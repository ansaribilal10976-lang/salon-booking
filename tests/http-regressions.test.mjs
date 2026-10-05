import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");

// Execute the actual route/middleware without SWC or a running Next server.
// Only database adapters are replaced; Next request/response objects are real.
function loadSource(path, overrides = {}) {
  const file = new URL(path, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const localRequire = createRequire(file);
  new Function("require", "module", "exports", outputText)(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    module, module.exports,
  );
  return module.exports;
}

function streamedRequest(payload, contentLength, cancelResult) {
  const bytes = new TextEncoder().encode(payload);
  const state = { bytesRead: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      if (state.bytesRead === bytes.length) { controller.close(); return; }
      const chunk = bytes.slice(state.bytesRead, state.bytesRead + 1024);
      state.bytesRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() { state.cancelled = true; return cancelResult?.(); },
  }, { highWaterMark: 0 });
  const headers = { "Content-Type": "application/json", Origin: "https://salon.example" };
  if (contentLength !== undefined) headers["Content-Length"] = contentLength;
  const request = new NextRequest("https://salon.example/api/bookings", {
    method: "POST", headers, body, duplex: "half",
  });
  return { request, state, totalBytes: bytes.length };
}

test("booking route enforces its 4 KB byte cap before consuming the full stream", { timeout: 5000 }, async () => {
  const accepted = [];
  const { POST } = loadSource("../src/app/api/bookings/route.ts", {
    "@/lib/booking-operations": { submitBooking: async (input) => {
      accepted.push(input);
      return { status: 201, body: { saved: true } };
    } },
    "@/lib/supabase/server": { createClient: () => { throw new Error("No database access expected"); } },
  });
  // The character count fits below 4 KB, but UTF-8 bytes exceed the cap.
  const oversized = JSON.stringify({ note: "é".repeat(3000) });
  assert.ok(oversized.length < 4096);
  for (const [contentLength, cancelResult] of [
    [undefined, undefined],
    ["1", () => Promise.reject(new Error("Cancellation failed"))],
    [undefined, () => new Promise(() => {})],
  ]) {
    const { request, state, totalBytes } = streamedRequest(oversized, contentLength, cancelResult);
    const response = await POST(request);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "Booking details are too long." });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(state.cancelled, true);
    assert.equal(state.bytesRead, 5120, "stop at the first chunk exceeding 4096 bytes");
    assert.ok(state.bytesRead < totalBytes, "do not buffer the rest of the body");
    assert.equal(accepted.length, 0, "oversized input must not reach booking persistence");
    assert.equal(request.body.locked, false, "release the stream reader");
  }
  for (const size of [4095, 4096]) {
    const payload = JSON.stringify({ note: "a".repeat(size - 11) });
    const { request, state } = streamedRequest(payload);
    assert.equal(new TextEncoder().encode(payload).length, size);
    assert.equal((await POST(request)).status, 201);
    assert.deepEqual(accepted.at(-1), JSON.parse(payload));
    assert.equal(state.cancelled, false);
    assert.equal(request.body.locked, false);
  }
  const { request } = streamedRequest("{not JSON}");
  assert.equal((await POST(request)).status, 400);
  assert.equal(accepted.length, 2, "malformed JSON must not reach persistence");
});

test("middleware fails closed for an invalid Supabase URL on admin pages and APIs", async (t) => {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  let networkCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { networkCalls++; throw new Error("No network access expected"); });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "invalid-project-url";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-public-test-key";
  try {
    const { middleware } = loadSource("../src/middleware.ts");
    for (const path of ["/admin", "/admin/login", "/api/admin/services"]) {
      const response = await middleware(new NextRequest(`https://salon.example${path}`));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("x-middleware-next"), null, "never forward the protected request");
      assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
      const body = await response.json();
      assert.deepEqual(body, { error: "Admin access could not be verified. Please try again." });
      assert.equal(JSON.stringify(body).includes("invalid-project-url"), false);
    }
    assert.equal(networkCalls, 0);
  } finally {
    for (const [name, value] of [
      ["NEXT_PUBLIC_SUPABASE_URL", previous.url],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", previous.key],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
