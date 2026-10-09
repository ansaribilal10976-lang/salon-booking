# Muse — Plum & porcelain

## Direction and scope

The committed identity is **editorial plum/porcelain with lilac supporting surfaces**, using Bodoni Moda for display text and Geist Sans for reading and controls. It extends across the landing page, `/book`, and the `/admin` dashboard. Use generous space for discovery, a clear three-step booking form for guests, and a denser appointment list for staff. Do not add decorative card grids, fabricated metrics, reviews, or business claims.

This document describes the implementation on `redesign-landing`: landing commit `b2b924b`, booking commit `b976f0a`, and dashboard commit `4c71879`. It supersedes the earlier olive specification; that revision remains in Git history, not as a second supported theme. **Muse remains a sample name**, and the typographic wordmark is not an approved salon logo.

The redesign is presentation-only. Preserve booking state, validation, availability, submission and retry behavior, service mutations, query parameters, authentication, authorization, Supabase access, RLS, and API contracts. The shared admin shell is restyled; login and access-denied page contents, refresh, and sign-out components are not fully migrated to the new component markup.

## Source map

| Responsibility | Source |
| --- | --- |
| Palette, semantic colors, font aliases, page gutters, form styles, focus and reduced-motion rules | `src/app/globals.css` |
| Tailwind color/font mappings and touch-safe hover utilities | `tailwind.config.ts` |
| Local font registration and viewport metadata | `src/app/layout.tsx` |
| Landing composition and local type scale | `src/app/page.tsx`, `src/app/page.module.css` |
| Booking shell, states, and responsive form layout | `src/app/book/page.tsx`, `src/components/booking-flow.tsx`, `src/app/book/booking.module.css` |
| Admin shell, appointment book, and service panel | `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/components/admin-bookings.tsx`, `src/components/admin-services.tsx`, `src/app/admin/admin.module.css` |
| Shared Button and Card primitives | `src/components/ui/button.tsx`, `src/components/ui/card.tsx` |
| Brand name and INR formatting | `src/lib/salon.ts` |

Colors and font aliases are shared tokens. Page composition, spacing, type metrics, and responsive geometry live in the three CSS modules; they are **not** all centralized in `globals.css`.

## Palette tokens

These are the literal values in `src/app/globals.css`. Use the existing variables rather than adding page-specific hex colors.

| Token | Value | Role |
| --- | --- | --- |
| `--background` | `#F5F3F1` | Porcelain page canvas |
| `--paper` | `#FFFEFC` | Inputs, unselected choices, cards, admin header |
| `--ink` | `#382C38` | Plum primary text, buttons, selected times, landing closing section |
| `--ink-soft` | `#584758` | Secondary plum text and primary-button hover |
| `--lilac` | `#E7DFEA` | Supporting sections, selected services, booking summary, admin service panel |
| `--text-muted` | `#6B5E6B` | Captions, hints, secondary labels, input boundaries |
| `--line` | `#D4CBD5` | Quiet dividers and panel borders |
| `--sand` | `#EEE9EE` | Neutral state surfaces; despite the legacy name, a pale plum-gray |
| `--sage` | `#3E6150` | Confirmed/success feedback, not the brand accent |
| `--sage-soft` | `#E5EDE7` | Success notice and confirmed-status backgrounds |
| `--danger` | `#963C42` | Validation errors, cancellation/deletion controls and feedback |
| `--danger-soft` | `#F9E8E7` | Error and destructive-confirmation backgrounds |

### Semantic mappings

| Semantic token(s) | Mapping |
| --- | --- |
| `--foreground`, `--card-foreground`, `--popover-foreground` | `var(--ink)` |
| `--card`, `--popover` | `var(--paper)` |
| `--primary` / `--primary-foreground` | `var(--ink)` / `var(--cream)` |
| `--secondary` / `--secondary-foreground` | `var(--lilac)` / `var(--ink)` |
| `--accent` / `--accent-foreground` | `var(--lilac)` / `var(--ink)` |
| `--muted-surface` / `--muted-foreground` | `var(--lilac)` / `var(--text-muted)` |
| `--destructive` | `var(--danger)` |
| `--border` / `--input` / `--ring` | `var(--line)` / `var(--text-muted)` / `var(--ink)` |

