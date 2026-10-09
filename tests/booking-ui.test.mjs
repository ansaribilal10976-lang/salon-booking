import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as salon from "../src/lib/salon.ts";
import * as validation from "../src/lib/booking-validation.ts";
import * as operations from "../src/lib/booking-operations.ts";
import { button, card, cssModule, link, loadSource, withStateFixtures } from "./ui-harness.mjs";

const service = { id: "b1b4285a-22a1-4b1b-949c-b5fb5a6b59f0", name: "Haircut & finish", duration: 90, price: 1234.5 };
const config = { min_date: "2026-10-12", max_date: "2026-11-12", time_zone: "Asia/Kolkata" };
const slot = "2026-10-12T04:30:00Z";
const ready = { key: `${service.id}:${config.min_date}`, status: "ready", slots: [{ slot_time: slot }] };

function renderFlow(fixtures = {}, props = {}) {
  const path = "../src/components/booking-flow.tsx";
  const { BookingFlow } = loadSource(path, {
    react: withStateFixtures(path, fixtures),
    "next/link": link,
    "@/components/ui/button": button,
    "@/components/ui/card": card,
    "@/app/book/booking.module.css": cssModule,
    "@/lib/salon": salon,
    "@/lib/booking-validation": validation,
    "@/lib/booking-operations": operations,
  });
  return renderToStaticMarkup(React.createElement(BookingFlow, { services: [service], config, initialServiceId: "", ...props }));
}

function assertSubmitDisabled(html, disabled) {
  const tag = html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
  assert.ok(tag, "submit button exists");
  assert.equal(tag.includes('disabled=""'), disabled);
  assert.ok(tag.includes('data-slot="button"'));
}

function assertDescriptionsExist(html) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, description] of html.matchAll(/aria-describedby="([^"]+)"/g)) {
    for (const id of description.split(" ")) assert.ok(ids.includes(id), `${id} exists`);
  }
}

test("booking service selection retains native radios, prices, duration and disabled continuation", () => {
  const html = renderFlow();
  assert.match(html, /aria-label="Booking progress"/);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /type="radio" name="service"/);
  assert.ok(html.includes(service.id));
  assert.ok(html.includes("Haircut &amp; finish"));
  assert.ok(html.includes("1 hr 30 min"));
  assert.ok(html.includes("₹1,234.50"));
  assert.match(html, /Choose a service to see its duration/);
  assertSubmitDisabled(html, true);
  assertSubmitDisabled(renderFlow({ serviceId: service.id }), false);
});

test("booking deep links still open the date step and unknown service IDs stay on service selection", () => {
  const html = renderFlow({}, { initialServiceId: service.id });
  assert.match(html, /Find your time/);
  assert.match(html, /type="date"/);
  assert.ok(html.includes(`min="${config.min_date}"`));
  assert.ok(html.includes(`max="${config.max_date}"`));
  assert.match(html, /Asia\/Kolkata/);
  assert.match(html, /role="status"[^>]*>Checking the salon/);
  assertSubmitDisabled(html, true);
  assert.match(renderFlow({}, { initialServiceId: "preview-cut" }), /Choose your service/);
});

test("booking availability renders error, empty, invalid-date and selected-slot states distinctly", () => {
  const base = { step: 1, serviceId: service.id };
  const failed = renderFlow({ ...base, availability: { ...ready, status: "error", slots: [], error: "Schedule unavailable." } });
  assert.match(failed, /role="alert"[^>]*>Schedule unavailable\./);
  assert.match(failed, /Try again/);
  assertSubmitDisabled(failed, true);
  const empty = renderFlow({ ...base, availability: { ...ready, slots: [] } });
  assert.match(empty, /No times are available/);
  assert.doesNotMatch(empty, /Try again/);
  assertSubmitDisabled(empty, true);
  const invalid = renderFlow({ ...base, date: "2027-01-01" });
  assert.match(invalid, /Choose a date between/);
  assert.match(invalid, /aria-invalid="true"/);
  const selected = renderFlow({ ...base, availability: ready, slotTime: slot });
  assert.match(selected, /name="slot"[^>]*checked=""/);
  assert.match(selected, /10:00 AM/);
  assert.match(selected, /Selected time/);
  assertSubmitDisabled(selected, false);
});

