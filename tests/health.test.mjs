import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");

// Run the real route with real Next request/response objects, as in
// http-regressions.test.mjs. Replace only the Supabase adapter boundary.
function loadSource(path, overrides = {}) {
  const file = new URL(path, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const compiled = { exports: {} };
  const localRequire = createRequire(file);
  new Function("require", "module", "exports", outputText)(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    compiled, compiled.exports,
  );
  return compiled.exports;
}

const bookingValidation = loadSource("../src/lib/booking-validation.ts");
const publicUrl = "https://health-test.supabase.invalid";
const publicKey = "dummy-public-health-test-key";
const validConfig = { time_zone: "UTC", min_date: "2026-01-01", max_date: "2026-04-01" };

function fixture(t, { env = {}, result = { data: [validConfig], error: null }, query, clientError, fetch } = {}) {
  const environment = {
    NEXT_PUBLIC_SUPABASE_URL: publicUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey,
    CRON_SECRET: undefined,
    ...env,
  };
  const previous = Object.fromEntries(Object.keys(environment).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(globalThis, "fetch", fetch ?? (async () => {
    throw new Error("Unexpected network access: health tests must stay offline");
  }));

  const calls = { clients: [], rpcs: [], signals: [] };
  const route = loadSource("../src/app/api/health/route.ts", {
    "@/lib/booking-validation": bookingValidation,
    "@supabase/supabase-js": { createClient(url, key, options) {
      calls.clients.push({ url, key, options });
      if (clientError) throw clientError;
      return {
        rpc(name, ...args) {
          calls.rpcs.push([name, ...args]);
          return { abortSignal(signal) {
            calls.signals.push(signal);
            return query ? query(signal, options) : Promise.resolve(result);
          } };
        },
      };
    } },
    "@/lib/supabase/server": { createClient() {
      throw new Error("Cookie/session clients must not be used for health checks");
    } },
  });
  return { ...route, calls };
}

function request(headers, search = "") {
  return new NextRequest(`https://salon.example/api/health${search}`, { headers });
}

async function assertHealth(response, status, detail) {
  assert.ok(response instanceof NextResponse, "execute the actual Next response path");
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.deepEqual(await response.json(), { ok: status === 200, ...(detail ? { detail } : {}) });
}

test("public health checks use only a stateless public-key client and the configuration RPC", async (t) => {
  const { GET, calls, dynamic } = fixture(t, {
    result: { data: [{ ...validConfig, private_detail: "must never be returned" }], error: null },
  });
  await assertHealth(await GET(request({
    Cookie: "sb-test-auth-token=visitor-cookie-test-fixture",
    Authorization: "Bearer visitor-session-test-fixture",
  })), 200);
  assert.equal(dynamic, "force-dynamic");
  assert.equal(calls.clients.length, 1);
  assert.equal(calls.clients[0].url, publicUrl);
  assert.equal(calls.clients[0].key, publicKey);
  const options = calls.clients[0].options;
  assert.deepEqual(options.auth, {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  });
  assert.deepEqual(Object.keys(options).sort(), ["auth", "global"]);
  assert.deepEqual(Object.keys(options.global), ["fetch"], "no visitor cookies or authorization forwarded");
  assert.deepEqual(calls.rpcs, [["get_booking_config"]], "do not query services, bookings, or auth");
  assert.ok(calls.signals[0] instanceof AbortSignal);
});

test("the upstream fetch is no-store while preserving the RPC request and abort signal", async (t) => {
  const forwarded = [];
  const original = { method: "POST", body: "{}", cache: "force-cache", headers: { apikey: publicKey } };
  const { GET, calls } = fixture(t, {
    fetch: async (input, init) => {
      forwarded.push({ input, init });
      return new Response(JSON.stringify([validConfig]), { headers: { "Content-Type": "application/json" } });
    },
    query: async (signal, options) => {
      const response = await options.global.fetch(`${publicUrl}/rest/v1/rpc/get_booking_config`, { ...original, signal });
      return { data: await response.json(), error: null };
    },
  });
  await assertHealth(await GET(request()), 200);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].input, `${publicUrl}/rest/v1/rpc/get_booking_config`);
  assert.deepEqual(forwarded[0].init, { ...original, cache: "no-store", signal: calls.signals[0] });
  assert.equal(original.cache, "force-cache", "do not mutate the caller's fetch options");
});