Compatibility aliases remain: `--cream` → `--background`, `--blush` → `--lilac`, `--clay` → `--ink-soft`, `--clay-dark` → `--ink`, and `--muted` → `--text-muted`. In Tailwind, `bg-muted` maps to `--muted-surface`, **not** the legacy `--muted` text alias. The legacy Tailwind names `forest` and `olive` map to ink and sage; they do not define an alternative palette.

The UI is light-only. `src/app/layout.tsx` sets `themeColor: "#f5f3f1"` to match the canvas and declares `colorScheme: "light"`; there is no dark-mode toggle. Text selection uses porcelain on plum.

## Typography

### Brand families and font loading

- **Bodoni Moda, regular 400:** `BodoniModa-Regular.ttf` → `--font-bodoni` → `--font-display` and Tailwind `font-display`. Used for wordmarks, major headings, service-choice/menu titles, and admin customer names. Georgia/serif fallbacks.
- **Geist Sans, variable 100–900:** `GeistVF.woff` → `--font-geist-sans` → `--font-sans` and Tailwind `font-sans`. Body/UI text mainly uses 400/500/600. Tailwind `font-heading` also maps to Geist Sans; it is not the editorial display face. Arial/sans-serif fallbacks.

Both brand families use `next/font/local` with `display: "swap"`; there is no runtime Google Fonts request. Font provenance is in `src/app/fonts/README.md`, with the Bodoni license in `src/app/fonts/BodoniModa-OFL.txt`.

**Implementation distinction:** `src/app/layout.tsx` also registers the existing Geist Mono asset as `--font-geist-mono`, with `preload: false`, and Tailwind retains `font-mono`. It is not part of the two-family visual identity. The redesigned booking/admin reference fields inherit Geist Sans rather than using `font-mono`.

### Type scale and rhythm

The landing's `--text-*` variables are scoped to `.site` in `src/app/page.module.css`, not global tokens.

| Role | Current size | Treatment |
| --- | --- | --- |
| Wordmark, all three surfaces | `3rem` | Bodoni 400, line-height 1.1, tracking `-0.075em`, lowercase name plus period |
| Landing hero, `--text-hero` | `clamp(3.5rem, 7.8vw, 7rem)` | Line-height 1.02, tracking `-0.055em` |
| Landing sections, `--text-heading` | `clamp(2.25rem, 4.5vw, 4rem)` | Section titles use line-height 1.1, tracking `-0.045em` |
| Landing service names, `--text-subheading` | `clamp(1.5rem, 2.4vw, 2rem)` | Line-height 1.25 |
| Landing lead, `--text-lead` | `clamp(1rem, 1.4vw, 1.125rem)` | Line-height 1.7 |
| Landing body/UI/caption | `1rem` / `0.875rem` / `0.75rem` | `--text-body` / `--text-ui` / `--text-caption` |
| Booking page title | `clamp(2.75rem, 6vw, 5rem)` | Line-height 1.08, tracking `-0.05em` |
| Admin page title | `clamp(2.5rem, 5.5vw, 4.5rem)` | Line-height 1.1, tracking `-0.05em` |
| Booking/admin section titles | `clamp(1.875rem, 3vw, 2.5rem)` | Line-height 1.2, tracking `-0.035em` |
| Booking choices/admin service names | `1.5rem` | Bodoni, line-height 1.3 |
| Admin customer names | `1.75rem` | Bodoni, line-height 1.25 |
| Form inputs | `1rem` | Geist Sans; retain 16px text to avoid mobile input zoom |

Body copy uses approximately 1.6–1.8 line-height and constrained measures: 33ch for the landing hero description, 48ch for booking descriptions, and 52ch for admin introductory copy. Headings are balanced, paragraph wrapping uses `text-wrap: pretty`, and long names/references/prices use wrapping rather than truncation. Prices and appointment times use tabular numerals where alignment matters. Labels use sentence case; there is no recurring italic or colored-word headline treatment on the redesigned pages.

## Spacing, layout, and surfaces

### Shared frame

