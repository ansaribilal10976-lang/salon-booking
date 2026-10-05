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

Brand and display currency are configured in `src/lib/salon.ts` (Muse and USD are draft defaults). The locally served image is illustrative stock photography; provenance is in `public/images/README.md`. Replace these with the actual salon's details before launch.

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

Use [`supabase/salon_booking_schema.sql`](supabase/salon_booking_schema.sql). It contains the complete tables, constraints, RLS/grants, private admin allowlist, scheduling settings, validation triggers, and application RPCs from all four numbered migrations, inside one transaction. It seeds no admin accounts or sample services/customer data.

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

Run only migrations that have not yet been applied. If the first three are already applied, run only the fourth to enable direct public booking submissions. These files are not designed to overwrite existing schemas or be rerun. Set the salon time zone, then add actual service names, durations in minutes, and approved prices through the Supabase Table Editor. There is no automatic production seed of the example menu.

| Table | Columns |
| --- | --- |
| `services` | `id` UUID, `name` text, `duration` positive integer, `price` non-negative numeric(10,2) |
| `bookings` | `id` UUID, `customer_name` text, `phone` text, `service_id` UUID foreign key, `slot_time` timestamptz, `end_time` timestamptz, `status` booking_status |

IDs are generated automatically unless an idempotency UUID is supplied. Names and phones cannot be blank; phone numbers are text to preserve country codes and leading zeros. Slots are stored as timezone-aware instants. Service deletion is restricted while any booking references it.

`end_time` snapshots the service duration at reservation time. A trigger derives it on insert and when a booking's service/start changes, and prevents manual shortening. Later service-duration changes do not move existing appointments. The second migration backfills old bookings without deleting records; existing overlapping reservations cause migration failure and must be reviewed by the owner, not silently cancelled.

Direct public booking submissions default to `pending` for admin confirmation. Guest website/RPC bookings are explicitly `confirmed` after saving. Other enum values are `completed` and `cancelled`.

### Privacy and RPCs

Both public tables have row-level security enabled. The access rules are:

| Action | Anonymous visitor | Ordinary signed-in user | Allowlisted admin |
| --- | --- | --- | --- |
| Read services | Yes | Yes | Yes |
| Submit a new booking | Yes | Yes | Yes |
| Read booking rows | No | No | Yes |
| Add/edit/delete services | No | No | Yes |
| Confirm/cancel bookings through admin RPC | No | No | Yes |
| Direct booking UPDATE/DELETE | No | No | No |

The fourth migration grants `anon` and `authenticated` INSERT privileges on **only** `customer_name`, `phone`, `service_id`, and `slot_time`, with a pending-status INSERT policy. IDs and end times are generated/derived by the database; customers cannot supply `id`, `status`, or `end_time`. An authenticated SELECT grant is filtered by the admin allowlist policy, so ordinary accounts cannot read customer records—even their own inserted rows. Anonymous booking SELECT remains ungranted. Service edits still require an allowlisted admin through RLS.

Direct Supabase inserts must omit `.select()`/RETURNING and use the allowed fields only. A database trigger trims/validates contact fields and enforces the salon-local schedule, future/90-day date range, half-hour starts, and finishing by 8 PM. The existing exclusion constraint blocks same-time and full-duration overlaps. Direct inserts cannot bypass the RPC safeguards by posting a cancelled status or shortened end time.

The website keeps using `create_booking` for atomic confirmation, idempotent retries, and that request's receipt. Returning a validated booking receipt from this RPC does not grant permission to list or read the bookings table.

The following narrowly scoped guest SECURITY DEFINER functions are granted to `anon` and `authenticated`, with fixed empty search paths and validated inputs:

- `get_booking_config()` returns the time zone and date range.
- `get_available_slots(p_service_id, p_date)` returns **only** available timestamp instants, not reservation details.
- `create_booking(p_booking_id, p_service_id, p_slot_time, p_customer_name, p_phone)` validates the schedule, saves to `bookings`, and returns that request's receipt. Matching retries return the same row; mismatched IDs/details fail without revealing stored contact data.

