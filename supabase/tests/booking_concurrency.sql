-- Manual two-connection regression, requiring psql and a DISPOSABLE migrated DB.
-- Unlike booking.sql, the setup and winning reservations COMMIT. Run cleanup last.
-- Do not run alongside other tests or on a real salon calendar.
--
-- 1. psql "$TESTDB" -v ON_ERROR_STOP=1 -v phase=setup -f supabase/tests/booking_concurrency.sql
-- 2. Start session A, then start session B during A's first 15-second pause:
--    psql "$TESTDB" -v ON_ERROR_STOP=1 -v phase=a -f supabase/tests/booking_concurrency.sql
--    psql "$TESTDB" -v ON_ERROR_STOP=1 -v phase=b -f supabase/tests/booking_concurrency.sql
-- 3. psql "$TESTDB" -v ON_ERROR_STOP=1 -v phase=cleanup -f supabase/tests/booking_concurrency.sql
--
-- Then, on an EMPTY disposable calendar/ledger, repeat for each quota_kind:
-- global, active, window. Nonoverlapping slots ensure this is a quota race.
-- 4. psql "$TESTDB" -v ON_ERROR_STOP=1 -v phase=quota_setup -v quota_kind=global -f supabase/tests/booking_concurrency.sql
-- 5. Start quota_a, then quota_b during A's 15-second pause:
--    psql "$TESTDB" -v ON_ERROR_STOP=1 -v phase=quota_a -f supabase/tests/booking_concurrency.sql
--    psql "$TESTDB" -v ON_ERROR_STOP=1 -v phase=quota_b -f supabase/tests/booking_concurrency.sql
-- 6. psql "$TESTDB" -v ON_ERROR_STOP=1 -v phase=quota_cleanup -f supabase/tests/booking_concurrency.sql
-- Repeat 4-6 with quota_kind=active, then quota_kind=window. Cleanup also
-- removes quota events and restores owner-configured caps. Never auto-run.
--
-- Session B must actually wait in BOTH calls. It checks lock-wait durations so
-- starting it too late fails instead of falsely claiming concurrency coverage.
-- The second round uses a different service AND a different overlapping start.

\if :{?phase}
\else
  \echo 'Supply -v phase=setup|a|b|cleanup|quota_setup|quota_a|quota_b|quota_cleanup; see header.'
  \quit 1
\endif
select :'phase' = 'setup' as setup, :'phase' = 'a' as a,
       :'phase' = 'b' as b, :'phase' = 'cleanup' as cleanup,
       :'phase' = 'quota_setup' as quota_setup, :'phase' = 'quota_a' as quota_a,
       :'phase' = 'quota_b' as quota_b, :'phase' = 'quota_cleanup' as quota_cleanup
\gset

\if :setup
begin;
create table private.booking_concurrency_fixture (
  original_time_zone text not null,
  original_limits jsonb not null,
  slot_time timestamptz not null
);
revoke all on private.booking_concurrency_fixture from public, anon, authenticated;
insert into private.booking_concurrency_fixture
select time_zone, to_jsonb(settings), (((clock_timestamp() at time zone 'UTC')::date + 21) + time '10:00') at time zone 'UTC'
from private.salon_booking_settings as settings where singleton;
update private.salon_booking_settings set time_zone = 'UTC', max_active_future_per_phone = 5,
  max_phone_bookings_per_24h = 5, max_daily_submissions = 40;
insert into public.services (id, name, duration, price) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'Synthetic concurrency 60 minutes', 60, 1),
  ('eeeeeeee-0000-4000-8000-000000000002', 'Synthetic concurrency 30 minutes', 30, 1);
commit;
\endif

\if :a
-- First round: an identical retry races an uncommitted matching booking.
begin;
select * from public.create_booking(
  'eeeeeeee-0000-4000-8000-000000000011', 'eeeeeeee-0000-4000-8000-000000000001',
  (select slot_time from private.booking_concurrency_fixture), 'Synthetic Concurrent Guest', '1234567');
\echo 'Start session B now; holding the matching-ID transaction for 15 seconds.'
select pg_sleep(15);
commit;

-- Wait for B to acquire its synchronization lock, then let it hold that lock
-- through its assertions. The lock is a test handshake, not booking protection.
select pg_sleep(1);
select pg_advisory_lock(8675309, 2);
begin;
select * from public.create_booking(
  'eeeeeeee-0000-4000-8000-000000000012', 'eeeeeeee-0000-4000-8000-000000000001',
  (select slot_time + interval '2 hours' from private.booking_concurrency_fixture), 'Synthetic Overlap Winner', '1234567');
