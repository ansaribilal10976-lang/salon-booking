# Salon Booking

Next.js 14 App Router, TypeScript, Tailwind CSS, and Supabase Postgres. Deployment target: Vercel. Phase 2 implements guest appointment booking; there is no account requirement or payment collection.

## Development

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Do not overwrite an existing `.env.local`. Open http://localhost:3000.

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` using your Supabase project's Connect dialog or Settings > API. The key must be a complete public anon JWT or `sb_publishable_...` key. Restart the dev server after changes. `.env.local` is gitignored; do not put real credentials in the example file. Never use a service-role/secret key or database password in a `NEXT_PUBLIC_*` variable.

The server and browser helpers are in `src/lib/supabase/`. Both are typed using the handwritten schema in `src/types/database.ts`; regenerate these types from Supabase after applying the migrations.

## Landing page

The mobile-first home page includes a hero, salon service cards showing duration and price, practical appointment-preparation advice, and **Book Now** links.

- With no Supabase environment configuration, the home page displays a clearly labeled example menu. These display-only services cannot be booked and are never inserted into the database.
- With both variables configured, the page reads the public `services` table on each request, ordered by name. Requests time out after five seconds.
- An empty live menu and a failed connection show different states. Neither silently falls back to invented services.
- **Book Now** opens `/book`. A real service card preselects that service. Booking requires a reachable, migrated Supabase project and real service rows; there is no fake success or local-only reservation fallback.

Brand and display currency are configured in `src/lib/salon.ts`. **Muse is a placeholder salon name**, not a real-business claim. Prices display in **INR using `en-IN`**, including Indian digit grouping (for example, ₹1,23,456.78). This changes formatting only: it does not convert stored numeric prices or choose the salon time zone. Review the service amounts as rupees before launch.

### Branding and image checklist

Replace or review every branding location before launch:

- `src/lib/salon.ts`: placeholder name, display locale, and currency.
- `src/app/page.tsx`, `src/app/book/page.tsx`, `src/app/admin/layout.tsx`: hardcoded lowercase **`muse.`** wordmark. The landing footer says “A sample salon concept.”
- `src/app/layout.tsx`, `src/app/book/page.tsx`, `src/app/admin/layout.tsx`: page titles/descriptions and name-derived metadata.
- `src/app/page.tsx`, `src/app/book/page.tsx`, `src/components/booking-flow.tsx`: taglines, marketing/booking copy, image alt text, and salon-facing wording.
- `src/components/icons.tsx`: `FlowerIcon` brand/decorative motif and other inline iconography; there is no separate logo image.
- `src/app/favicon.ico`: starter black/white Vercel-style favicon; replace with the salon's own icon.
- `tailwind.config.ts`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/fonts/`: palette, typography, and local Geist fonts. Also review inline colors in the landing page, booking flow, and admin booking/service components.
- `src/lib/services.ts`: display-only example service names, durations, and prices; real menu rows come from Supabase `services`.
- `public/images/salon-interior.jpg`, `public/images/README.md`, `src/app/page.tsx`: stock photo, attribution, and usage. The photo includes visible product signage, not proof of the salon's premises or affiliations.

There are **no service images or Supabase Storage calls**. The only photo is already local at `public/images/salon-interior.jpg` (1400×972 JPEG, 175,385 bytes), served with Next Image from `src/app/page.tsx`; no Storage migration is needed. Keep its provenance in `public/images/README.md`, or replace it with an optimized, authorized salon photograph.

### Content rules

Use realistic, plain-English salon content, never lorem ipsum. Do not invent reviews, credentials, awards, contact details, or confirmed availability. Keep example-price disclosures whenever the menu is sample data.

### Mobile-first UI

Layouts start with one column. Services expand to two columns at 640px and three at 1024px. The hero becomes split-column at 1024px. Mobile navigation remains visible, primary CTAs fill the available width, and headings scale fluidly. Buttons are at least 48px high; navigation links are at least 44px high. Focus indicators, reduced-motion preferences, device safe areas, and browser zoom are supported. Contact inputs use autocomplete and an appropriate phone keyboard. Long names and prices wrap.