test("missing or empty public configuration fails safely without constructing a client", async (t) => {
  for (const [name, env] of [
    ["missing URL", { NEXT_PUBLIC_SUPABASE_URL: undefined }],
    ["missing public key", { NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }],
    ["empty URL", { NEXT_PUBLIC_SUPABASE_URL: "" }],
    ["empty public key", { NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }],
    ["both missing", { NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }],
  ]) {
    await t.test(name, async (t) => {
      const { GET, calls } = fixture(t, { env });
      await assertHealth(await GET(request()), 503);
      assert.deepEqual(calls.clients, []);
      assert.deepEqual(calls.rpcs, []);
    });
  }
});

test("valid named zones and real calendar bounds pass, including equal bounds and leap days", async (t) => {
  for (const config of [
    { ...validConfig, time_zone: "Asia/Kolkata" },
    { ...validConfig, time_zone: "America/New_York" },
    { ...validConfig, min_date: "2028-02-29", max_date: "2028-02-29" },
  ]) {
    await t.test(JSON.stringify(config), async (t) => {
      const { GET } = fixture(t, { result: { data: [config], error: null } });
      await assertHealth(await GET(request()), 200);
    });
  }
});

test("missing, ambiguous, or invalid booking configuration is a sanitized failure", async (t) => {
  const cases = [
    ["null result", null],
    ["missing result", undefined],
    ["no rows", []],
    ["multiple rows", [validConfig, validConfig]],
    ["not an array", validConfig],
    ["null row", [null]],
    ["array row", [[validConfig]]],
    ["missing fields", [{}]],
    ...[undefined, null, "", 42, "Mars/Olympus", "+05:30", "-08:00"].map((time_zone) => [
      `invalid zone ${String(time_zone)}`, [{ ...validConfig, time_zone }],
    ]),
    ...[undefined, "", "2026-2-01", "2026-02-29", "2026-02-30"].map((min_date) => [
      `invalid minimum ${String(min_date)}`, [{ ...validConfig, min_date }],
    ]),
    ["invalid maximum", [{ ...validConfig, max_date: "2026-04-31" }]],
    ["missing maximum", [{ ...validConfig, max_date: undefined }]],
    ["reversed bounds", [{ ...validConfig, min_date: "2026-04-02" }]],
  ];
  for (const [name, data] of cases) {
    await t.test(name, async (t) => {
      const { GET } = fixture(t, { result: { data, error: null } });
      await assertHealth(await GET(request()), 503);
    });
  }
});

test("authorized cron checks expose only sanitized step status", async (t) => {
  const env = { CRON_SECRET: "cron-secret-test" };
  const headers = { Authorization: "Bearer cron-secret-test" };
  const healthy = fixture(t, { env });
  await assertHealth(
    await healthy.GET(request(headers)),
    200,
    { env: "ok", rpc: "ok", config: "ok" },
  );
});

test("authorized cron diagnostics identify missing environment and RPC failures", async (t) => {
  const headers = { Authorization: "Bearer cron-secret-test" };
  const noEnvironment = fixture(t, {
    env: {
      CRON_SECRET: "cron-secret-test",
      NEXT_PUBLIC_SUPABASE_URL: undefined,
    },
  });
  await assertHealth(
    await noEnvironment.GET(request(headers)),
    503,
    { env: "failed", rpc: "skipped", config: "skipped" },
  );

  const rpcFailure = fixture(t, {
    env: { CRON_SECRET: "cron-secret-test" },
    result: { data: null, error: new Error("sensitive upstream message") },
  });
  await assertHealth(
    await rpcFailure.GET(request(headers)),
    503,
    { env: "ok", rpc: "failed", config: "skipped" },
  );
});

