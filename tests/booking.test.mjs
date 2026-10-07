import assert from "node:assert/strict";
import { test } from "node:test";
import { isCalendarDate, isSlotInstant, isUuid, validateBookingRequest, formatBookingDate, formatSlotTime } from "../src/lib/booking-validation.ts";
import { getAvailability, getConfirmedBooking, submitBooking } from "../src/lib/booking-operations.ts";

const bookingId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const input = { bookingId, serviceId, slotTime: "2030-01-15T10:00:00Z", customerName: "Alex Morgan", phone: "+1 202-555-0147" };
const receipt = {
  id: bookingId, service_id: serviceId, slot_time: "2030-01-15T10:00:00+00:00",
  end_time: "2030-01-15T11:00:00+00:00", customer_name: input.customerName,
  phone: input.phone, status: "confirmed",
};
const savedResult = async () => ({ data: [receipt], error: null });

test("only real calendar dates are accepted, including leap days", () => {
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("2030-01-15"), true);
  for (const invalid of ["2030-02-29", "2030-02-30", "2030-13-01", "2030-01-32", "15/01/2030", "", null]) {
    assert.equal(isCalendarDate(invalid), false);
  }
});

test("slot instants require a real date, valid clock time, and an explicit timezone", () => {
  assert.equal(isSlotInstant("2030-01-15T10:30:00Z"), true);
  assert.equal(isSlotInstant("2030-01-15T10:30:00+02:00"), true);
  for (const invalid of ["2030-01-15T10:30:00", "2030-01-15", "2030-02-30T10:00:00Z", "2030-01-15T24:00:00Z", "2030-01-15T10:60:00Z", "tomorrow", null]) {
    assert.equal(isSlotInstant(invalid), false);
  }
});

test("preview IDs and malformed IDs cannot reach the booking RPC", () => {
  assert.equal(isUuid(serviceId), true);
  assert.equal(isUuid("preview-cut"), false);
  const result = validateBookingRequest({ ...input, serviceId: "preview-cut", bookingId: "invalid" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.serviceId);
  assert.ok(result.errors.bookingId);
});

test("contact fields are trimmed and slot offsets normalize to one instant", () => {
  const result = validateBookingRequest({ ...input, customerName: "  Alex Morgan  ", phone: "  +1 202-555-0147  ", slotTime: "2030-01-15T12:00:00+02:00" });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { ...input, slotTime: "2030-01-15T10:00:00.000Z" });
});

test("names support accents, spaces and apostrophes without accepting empty or control-character input", () => {
  assert.equal(validateBookingRequest({ ...input, customerName: "Chloé O’Connor" }).valid, true);
  for (const name of ["", " ", "A", "A".repeat(101), "Alex\nMorgan", "Alex\u0000Morgan"]) {
    const result = validateBookingRequest({ ...input, customerName: name });
    assert.equal(result.valid, false);
    assert.ok(result.errors.customerName);
  }
});

test("phone validation preserves leading zeros and rejects incomplete or non-phone input", () => {
  assert.equal(validateBookingRequest({ ...input, phone: "020 7946 0147" }).value.phone, "020 7946 0147");
  assert.equal(validateBookingRequest({ ...input, phone: "+1 (202) 555-0147" }).valid, true);
  assert.equal(validateBookingRequest({ ...input, phone: "  1234567  " }).value.phone, "1234567");
  for (const phone of ["", "123", "1234567890123456", "call-me", "+1 202\n5550147", "1" + "-".repeat(40) + "234567"]) {
    const result = validateBookingRequest({ ...input, phone });
    assert.equal(result.valid, false);
    assert.ok(result.errors.phone);
  }
});

test("null, array and untrusted objects fail validation without throwing", () => {
  for (const value of [null, [], "text", 42, {}, { ...input, customerName: {} }]) {
    assert.equal(validateBookingRequest(value).valid, false);
  }
});

test("slot labels use the salon timezone rather than the visitor timezone, including DST", () => {
  assert.equal(formatSlotTime("2030-01-15T15:00:00Z", "America/New_York"), "10:00 AM");
  assert.equal(formatSlotTime("2030-07-15T14:00:00Z", "America/New_York"), "10:00 AM");
  assert.match(formatBookingDate("2030-01-15"), /January 15, 2030/);
});

test("invalid availability input never invokes the database adapter", async () => {
  let called = false;
  const result = await getAvailability("preview-cut", "2030-02-30", async () => { called = true; return { data: [], error: null }; });
  assert.equal(called, false);
  assert.equal(result.status, 400);
});

test("availability exposes only slot instants, never extra customer fields", async () => {
  const result = await getAvailability(serviceId, "2030-01-15", async (id, date) => {
    assert.equal(id, serviceId);
    assert.equal(date, "2030-01-15");
    return { data: [{ slot_time: input.slotTime, phone: "must-not-leak" }], error: null };
  });
  assert.deepEqual(result, { status: 200, body: { slots: [{ slot_time: input.slotTime }] } });
});

test("fully booked dates remain empty and do not invent fallback availability", async () => {
  const result = await getAvailability(serviceId, "2030-01-15", async () => ({ data: [], error: null }));
  assert.deepEqual(result, { status: 200, body: { slots: [] } });
});

test("availability failures are distinguishable from fully booked dates and omit raw database errors", async () => {
  for (const query of [
    async () => ({ data: null, error: { message: "private connection detail", code: "XX000" } }),
    async () => { throw new Error("private connection detail"); },
    async () => ({ data: [{ slot_time: "not a date" }], error: null }),
  ]) {
    const result = await getAvailability(serviceId, "2030-01-15", query);
    assert.equal(result.status, 503);
    assert.equal(JSON.stringify(result).includes("private connection detail"), false);
    assert.equal("slots" in result.body, false);
  }
});