## Booking flow

1. Select a real salon service.
2. Pick a date and one of the available appointment times.
3. Enter a full name and phone number and review the appointment summary.
4. Select **Confirm booking**.
5. Show the success screen only after Supabase returns the matching saved reservation with `confirmed` status.

The success screen shows the service, salon-local date and start/end times, time zone, reserved duration, menu price, customer name, phone, confirmed status, and booking reference. The menu price is not a charged payment or a historical price snapshot. Keep the confirmation/reference for your records; email and SMS notifications are not implemented.

### Scheduling rules

- One shared salon calendar, every day, 10:00 AM–8:00 PM.
- Starts are spaced 30 minutes apart, beginning at 10:00 AM. An appointment must **finish** by 8:00 PM. A 30-minute service's last start is 7:30 PM; a 60-minute service's is 7:00 PM.
- Available dates span today through 90 days ahead, based on the configured salon time zone. Past slots are excluded.
- Full service durations are reserved. Pending, confirmed, and completed bookings block overlapping intervals across all services; cancelled bookings do not. Adjacent appointments are allowed.
- Availability is rechecked at write time. A Postgres GiST exclusion constraint is the final protection against concurrent duplicate or overlapping reservations—not browser filtering.
- If another customer wins a slot, the API returns 409, the UI reloads availability, and the customer chooses another time while retaining their contact details.
- Every confirmation attempt uses a UUID request ID. Unchanged retries reuse it, so a lost network response can return the existing reservation rather than create a second one. Keep the page open and retry with the same details after an uncertain response.

### Time zone: set before accepting bookings

The database stores one IANA time zone in `private.salon_booking_settings`. It defaults to **UTC**, a configuration default—not an inferred salon location. The UI explicitly displays it. Set the actual salon zone through the SQL Editor before accepting appointments. For example, **only if your salon is in New York**:

```sql
update private.salon_booking_settings
set time_zone = 'America/New_York'
where singleton;
```

Use the appropriate IANA name for the actual salon. Changing the zone does not move existing saved timestamp instants. Reload the booking page after changing configuration.

## Database setup

### One-file setup for a fresh Supabase project

Use [`supabase/salon_booking_schema.sql`](supabase/salon_booking_schema.sql). It contains the complete tables, constraints, RLS/grants, private admin allowlist, scheduling settings, validation triggers, application RPCs, and private quota bookkeeping from all six numbered migrations, inside one transaction. It seeds no admin accounts or sample services/customer data.

1. Open a **fresh development Supabase project** in the dashboard and open **SQL Editor** as the owner.
2. Paste the entire file and run it once. A preflight check refuses an existing salon schema without dropping or rewriting its objects.
3. Set the actual salon time zone, add real services, and provision an administrator using the instructions below. The initial zone is UTC, not an inferred location.
4. Run the SQL checks only on a disposable development database before production use.

**Choose one setup method:** use this bundle OR the numbered migrations, not both on the same database. The bundle is intentionally outside `supabase/migrations/` so Supabase CLI migration scans do not apply it twice. It does not create numbered migration-history records; do not later run the original numbered files against a bundled schema without deliberately baselining your migration history.

The SQL file has not been executed on PostgreSQL or a live Supabase project here. Its source parity can be checked or regenerated without database access:

```bash
node scripts/export-supabase-schema.mjs --check
node scripts/export-supabase-schema.mjs
```

This checks exported content, not database syntax, policies, or runtime behavior.

### Incremental setup for existing projects

Apply these migration files **in order**, once each, in the intended development Supabase project's SQL Editor:

1. `supabase/migrations/20261005000000_create_services_and_bookings.sql`
2. `supabase/migrations/20261005010000_add_guest_booking_rpcs.sql`
3. `supabase/migrations/20261005020000_add_admin_dashboard.sql`
4. `supabase/migrations/20261005030000_allow_public_booking_inserts.sql`
5. `supabase/migrations/20261005040000_validate_raw_service_values.sql`
6. `supabase/migrations/20261005050000_protect_guest_bookings.sql`

