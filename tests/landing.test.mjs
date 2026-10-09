import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { salon, formatDuration, formatPrice } from "../src/lib/salon.ts";

// Render the actual landing and booking-link components without a live database.
// Next's image/link transports and CSS modules are replaced, not page content.
function loadSource(path, overrides = {}) {
  const file = new URL(path, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const localRequire = createRequire(file);
  new Function("require", "module", "exports", outputText)(
    (name) => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    module, module.exports,
  );
  return module.exports;
}

const require = createRequire(import.meta.url);
const { Button, buttonVariants } = loadSource("../src/components/ui/button.tsx", {
  "@/lib/utils": require("cn"),
});
const card = loadSource("../src/components/ui/card.tsx");
const { BookingButton } = loadSource("../src/components/booking-button.tsx", {
  "@/components/ui/button": { Button },
  "next/link": {
    __esModule: true,
    default: ({ href, children, ...props }) => React.createElement("a", {
      ...props,
      href: typeof href === "string" ? href : `${href.pathname}?${new URLSearchParams(href.query)}`,
    }, children),
  },
});

async function renderPage(catalog) {
  const { default: Home } = loadSource("../src/app/page.tsx", {
    "next/image": {
      __esModule: true,
      default: ({ fill, priority, ...props }) => React.createElement("img", props),
    },
    "@/components/booking-button": { BookingButton },
    "@/components/ui/button": { Button },
    "@/components/ui/card": card,
    "@/lib/salon": { salon, formatDuration, formatPrice },
    "@/lib/services": { loadServiceCatalog: async () => catalog },
    "@/lib/supabase/server": { createClient: () => { throw new Error("No database access allowed"); } },
    "./page.module.css": { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) },
  });
  return renderToStaticMarkup(await Home());
}

const realService = {
  id: "b1b4285a-22a1-4b1b-949c-b5fb5a6b59f0",
  name: "Haircut & finish",
  duration: 90,
  price: 1234.5,
};

test("landing live menu preserves service selection, duration, and INR pricing", async () => {
  const html = await renderPage({ source: "supabase", services: [realService] });
  assert.ok(html.includes(`href="/book?service=${realService.id}"`));
  assert.ok(html.includes("Haircut &amp; finish"));
  assert.ok(html.includes("1 hr 30 min"));
  assert.ok(html.includes("₹1,234.50"));
  assert.ok(html.includes("Prices in INR"));
  assert.ok(!html.includes("Preview menu."));
  assert.ok(!html.includes("Example only"));
});

test("landing preview makes examples explicit and exposes no service booking link", async () => {
  const html = await renderPage({ source: "preview", services: [{ ...realService, id: "preview-cut" }] });
  assert.ok(html.includes("Preview menu."));
  assert.ok(html.includes("Example services cannot be booked."));
  assert.ok(html.includes("Example only"));
  assert.ok(!html.includes("/book?service="));
  assert.ok(!html.includes("preview-cut"));
  assert.ok(html.includes('href="/book"'), "general booking route remains available");
});

test("landing empty menu is distinct from service loading failure", async () => {
  const empty = await renderPage({ source: "supabase", services: [] });
  assert.ok(empty.includes("The menu is coming soon."));
  assert.ok(empty.includes('data-slot="card"'));
  assert.ok(empty.includes('data-slot="card-content"'));
  assert.ok(!empty.includes("Try again"));
  assert.ok(!empty.includes("Preview menu."));

  const unavailable = await renderPage({ source: "unavailable", services: [] });
  assert.ok(unavailable.includes("The menu is temporarily unavailable."));
  assert.ok(unavailable.includes('data-slot="card"'));
  assert.ok(unavailable.includes('action="/#services"'));
  assert.ok(unavailable.includes('method="get"'));
  assert.ok(unavailable.includes("Try again"));
  assert.ok(unavailable.includes('role="status"'));
  assert.ok(!unavailable.includes("Example only"));
});