`.page-width` is centered, full-width, and capped at **1360px**, including its padding. Its `--page-gutter` changes at Tailwind's existing breakpoints:

| Viewport | Gutter per side |
| --- | --- |
| Below 640px | `1.25rem` (20px) |
| 640–1023px | `2rem` (32px) |
| 1024–1279px | `3rem` (48px) |
| 1280px and above | `4rem` (64px) |

Horizontal gutters respect safe-area insets. Headers and footers also account for top/bottom insets, and the viewport uses `viewportFit: "cover"`. Body minimum width is 320px. Browser zoom is not disabled.

### Spacing rhythm

Use the existing rem-based scale: `0.25`, `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75`, `2`, `2.5`, `3`, `3.5`, `4`, `5`, and `6rem`, with small optical adjustments such as `0.375rem`. There is no shared `--space-*` token family in the committed CSS.

- Landing sections generally use `4rem` vertical space on mobile and `6rem` at 1024px; the desktop closing section uses `5rem`.
- Booking main padding is `2.5rem` top / `4rem` bottom, becoming `3.5rem` / `6rem` at 640px. The form/summary gap grows from `2rem` to `4rem` at 1024px.
- Admin main padding is `2.5rem` / `4rem`, becoming `3rem` / `6rem` at 640px. Dashboard columns have a `2.5rem` gap at 1024px and `3rem` at 1280px. Appointment rows use `1.5rem` vertical padding.
- Control/list gaps are usually `0.75rem`; form field groups are `1.25–1.5rem` apart. Panel padding is typically `1.25–2rem`.

Use **1px borders** for surfaces/dividers and **2px rules** for booking progress. `--radius` is `0.375rem` (6px), used by forms, choices, and status treatments. Button/Card use Tailwind `rounded-md`, currently the same 6px size; their radius is not wired to a separate card token. Circles are limited to radio indicators and step numbers.

The redesigned pages do not use decorative elevation shadows or grain textures. Surface hierarchy comes from porcelain/paper/lilac fills, dividers, and spacing. The global focus indicator is a **2px plum outline with 4px offset and a 5px background-colored box-shadow halo**; the landing closing section inverts it. Form-input focus uses a 2px outline with 2px offset, and radio labels receive a visible outline when their input is keyboard-focused. There are no `--shadow-soft`, `--radius-card`, or `--border-width` tokens.

## Component roles

| Component or pattern | Use |
| --- | --- |
| `Button` default | Plum primary action: Book Now, Continue, Confirm booking, service saves, pending-booking confirmation; also the active admin date filter |
| `Button` outline | Back/retry actions, inactive date filter, pagination, service edits, keep/discard actions; danger-colored outline overrides distinguish cancel/delete entry points |
| `Button` inverted | Porcelain action on the landing's plum closing section |
| `Button` destructive | Final cancellation/deletion confirmation, not the initial entry point |
| `Button asChild` | Navigation links styled as controls without nesting an anchor inside a button |
| `Card` / `CardContent` | Empty/unavailable panels, lilac appointment summary, lilac admin service panel; not every menu or appointment row |
| Native inputs and fieldsets | Service/time radios, date selection, contact fields, and service editor; shared `booking-label`, `booking-input`, `field-error` styles |
| Native `<details>` / `<summary>` | Landing booking questions; immediate disclosure without custom state |
| Inline feedback | `role="alert"` for errors; `role="status"` for schedule loading, empty availability, and admin success notices |
| Inline confirmation groups | Named cancellation/deletion prompts next to the affected booking or service; no modal added |
| Lucide icons | Sparse functional arrows, retry, check, calendar, and add icons; decorative icons beside labels are hidden from assistive technology |

The redesigned controls use the existing shadcn Button/Card APIs, adapted to **Tailwind 3**. Default buttons and inputs are at least 48px high; compact admin buttons and navigation links are at least 44px. Disabled controls retain their native disabled semantics. Input labels, autocomplete, keyboard types, inline errors, and focus refs remain intact.

Compatibility classes such as `.button`, `.admin-surface`, and the old color aliases remain for refresh/sign-out and untouched auth-page contents. The legacy flower icon remains on the login page, not on `/`, `/book`, or the dashboard. Dialog, Sheet, Tabs, Badge, and Sonner are not used by these redesigned pages; dormant generated primitives are not evidence of a full Tailwind migration. Reuse the existing primitives, and review compatibility before introducing another one.

