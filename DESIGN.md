# Muse — Editorial luxury

## Direction and scope

**One direction:** warm, quiet editorial luxury. An asymmetric serif-led hero, generous whitespace, a framed photography slot, an aligned service menu, practical visit advice, and a restrained closing invitation. No alternative themes, repeated card grid, fake artwork, or fabricated social proof.

Audience: people comparing salon appointments, often on a phone. The visual identity must not obstruct service names, prices, durations, or booking.

Scope remains landing page, shared layout, UI, and theme. Booking/API/database/auth business logic is protected. Muse remains an explicitly disclosed sample name until approved brand assets arrive.

The five requested skills were read before implementation: `frontend-design`, `emil-design-eng`, `design-ui-designer`, `design-ux-architect`, and `design-brand-guardian`. The later design instructions supersede the earlier Bodoni/plum/lilac direction.

## Two fonts, through next/font

1. **Cormorant 400** — `--font-cormorant`, mapped to `--font-display`. Wordmark, hero, section headings, and service names. Local font with its SIL OFL license.
2. **Geist Sans 400/500/600** — existing `--font-geist-sans`, mapped to `--font-sans`. Body, navigation, labels, prices, and controls.

Only these two font families are loaded. The existing Geist Mono asset stays untouched but is no longer loaded; operational reference IDs inherit the clean sans family. No remote font request at runtime.

| Role | CSS token | Scale |
| --- | --- | --- |
| Hero, mobile | `--text-hero-mobile` | `clamp(3.25rem, 12vw, 5rem)` |
| Hero, desktop | `--text-hero-desktop` | `clamp(4rem, 8.5vw, 7.5rem)` — 64–120px |
| Section heading | `--text-heading` | `clamp(2.5rem, 4.5vw, 4.5rem)` |
| Service title | `--text-subheading` | `clamp(1.625rem, 2.4vw, 2.25rem)` |
| Lead | `--text-lead` | `clamp(1rem, 1.4vw, 1.125rem)` |
| Body | `--text-body` | `1rem` |
| UI | `--text-ui` | `0.875rem` |
| Caption | `--text-caption` | `0.75rem` |

Line heights, weights, tracking, and readable widths also live in the shared theme. No repeated italic/colored-word heading formula.

## Warm neutrals + one accent

| Role | CSS variable | Value |
| --- | --- | --- |
| Warm ivory | `--background` | `#F7F3EC` |
| Paper | `--paper` | `#FFFDF8` |
| Sand | `--sand` | `#EBE4D8` |
| Warm ink | `--ink` | `#302B27` |
| Secondary ink | `--ink-soft` | `#514A42` |
| Muted text | `--text-muted` | `#6D6459` |
| Hairline | `--line` | `#D9D0C3` |
| **Only decorative accent: olive** | `--accent` | `#58634E` |
| Olive interaction shade | `--accent-hover` | `#454F3D` |

Primary buttons use olive with paper text. Secondary surfaces use sand, not another hue. The closing section uses warm ink with paper text. Legacy aliases remain supported for existing operational screens. Functional error colors on booking/admin forms are semantic feedback, not landing accents.

All component color declarations reference theme variables. Browser `theme-color` metadata mirrors `--background` because metadata cannot resolve CSS variables.

## Token and shadcn contract

`src/app/globals.css` owns all colors, spacing, radii, type metrics, borders, control sizes, and the one shadow.

- Spacing uses `--space-*` variables; gutters and section gaps use semantic aliases.
- Borders: `--border-width: 1px`.
- Controls/cards: small `--radius` / `--radius-card`, not the stock shadcn defaults.
- Focus: tokenized outline, not a second box-shadow.
- **One shadow style:** `--shadow-soft`, used only on the photography frame. Never comma-stacked, never layered with a ring shadow.
- Existing shadcn Button and Card retain their public composition APIs; their appearance is defined by theme classes and variables, not raw numeric utilities in components.
- No hand-written replacement buttons, cards, or modals. Booking links use Button `asChild`; the unavailable/empty menu uses Card/CardContent.
- Dialog, Sheet, Tabs, Badge, and Sonner are not inserted without a real purpose. A genuinely missing component must be added using `npx shadcn@4.20.0 add <component>`; none is missing here.
- Static breakpoint conditions and responsive image `sizes` are documented geometry exceptions: CSS custom properties cannot be substituted into native media conditions or image selection hints. These use the same 40rem/64rem/85rem layout boundaries, not ad hoc component spacing.

## Composition

```text
Name             Services / Your visit / Booking questions       Book Now

A little change.                      ┌──────────────────────────┐
All you.                              │                          │
                                      │  Framed photography slot │
Short introduction.                   │  Clearly labeled pending │
Book Now / Explore services            │                          │
                                      └──────────────────────────┘

The service menu
Service name                          Duration      INR price    Action

Sand section: visit preparation
Large left heading                    Three practical steps

Before you book                        Native FAQ disclosures

Warm-ink closing invitation                                      Book Now
Footer / sample-brand disclosure
```