test("authorized cron diagnostics distinguish invalid configuration", async (t) => {
  const { GET } = fixture(t, {
    env: { CRON_SECRET: "cron-secret-test" },
    result: { data: [{ ...validConfig, time_zone: "invalid-zone" }], error: null },
  });
  await assertHealth(
    await GET(request({ Authorization: "Bearer cron-secret-test" })),
    503,
    { env: "ok", rpc: "ok", config: "failed" },
  );
});

test("unauthorized cron checks do not disclose diagnostic details", async (t) => {
  const { GET } = fixture(t, { env: { CRON_SECRET: "cron-secret-test" } });
  await assertHealth(await GET(request()), 401);
});

test("query errors and thrown query/client failures never expose upstream details", async (t) => {
  const detail = "private upstream URL, key, and database diagnostic test fixture";
  for (const [name, options] of [
    ["query error with otherwise valid data", { result: { data: [validConfig], error: { message: detail } } }],
    ["thrown query", { query: () => { throw new Error(detail); } }],
    ["rejected query", { query: async () => { throw new Error(detail); } }],
    ["invalid client configuration", { clientError: new Error(detail), env: { NEXT_PUBLIC_SUPABASE_URL: "invalid-project-url" } }],
    ["missing query response", { query: async () => undefined }],
  ]) {
    await t.test(name, async (t) => {
      const { GET } = fixture(t, options);
      await assertHealth(await GET(request()), 503);
    });
  }
});

test("the configuration query gets a five-second abort timeout and aborted checks fail safely", { timeout: 2000 }, async (t) => {
  const controller = new AbortController();
  const timeouts = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    timeouts.push(milliseconds);
    return controller.signal;
  });
  const { GET, calls } = fixture(t, {
    query: (signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve({
        data: null, error: new DOMException("Private timeout diagnostic", "AbortError"),
      }), { once: true });
    }),
  });
  const pending = GET(request());
  assert.deepEqual(timeouts, [5000]);
  assert.deepEqual(calls.signals, [controller.signal]);
  controller.abort();
  await assertHealth(await pending, 503);
});

test("a nonempty cron secret requires the exact Bearer header before any client or query work", async (t) => {
  for (const authorization of [
    undefined, "", "Bearer incorrect", "bearer required-test-secret", "Basic required-test-secret",
    "Bearer  required-test-secret", "Bearer required-test-secret-extra",
    "Bearer required-test-secret, Bearer required-test-secret",
  ]) {
    await t.test(String(authorization), async (t) => {
      const { GET, calls } = fixture(t, { env: {
        CRON_SECRET: "required-test-secret",
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      } });
      const headers = authorization === undefined ? {} : { Authorization: authorization };
      await assertHealth(await GET(request(headers, "?CRON_SECRET=required-test-secret")), 401);
      assert.deepEqual(calls.clients, []);
      assert.deepEqual(calls.rpcs, []);
    });
  }
});

test("unset/empty secrets permit public checks and a configured exact Bearer secret succeeds", async (t) => {
  for (const [secret, authorization] of [
    [undefined, undefined], ["", undefined], ["", "Bearer unrelated-visitor-token"],
    ["required-test-secret", "Bearer required-test-secret"],
  ]) {
    await t.test(`secret ${String(secret)}; header ${String(authorization)}`, async (t) => {
      const { GET, calls } = fixture(t, { env: { CRON_SECRET: secret } });
      await assertHealth(
        await GET(request(authorization === undefined ? {} : { Authorization: authorization })),
        200,
        secret ? { env: "ok", rpc: "ok", config: "ok" } : undefined,
      );
      assert.equal(calls.clients.length, 1);
      assert.deepEqual(calls.rpcs, [["get_booking_config"]]);
    });
  }
});

test("Vercel schedules only the health endpoint daily at 03:00 UTC", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.crons, [{ path: "/api/health", schedule: "0 3 * * *" }]);
});