## Page patterns

### Landing `/`

- Wordmark, visible navigation, and Book Now. Mobile navigation takes a separate row; the desktop header aligns all three at 1024px.
- “A little change. All you.” pairs with a local stock photograph. At 1024px the hero uses unequal `0.95fr / 1.05fr` columns; the photo is portrait-cropped. It is rendered with `next/image`, not a placeholder or drawn illustration.
- The caption explicitly says **“Stock photography, not our premises.”** Keep that disclosure until authorized real imagery replaces it.
- Service-menu rows align name, duration, INR price, and action on desktop and stack across rows on mobile. Preview rows say “Example only” and have no service-specific booking link.
- Lilac visit-preparation section, native booking-question disclosures, and a plum closing invitation with an inverted CTA. The footer discloses the sample identity.
- Preserve `#home`, `#main`, `#services`, `#ritual`, and `#stories`, general `/book` links, and `/book?service=<real-id>` links. Live, preview, empty, and unavailable menu states remain distinct.

### Booking `/book`

- Shared wordmark, Back to menu, “Make time for you.” and an ordered progress list: **Service → Date & time → Your details**. Progress is informational, not clickable step navigation; `aria-current="step"` marks the current stage.
- **Service:** full-row native radio labels with name, duration, and INR price. The selected row uses lilac, a plum border, and a filled radio indicator. Continue remains disabled until a service is selected.
- **Date & time:** native bounded date input, visible salon time zone, and a radio grid with three columns on mobile/four at 640px. Selected times use porcelain text on plum. Loading, error/retry, invalid-date, and no-times states do not invent availability.
- **Your details:** full-name and phone fields with existing autocomplete, limits, keyboard modes, error associations, and submission disabling. Keep the reminder that selecting a time does not hold it.
- A lilac Card summarizes the selected service, duration, menu price, and selected time. It follows the form on mobile; at 1024px the grid becomes `minmax(0, 1fr) minmax(18rem, 0.55fr)` and the summary is sticky with a `2rem` top offset.
- Back/Continue actions stack with the primary action above Back on mobile, then sit in a row at 640px. No floating action bar obscures inputs.
- Confirmation replaces the form only when the existing receipt logic accepts the saved booking. The focused heading, customer name, service, status, salon-local start/end times, time zone, menu price, phone, selectable reference, and no-payment statement remain visible. Receipt details form two columns at 640px, within a 52rem maximum width.
- Empty-menu and unavailable-schedule page states use a separate Card and preserve the GET retry form to `/book`. Keep `#booking-main`, preselected-service behavior, keyboard radio selection, step focus, and safe same-request retries unchanged.

### Admin dashboard `/admin`

- Paper header on a porcelain workspace, the shared wordmark, and View salon website. “The salon, at a glance.” introduces the signed-in identity, existing refresh/sign-out controls, and jump links to the appointment book and service menu.
- **Appointment book:** a divided list, not a grid of booking cards or fabricated KPI tiles. Each entry shows a prominent start time, end time, date, customer name, service, phone, status, and selectable reference.
- From 640px, a `7rem` time column sits beside appointment details; it grows to `8rem` at 1280px. On smaller screens the time/date area sits above the details.
- **Today / Upcoming:** real query-string links with `aria-current="page"`. Preserve salon-local interpretation, all statuses, the existing 50-row pagination, and Previous/Next links. The visible time-zone note explains the list.
- **Service panel:** lilac Card containing the INR note, Add a service, inline editor, and divided service rows. Each row shows name, duration, price, and explicitly named Edit/Delete controls. Validation, busy, empty, error, success, and sign-in-required states stay visible.
- At 1024px, appointments and services become `minmax(0, 1fr) 20rem` columns; the service column widens to `22rem` at 1280px. The service panel is not sticky. On mobile it follows the appointment book, with a jump link for direct access.
- Pending bookings retain Confirm; eligible bookings retain Cancel booking. Cancellation and service deletion require their existing inline confirmation groups and show a destructive final action. Completed/cancelled bookings show explanatory text rather than reopen controls.
- Keep `#admin-main`, `#admin-bookings-title`, `#admin-services-title`, query parameters, navigation, and existing access checks. A workspace-loading failure remains an explicit unavailable panel, not an empty appointment list.