select pg_advisory_unlock(8675309, 2);
\echo 'Holding the cross-service overlap transaction for 15 seconds.'
select pg_sleep(15);
commit;
\endif

\if :b
-- This session lock tells A that B has started the first round.
select pg_advisory_lock(8675309, 2);
do $$
declare
  v_start timestamptz;
  v_before timestamptz := clock_timestamp();
  v_receipt record;
begin
  select slot_time into strict v_start from private.booking_concurrency_fixture;
  select * into strict v_receipt from public.create_booking(
    'eeeeeeee-0000-4000-8000-000000000011', 'eeeeeeee-0000-4000-8000-000000000001',
    v_start, 'Synthetic Concurrent Guest', '1234567');
  if clock_timestamp() - v_before < interval '1 second' then
    raise exception 'Retry did not wait: rerun setup and start session B earlier';
  end if;
  if v_receipt.id <> 'eeeeeeee-0000-4000-8000-000000000011'::uuid
     or v_receipt.end_time <> v_start + interval '1 hour' or v_receipt.status <> 'confirmed'
     or (select count(*) from public.bookings where id = v_receipt.id) <> 1 then
    raise exception 'Concurrent identical retry did not return exactly the saved receipt';
  end if;
  begin
    perform public.create_booking(
      'eeeeeeee-0000-4000-8000-000000000011', 'eeeeeeee-0000-4000-8000-000000000001',
      v_start, 'Mismatched Guest', '1234567');
    raise exception 'Mismatched retry was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'REQUEST_MISMATCH' then raise; end if;
  end;
end;
$$;
select pg_advisory_unlock(8675309, 2);
-- Give A time to acquire its lock and insert the second uncommitted booking.
select pg_sleep(3);
do $$
declare
  v_start timestamptz;
  v_before timestamptz := clock_timestamp();
begin
  select slot_time + interval '2 hours 30 minutes' into strict v_start from private.booking_concurrency_fixture;
  begin
    perform public.create_booking(
      'eeeeeeee-0000-4000-8000-000000000013', 'eeeeeeee-0000-4000-8000-000000000002',
      v_start, 'Synthetic Overlap Loser', '1234567');
    raise exception 'Concurrent cross-service overlap was accepted';
  exception when exclusion_violation then
    if sqlerrm <> 'SLOT_UNAVAILABLE' then raise; end if;
  end;
  if clock_timestamp() - v_before < interval '1 second' then
    raise exception 'Overlap did not wait: test did not exercise the concurrent insert';
  end if;
  if exists (select 1 from public.bookings where id = 'eeeeeeee-0000-4000-8000-000000000013') then
    raise exception 'Losing concurrent booking was stored';
  end if;
  raise notice 'Concurrent retry and overlapping-service reservation checks passed.';
end;
$$;
\endif

\if :cleanup
begin;
delete from private.booking_quota_events where booking_id in (
  'eeeeeeee-0000-4000-8000-000000000011', 'eeeeeeee-0000-4000-8000-000000000012',
  'eeeeeeee-0000-4000-8000-000000000013'
);
delete from public.bookings where id in (
  'eeeeeeee-0000-4000-8000-000000000011', 'eeeeeeee-0000-4000-8000-000000000012',
  'eeeeeeee-0000-4000-8000-000000000013'
);
delete from public.services where id in (
  'eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000002'
);
update private.salon_booking_settings
set time_zone = fixture.original_time_zone,
    max_active_future_per_phone = (fixture.original_limits ->> 'max_active_future_per_phone')::integer,
    max_phone_bookings_per_24h = (fixture.original_limits ->> 'max_phone_bookings_per_24h')::integer,
    max_daily_submissions = (fixture.original_limits ->> 'max_daily_submissions')::integer
from private.booking_concurrency_fixture as fixture;
drop table private.booking_concurrency_fixture;
commit;
\endif

\if :quota_setup
\if :{?quota_kind}
\else
  \echo 'Supply -v quota_kind=global|active|window with quota_setup.'
  \quit 1
\endif
begin;
create table private.booking_quota_concurrency_fixture (
  original_settings jsonb not null,
  slot_time timestamptz not null,
  quota_kind text not null check (quota_kind in ('global','active','window'))
);
revoke all on private.booking_quota_concurrency_fixture from public, anon, authenticated;
do $$
begin
  if exists (select 1 from public.bookings) or exists (select 1 from private.booking_quota_events) then
    raise exception 'Quota races require an empty disposable calendar and ledger; no data was removed';
  end if;
