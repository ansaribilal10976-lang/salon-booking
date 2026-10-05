import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAdminAccess, runAdminOperation } from "../src/lib/admin-access.ts";
import { parseAdminFilters, validateServiceInput, canChangeBookingStatus, isAdminPasswordInput } from "../src/lib/admin-validation.ts";
import { saveAdminService, deleteAdminService, setAdminBookingStatus } from "../src/lib/admin-operations.ts";

const adminId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const bookingId = "33333333-3333-4333-8333-333333333333";
const service = { id: serviceId, name: "Haircut & blow-dry", duration: 60, price: 65 };
const signedIn = async () => ({ user: { id: adminId, email: "admin@example.test" }, error: null });
const adminRole = async () => ({ data: true, error: null });

test("anonymous sessions are denied without even checking the admin RPC", async () => {
  let checked = false;
  const access = await resolveAdminAccess(async () => ({ user: null, error: null }), async () => { checked = true; return { data: true, error: null }; });
  assert.equal(access.allowed, false);
  assert.equal(access.status, 401);
  assert.equal(checked, false);
});

test("a signed-in account is not an admin without the database allowlist", async () => {
  const access = await resolveAdminAccess(signedIn, async () => ({ data: false, error: null }));
  assert.equal(access.allowed, false);
  assert.equal(access.status, 403);
});

test("editable user metadata and an admin-looking email never authorize an account", async () => {
  const access = await resolveAdminAccess(async () => ({ user: { id: adminId, email: "admin@example.test", user_metadata: { role: "admin", is_admin: true } }, error: null }), async () => ({ data: false, error: null }));
  assert.equal(access.allowed, false);
  assert.equal(access.status, 403);
});

test("expired identity is rejected even if a role callback would return true", async () => {
  const access = await resolveAdminAccess(async () => ({ user: { id: adminId }, error: { message: "expired" } }), adminRole);
  assert.equal(access.status, 401);
});

test("missing migrations, errors and unreachable auth fail closed without exposing internal details", async () => {
  for (const check of [async () => ({ data: null, error: null }), async () => ({ data: true, error: { message: "private database detail" } }), async () => { throw new Error("private database detail"); }]) {
    const access = await resolveAdminAccess(signedIn, check);
    assert.equal(access.allowed, false);
    assert.equal(access.status, 503);
    assert.equal(JSON.stringify(access).includes("private database detail"), false);
  }
});

test("verified allowlisted admins get only safe identity fields", async () => {
  const access = await resolveAdminAccess(async () => ({ user: { id: adminId, email: "admin@example.test", token: "must-not-appear" }, error: null }), adminRole);
  assert.deepEqual(access, { allowed: true, user: { id: adminId, email: "admin@example.test" } });
});

test("the API operation guard never runs database work for rejected access", async () => {
  for (const status of [401, 403, 503]) {
    let ran = false;
    const result = await runAdminOperation({ allowed: false, status, error: "Denied" }, async () => { ran = true; return { status: 200, body: {} }; });
    assert.equal(ran, false);
    assert.deepEqual(result, { status, body: { error: "Denied" } });
  }
});

test("the API operation guard runs allowed work once", async () => {
  let calls = 0;
  const result = await runAdminOperation({ allowed: true, user: { id: adminId } }, async () => { calls++; return { status: 200, body: { saved: true } }; });
  assert.equal(calls, 1);
  assert.equal(result.body.saved, true);
});

test("today/upcoming pagination validates query parameters and caps database offsets", () => {
  assert.deepEqual(parseAdminFilters("upcoming", "2"), { view: "upcoming", page: 2, offset: 50 });
  assert.deepEqual(parseAdminFilters("today", "201"), { view: "today", page: 201, offset: 10000 });
  for (const page of ["0", "-1", "1.5", "202", "Infinity", "NaN", "999999999999999999999", ["2"], undefined]) {
    assert.deepEqual(parseAdminFilters("bad view", page), { view: "today", page: 1, offset: 0 });
  }
});

test("service validation trims names and accepts practical durations and prices", () => {
  assert.deepEqual(validateServiceInput({ name: "  Root color touch-up  ", duration: 90, price: 95.5 }), { valid: true, value: { name: "Root color touch-up", duration: 90, price: 95.5 } });
  assert.equal(validateServiceInput({ name: "Complimentary consultation", duration: 1, price: 0 }).valid, true);
  assert.equal(validateServiceInput({ name: "A".repeat(120), duration: 600, price: 99999999.99 }).valid, true);
});

test("invalid service names, fractional durations, excessive duration and malformed prices are rejected", () => {
  for (const invalid of [
    { ...service, name: " " }, { ...service, name: "A".repeat(121) }, { ...service, name: "Cut\nFinish" },
    { ...service, duration: 0 }, { ...service, duration: 601 }, { ...service, duration: 30.5 }, { ...service, duration: "60" },
    { ...service, price: -1 }, { ...service, price: Infinity }, { ...service, price: NaN }, { ...service, price: 1.234 }, { ...service, price: 100000000 }, { ...service, price: "65" },
    null, [], {},
  ]) assert.equal(validateServiceInput(invalid).valid, false);
});

