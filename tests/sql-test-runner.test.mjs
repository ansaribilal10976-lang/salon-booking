import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const runner = fileURLToPath(new URL("../scripts/run-sql-tests.sh", import.meta.url));
const sqlDirectory = fileURLToPath(new URL("../supabase/tests/", import.meta.url));
const forbiddenProjectRef = process.env.FORBIDDEN_PROJECT_REF ?? "fixture-live-project-ref";

// Invoke the shell runner ONLY with a fake psql first in PATH. This never opens
// a database or reads application credentials; every invocation is recorded.
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "salon-sql-runner-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, "calls.jsonl");
  writeFileSync(join(directory, "psql"), `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.FAKE_PSQL_LOG, JSON.stringify({
  args: process.argv.slice(2),
  targetDefaults: ['PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGSERVICE','PGSERVICEFILE'].map(name => process.env[name] ?? null),
}) + '\\n');
process.exit(process.env.FAKE_PSQL_FAIL === '1' ? 9 : 0);
`, { mode: 0o700 });
  const run = (database, extra = {}) => {
    const env = {
      ...process.env, PATH: `${directory}:${process.env.PATH}`, FAKE_PSQL_LOG: log,
      FORBIDDEN_PROJECT_REF: forbiddenProjectRef,
      // A inherited remote libpq target must be removed before fake psql runs.
      PGHOSTADDR: "203.0.113.10", PGSERVICE: "remote-test-fixture", PGDATABASE: "other-test-fixture",
      ...extra,
    };
    delete env.TESTDB;
    if (database !== undefined) env.TESTDB = database;
    const result = spawnSync("bash", [runner], { env, encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined);
    let calls = [];
    try { calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return { ...result, calls, output: result.stdout + result.stderr };
  };
  return run;
}

test("SQL runner refuses missing/blank TESTDB and never falls back to DATABASE_URL", (t) => {
  for (const database of [undefined, "", "   ", "\t\n"]) {
    const result = fixture(t)(database, { DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/unused_test" });
    assert.notEqual(result.status, 0);
    assert.equal(result.calls.length, 0);
    assert.match(result.output, /Refusing SQL tests/);
  }
});

test("SQL runner refuses live refs, remote targets, and libpq target overrides", (t) => {
  for (const database of [
    `postgresql://postgres@${forbiddenProjectRef}.supabase.co/test`,
    `postgresql://postgres@127.0.0.1/${forbiddenProjectRef}`,
    `postgresql://postgres@127.0.0.1/${forbiddenProjectRef.toUpperCase()}`,
    `postgresql://postgres@127.0.0.1/%${forbiddenProjectRef.charCodeAt(0).toString(16)}${forbiddenProjectRef.slice(1)}`,
    "postgresql://postgres@db.example.invalid/test",
    "postgresql://postgres@192.0.2.1/test",
    "postgresql://postgres@[2001:db8::1]/test",
    "postgresql://postgres@127.0.0.1,remote.invalid/test",
    "postgresql://postgres@127.0.0.1/test?host=remote.invalid",
    "postgresql://postgres@127.0.0.1/test?hostaddr=192.0.2.1",
    "postgresql://postgres@127.0.0.1/test?service=remote",
    "postgresql://postgres@127.0.0.1/test?dbname=postgresql%3A%2F%2Fremote.invalid%2Ftest",
    "postgresql://postgres@127.0.0.1/test?%68ost=remote.invalid",
    "postgresql:///test", "postgresql://postgres@127.0.0.1/", "not a URI",
    "host=localhost dbname=test", "https://localhost/test",
  ]) {
    const result = fixture(t)(database);
    assert.notEqual(result.status, 0, database);
    assert.equal(result.calls.length, 0, database);
    assert.match(result.output, /Refusing SQL tests/);
    assert.equal(result.output.includes(database), false, "never echo the connection string");
  }
});

test("SQL runner uses only TESTDB, stops before manual races, and does not reveal the URI", (t) => {
  const expected = readdirSync(sqlDirectory).filter(name => name.endsWith(".sql") && name !== "booking_concurrency.sql").sort();
  assert.ok(expected.includes("booking_rate_limits.sql"));
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const database = `postgresql://postgres:test-only-password@${host}:5432/disposable_test?sslmode=disable`;
    const result = fixture(t)(database, { DATABASE_URL: "postgresql://ignored.invalid/never_used" });
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.calls.map(({ args }) => basename(args.at(-1))), expected);
    for (const { args, targetDefaults } of result.calls) {
      assert.deepEqual(args.slice(0, 5), ["-X", "-w", database, "-v", "ON_ERROR_STOP=1"]);
      assert.equal(args[5], "-f");
      assert.deepEqual(targetDefaults, [null, null, null, null, null, null]);
    }
    assert.match(result.output, /booking_concurrency.sql was NOT executed/);
    assert.match(result.output, /quota_kind=global, active, window/);
    assert.equal(result.output.includes(database), false);
    assert.equal(result.output.includes("test-only-password"), false);
  }
});

test("SQL runner stops immediately when an ordinary SQL file fails", (t) => {
  const result = fixture(t)("postgres://postgres@127.0.0.1/disposable_test", { FAKE_PSQL_FAIL: "1" });
  assert.equal(result.status, 9);
  assert.equal(result.calls.length, 1);
  assert.equal(result.output.includes("Ordinary SQL tests completed"), false);
});