test("landing preserves anchors and semantic disclosure navigation", async () => {
  const html = await renderPage({ source: "supabase", services: [realService] });
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, "IDs are unique");
  for (const anchor of ["home", "main", "services", "ritual", "stories"]) {
    assert.ok(ids.includes(anchor), `${anchor} remains supported`);
  }
  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(anchor), `link target ${anchor} exists`);
  }
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.equal((html.match(/<details\b/g) ?? []).length, 3);
  assert.equal((html.match(/<summary\b/g) ?? []).length, 3);
  assert.ok(html.includes('aria-label="Main navigation"'));
  assert.ok(html.includes('id="main" tabindex="-1"'));
});

test("landing discloses placeholder assets and removes unsupported social proof", async () => {
  const html = await renderPage({ source: "supabase", services: [] });
  assert.ok(html.includes("Stock photography, not our premises."));
  assert.ok(html.includes("A sample salon concept."));
  assert.ok(html.includes("copy await owner approval."));
  assert.doesNotMatch(html, /10\+|4\.9|Est\. 2014|Ananya|Maya S\.|Nisha|Loved by guests/);
  assert.doesNotMatch(html, /wa\.me|tel:|<blockquote/);
});

test("landing retains and escapes long service names and large prices", async () => {
  const name = `${"LongName".repeat(30)} <script>alert(1)</script> 日本語`;
  const html = await renderPage({ source: "supabase", services: [{ ...realService, name, price: 99999999.99 }] });
  assert.ok(html.includes("LongName".repeat(30)));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("日本語"));
  assert.ok(html.includes("₹9,99,99,999.99"));
  assert.ok(!html.includes("<script>"));
});

test("brand text and semantic feedback pairs meet WCAG AA normal-text contrast", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const tokens = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*(#[a-f\d]{6});/gi)].map((match) => [match[1], match[2]]));
  function luminance(hex) {
    assert.ok(hex, "color token must exist");
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  }
  for (const [foreground, background] of [
    ["--ink", "--background"], ["--ink-soft", "--background"],
    ["--text-muted", "--background"], ["--text-muted", "--paper"],
    ["--text-muted", "--lilac"], ["--text-muted", "--sage-soft"],
    ["--sage", "--sage-soft"], ["--danger", "--danger-soft"],
    ["--lilac", "--ink"], ["--ink-soft", "--lilac"],
  ]) {
    const [dark, light] = [luminance(tokens[foreground]), luminance(tokens[background])].sort((a, b) => a - b);
    const ratio = (light + 0.05) / (dark + 0.05);
    assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
  }
});

test("all landing booking and retry controls render through the actual shadcn Button", async () => {
  for (const catalog of [
    { source: "supabase", services: [realService] },
    { source: "unavailable", services: [] },
  ]) {
    const html = await renderPage(catalog);
    for (const [tag] of html.matchAll(/<a\b[^>]*href="\/book[^\"]*"[^>]*>/g)) {
      assert.ok(tag.includes('data-slot="button"'), tag);
      assert.ok(tag.includes("min-h-12"), "booking controls keep a 48px minimum");
    }
    for (const [tag] of html.matchAll(/<button\b[^>]*>/g)) {
      assert.ok(tag.includes('data-slot="button"'), "no bespoke native button in landing");
    }
    assert.doesNotMatch(html, /<button\b[^>]*>\s*<a\b/, "asChild must not nest interactive controls");
    assert.ok(html.includes("lucide-arrow-up-right"));
    assert.ok(html.includes('data-variant="inverted"'));
  }
});

test("shadcn Button preserves disabled/form semantics and uses supported touch sizes", () => {
  const html = renderToStaticMarkup(React.createElement(Button, { disabled: true, type: "submit" }, "Save"));
  assert.ok(html.includes('disabled=""'));
  assert.ok(html.includes('type="submit"'));
  assert.ok(html.includes('data-slot="button"'));
  assert.ok(buttonVariants({ size: "icon-sm" }).includes("h-11 w-11"));
  assert.ok(!buttonVariants().includes("transition-all"));
});

test("booking button continues to guard preview IDs even outside the landing", () => {
  const html = renderToStaticMarkup(React.createElement(BookingButton, {
    service: { ...realService, id: "preview-cut" }, preview: true,
  }));
  assert.ok(html.includes('href="/book"'));
  assert.ok(!html.includes("?service="));
});