Status colors always accompany a text label:

| Status | Foreground | Background |
| --- | --- | --- |
| Pending | `--ink-soft` | `--lilac` |
| Confirmed | `--sage` | `--sage-soft` |
| Cancelled | `--danger` | `--danger-soft` |
| Completed | `--text-muted` | `--sand` |

## Motion and accessibility

The only animation used by the redesigned pages is shared Button pointer-press feedback through `motion`: lazy `domAnimation`, scale **0.98**, **120ms**, easing **`[0.23, 1, 0.32, 1]`**. Pointer release/cancel/leave/blur restores the resting state. Reduced-motion users get no scaling. Keyboard activation, hover colors, and FAQ disclosure are immediate. Do not add page-load choreography, parallax, animated grain, or layout animation.

Page hover styles are gated by pointer/hover capability; Tailwind has `future.hoverOnlyWhenSupported: true`. Global reduced-motion rules disable transitions and minimize CSS animations. Touch controls use `touch-action: manipulation`. Skip links, native form semantics, focus indicators, wrapping, and safe-area padding are implemented; browser, assistive-technology, and hardware behavior still require hands-on checks. Booking radio selections also have explicit forced-colors styling.

`tw-animate-css` remains a direct dependency in `package.json`, but it is not imported by the current app styles or redesigned pages. Do not describe it as removed, or treat its presence as implemented animation. No dependency cleanup is part of this specification.

## Content and launch requirements

- Keep Muse's sample-name disclosure until the owner approves a final identity, logo, favicon, and copy. The existing favicon also needs review.
- The only photo is `public/images/salon-interior.jpg`; its attribution is in `public/images/README.md`. It is not evidence of the real premises, staff, or product affiliations. Replace it only with authorized imagery and update the caption/alt text.
- Service names, durations, and prices come from the existing menu flow. Format INR with `en-IN`; do not convert stored amounts, infer the salon's location, or turn preview IDs into bookable services.
- Do not invent testimonials, ratings, credentials, contact information, or confirmed availability. Add testimonials or a WhatsApp link only after receiving genuine content, permission, and an approved business number.
- Preserve clear reservation/no-payment language. No payment, email/SMS confirmation, or new booking behavior is implied by this visual update.

## Verification and known gaps

For design changes, run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`. A production **build** compiles the application; it is not permission to start a dev, preview, or production server. The earlier prohibited dev-server run remains a historical process issue, not a validation method to repeat. Do not create production appointments or access live customer data for visual checks.

The committed redesign passed typecheck, **149 tests**, and production builds; a subsequent build at `4c71879` also passed. The build skips linting. Nonfatal OpenSSL certificate-directory and inferred workspace-root warnings remain; tests also emit a Node module-format warning. These are recorded results for the implementation above, not a claim that every future documentation or code revision has been retested.

- `tests/landing.test.mjs`: rendered catalog states, links/anchors, sample/stock disclosures, escaping, selected theme contrast pairs, and shared Button semantics/touch-size classes.
- `tests/booking-ui.test.mjs`: rendered service/date/detail/receipt states, error associations, deep links, empty/unavailable states, and busy/disabled markup.
- `tests/admin-ui.test.mjs`: rendered filters, pagination, status actions, editor/deletion/cancellation states, shell links, and mocked page data boundaries.
- `tests/ui-harness.mjs`: offline rendering with real UI primitives and stubbed Next transports/CSS modules; state fixtures test markup, not event execution or persistence.

Browser rendering, real-device performance, screen-reader operation, live booking/admin authentication and mutations, and SQL runtime/RLS checks remain **unverified** by these UI checks. Source/SSR tests do not prove layout or accessibility compliance. See [README.md](README.md#checks-and-current-verification-gaps) for the broader test boundaries and manual checks. Historical dependency-audit findings are not a fresh security assessment; no new audit or package migration is claimed here.