test("invalid booking details never attempt a write", async () => {
  let writes = 0;
  const result = await submitBooking({ ...input, phone: "" }, async () => { writes++; return savedResult(); });
  assert.equal(result.status, 400);
  assert.ok(result.body.fieldErrors.phone);
  assert.equal(writes, 0);
});

test("successful writes return the actual matching database receipt", async () => {
  const result = await submitBooking(input, async (request) => {
    assert.equal(request.bookingId, bookingId);
    assert.equal(request.serviceId, serviceId);
    assert.equal(request.slotTime, "2030-01-15T10:00:00.000Z");
    assert.equal("status" in request, false);
    return savedResult();
  });
  assert.deepEqual(result, { status: 201, body: { booking: receipt } });
});

test("untrusted status and price fields are not forwarded to the booking RPC", async () => {
  const result = await submitBooking({ ...input, status: "cancelled", price: 0 }, async (request) => {
    assert.equal("status" in request, false);
    assert.equal("price" in request, false);
    return savedResult();
  });
  assert.equal(result.status, 201);
});

test("database slot conflicts become a recoverable 409 without leaking contact details", async () => {
  for (const error of [{ code: "23P01", message: "private detail" }, { code: "23505" }, { message: "SLOT_UNAVAILABLE" }]) {
    const result = await submitBooking(input, async () => ({ data: null, error }));
    assert.equal(result.status, 409);
    assert.match(result.body.error, /choose another/i);
    assert.equal(JSON.stringify(result).includes("private detail"), false);
  }
});

test("database quotas become friendly 429 responses without exposing private details", async () => {
  const limits = [
    ["PHONE_ACTIVE_LIMIT", /upcoming appointments.*contact the salon/i],
    ["PHONE_WINDOW_LIMIT", /past 24 hours.*try again later/i],
    ["GLOBAL_SUBMISSION_LIMIT", /daily.*try again tomorrow.*contact the salon/i],
    ["UNRECOGNIZED_LIMIT", /booking limit.*try again later.*contact the salon/i],
  ];
  for (const [message, friendly] of limits) {
    const result = await submitBooking(input, async () => ({
      data: null, error: { code: "PT429", message, details: "private quota/customer data", hint: "must-not-leak" },
    }));
    assert.equal(result.status, 429);
    assert.match(result.body.error, friendly);
    assert.equal("booking" in result.body, false);
    assert.equal(JSON.stringify(result).includes("private quota/customer data"), false);
    assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
    assert.equal(JSON.stringify(result).includes(message), false);
  }
});

test("a quota rejection preserves submitted details and the UUID for a later retry", async () => {
  const before = structuredClone(input);
  const requests = [];
  const persist = async (request) => {
    requests.push(request);
    return requests.length === 1
      ? { data: null, error: { code: "PT429", message: "PHONE_WINDOW_LIMIT" } }
      : savedResult();
  };
  assert.equal((await submitBooking(input, persist)).status, 429);
  assert.equal((await submitBooking(input, persist)).status, 201);
  assert.deepEqual(input, before);
  assert.equal(requests[0].bookingId, bookingId);
  assert.deepEqual(requests[0], requests[1]);
});

test("database validation errors remain failures instead of false confirmations", async () => {
  const result = await submitBooking(input, async () => ({ data: null, error: { code: "22023", message: "REQUEST_MISMATCH" } }));
  assert.equal(result.status, 400);
  assert.equal("booking" in result.body, false);
});

test("missing, mismatched or unconfirmed receipts never show a successful booking", async () => {
  for (const data of [null, [], [{ ...receipt, id: serviceId }], [{ ...receipt, service_id: bookingId }], [{ ...receipt, status: "pending" }], [{ ...receipt, phone: "wrong phone" }], [{ ...receipt, end_time: receipt.slot_time }]]) {
    const result = await submitBooking(input, async () => ({ data, error: null }));
    assert.equal(result.status, 503);
    assert.equal("booking" in result.body, false);
  }
});

test("unknown write outcomes encourage safe same-request retries", async () => {
  const result = await submitBooking(input, async () => { throw new Error("network timeout after possible commit"); });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /retry with the same details/);
  assert.equal("booking" in result.body, false);
});

test("success-screen receipt validation rejects malformed dates, contact mismatches and unknown statuses", () => {
  assert.deepEqual(getConfirmedBooking(receipt, input), receipt);
  for (const invalid of [null, {}, { ...receipt, slot_time: "bad date" }, { ...receipt, end_time: "bad date" }, { ...receipt, customer_name: "Wrong Customer" }, { ...receipt, status: "cancelled" }]) {
    assert.equal(getConfirmedBooking(invalid, input), null);
  }
});

test("success-screen summaries contain only safe matching receipt fields", () => {
  assert.deepEqual(getConfirmedBooking({ ...receipt, internal_note: "private data" }, input), receipt);
});

test("retry requests preserve the same idempotency ID and accept the existing database receipt", async () => {
  const ids = [];
  const persist = async (request) => { ids.push(request.bookingId); return savedResult(); };
  const first = await submitBooking(input, persist);
  const retried = await submitBooking(input, persist);
  assert.deepEqual(ids, [bookingId, bookingId]);
  assert.deepEqual(first, retried);
  // Database-level deduplication/race protection is exercised by SQL tests,
  // not by this mocked adapter test.
});