end;
$$;
insert into private.booking_quota_concurrency_fixture
select to_jsonb(settings), ((clock_timestamp() at time zone 'UTC')::date + 21 + time '10:00') at time zone 'UTC', :'quota_kind'
from private.salon_booking_settings as settings where singleton;
update private.salon_booking_settings set time_zone = 'UTC',
  max_active_future_per_phone = case when :'quota_kind' = 'active' then 1 else 5 end,
  max_phone_bookings_per_24h = case when :'quota_kind' = 'window' then 1 else 5 end,
  max_daily_submissions = case when :'quota_kind' = 'global' then 1 else 40 end;
insert into public.services (id,name,duration,price)
values ('eeeeeeee-0000-4000-8000-000000000003','Synthetic quota race service',30,1);
commit;
\endif

\if :quota_a
begin;
select slot_time::text as quota_slot from private.booking_quota_concurrency_fixture \gset
set local role anon;
select * from public.create_booking('eeeeeeee-0000-4000-8000-000000000021',
  'eeeeeeee-0000-4000-8000-000000000003', :'quota_slot'::timestamptz, 'Quota Winner', '+1 (202) 555-0100');
\echo 'Start quota_b NOW. Holding the final available quota for 15 seconds.'
select pg_sleep(15);
commit;
\endif

\if :quota_b
do $$
declare
  v_fixture private.booking_quota_concurrency_fixture%rowtype;
  v_before timestamptz;
  v_expected text;
  v_phone text;
  v_receipt record;
begin
  select * into strict v_fixture from private.booking_quota_concurrency_fixture;
  v_expected := case v_fixture.quota_kind when 'global' then 'GLOBAL_SUBMISSION_LIMIT'
    when 'active' then 'PHONE_ACTIVE_LIMIT' else 'PHONE_WINDOW_LIMIT' end;
  -- Global race uses a different phone; phone races use equivalent digits in
  -- different formatting. Slots are nonoverlapping in every case.
  v_phone := case when v_fixture.quota_kind = 'global' then '12025550101' else '12025550100' end;
  v_before := clock_timestamp();
  set local role authenticated;
  begin
    perform public.create_booking('eeeeeeee-0000-4000-8000-000000000022',
      'eeeeeeee-0000-4000-8000-000000000003',v_fixture.slot_time + interval '1 hour','Quota Loser',v_phone);
    raise exception 'Quota race accepted both requests';
  exception when sqlstate 'PT429' then
    if sqlerrm <> v_expected then raise; end if;
  end;
  if clock_timestamp() - v_before < interval '1 second' then
    raise exception 'Quota request did not wait: rerun setup and start quota_b earlier';
  end if;
  select * into strict v_receipt from public.create_booking('eeeeeeee-0000-4000-8000-000000000021',
    'eeeeeeee-0000-4000-8000-000000000003',v_fixture.slot_time,'Quota Winner','+1 (202) 555-0100');
  reset role;
  if v_receipt.status <> 'confirmed'
     or (select count(*) from public.bookings) <> 1
     or (select count(*) from private.booking_quota_events) <> 1 then
    raise exception 'Race must leave one saved booking/event and an intact matching receipt';
  end if;
  raise notice 'Concurrent % quota boundary passed', v_fixture.quota_kind;
end;
$$;
\endif

\if :quota_cleanup
begin;
delete from private.booking_quota_events where booking_id in (
  'eeeeeeee-0000-4000-8000-000000000021','eeeeeeee-0000-4000-8000-000000000022');
delete from public.bookings where id in (
  'eeeeeeee-0000-4000-8000-000000000021','eeeeeeee-0000-4000-8000-000000000022');
delete from public.services where id = 'eeeeeeee-0000-4000-8000-000000000003';
update private.salon_booking_settings
set time_zone = fixture.original_settings ->> 'time_zone',
    max_active_future_per_phone = (fixture.original_settings ->> 'max_active_future_per_phone')::integer,
    max_phone_bookings_per_24h = (fixture.original_settings ->> 'max_phone_bookings_per_24h')::integer,
    max_daily_submissions = (fixture.original_settings ->> 'max_daily_submissions')::integer
from private.booking_quota_concurrency_fixture as fixture;
drop table private.booking_quota_concurrency_fixture;
commit;
\endif
