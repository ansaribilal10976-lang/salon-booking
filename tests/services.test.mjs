import assert from "node:assert/strict";
import { test } from "node:test";
import { loadServiceCatalog } from "../src/lib/services.ts";
import { formatDuration, formatPrice } from "../src/lib/salon.ts";

const config = { url: "https://example.supabase.co", key: "test-public-key" };
const service = { id: "test-service", name: "Haircut", duration: 60, price: 49.5 };

test("missing configuration shows an explicitly identified sample menu without a query", async () => {
  let queried = false;
  const catalog = await loadServiceCatalog({}, async () => {
    queried = true;
    return { data: [], error: null };
  });
  assert.equal(queried, false);
  assert.equal(catalog.source, "preview");
  assert.equal(catalog.services.length, 6);
  assert.ok(catalog.services.every((item) => item.id.startsWith("preview-")));
});

test("partial configuration reports unavailability instead of displaying samples", async () => {
  for (const partial of [{ url: config.url }, { key: config.key }]) {
    let queried = false;
    const catalog = await loadServiceCatalog(partial, async () => {
      queried = true;
      return { data: [service], error: null };
    });
    assert.equal(queried, false);
    assert.deepEqual(catalog, { source: "unavailable", services: [] });
  }
});

test("configured queries return real service data without altering prices or durations", async () => {
  const catalog = await loadServiceCatalog(config, async () => ({ data: [service], error: null }));
  assert.deepEqual(catalog, { source: "supabase", services: [service] });
});

test("an empty live table stays empty rather than falling back to sample services", async () => {
  const catalog = await loadServiceCatalog(config, async () => ({ data: [], error: null }));
  assert.deepEqual(catalog, { source: "supabase", services: [] });
});

test("database errors return a safe unavailable state without leaking error details", async () => {
  const catalog = await loadServiceCatalog(config, async () => ({
    data: [service], error: { message: "Internal database detail" },
  }));
  assert.deepEqual(catalog, { source: "unavailable", services: [] });
});

test("network failures and timeouts do not break the landing page or show fake services", async () => {
  const catalog = await loadServiceCatalog(config, async () => { throw new Error("Network failure"); });
  assert.deepEqual(catalog, { source: "unavailable", services: [] });
});

test("a null response is treated as unavailable", async () => {
  const catalog = await loadServiceCatalog(config, async () => ({ data: null, error: null }));
  assert.deepEqual(catalog, { source: "unavailable", services: [] });
});

test("INR prices preserve amounts and paise and accept zero-price services", () => {
  assert.equal(formatPrice(65), "₹65");
  assert.equal(formatPrice(49.5), "₹49.50");
  assert.equal(formatPrice(0.05), "₹0.05");
  assert.equal(formatPrice(0), "₹0");
});

test("INR prices use Indian digit grouping for integers and decimals", () => {
  assert.equal(formatPrice(1234567), "₹12,34,567");
  assert.equal(formatPrice(1234567.89), "₹12,34,567.89");
});

test("duration labels cover minutes, whole hours, and mixed durations", () => {
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(60), "1 hr");
  assert.equal(formatDuration(90), "1 hr 30 min");
  assert.equal(formatDuration(150), "2 hr 30 min");
});
