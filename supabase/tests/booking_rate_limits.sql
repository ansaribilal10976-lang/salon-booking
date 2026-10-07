-- UNEXECUTED runtime regressions. ALL six migrations, disposable LOCAL DB only.
-- psql "$TESTDB" -v ON_ERROR_STOP=1 -f supabase/tests/booking_rate_limits.sql
-- Replaces calendar/ledger/configuration inside a rolled-back transaction.
-- Do not run on production. Two-session races are in booking_concurrency.sql.
begin;
set local timezone = 'Pacific/Honolulu';
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';
truncate table public.bookings, public.services, private.booking_quota_events;

create function pg_temp.quota_assert(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'Booking quota assertion failed: %', p_label;
  end if;
end;
$$;
create function pg_temp.quota_expect(p_sql text, p_state text, p_message text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state or (p_message is not null and sqlerrm <> p_message) then
      raise exception 'Unexpected state/message % / %, expected % / %', sqlstate, sqlerrm, p_state, p_message;
    end if;
    return;
  end;
  raise exception 'Expected % / % was not raised', p_state, p_message;
end;
$$;

do $$
declare
  v_service uuid := gen_random_uuid();
  v_id uuid;
  v_first_id uuid;
  v_role text;
  v_setting text;
  v_i integer;
  v_day date := (clock_timestamp() at time zone 'UTC')::date + 7;
  v_slot timestamptz;
  v_phone text;
  v_first_slot timestamptz;
  v_first_phone text;
  v_receipt record;
  v_start_of_today timestamptz;
begin
  insert into public.services (id,name,duration,price) values (v_service,'Synthetic quota service',30,10);
  perform pg_temp.quota_assert((select relrowsecurity from pg_class where oid = 'private.booking_quota_events'::regclass), 'quota ledger has RLS');
  foreach v_role in array array['anon', 'authenticated'] loop
    perform pg_temp.quota_assert(not has_table_privilege(v_role, 'private.booking_quota_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and not has_any_column_privilege(v_role, 'private.booking_quota_events', 'SELECT,INSERT,UPDATE,REFERENCES'), 'ledger is private');
    perform pg_temp.quota_assert(not has_any_column_privilege(v_role, 'public.bookings', 'INSERT'), 'direct INSERT cannot bypass quotas');
    update private.salon_booking_settings set time_zone = 'UTC', max_active_future_per_phone = 5,
      max_phone_bookings_per_24h = 5, max_daily_submissions = 40;
    truncate public.bookings, private.booking_quota_events;

    -- Quota identity uses the last ten digits, so country prefixes, leading
    -- digits, and formatting cannot create separate active-phone budgets.
    update private.salon_booking_settings set max_active_future_per_phone = 4;
    execute format('set local role %I', v_role);
    v_i := 0;
    foreach v_phone in array array['+919876543210', '09876543210', '98765 43210', '0009876543210'] loop
      perform public.create_booking(gen_random_uuid(), v_service,
        (v_day + time '10:00' + v_i * interval '30 minutes') at time zone 'UTC',
        'Shared phone fixture', v_phone);
      v_i := v_i + 1;
    end loop;
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Shared phone fifth'',''9876543210'')',
      gen_random_uuid(), v_service, (v_day + time '12:00') at time zone 'UTC'), 'PT429', 'PHONE_ACTIVE_LIMIT');
    perform public.create_booking(gen_random_uuid(), v_service,
      (v_day + time '12:00') at time zone 'UTC', 'Different phone fixture', '9876543211');
    reset role;
    perform pg_temp.quota_assert((select count(*) = 4 from private.booking_quota_events where phone_key = '9876543210'),
      'country prefixes, leading digits, and formatting share one last-ten-digit quota key');
    perform pg_temp.quota_assert((select count(*) = 1 from private.booking_quota_events where phone_key = '9876543211'),
      'a different last-ten-digit phone has a separate quota key');
    update private.salon_booking_settings set max_active_future_per_phone = 5;
    truncate public.bookings, private.booking_quota_events;

    -- Four pre-migration rows count despite having no ledger events. A cancelled
    -- future row and an elapsed confirmed row must not consume active capacity.
    for v_i in 0..3 loop
      insert into public.bookings (service_id,slot_time,customer_name,phone,status)
      values (v_service,(v_day + time '10:00' + v_i * interval '30 minutes') at time zone 'UTC',
        'Existing quota fixture','+1 (202) 555-0100',case when v_i % 2 = 0 then 'pending'::public.booking_status else 'confirmed'::public.booking_status end);
    end loop;
    insert into public.bookings (service_id,slot_time,customer_name,phone,status) values
      (v_service,(v_day + time '15:00') at time zone 'UTC','Cancelled fixture','12025550100','cancelled'),
      (v_service,(v_day - 20 + time '10:00') at time zone 'UTC','Elapsed fixture','12025550100','confirmed');
    v_id := gen_random_uuid();
    v_slot := (v_day + time '12:00') at time zone 'UTC';
    execute format('set local role %I', v_role);
    select * into strict v_receipt from public.create_booking(v_id,v_service,v_slot,'Fifth Guest','+1 202.555.0100');
    perform pg_temp.quota_assert(v_receipt.phone = '+1 202.555.0100' and v_receipt.status = 'confirmed', 'fifth active booking saves and preserves display phone');
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Sixth Guest'',''12025550100'')', gen_random_uuid(),v_service,v_slot + interval '30 minutes'), 'PT429','PHONE_ACTIVE_LIMIT');
    reset role;
    perform pg_temp.quota_assert((select count(*) = 1 from private.booking_quota_events), 'old rows have no fabricated creation events; failed write adds none');
    -- Exhaust submission quotas too; exact retries still precede every quota.
    update private.salon_booking_settings set max_daily_submissions = 1, max_phone_bookings_per_24h = 1;
    execute format('set local role %I', v_role);
    select * into strict v_receipt from public.create_booking(v_id,v_service,v_slot,'Fifth Guest','+1 202.555.0100');
    perform pg_temp.quota_assert(v_receipt.id = v_id, 'exact retry succeeds at exhausted active/window/global quotas');
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Wrong Details'',''+1 202.555.0100'')',v_id,v_service,v_slot),'22023','REQUEST_MISMATCH');
    reset role;
    update public.bookings set status = 'cancelled' where id = v_id;
    execute format('set local role %I', v_role);
    select * into strict v_receipt from public.create_booking(v_id,v_service,v_slot,'Fifth Guest','+1 202.555.0100');
    perform pg_temp.quota_assert(v_receipt.status = 'cancelled', 'retry neither resurrects cancelled booking nor adds an event');
    reset role;
    update private.salon_booking_settings set max_daily_submissions = 40, max_phone_bookings_per_24h = 5;
    execute format('set local role %I', v_role);
    perform public.create_booking(gen_random_uuid(),v_service,v_slot,'Replacement Guest','12025550100');
    reset role;
    perform pg_temp.quota_assert((select count(*) = 2 from private.booking_quota_events), 'cancellation releases active capacity but retains original event');

    -- Five saves, cancelled after each, still exhaust the rolling phone window.
    truncate public.bookings, private.booking_quota_events;
    for v_i in 0..4 loop
      v_id := gen_random_uuid();
      execute format('set local role %I', v_role);
      perform public.create_booking(v_id,v_service,v_slot,'Window Guest','+1 (202) 555-0100');
      reset role;
      update public.bookings set status = 'cancelled' where id = v_id;
    end loop;
    execute format('set local role %I', v_role);
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Window Sixth'',''12025550100'')',gen_random_uuid(),v_service,v_slot),'PT429','PHONE_WINDOW_LIMIT');
    reset role;
    perform pg_temp.quota_assert((select count(*) = 5 from private.booking_quota_events), 'cancellation and rejected saves do not change five submissions');
    update private.booking_quota_events set created_at = clock_timestamp() - interval '24 hours 1 second'
      where booking_id = v_id;
    execute format('set local role %I', v_role);
    perform public.create_booking(gen_random_uuid(),v_service,v_slot,'Window After Expiry','12025550100');
    reset role;
    perform pg_temp.quota_assert((select count(*) = 5 from private.booking_quota_events), 'expired event no longer counts and is pruned on success');

    -- Global 40/day is across phones and appointment dates, not just today's
    -- scheduled slots. Real RPC saves cover the exact default boundary.
    truncate public.bookings, private.booking_quota_events;
    for v_i in 0..39 loop
      v_id := gen_random_uuid();
      v_phone := '7000000' || lpad(v_i::text,3,'0');
      v_slot := (v_day + v_i / 20 + time '10:00' + (v_i % 20) * interval '30 minutes') at time zone 'UTC';
      if v_i = 0 then
        v_first_id := v_id; v_first_slot := v_slot; v_first_phone := v_phone;
      end if;
      execute format('set local role %I', v_role);
      perform public.create_booking(v_id,v_service,v_slot,'Global Guest',v_phone);
      reset role;
    end loop;
    perform pg_temp.quota_assert((select count(*) = 40 from private.booking_quota_events), '40 daily submissions permitted');
    perform pg_temp.quota_assert((select count(*) = 20 from public.bookings
      where (slot_time at time zone 'UTC')::date = v_day), 'all 20 shared-calendar starts save without a separate appointment-date quota');
    execute format('set local role %I', v_role);
    perform pg_temp.quota_assert(not exists (select 1 from public.get_available_slots(v_service,v_day)), 'full calendar has no remaining starts');
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Calendar Conflict'',''7999999999'')',gen_random_uuid(),v_service,v_first_slot),'23P01','SLOT_UNAVAILABLE');
    reset role;
    v_slot := (v_day + 2 + time '10:00') at time zone 'UTC';
    execute format('set local role %I', v_role);
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Global 41'',''7999999999'')',gen_random_uuid(),v_service,v_slot),'PT429','GLOBAL_SUBMISSION_LIMIT');
    reset role;
    update public.bookings set status = 'cancelled' where id = v_first_id;
    execute format('set local role %I', v_role);
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Global Still Full'',''7999999999'')',gen_random_uuid(),v_service,v_slot),'PT429','GLOBAL_SUBMISSION_LIMIT');
    select * into strict v_receipt from public.create_booking(v_first_id,v_service,v_first_slot,'Global Guest',v_first_phone);
    perform pg_temp.quota_assert(v_receipt.status = 'cancelled', 'global exhaustion does not block cancelled receipt retry');
    reset role;
    update private.salon_booking_settings set max_daily_submissions = 41;
    execute format('set local role %I', v_role);
    perform public.create_booking(gen_random_uuid(),v_service,v_slot,'Owner Raised Cap','7999999999');
    reset role;
    perform pg_temp.quota_assert((select count(*) = 41 from private.booking_quota_events), 'owner SQL cap increase restores submission capacity');

    -- Submission expiry follows salon midnight, not the session timezone. Old
    -- day events remain available to the rolling phone window if still recent.
    truncate public.bookings, private.booking_quota_events;
    update private.salon_booking_settings set time_zone = 'Asia/Kathmandu', max_daily_submissions = 1;
    v_start_of_today := (clock_timestamp() at time zone 'Asia/Kathmandu')::date::timestamp at time zone 'Asia/Kathmandu';
    insert into private.booking_quota_events (booking_id,phone_key,created_at)
    values (gen_random_uuid(),'7777777',v_start_of_today - interval '1 second');
    v_id := gen_random_uuid();
    v_slot := (v_day + time '10:00') at time zone 'Asia/Kathmandu';
    execute format('set local role %I', v_role);
    perform public.create_booking(v_id,v_service,v_slot,'New Salon Day','1234567');
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Current Day Full'',''1234568'')',gen_random_uuid(),v_service,v_slot + interval '30 minutes'),'PT429','GLOBAL_SUBMISSION_LIMIT');
    reset role;
    update private.booking_quota_events set created_at = v_start_of_today - interval '1 second' where booking_id = v_id;
    execute format('set local role %I', v_role);
    perform public.create_booking(gen_random_uuid(),v_service,v_slot + interval '30 minutes','Midnight Capacity','1234568');
    reset role;

    -- One owner UPDATE changes all three limits, without replacing the RPC or
    -- applying another migration. Nondefault values must govern actual saves.
    truncate public.bookings, private.booking_quota_events;
    update private.salon_booking_settings set time_zone = 'UTC',
      max_active_future_per_phone = 2, max_phone_bookings_per_24h = 3, max_daily_submissions = 4;
    v_slot := (v_day + time '10:00') at time zone 'UTC';
    v_first_id := gen_random_uuid();
    execute format('set local role %I', v_role);
    foreach v_setting in array array['max_active_future_per_phone','max_phone_bookings_per_24h','max_daily_submissions'] loop
      perform pg_temp.quota_expect(format('update private.salon_booking_settings set %I = 1',v_setting),'42501');
    end loop;
    perform public.create_booking(v_first_id,v_service,v_slot,'Configured First','5550001');
    perform public.create_booking(gen_random_uuid(),v_service,v_slot + interval '30 minutes','Configured Second','5550001');
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Configured Active Full'',''5550001'')',gen_random_uuid(),v_service,v_slot + interval '1 hour'),'PT429','PHONE_ACTIVE_LIMIT');
    reset role;
    update public.bookings set status = 'cancelled' where id = v_first_id;
    v_id := gen_random_uuid();
    execute format('set local role %I', v_role);
    perform public.create_booking(v_id,v_service,v_slot + interval '1 hour','Configured Third','5550001');
    reset role;
    -- Keep only one active row so the rolling-window error is independently
    -- observable; cancellation still leaves all three submission events.
    update public.bookings set status = 'cancelled' where id <> v_id;
    execute format('set local role %I', v_role);
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Configured Window Full'',''5550001'')',gen_random_uuid(),v_service,v_slot + interval '90 minutes'),'PT429','PHONE_WINDOW_LIMIT');
    perform public.create_booking(gen_random_uuid(),v_service,v_slot + interval '90 minutes','Configured Other Phone','5550002');
    perform pg_temp.quota_expect(format('select * from public.create_booking(%L,%L,%L,''Configured Global Full'',''5550003'')',gen_random_uuid(),v_service,v_slot + interval '2 hours'),'PT429','GLOBAL_SUBMISSION_LIMIT');
    reset role;
    update private.salon_booking_settings set max_active_future_per_phone = 3,
      max_phone_bookings_per_24h = 4, max_daily_submissions = 5;
    execute format('set local role %I', v_role);
    perform public.create_booking(gen_random_uuid(),v_service,v_slot + interval '2 hours','Configured Raised Limits','5550001');
    reset role;
    perform pg_temp.quota_assert((select count(*) = 5 from private.booking_quota_events), 'one UPDATE raises the phone/window/global settings for subsequent calls without a migration');
    foreach v_setting in array array['max_active_future_per_phone','max_phone_bookings_per_24h','max_daily_submissions'] loop
      perform pg_temp.quota_expect(format('update private.salon_booking_settings set %I = 0',v_setting),'23514');
      perform pg_temp.quota_expect(format('update private.salon_booking_settings set %I = null',v_setting),'23502');
    end loop;
  end loop;
  raise notice 'Booking quota regressions passed; all fixtures will be rolled back.';
end;
$$;
rollback;