Next.js `GET /api/availability` and `POST /api/bookings` call these RPCs using the public key. The API validates input and omits raw database errors. Private responses and availability are not cached. The booking endpoint validates content type, limits input size, and rejects explicit cross-origin requests. RPCs still allow public guest access directly; this origin check is not an anti-abuse boundary.

**Before public production launch**, add an anti-abuse solution (rate limits/CAPTCHA at a trusted gateway) covering both direct Supabase RPC access and the public booking INSERT endpoint. Guest booking currently has no identity verification, customer cancellation UI, holiday schedule, multi-stylist capacity, payments, or notification integration. Staff access is managed through the admin allowlist below; never open the entire bookings table to all signed-in users.

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
- Service management supports **add, edit, and delete**, with real names, whole-minute durations from 1–600, and non-negative prices with at most two decimal places. Names are limited to 120 characters. Database constraints also enforce these limits; incompatible existing rows abort the migration rather than being altered silently.
- Service IDs cannot be changed. Deleting a service with any booking attached fails with a clear conflict message, preserving history. Duration edits affect new reservations while existing booking end-time snapshots stay unchanged.
- Changes trigger a dashboard refresh. **Refresh dashboard** reloads the current view on demand without changing its date filter. Failed/uncertain saves show errors rather than false success; refresh before retrying an uncertain service create to avoid accidental duplicate menu entries.
- **Sign out** clears the local Supabase session and performs a full navigation away from the customer-data dashboard.

### Admin access boundaries

`public.is_admin()` checks a private allowlist against `auth.uid()`. `list_admin_bookings` and `admin_set_booking_status` independently require that role. They are executable by `authenticated` only, with fixed empty search paths; anonymous RPC execution is denied. The service policies and column-level grants permit only admin writes to `name`, `duration`, and `price`. Authenticated users may submit only the same restricted booking fields as guests; there are still no direct booking UPDATE/DELETE grants. Admin confirmation/cancellation remains an explicitly authorized RPC operation.

All `/admin` and `/api/admin` responses are private/no-store. Mutating APIs require a same-origin request, verify identity/role before parsing work, cap JSON inputs, validate fields, and do not expose raw auth/database errors or use service-role credentials. Supabase RLS/RPC checks remain authoritative even if someone bypasses the dashboard. A session cookie alone is not sufficient.

## Checks and current verification gaps

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Unit tests use Node's built-in runner and TypeScript stripping (Node 22.6+). They cover service source/error states, calendar/contact input validation, salon-zone formatting, availability response privacy, conflict handling, unknown write outcomes, safe receipt validation, idempotency request propagation, admin identity/role denial, API operation gating, service CRUD validation/read-back, booking status actions, pagination, and safe error responses. Database/auth adapters are mocked in these tests; they do not prove real authentication, database permissions, saves, or races.

Latest local application checks: `npm run lint` passed, `npm run typecheck -- --incremental false` passed, all 54 tests passed under `npm test`, and standalone Tailwind compilation passed. `npm run build` failed at the unavailable Android ARM64 SWC binary, before production compilation. The unit tests use mocked database/auth adapters and are not a live authorization check.

SQL tests on a **disposable development database**:

