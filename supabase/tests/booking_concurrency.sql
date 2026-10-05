-- Manual two-connection regression, requiring psql and a DISPOSABLE migrated DB.
-- Unlike booking.sql, the setup and winning reservations COMMIT. Run cleanup last.
-- Do not run alongside other tests or on a real salon calendar.
--
-- 1. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v phase=setup -f supabase/tests/booking_concurrency.sql
-- 2. Start session A, then start session B during A's first 15-second pause:
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v phase=a -f supabase/tests/booking_concurrency.sql
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v phase=b -f supabase/tests/booking_concurrency.sql
-- 3. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v phase=cleanup -f supabase/tests/booking_concurrency.sql
--
-- Session B must actually wait in BOTH calls. It checks lock-wait durations so
-- starting it too late fails instead of falsely claiming concurrency coverage.
-- The second round uses a different service AND a different overlapping start.

\if :{?phase}
\else
  \echo 'Supply -v phase=setup|a|b|cleanup; see file header.'
  \quit 1
\endif
select :'phase' = 'setup' as setup, :'phase' = 'a' as a,
       :'phase' = 'b' as b, :'phase' = 'cleanup' as cleanup
\gset

\if :setup
begin;
create table private.booking_concurrency_fixture (
  original_time_zone text not null,
  slot_time timestamptz not null
);
revoke all on private.booking_concurrency_fixture from public, anon, authenticated;
insert into private.booking_concurrency_fixture
select time_zone, (((clock_timestamp() at time zone 'UTC')::date + 21) + time '10:00') at time zone 'UTC'
from private.salon_booking_settings where singleton;
update private.salon_booking_settings set time_zone = 'UTC';
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
delete from public.bookings where id in (
  'eeeeeeee-0000-4000-8000-000000000011', 'eeeeeeee-0000-4000-8000-000000000012',
  'eeeeeeee-0000-4000-8000-000000000013'
);
delete from public.services where id in (
  'eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000002'
);
update private.salon_booking_settings
set time_zone = (select original_time_zone from private.booking_concurrency_fixture);
drop table private.booking_concurrency_fixture;
commit;
\endif