test("booking details preserve field names, autocomplete, error associations and submitting state", () => {
  const fixtures = { step: 2, serviceId: service.id, availability: ready, slotTime: slot, customerName: "A guest", phone: "+91 98765 43210" };
  const html = renderFlow({ ...fixtures, errors: { customerName: "Please enter a full name.", phone: "Check the phone number." }, message: "Please check your name and phone number." });
  assert.match(html, /name="customerName" autoComplete="name" type="text"/);
  assert.match(html, /name="phone" autoComplete="tel" type="tel" inputMode="tel"/);
  assert.match(html, /maxLength="100"/);
  assert.match(html, /maxLength="32"/);
  assert.match(html, /Confirm booking/);
  assert.match(html, /role="alert"/);
  assertDescriptionsExist(html);
  const busy = renderFlow({ ...fixtures, submitting: true });
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /<fieldset disabled=""/);
  assert.match(busy, /Confirming your appointment…/);
  assertSubmitDisabled(busy, true);
});

test("booking confirmation preserves the receipt, timezone, contact and no-payment statement", () => {
  const html = renderFlow({ receipt: { id: "a143a627-2e99-4a94-8188-69608d4885e3", service_id: service.id, customer_name: "Guest <script>", phone: "+91 98765 43210", slot_time: slot, end_time: "2026-10-12T06:00:00Z", status: "confirmed" } });
  assert.match(html, /id="booking-confirmed-title" tabindex="-1"/);
  assert.match(html, /Guest &lt;script&gt;/);
  assert.match(html, /10:00 AM – 11:30 AM/);
  assert.match(html, /Asia\/Kolkata/);
  assert.match(html, /₹1,234.50/);
  assert.match(html, /a143a627-2e99-4a94-8188-69608d4885e3/);
  assert.match(html, /No payment was collected/);
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /<form/);
});

test("booking service labels escape long multilingual names without dropping price information", () => {
  const name = `${"VeryLongName".repeat(30)} 日本語 <script>bad</script>`;
  const html = renderFlow({}, { services: [{ ...service, name, price: 99999999.99 }] });
  assert.ok(html.includes("VeryLongName".repeat(30)));
  assert.ok(html.includes("日本語 &lt;script&gt;bad&lt;/script&gt;"));
  assert.ok(html.includes("₹9,99,99,999.99"));
});

test("booking page keeps unavailable/empty fallbacks and retry navigation without a database", async () => {
  // Stub only the data boundary; no credentials are read and no query leaves this test.
  const original = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only-public-key";
  try {
    for (const unavailable of [false, true]) {
      const { default: Page } = loadSource("../src/app/book/page.tsx", {
        "next/link": link,
        "@/components/booking-flow": { BookingFlow: () => { throw new Error("Unexpected flow"); } },
        "@/components/ui/button": button,
        "@/components/ui/card": card,
        "./booking.module.css": cssModule,
        "@/lib/salon": salon,
        "@/lib/booking-validation": validation,
        "@/lib/supabase/server": { createClient: async () => {
          if (unavailable) throw new Error("Offline");
          return { from: () => ({ select: () => ({ order: () => ({ abortSignal: async () => ({ data: [] }) }) }) }), rpc: () => ({ abortSignal: async () => ({ data: [config] }) }) };
        } },
      });
      const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
      assert.match(html, unavailable ? /Online booking is unavailable right now/ : /No services are available to book yet/);
      assert.match(html, /No appointment has been reserved/);
      assert.match(html, /action="\/book" method="get"/);
      assert.match(html, /id="booking-main"/);
      assert.match(html, /href="\/#services"/);
    }
  } finally {
    for (const [index, key] of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"].entries()) {
      if (original[index] === undefined) delete process.env[key]; else process.env[key] = original[index];
    }
  }
});