Run only migrations that have not yet been applied. If the first five are already applied (including through the previous five-migration bundle), run **only the sixth**. If fewer are applied, run the remaining numbered files in order. Do not rerun the original migrations or the fresh-project bundle over that existing schema. Set the salon time zone, then add actual service names, durations in minutes, and approved prices through the Supabase Table Editor. There is no automatic production seed of the example menu.

The fifth migration removes the price column's fixed-scale coercion so database CHECKs see the raw numeric value before rounding. Prices must be finite, nonnegative, at most `99999999.99`, and exactly representable to two decimal places: `1.239` and `-0.001` fail on raw INSERT/UPDATE; equivalent trailing-zero values such as `1.2300` remain valid. Existing price values are preserved. A trigger trims outer spaces from service names on writes; the migration deliberately trims existing padded names, and validated constraints bound the actual stored name to 1–120 characters with no controls. Internal spaces remain unchanged. RLS and column-level privileges are preserved by that migration.

The sixth migration revokes both table- and column-level booking INSERT privileges for `PUBLIC`, `anon`, and `authenticated`, removes the public INSERT policy, and replaces `create_booking` with database-enforced quotas. It preserves existing appointments, guest RPC permissions, admin-only reads/status actions, contact/schedule validation, idempotent receipts, and overlap protection. Private settings hold owner-editable limits; `private.booking_quota_events` records new successful RPC submissions. Historical creation times are not fabricated, so submission-window accounting starts when this migration is applied; active/future checks include existing rows.

| Table | Columns |
| --- | --- |
| `services` | `id` UUID, `name` normalized text, `duration` positive integer, `price` numeric with explicit monetary-value constraints |
| `bookings` | `id` UUID, `customer_name` text, `phone` text, `service_id` UUID foreign key, `slot_time` timestamptz, `end_time` timestamptz, `status` booking_status |

IDs are generated automatically unless an idempotency UUID is supplied. Names and phones cannot be blank; phone numbers are text to preserve country codes and leading zeros. Slots are stored as timezone-aware instants. Service deletion is restricted while any booking references it.

`end_time` snapshots the service duration at reservation time. A trigger derives it on insert and when a booking's service/start changes, and prevents manual shortening. Later service-duration changes do not move existing appointments. The second migration backfills old bookings without deleting records; existing overlapping reservations cause migration failure and must be reviewed by the owner, not silently cancelled.

Direct public booking INSERT is **denied**. Guest website/RPC bookings are explicitly `confirmed` after saving. Existing or owner-maintained `pending` rows still support admin confirmation. Other enum values are `completed` and `cancelled`.

### Privacy and RPCs

Both public tables have row-level security enabled. The access rules are:

| Action | Anonymous visitor | Ordinary signed-in user | Allowlisted admin |
| --- | --- | --- | --- |
| Read services | Yes | Yes | Yes |
| Submit a new booking through `create_booking` (quota-limited) | Yes | Yes | Yes |
| Direct booking INSERT | **DENIED** | **DENIED** | **DENIED** |
| Read booking rows | No | No | Yes |
| Add/edit/delete services | No | No | Yes |
| Confirm/cancel bookings through admin RPC | No | No | Yes |
| Direct booking UPDATE/DELETE | No | No | No |

The sixth migration **revokes the fourth migration's direct INSERT grants** and drops its public INSERT policy. No code in `src/` uses the old grant. Direct INSERT is denied for `anon` and `authenticated`, including allowlisted admins using that API role, even with valid customer-only fields and without RETURNING. All guest submissions must use `create_booking`; admin confirmation/cancellation uses the authorized admin RPC.

An authenticated SELECT grant is filtered by the admin allowlist policy, so ordinary accounts cannot read any customer rows. Anonymous booking SELECT remains ungranted. Service edits still require an allowlisted admin through RLS. Retained validation/duration triggers and the exclusion constraint protect the RPC's schedule, contact fields, duration, and overlapping slots. Private quota settings/events cannot be read or edited through the public roles.

