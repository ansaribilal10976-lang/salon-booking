import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as salon from "../src/lib/salon.ts";
import * as validation from "../src/lib/admin-validation.ts";
import * as bookingValidation from "../src/lib/booking-validation.ts";
import { button, card, cssModule, link, loadSource, withStateFixtures } from "./ui-harness.mjs";

const service = { id: "b1b4285a-22a1-4b1b-949c-b5fb5a6b59f0", name: "Haircut & finish", duration: 90, price: 1234.5 };
const appointment = {
  id: "a143a627-2e99-4a94-8188-69608d4885e3", service_id: service.id, service_name: service.name,
  customer_name: "A guest", phone: "+91 98765 43210", status: "confirmed",
  slot_time: "2026-10-12T04:30:00Z", end_time: "2026-10-12T06:00:00Z",
};
const navigation = { useRouter: () => ({ refresh: () => { throw new Error("Unexpected refresh in SSR"); } }) };
const noRequests = { AdminRequestError: class extends Error {}, adminRequest: () => { throw new Error("UI render must not make a request"); } };

function components(path, fixtures = {}) {
  return loadSource(path, {
    react: withStateFixtures(path, fixtures),
    "next/link": link,
    "next/navigation": navigation,
    "@/components/ui/button": button,
    "@/components/ui/card": card,
    "@/app/admin/admin.module.css": cssModule,
    "@/lib/admin-client": noRequests,
    "@/lib/admin-validation": validation,
    "@/lib/booking-validation": bookingValidation,
    "@/lib/salon": salon,
  });
}
function renderBookings(props = {}, fixtures = {}) {
  const { AdminBookings } = components("../src/components/admin-bookings.tsx", fixtures);
  return renderToStaticMarkup(React.createElement(AdminBookings, { bookings: [appointment], view: "today", page: 1, hasMore: false, timeZone: "Asia/Kolkata", error: null, ...props }));
}
function renderServices(props = {}, fixtures = {}) {
  const { AdminServices } = components("../src/components/admin-services.tsx", fixtures);
  return renderToStaticMarkup(React.createElement(AdminServices, { services: [service], error: null, ...props }));
}

test("admin appointment book preserves filter URLs, salon time, customer contact and references", () => {
  const html = renderBookings();
  assert.match(html, /Today’s bookings/);
  const todayLink = html.match(/<a\b[^>]*href="\/admin\?view=today"[^>]*>/)?.[0];
  assert.ok(todayLink?.includes('aria-current="page"'));
  assert.match(html, /href="\/admin\?view=upcoming"/);
  assert.match(html, /10:00 AM/);
  assert.match(html, /11:30 AM/);
  assert.match(html, /Asia\/Kolkata/);
  assert.ok(html.includes(appointment.phone));
  assert.ok(html.includes(appointment.id));
  assert.match(html, /Haircut &amp; finish/);
  assert.match(html, /Cancel booking/);
  assert.doesNotMatch(html, />Confirm<|Previous page|Next page/);
});

test("admin date filters retain pagination limits and links", () => {
  const html = renderBookings({ view: "upcoming", page: 2, hasMore: true });
  assert.match(html, /Upcoming bookings/);
  assert.match(html, /Appointments from tomorrow onwards/);
  assert.match(html, /href="\/admin\?view=upcoming&amp;page=1"/);
  assert.match(html, /href="\/admin\?view=upcoming&amp;page=3"/);
  assert.match(html, /Page 2 · up to 50 appointments/);
  assert.doesNotMatch(renderBookings({ page: 201, hasMore: true }), /Next page/);
});

test("admin statuses retain their action availability and visible text labels", () => {
  const pending = renderBookings({ bookings: [{ ...appointment, status: "pending" }] });
  assert.match(pending, />pending<\/span>/);
  assert.match(pending, />Confirm<\/button>/);
  assert.match(pending, /Cancel booking/);
  for (const status of ["cancelled", "completed"]) {
    const html = renderBookings({ bookings: [{ ...appointment, status }] });
    assert.ok(html.includes(`>${status}</span>`));
    assert.doesNotMatch(html, /Cancel booking|>Confirm<\/button>/);
    assert.match(html, status === "cancelled" ? /cannot be reopened/ : /appointment is complete/);
  }
});

test("admin cancellation prompt, pending state, errors and sign-in link remain available", () => {
  const html = renderBookings({}, { askCancel: true });
  assert.match(html, /role="group" aria-label="Confirm appointment cancellation"/);
  assert.match(html, /cancellation cannot be undone/);
  assert.match(html, /data-variant="destructive"/);
  assert.match(html, /Yes, cancel appointment/);
  assert.match(html, /Keep booking/);
  const blocked = renderBookings({}, { pending: true, askCancel: true });
  for (const [tag] of blocked.matchAll(/<button\b[^>]*>/g)) assert.ok(tag.includes('disabled=""'));
  assert.match(blocked, /Cancelling…/);
  const failed = renderBookings({}, { error: "Please sign in again.", needsLogin: true });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /href="\/admin\/login"/);
  assert.match(renderBookings({}, { notice: "Appointment confirmed." }), /role="status"/);
});

test("admin booking empty and failure states are distinct and untrusted names stay escaped", () => {
  assert.match(renderBookings({ bookings: [] }), /No appointments today/);
  assert.match(renderBookings({ bookings: [], view: "upcoming" }), /No upcoming appointments/);
  const failed = renderBookings({ error: "Bookings could not be loaded." });
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /No appointments|Cancel booking/);
  const longName = `${"Guest".repeat(80)} 日本語 <script>`;
  const html = renderBookings({ bookings: [{ ...appointment, customer_name: longName }] });
  assert.ok(html.includes("Guest".repeat(80)));
  assert.match(html, /日本語 &lt;script&gt;/);
});