test("service creation passes only whitelisted mutable fields, not supplied IDs or privileges", async () => {
  const result = await saveAdminService({ ...service, is_admin: true }, null, async (values, id) => {
    assert.deepEqual(values, { name: service.name, duration: service.duration, price: service.price });
    assert.equal(id, null);
    return { data: [service], error: null };
  });
  assert.deepEqual(result, { status: 201, body: { service } });
});

test("editing saves and returns the matching service rather than echoing unsaved inputs", async () => {
  const result = await saveAdminService(service, serviceId, async (values, id) => { assert.equal(id, serviceId); return { data: [{ id, ...values }], error: null }; });
  assert.deepEqual(result, { status: 200, body: { service } });
  const mismatch = await saveAdminService(service, serviceId, async () => ({ data: [{ ...service, price: 0 }], error: null }));
  assert.equal(mismatch.status, 503);
});

test("invalid service edits never invoke persistence", async () => {
  let calls = 0;
  const result = await saveAdminService({ ...service, duration: 0 }, serviceId, async () => { calls++; return { data: [service], error: null }; });
  assert.equal(result.status, 400);
  assert.ok(result.body.fieldErrors.duration);
  assert.equal(calls, 0);
});

test("missing or forbidden service writes are explicit failures", async () => {
  assert.equal((await saveAdminService(service, serviceId, async () => ({ data: [], error: null }))).status, 404);
  const denied = await saveAdminService(service, null, async () => ({ data: null, error: { code: "42501", message: "private policy detail" } }));
  assert.equal(denied.status, 403);
  assert.equal(JSON.stringify(denied).includes("private policy detail"), false);
});

test("service deletion requires a verified matching deleted row", async () => {
  const deleted = await deleteAdminService(serviceId, async (id) => ({ data: [{ id }], error: null }));
  assert.deepEqual(deleted, { status: 200, body: { deletedId: serviceId } });
  assert.equal((await deleteAdminService(serviceId, async () => ({ data: [], error: null }))).status, 404);
  assert.equal((await deleteAdminService(serviceId, async () => ({ data: null, error: null }))).status, 503);
});

test("deleting a booked service reports a recoverable conflict rather than deleting history", async () => {
  const result = await deleteAdminService(serviceId, async () => ({ data: null, error: { code: "23503", message: "private foreign-key detail" } }));
  assert.equal(result.status, 409);
  assert.match(result.body.error, /bookings attached/);
  assert.equal(JSON.stringify(result).includes("private foreign-key detail"), false);
});

test("booking actions allow pending/confirmed changes but no cancelled or completed reopening", () => {
  assert.equal(canChangeBookingStatus("pending", "confirmed"), true);
  assert.equal(canChangeBookingStatus("confirmed", "cancelled"), true);
  assert.equal(canChangeBookingStatus("cancelled", "confirmed"), false);
  assert.equal(canChangeBookingStatus("completed", "cancelled"), false);
  assert.equal(canChangeBookingStatus("pending", "completed"), false);
});

test("admin status saves return only ID/status, without re-exposing customer contact data", async () => {
  const result = await setAdminBookingStatus(bookingId, { status: "cancelled", customer_name: "not forwarded" }, async (id, status) => ({ data: [{ id, status, customer_name: "private name", phone: "private phone" }], error: null }));
  assert.deepEqual(result, { status: 200, body: { booking: { id: bookingId, status: "cancelled" } } });
});

test("invalid booking targets and IDs never reach the status RPC", async () => {
  for (const [id, status] of [[bookingId, "completed"], ["invalid", "cancelled"], [bookingId, "pending"]]) {
    let called = false;
    const result = await setAdminBookingStatus(id, { status }, async () => { called = true; return { data: [], error: null }; });
    assert.equal(called, false);
    assert.equal(result.status, 400);
  }
});

test("final-state and racing status changes do not yield false successes", async () => {
  const rejected = await setAdminBookingStatus(bookingId, { status: "confirmed" }, async () => ({ data: null, error: { code: "22023", message: "private status detail" } }));
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /cannot be reopened/);
  assert.equal(JSON.stringify(rejected).includes("private status detail"), false);
  const mismatch = await setAdminBookingStatus(bookingId, { status: "confirmed" }, async () => ({ data: [{ id: bookingId, status: "cancelled" }], error: null }));
  assert.equal(mismatch.status, 503);
});

test("unknown admin write outcomes prompt refresh instead of false save notifications", async () => {
  const result = await saveAdminService(service, null, async () => { throw new Error("private timeout detail"); });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /Refresh/);
  assert.equal(JSON.stringify(result).includes("private timeout detail"), false);
});

test("email/password validation accepts valid credentials and rejects malformed input without trimming passwords", () => {
  assert.equal(isAdminPasswordInput(" team@example.test ", " keep spaces "), true);
  assert.equal(isAdminPasswordInput("team@example.test", ""), false);
  assert.equal(isAdminPasswordInput("not an email", "password"), false);
  assert.equal(isAdminPasswordInput(null, "password"), false);
  assert.equal(isAdminPasswordInput("team@example.test", null), false);
});