- Asymmetry comes from unequal hero columns, offset image placement, and different information densities, not overlapping text.
- The hero heading is 64–120px on desktop and fluid on mobile.
- Section space is generous, increasing from the mobile spacing token to the desktop section token.
- A small static grain texture is applied at very low opacity. No animated noise, SVG scene, procedural illustration, canvas, or WebGL.
- Grain is pointer-transparent and hidden for printing/forced-color modes.
- Photos use `next/image`. Until real assets arrive, show a neutral framed placeholder with a visible caption and `// TODO(content): real salon photo` in source. Do not use the stock salon photo as proof of real premises.
- Navigation remains visible on mobile. Long service names and large prices wrap.
- Preserve `/book`, real service query parameters, INR formatting, and preview/live/empty/unavailable states. Preview rows are explicitly unbookable.
- Preserve `#home`, `#main`, `#services`, `#ritual`, and `#stories`. The latter anchors support visit advice and booking questions instead of fabricated reviews.

## Motion and performance

**Only `motion`. Zero extra effect libraries.** No Three.js, WebGL, Lottie, parallax, marquees, layout animation, or page-load spectacle.

The existing shadcn Button uses lazy `domAnimation` features and transform-only pointer press feedback: scale 0.98, 120ms, easing `[0.23, 1, 0.32, 1]`. Release/cancel/leave/blur restores the resting state. Keyboard activation and hover color changes are immediate. Reduced-motion users get no movement.

Native FAQ disclosures open immediately. Grain is a small static raster tile, not an effect library. No new scroll observer or client-side page rendering is introduced.

Mid-range Android smoothness is a design goal, **not a measured result**. Do not claim device performance without testing.

## Content needed from the owner

1. **Photos:** authorized salon interior, hair work, optional team photos, and permission to publish identifiable people.
2. **Logo:** final name, SVG logo, favicon, and any brand guidelines.
3. **Copy:** approved positioning, service details, business/contact information, and policies.
4. **Real testimonials:** exact text, attribution, source, and permission. No invented ratings or quotes.
5. **WhatsApp number:** business-owned international-format number and approved prefilled message. No dummy contact link.

## Verification rules

- Run `npx tsc --noEmit` and fix errors.
- Run `npm test`, non-server Tailwind/PostCSS compilation, token/contrast checks, and `git diff --check`.
- **Do not start dev, preview, or build servers.** The earlier `npm run dev` was stopped and remains a recorded violation.
- Do not create production appointments or touch live customer data.
- Keep historical build/HTTP results distinct from validation of the latest revision.
- Browser/device/screen-reader checks remain unverified; source/SSR tests do not prove visual layout or interaction performance.

## Audit ledger

This covers the explicit rules supplied in the conversation and repository. No compliance claim is made for an additional unseen STRICT RULES document.

| Status | Finding | Resolution or remaining gap |
| --- | --- | --- |
| Historical violation, stopped | Earlier verification ran `npm run dev` | Server stopped; no server started after the prohibition |
| Fixed | Earlier direction used Bodoni/plum/lilac rather than the latest specified direction | One Cormorant/Geist warm-neutral/olive system replaces it |
| Fixed | A third font family was loaded | Geist Mono is no longer loaded |
| Fixed | Raw spacing/radii and stock shadcn styling in used controls | Used Button/Card styling moves to shared CSS-variable theme rules |
| Fixed | Missing grain, frame, and content TODO | Static grain and an honest framed image placeholder added |
| Fixed | Bespoke landing buttons and status card | Existing shadcn Button/Card composition used |
| Fixed | CSS press animation and an extra animation dependency | Motion-only press feedback; direct `tw-animate-css` dependency removed |
| Fixed | Custom arrow/disclosure iconography | Sparse Lucide icons |
| Fixed | Unsupported experience, rating, founding date, one-to-one care, and named reviews | Removed, with regression coverage |
| Fixed | Stock imagery and sample identity could imply a real business | Neutral image placeholder and explicit sample-brand disclosure |
| Fixed | Hidden mobile navigation and repeated generic card grids | Visible navigation and editorial/menu composition |
| Fixed | Conflicting theme/muted roles and insufficient draft contrast | Consolidated roles; current palette covered by contrast checks |
| Fixed | Duplicate remote/local Geist loading | Two local families through next/font |
| Fixed | Preview rows suggested bookable services | “Example only”; no preview ID enters real booking links |
| Fixed | Tailwind 4-only global imports and used Button/Card utilities | Removed/adapted without upgrading Tailwind |
| Open, dormant UI debt | Unused Dialog/Sheet/Tabs/Badge retain Tailwind 4-specific utilities | Full migration not performed; they are not used by this landing |
| Open, outside landing scope | Existing booking/admin markup retains old custom controls, literal utility values, and icons | Not an app-wide UI migration; business-flow markup remains unchanged |
| Open, owner input | Approved photos/logo/copy/favicon/testimonials/WhatsApp missing | Disclosed or omitted; launch assets still required |
| Unverified | Browser rendering, screen-reader operation, device performance | No servers or browser/device tests in the current pass |
| Open, dependency security | Latest audit reported 13 affected dependency entries | No forced breaking toolchain upgrade during this task |

### Dependency findings retained from the stack-alignment pass

- **High (10):** `@shadcn/registry`, `@ts-morph/common`, `braces`, `chokidar`, `fast-glob`, `micromatch`, `postcss`, `shadcn`, `tailwindcss`, `ts-morph`.
- **Moderate (3):** `next`, `postcss-nested`, `postcss-selector-parser`.

Motion was not listed in that report. These are security findings, not additional decorative-library violations.

### Evidence history

The preceding revision passed TypeScript, 132 tests, and non-server CSS compilation. Earlier still, a production build and offline HTTP checks passed, but the HTTP checks involved the recorded server-rule violation. Neither result is proof of the current typography/token/placeholder revision. Current verification results will be recorded after checks complete.