test("admin service menu preserves price, duration and named edit/delete controls", () => {
  const html = renderServices();
  assert.match(html, /Prices are shown in INR/);
  assert.match(html, /not existing reserved times/);
  assert.match(html, /₹1,234.50/);
  assert.match(html, /1 hr 30 min/);
  assert.match(html, /aria-label="Edit Haircut &amp; finish"/);
  assert.match(html, /aria-label="Delete Haircut &amp; finish"/);
  for (const [tag] of html.matchAll(/<button\b[^>]*>/g)) assert.ok(tag.includes('data-slot="button"'));
  assert.match(renderServices({ services: [] }), /Your menu is empty/);
  const failed = renderServices({ error: "Refresh before making changes." });
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /<button/);
});

test("admin service editor preserves field bounds, errors, busy state and discard action", () => {
  const html = renderServices({}, { showEditor: true, editingId: service.id, name: service.name, duration: "90", price: "1234.5", errors: { name: "Check name.", duration: "Check duration.", price: "Check price." } });
  assert.match(html, /tabindex="-1"[^>]*>Edit service/);
  assert.match(html, /maxLength="120"/);
  assert.match(html, /min="1" max="600" step="1"/);
  assert.match(html, /min="0" max="99999999.99" step="0.01"/);
  assert.match(html, /Save changes/);
  assert.match(html, /Discard edits/);
  for (const field of ["name", "duration", "price"]) {
    assert.ok(html.includes(`aria-describedby="service-${field}-error"`));
    assert.ok(html.includes(`id="service-${field}-error"`));
  }
  const busy = renderServices({}, { showEditor: true, pending: true });
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /<fieldset disabled=""/);
  assert.match(busy, /Saving service…/);
});

test("admin service deletion keeps the confirmation gate and booking-history warning", () => {
  const html = renderServices({}, { deleteId: service.id });
  assert.match(html, /aria-label="Confirm deletion of Haircut &amp; finish"/);
  assert.match(html, /Services with any bookings attached cannot be deleted/);
  assert.match(html, /data-variant="destructive"/);
  assert.match(html, /Yes, delete service/);
  assert.match(html, /Keep service/);
  const failed = renderServices({}, { needsLogin: true, message: "Sign in again." });
  assert.match(failed, /href="\/admin\/login"/);
  assert.match(failed, /role="alert"/);
  assert.match(renderServices({}, { notice: "Service updated." }), /role="status"/);
});

test("admin shell retains skip target and public/workspace links", () => {
  const { default: Layout } = loadSource("../src/app/admin/layout.tsx", { "next/link": link, "@/lib/salon": salon, "./admin.module.css": cssModule });
  const html = renderToStaticMarkup(React.createElement(Layout, null, "Dashboard"));
  assert.match(html, /href="#admin-main"/);
  assert.match(html, /id="admin-main" tabindex="-1"/);
  assert.match(html, /href="\/admin"/);
  assert.match(html, /href="\/"/);
});

test("admin page renders real panel props and unavailable feedback through mocked read-only boundaries", async () => {
  const captured = [];
  const config = { min_date: "2026-10-12", max_date: "2026-11-12", time_zone: "Asia/Kolkata" };
  const data = Array.from({ length: 51 }, (_, index) => ({ ...appointment, id: String(index) }));
  const client = {
    rpc: (name) => ({ abortSignal: async () => ({ data: name === "get_booking_config" ? [config] : data }) }),
    from: () => ({ select: () => ({ order: () => ({ abortSignal: async () => ({ data: [service] }) }) }) }),
  };
  async function render(accessResult) {
    const { default: Page } = loadSource("../src/app/admin/page.tsx", {
      "next/navigation": { redirect: () => { throw new Error("Unexpected redirect"); } },
      "@/components/admin-bookings": { AdminBookings: (props) => { captured.push(props); return React.createElement("h2", { id: "admin-bookings-title" }, "Bookings"); } },
      "@/components/admin-services": { AdminServices: (props) => { captured.push(props); return React.createElement("h2", { id: "admin-services-title" }, "Services"); } },
      "@/components/admin-sign-out": { AdminSignOut: () => React.createElement("button", null, "Sign out") },
      "@/components/admin-refresh": { AdminRefresh: () => React.createElement("button", null, "Refresh dashboard") },
      "@/components/ui/card": card,
      "./admin.module.css": cssModule,
      "@/lib/admin-server": { getAdminAccess: async () => accessResult },
      "@/lib/admin-validation": validation,
    });
    return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ view: "upcoming", page: "2" }) }));
  }
  const html = await render({ supabase: client, access: { allowed: true, user: { email: "admin@example.test" } } });
  assert.match(html, /admin@example.test/);
  assert.match(html, /href="#admin-bookings-title"/);
  assert.match(html, /href="#admin-services-title"/);
  assert.equal(captured[0].bookings.length, 50);
  assert.equal(captured[0].hasMore, true);
  assert.equal(captured[0].view, "upcoming");
  assert.equal(captured[0].page, 2);
  assert.deepEqual(captured[1].services, [service]);
  const unavailable = await render({ supabase: null, access: { allowed: false, status: 503, error: "Try again later." } });
  assert.match(unavailable, /workspace is temporarily unavailable/);
  assert.match(unavailable, /role="alert"/);
  assert.match(unavailable, /Try again later/);
  assert.match(unavailable, /Refresh dashboard/);
});