The website keeps using `create_booking` for atomic confirmation, idempotent retries, and that request's receipt. Returning a validated booking receipt from this RPC does not grant permission to list or read the bookings table.

The following narrowly scoped guest SECURITY DEFINER functions are granted to `anon` and `authenticated`, with fixed empty search paths and validated inputs:

- `get_booking_config()` returns the time zone and date range.
- `get_available_slots(p_service_id, p_date)` returns **only** available timestamp instants, not reservation details.
- `create_booking(p_booking_id, p_service_id, p_slot_time, p_customer_name, p_phone)` validates the schedule, saves to `bookings`, and returns that request's receipt. Matching retries return the same row; mismatched IDs/details fail without revealing stored contact data.

Next.js `GET /api/availability` and `POST /api/bookings` call these RPCs using the public key. The API validates input and omits raw database errors. Private responses and availability are not cached. The booking endpoint validates content type, enforces a 4096-byte limit while streaming the body (oversized reads stop immediately), and rejects explicit cross-origin requests. RPCs still allow public guest access directly; this origin check is not an anti-abuse boundary.

### Booking limits and remaining abuse risk

**All limits are stored in the singleton row of `private.salon_booking_settings`.** `create_booking` reads this row for each new reservation; enforcement does not hardcode the defaults. The owner can change any or all limits with **one UPDATE, without another migration or application deployment**. Settings remain inaccessible to public API roles and are not returned by `get_booking_config`.

| Database control | Settings column | Default | Counting / expiry |
| --- | --- | --- | --- |
| Active future bookings per phone | `max_active_future_per_phone` | **5** | Pending/confirmed rows whose start is still future, including pre-migration bookings; starts/cancellations release capacity |
| New bookings per phone | `max_phone_bookings_per_24h` | **5 per rolling 24 hours** | Successful RPC inserts, even if later cancelled; thus at most 5 in any hour at the default setting, with no separate hourly quota |
| Global daily submissions | `max_daily_submissions` | **40 per salon-local calendar day** | Successful new future reservations across every phone and appointment date; resets at salon-local midnight, not a rolling day |

Phones are matched by the **last 10 digits for quotas**: country prefixes, leading digits, spaces, punctuation, and `+` do not create separate budgets; shorter valid numbers keep all their digits. Stored/displayed phones and exact receipt matching stay unchanged; no country-code inference or phone-ownership verification is performed. The per-phone default of five allows repeat/family bookings. These per-phone limits only stop casual repeats: an attacker can rotate phone numbers. The **global daily cap and a trusted-gateway CAPTCHA** are the real controls against that rotation. The global default is **40 new submissions/day**, not an appointment-date capacity limit; the owner can adjust it for legitimate demand. There is **no separate per-appointment-date quota**: the shared calendar has at most 20 half-hour starts/day, and the existing exclusion constraint prevents overlapping reservations. These limits do not expand calendar capacity.

Exact same-UUID/details retries return the existing saved receipt **before quota checks**, add no event, and have **no time-based expiry while the booking row exists**, including past/cancelled bookings. A mismatched payload remains rejected. Cancelled bookings still consume rolling-phone and daily-submission quotas. Expired ledger events are pruned on successful new bookings; time-bounded queries enforce expiry even before pruning.

Quota violations raise database `PT429`, which PostgREST exposes as HTTP 429; `/api/bookings` maps it to a friendly, limit-specific message (wait or contact the salon). The UI retains contact details, selected service/date/time, and request UUID; it never displays a false confirmation. All new RPC writes serialize quota checks, booking insertion, and ledger accounting in one transaction. PostgreSQL READ COMMITTED snapshots are required for new writes; unusual higher-isolation SQL callers fail safely rather than count stale data.

**Protection boundary:** database quotas cover both direct Supabase `create_booking` calls and `/api/bookings`. Revoked INSERT privileges close the alternate public write path. Origin checking, JSON validation, and the 4096-byte body cap protect **only `/api/bookings`**, not direct RPC access. Postgres sees infrastructure connections, not a reliable visitor IP; there is no claimed database per-IP limit.