- `supabase/tests/schema.sql`: base constraints and API-role table privacy; rolls back synthetic fixtures.
- `supabase/tests/public_booking_rls.sql`: direct anonymous/authenticated submissions, pending defaults, protected fields, no read-back permission, invalid schedules/contacts, overlap protection, admin-only reads/service edits, and compatibility with the website confirmation RPC. Runs after all four migrations and rolls back fixtures; it temporarily truncates the test calendar, so use only a disposable database.
- `supabase/tests/admin.sql`: anonymous/non-admin denial, forged metadata rejection, allowlisted admin service CRUD and booking access, status transitions, time-zone filters, and pagination; synthetic accounts/fixtures are rolled back. Use a disposable development database.
- `supabase/tests/booking.sql`: schedule boundaries, half-hour grid, time zones, contact validation, booking save/read-back, overlaps, cancellation, snapshots, receipt retries, RPC permissions. Rolls back fixtures but temporarily truncates the test calendar inside its transaction; **never run on a live booking database**.
- `supabase/tests/booking_concurrency.sql`: explicit two-connection idempotency and overlap race tests. Read the file's setup/session/cleanup instructions. Setup and winning reservations commit; use a disposable database and run cleanup.

If using psql, use `-v ON_ERROR_STOP=1` so failures fail the command. SQL tests/migrations have **not been executed here**: PostgreSQL/psql/Supabase CLI are unavailable. A complete public key is still needed for a live connection; the provided truncated value was not used.

The local Next.js production build is blocked by the unavailable Android ARM64 SWC binary. Browser rendering and interactions require verification on supported Linux/macOS/Windows or Vercel.

### Manual end-to-end checks

After configuring a real key, applying all required migrations, and adding services on a supported runtime:

1. At 320px, 375px, 768px, and 1280px widths, complete a booking from both the hero CTA and a preselected service card. Verify the summary and confirmed status, then check the saved row as the database owner.
2. Reload the schedule and confirm the occupied interval is absent for every service, including starts inside a longer appointment.
3. In two browsers, select the same time before either confirms. Confirm simultaneously; exactly one reservation must succeed. Repeat with different services/overlapping times and check adjacent appointments remain allowed.
4. Test dates outside the horizon, past times, non-grid timestamps via the RPC, invalid contacts, an empty menu, offline availability, and a stale selection.
5. Retry an unchanged request with the same UUID and check only one row exists. Test a mismatched payload, which must not expose the saved receipt.
6. Verify keyboard navigation, radio selection, step-focus changes, error announcements, phone input, 200% zoom, no horizontal overflow, and the salon timezone (not browser timezone).
7. Verify anonymous booking SELECT/UPDATE/DELETE fail, while a restricted booking INSERT and the three guest RPCs work. Verify ordinary signed-in users also cannot read customer rows or edit services. Do not treat unit tests as proof of this database boundary.

### Manual admin checks

After applying all four migrations and provisioning an admin on a supported runtime:

1. Open `/admin` anonymously and confirm redirection to login. Test invalid credentials and a signed-in ordinary account; neither may see customer bookings or mutate services.
2. Sign in as an allowlisted admin. Verify Today/Upcoming against the configured salon zone, including appointments around midnight and pagination beyond 50 rows.
3. Confirm a pending booking, cancel another with the explicit prompt, refresh, and verify the saved rows and guest availability. Attempt to reopen cancelled/completed bookings and verify rejection.
4. Add a real service, edit duration/price, reload `/admin` and the public menu, then delete an unused service. Attempt to delete a booked service and verify history remains intact.
5. Revoke the admin membership while the dashboard is open. The next read/write must fail. Check direct Supabase calls as anon and an ordinary authenticated user, not just the UI.
6. Sign out, then reload/back-navigate to the dashboard. Verify protected requests require sign-in. Check keyboard navigation, form validation, cancellation/delete prompts, and mobile layouts at 320px/375px widths.

Browser/admin-auth and SQL checks have not been run here; the missing complete key and local Android compiler limitation still block live end-to-end verification. Local lint, TypeScript, unit tests, and Tailwind compilation are separate checks, not proof of live authentication or database authorization.

## Vercel deployment

Import `salon-booking/` using the Next.js preset. Configure the two public environment variables for the appropriate Vercel environments before building; redeploy after changing them. Apply all required SQL migrations separately in Supabase and set the time zone. Default build command: `npm run build`. Nothing has been deployed by this task.