**These limits reduce but do not prevent abuse. Per-phone limits only stop casual repeats; an attacker rotating phone numbers can exhaust the global submission cap and block online bookings for that submission day, across all appointment dates.** The global cap and a trusted-gateway CAPTCHA are the real controls for this abuse pattern. Quotas bound saved reservations, not request traffic; they are not identity verification or complete denial-of-service protection. The CAPTCHA/rate-limit gateway must cover direct Supabase RPC access as well as the website before claiming broader protection.

**Owner response:** inspect `/admin`, cancel junk bookings to release occupied slots and per-phone active-booking capacity, and raise the global daily submission cap via owner SQL if legitimate customers remain blocked. Cancellation **does not refund the daily submission quota** (nor the phone's rolling quota). For example, after investigation, this single owner UPDATE keeps both phone limits at five and deliberately raises the global daily submission cap from 40 to 60. Change any of the three values as needed:

```sql
update private.salon_booking_settings
set max_active_future_per_phone = 5,
    max_phone_bookings_per_24h = 5,
    max_daily_submissions = 60
where singleton;
```

The defaults are **5 active future bookings per phone, 5 new bookings per phone per rolling 24 hours, and 40 global submissions per salon-local day**; restore them after the incident if appropriate. Limits must be positive integers. Do not re-grant direct INSERT, delete ledger events to bypass budgets, or expose these controls publicly. Raising a cap restores headroom but does not stop an attacker from exhausting it again. No SQL was executed as part of this implementation.

Guest booking still has no identity verification, customer cancellation UI, holiday schedule, multi-stylist capacity, payments, or notification integration. Staff access is managed through the admin allowlist below; never open the bookings table to all signed-in users.

## Admin dashboard

Open `/admin`. Unauthenticated visitors go to `/admin/login`, which uses Supabase **email/password** sign-in. There is no public admin signup. Valid sessions are refreshed by middleware, and protected pages/API handlers independently verify `auth.getUser()` plus the database allowlist. A locally decoded session, an email address, or editable user metadata is not authorization.

### Provision an administrator

1. Complete fresh-project bundle setup above, or apply `supabase/migrations/20261005020000_add_admin_dashboard.sql` after the two booking migrations. Do not reapply this migration if you already used the bundle.
2. In Supabase **Authentication > Users**, create a salon staff account using an actual email and a strong password. Ensure the email/password provider is enabled and the account is confirmed as required by your project. Never commit staff passwords.
3. As the database owner, add that user's UUID to `private.salon_admins`. For example, replace the address below with the actual staff account:

   ```sql
   insert into private.salon_admins (user_id)
   select id from auth.users where email = 'staff-account@example.com'
   on conflict (user_id) do nothing;
   ```

   This inserts nothing if that account does not exist. Verify the membership as the owner before trying to log in. No user can self-provision an admin role through the public API.
4. Sign in at `/admin/login`. A signed-in account without allowlist membership goes to an access-denied screen, not the booking list.

To revoke access, delete the user's row from `private.salon_admins` as the owner. Each subsequent protected request checks membership again. Already-viewed information cannot be retroactively removed from someone's knowledge. Password reset/email invitation callback screens are not implemented; manage account setup/recovery through your Supabase account administration.

### Dashboard behavior

- **Today** includes every appointment starting on the current salon-local date, including elapsed appointments. **Upcoming** starts tomorrow. Views include all statuses and are ordered by start time and ID, with 50-row pagination.
- Booking cards show customer name, phone, service, salon-local date/time, status, and reference.
- **Confirm** changes pending bookings to confirmed. **Cancel booking** requires an explicit confirmation and releases the occupied interval. Completed and cancelled bookings cannot be reopened. Repeating an already-applied confirm/cancel target is safe.
- Service management supports **add, edit, and delete**, with real names, whole-minute durations from 1–600, and non-negative prices with at most two decimal places. Names are trimmed on database writes and stored names are limited to 120 characters. Database constraints enforce these limits before monetary-value rounding; the fifth migration deliberately normalizes existing outer name padding without changing prices, IDs, durations, or booking snapshots.
- Service IDs cannot be changed. Deleting a service with any booking attached fails with a clear conflict message, preserving history. Duration edits affect new reservations while existing booking end-time snapshots stay unchanged.
- Changes trigger a dashboard refresh. **Refresh dashboard** reloads the current view on demand without changing its date filter. Failed/uncertain saves show errors rather than false success; refresh before retrying an uncertain service create to avoid accidental duplicate menu entries.
- **Sign out** clears the local Supabase session and performs a full navigation away from the customer-data dashboard.

### Admin access boundaries

`public.is_admin()` checks a private allowlist against `auth.uid()`. `list_admin_bookings` and `admin_set_booking_status` independently require that role. They are executable by `authenticated` only, with fixed empty search paths; anonymous RPC execution is denied. The service policies and column-level grants permit only admin writes to `name`, `duration`, and `price`. Authenticated users submit through the same quota-limited `create_booking` RPC as guests; direct booking INSERT/UPDATE/DELETE is denied even for an allowlisted admin's API role. Admin confirmation/cancellation remains an explicitly authorized RPC operation.

All `/admin` and `/api/admin` responses are private/no-store. Mutating APIs require a same-origin request, verify identity/role before parsing work, cap JSON inputs, validate fields, and do not expose raw auth/database errors or use service-role credentials. Supabase RLS/RPC checks remain authoritative even if someone bypasses the dashboard. A session cookie alone is not sufficient. If middleware client construction or authentication refresh throws, it returns a sanitized private 503 instead of forwarding the protected request; this also avoids redirect loops when login configuration is invalid.

## Checks and current verification gaps

```bash
npm run lint
npm run typecheck
npm test
node scripts/export-supabase-schema.mjs --check
# Production build on a supported runtime:
npm run build
```

Unit tests use Node's built-in runner and TypeScript stripping (Node 22.6+). They cover service source/error states, calendar/contact input validation, salon-zone formatting, availability response privacy, conflict handling, unknown write outcomes, safe receipt validation, idempotency request propagation, admin identity/role denial, API operation gating, service CRUD validation/read-back, booking status actions, pagination, and safe error responses. HTTP regressions execute the actual route/middleware source to check streaming UTF-8 byte limits, early cancellation (including failed/stalled cancellation), inclusive 4096-byte input, malformed JSON, and fail-closed responses for invalid Supabase URLs. Additional regressions cover friendly/sanitized quota 429s and UUID preservation, actual health-route authorization/configuration/timeout/no-store behavior, INR formatting, and SQL-runner safety with a fake `psql`. Database/auth adapters are mocked in these tests; they do not prove real authentication, database permissions, saves, or races.

Latest local Stage 1–4 checks (rerun after removing the appointment-date quota, setting the global daily default to 40, and applying the phone-key/health-header fixes from `fix1.md`): `npm run lint` passed, `npm run typecheck` passed, **122 tests passed with zero failures/skips** under `npm test`, and `node scripts/export-supabase-schema.mjs --check` matched all six migration bodies and the fresh-project guard. `bash -n scripts/run-sql-tests.sh` and `git diff --check` also passed. Quota 429 regressions were first observed failing against the old error mapping, then passed with the new handling. SQL-runner tests used only a fake `psql`.

SQL runtime tests remain **unexecuted**. The previous `npm run build` attempt failed at the unavailable Android ARM64 SWC binary before production compilation; it was not rerun for Stages 1–4, and no production build is claimed here. Unit/HTTP tests and schema text parity are not proof of live database authorization. Tests emitted nonfatal existing Node module-format and OpenSSL certificate-directory warnings.

SQL tests on a **disposable development database**:

- `supabase/tests/schema.sql`: base constraints and API-role table privacy; rolls back synthetic fixtures.
- `supabase/tests/public_booking_rls.sql`: **direct INSERT denial** for anonymous/authenticated roles (including valid customer-only writes), no surviving column grants, private-ledger denial, admin-only reads/service edits, and preserved `create_booking` save/retry/validation/overlap compatibility. Runs after all six migrations and rolls back fixtures; temporarily truncates the test calendar/ledger, so use only a disposable local database.
- `supabase/tests/booking_rate_limits.sql`: active and rolling-phone boundaries, equivalent phone formatting, cancellation accounting, the exact 40-submission boundary, owner cap increase, changing all three limits in one UPDATE and enforcing nondefault settings, salon-local submission-day limits, full shared-calendar capacity/overlap protection, expiry, historical rows, both public roles, and retries at exhausted quotas. Unexecuted; fixtures/configuration roll back.
- `supabase/tests/services_price.sql`: raw INSERT/UPDATE regression for excessive price precision (`1.239`, `-0.001`), valid boundaries, overflow, and non-finite values; covers owner and allowlisted authenticated writes without truncating the calendar. Run after all six migrations on a disposable database; fixtures roll back.
- `supabase/tests/services_name.sql`: raw INSERT/UPDATE regression for leading/trailing spaces, huge padding, actual stored-length bounds, internal spaces, and control characters; covers owner and allowlisted authenticated writes without truncating the calendar. Run after all six migrations on a disposable database; fixtures and temporary trigger changes roll back.
- `supabase/tests/admin.sql`: anonymous/non-admin denial, forged metadata rejection, allowlisted admin service CRUD and booking access, status transitions, time-zone filters, and pagination; synthetic accounts/fixtures are rolled back. Use a disposable development database.
- `supabase/tests/booking.sql`: schedule boundaries, half-hour grid, time zones, contact validation, booking save/read-back, overlaps, cancellation, snapshots, receipt retries, RPC permissions. Rolls back fixtures but temporarily truncates the test calendar inside its transaction; **never run on a live booking database**.
- `supabase/tests/booking_concurrency.sql`: explicit two-connection idempotency, overlap, and global/active-phone/rolling-phone quota races with nonoverlapping slots. Read the setup/session/cleanup instructions. Setup/winners **commit**; use a disposable local database and always run cleanup. Never run automatically.

### Guarded SQL runner — do not use on production

`scripts/run-sql-tests.sh` uses **only `$TESTDB`**; it never falls back to `DATABASE_URL` or application credentials. It refuses missing/whitespace-only values, the live ref `ytlmlixldsxfaveaokkv` (including case/percent-encoding variations), remote/ambiguous targets, and URI target overrides. Supply an explicit `postgres://` or `postgresql://` URI with a database and loopback host (`127.0.0.1`, `localhost`, or `[::1]`). Libpq conninfo/services/Unix sockets are deliberately unsupported. Only `sslmode`, `connect_timeout`, and `application_name` query parameters are accepted.

On an already migrated, **disposable local** database, the owner may run:

```bash
TESTDB='postgresql://postgres@127.0.0.1:5432/salon_test' bash scripts/run-sql-tests.sh
```

It runs ordinary `supabase/tests/*.sql` with `psql -X -w -v ON_ERROR_STOP=1`, stops at the first failure, ignores psql startup scripts/inherited connection-target defaults, never prints the connection string, and **excludes `booking_concurrency.sql`**, printing its separate manual instructions instead. Fixtures can truncate/lock the calendar: loopback is only a target guard, not proof the selected database is safe. Do not point it at a production tunnel. Tests of the runner use a fake `psql`, never a database.

**The runner has not been used against a database; SQL migrations/tests have not been executed here.** No live/remote connection or credentials were used. Schema text parity and mocked application tests do not verify SQL syntax, permissions, saves, expiry, or races.

The local Next.js production build is blocked by the unavailable Android ARM64 SWC binary. Browser rendering and interactions require verification on supported Linux/macOS/Windows or Vercel.

### Manual end-to-end checks

After configuring a real key, applying all required migrations, and adding services on a supported runtime:

1. At 320px, 375px, 768px, and 1280px widths, complete a booking from both the hero CTA and a preselected service card. Verify the summary and confirmed status, then check the saved row as the database owner.
2. Reload the schedule and confirm the occupied interval is absent for every service, including starts inside a longer appointment.
3. In two browsers, select the same time before either confirms. Confirm simultaneously; exactly one reservation must succeed. Repeat with different services/overlapping times and check adjacent appointments remain allowed.
4. Test dates outside the horizon, past times, non-grid timestamps via the RPC, invalid contacts, an empty menu, offline availability, and a stale selection.
5. Retry an unchanged request with the same UUID and check only one row exists. Test a mismatched payload, which must not expose the saved receipt.
6. Verify keyboard navigation, radio selection, step-focus changes, error announcements, phone input, 200% zoom, no horizontal overflow, and the salon timezone (not browser timezone).
7. Verify direct booking INSERT/UPDATE/DELETE fail for both `anon` and `authenticated`, anonymous SELECT fails, and the three guest RPCs still work. Exercise quota exhaustion and unchanged retries, checking 429 messages and no duplicate ledger events. Verify ordinary signed-in users also cannot read customer rows or edit services. Do not treat unit tests as proof of this database boundary.

### Manual admin checks

After applying all six migrations and provisioning an admin on a supported runtime:

1. Open `/admin` anonymously and confirm redirection to login. Test invalid credentials and a signed-in ordinary account; neither may see customer bookings or mutate services.
2. Sign in as an allowlisted admin. Verify Today/Upcoming against the configured salon zone, including appointments around midnight and pagination beyond 50 rows.
3. Confirm a pending booking, cancel another with the explicit prompt, refresh, and verify the saved rows and guest availability. Attempt to reopen cancelled/completed bookings and verify rejection.
4. Add a real service, edit duration/price, reload `/admin` and the public menu, then delete an unused service. Attempt to delete a booked service and verify history remains intact.
5. Revoke the admin membership while the dashboard is open. The next read/write must fail. Check direct Supabase calls as anon and an ordinary authenticated user, not just the UI.
6. Sign out, then reload/back-navigate to the dashboard. Verify protected requests require sign-in. Check keyboard navigation, form validation, cancellation/delete prompts, and mobile layouts at 320px/375px widths.

Browser/admin-auth and SQL checks have not been run here. Live end-to-end verification was not attempted; the local Android compiler limitation also blocks production/browser verification here. Local lint, TypeScript, unit tests, and Tailwind compilation are separate checks, not proof of live authentication or database authorization.

## Health check and daily cron

`GET /api/health` uses a **stateless public-key Supabase client**, not user cookies or service-role credentials. It calls only `get_booking_config`, with a five-second abort timeout and no-store upstream fetches. It returns only `200 {"ok":true}` for one valid configuration row; missing/invalid configuration or upstream failures return sanitized `503 {"ok":false}`. All responses are no-store and disclose no settings, customer data, or raw errors.

`vercel.json` schedules this endpoint daily at **03:00 UTC** (`0 3 * * *`). Set optional **server-only `CRON_SECRET`** in the deployment environment to require an exact `Authorization: Bearer <secret>` header; Vercel Cron supplies it when configured. Missing/wrong authorization returns `401 {"ok":false}` before database work. Leave the variable unset/empty for public checks. Keep real values in environment configuration, never committed files or query strings; `.env.local.example` contains only a blank placeholder. Manual calls to a protected route must provide the same header.

A daily cron/configuration read is a **best-effort keep-alive**, not a guarantee against Supabase pausing, provider suspension, cron delivery failure, or downtime. Verify the production route and Vercel cron logs after deployment; no cron execution or live health request was performed here.

## Vercel deployment

Import `salon-booking/` using the Next.js preset. Configure the two public environment variables and optional `CRON_SECRET` for the appropriate Vercel environments before building; redeploy after changing them. Apply all required SQL migrations separately and set the actual salon time zone. Default build command: `npm run build`. Deployment state is not asserted or verified by these local code changes.
