-- Run as postgres after ALL six migrations on a DISPOSABLE development DB.
-- psql "$TESTDB" -v ON_ERROR_STOP=1 -f supabase/tests/public_booking_rls.sql
-- TRUNCATE takes exclusive locks; never run on a live salon calendar.
-- All synthetic rows/accounts/configuration are rolled back.
begin;
set local timezone = 'Pacific/Honolulu';
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';
truncate table public.bookings, public.services, private.booking_quota_events;

create function pg_temp.rls_assert(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'Public booking RLS assertion failed: %', p_label;
  end if;
end;
$$;

create function pg_temp.rls_expect_error(p_sql text, p_state text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state then
      raise exception 'Unexpected state %, expected %', sqlstate, p_state;
    end if;
    return;
  end;
  raise exception 'Expected state % was not raised', p_state;
end;
$$;

do $$
declare
  v_service uuid := gen_random_uuid();
  v_second_service uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_rpc_id uuid := gen_random_uuid();
  v_pending_id uuid := gen_random_uuid();
  v_day date := (clock_timestamp() at time zone 'UTC')::date + 7;
  v_role text;
  v_column text;
  v_marker text;
  v_slot timestamptz;
  v_bad_slot timestamptz;
  v_contact text;
  v_index integer := 0;
  v_count integer;
  v_saved public.bookings%rowtype;
  v_receipt record;
  v_retry record;
begin
  update private.salon_booking_settings set time_zone = 'UTC',
    max_active_future_per_phone = 5, max_phone_bookings_per_24h = 5,
    max_daily_submissions = 40;
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'authenticated', 'authenticated', v_admin::text || '@rls-admin.invalid', '{}', '{}'),
    (v_user, 'authenticated', 'authenticated', v_user::text || '@rls-customer.invalid', '{}', '{"role":"admin"}');
  insert into private.salon_admins (user_id) values (v_admin);
  insert into public.services (id, name, duration, price) values
    (v_service, 'Synthetic public booking 60 minutes', 60, 65),
    (v_second_service, 'Synthetic public booking 30 minutes', 30, 35);

  perform pg_temp.rls_assert((select relrowsecurity from pg_class where oid = 'public.bookings'::regclass), 'booking RLS is enabled');
  perform pg_temp.rls_assert((select count(*) = 1 from pg_policy where polrelid = 'public.bookings'::regclass and polcmd = 'r'), 'only one booking read policy');
  perform pg_temp.rls_assert(not exists (select 1 from pg_policy where polrelid = 'public.bookings'::regclass and polcmd in ('a', '*')), 'no public booking INSERT policy');

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_column in array array['id', 'customer_name', 'phone', 'service_id', 'slot_time', 'end_time', 'status'] loop
      perform pg_temp.rls_assert(not has_column_privilege(v_role, 'public.bookings', v_column, 'INSERT'), 'every booking column INSERT is denied');
    end loop;
    perform pg_temp.rls_assert(not has_table_privilege(v_role, 'public.bookings', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'no direct mutation privileges');
    perform pg_temp.rls_assert(not has_any_column_privilege(v_role, 'public.bookings', 'INSERT,UPDATE,REFERENCES'), 'no column-level write grants survive');
    perform pg_temp.rls_assert(has_function_privilege(v_role, 'public.create_booking(uuid,uuid,timestamptz,text,text)', 'EXECUTE'), 'guest RPC remains executable');
    perform pg_temp.rls_assert(not has_function_privilege(v_role, 'private.validate_public_booking_insert()', 'EXECUTE'), 'validation remains trigger-only');

    if v_role = 'authenticated' then
      perform set_config('request.jwt.claim.sub', v_user::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', v_role, 'user_metadata', jsonb_build_object('role', 'admin'))::text, true);
    else
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{}', true);
    end if;
    v_marker := 'Public RLS fixture ' || v_user::text || ' ' || v_role;
    v_slot := (v_day + time '10:00' + v_index * interval '1 hour') at time zone 'UTC';
    v_rpc_id := gen_random_uuid();
    execute format('set local role %I', v_role);

    perform pg_temp.rls_assert((select count(*) = 2 from public.services), 'public service reads work');
    -- Even valid customer-only INSERTs, without RETURNING, must now be denied.
    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Direct denied'',''1234567'',%L,%L)', v_service, v_slot), '42501');
    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Read bypass'',''1234567'',%L,%L) returning *', v_service, v_slot), '42501');
    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time,status) values (''Status bypass'',''1234567'',%L,%L,''cancelled'')', v_service, v_slot), '42501');
    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time,end_time) values (''Duration bypass'',''1234567'',%L,%L,%L)', v_service, v_slot, v_slot + interval '1 minute'), '42501');
    perform pg_temp.rls_expect_error(format('insert into public.bookings (id,customer_name,phone,service_id,slot_time) values (%L,''ID bypass'',''1234567'',%L,%L)', v_rpc_id, v_service, v_slot), '42501');

    -- Keep compatibility checks: both roles save confirmed receipts via RPC,
    -- with the old trimming, exact retry, availability and validation contract.
    select * into strict v_receipt from public.create_booking(v_rpc_id, v_service, v_slot,
      '  ' || v_marker || '  ', '  +1 (202) 555-0100  ');
    select * into strict v_retry from public.create_booking(v_rpc_id, v_service, v_slot, v_marker, '+1 (202) 555-0100');
    perform pg_temp.rls_assert(v_receipt = v_retry and v_receipt.id = v_rpc_id
      and v_receipt.status = 'confirmed', 'both API roles retain idempotent confirmed receipts');
    perform pg_temp.rls_expect_error(format('select * from public.create_booking(%L,%L,%L,''Wrong Guest'',''1234567'')', v_rpc_id, v_service, v_slot), '22023');
    perform pg_temp.rls_expect_error(format('select * from public.create_booking(%L,%L,%L,''Duplicate time'',''1234567'')', gen_random_uuid(), v_second_service, v_slot), '23P01');
    perform pg_temp.rls_expect_error(format('select * from public.create_booking(%L,%L,%L,''Overlapping time'',''1234567'')', gen_random_uuid(), v_second_service, v_slot + interval '30 minutes'), '23P01');
    perform pg_temp.rls_assert(not exists (select 1 from public.get_available_slots(v_second_service, v_day) where slot_time in (v_slot, v_slot + interval '30 minutes')), 'RPC reservations block full duration');

    if v_role = 'anon' then
      perform pg_temp.rls_expect_error('select * from public.bookings', '42501');
      perform pg_temp.rls_expect_error('update public.services set price = 0', '42501');
      perform pg_temp.rls_expect_error('delete from public.services', '42501');
    else
      perform pg_temp.rls_assert(not public.is_admin(), 'editable metadata is not admin authorization');
      perform pg_temp.rls_assert((select count(*) = 0 from public.bookings), 'ordinary users cannot read customer rows');
      update public.services set price = 0;
      get diagnostics v_count = row_count;
      perform pg_temp.rls_assert(v_count = 0, 'non-admin service edits are filtered');
      delete from public.services;
      get diagnostics v_count = row_count;
      perform pg_temp.rls_assert(v_count = 0, 'non-admin service deletes are filtered');
    end if;
    perform pg_temp.rls_expect_error('insert into public.services (name,duration,price) values (''Forbidden'',30,1)', '42501');
    perform pg_temp.rls_expect_error('update public.bookings set status = ''cancelled''', '42501');
    perform pg_temp.rls_expect_error('delete from public.bookings', '42501');
    perform pg_temp.rls_expect_error('select * from private.salon_admins', '42501');
    perform pg_temp.rls_expect_error('select * from private.salon_booking_settings', '42501');
    perform pg_temp.rls_expect_error('select * from private.booking_quota_events', '42501');

    foreach v_bad_slot in array array[
      (v_day + time '09:30') at time zone 'UTC', (v_day + time '20:00') at time zone 'UTC',
      (v_day + time '10:15') at time zone 'UTC', (v_day + time '10:00:01') at time zone 'UTC',
      (v_day + time '19:30') at time zone 'UTC',
      ((clock_timestamp() at time zone 'UTC')::date + 91 + time '10:00') at time zone 'UTC',
      'infinity'::timestamptz
    ] loop
      perform pg_temp.rls_expect_error(format('select * from public.create_booking(%L,%L,%L,''Invalid schedule'',''1234567'')', gen_random_uuid(), v_service, v_bad_slot), '22023');
    end loop;
    perform pg_temp.rls_expect_error(format('select * from public.create_booking(%L,%L,%L,''Past schedule'',''1234567'')', gen_random_uuid(), v_service, clock_timestamp() - interval '1 day'), '23P01');
    foreach v_contact in array array['', ' ', 'A', repeat('n',101), E'Name\nBreak'] loop
      perform pg_temp.rls_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,''1234567'')', gen_random_uuid(), v_service, (v_day + time '16:00') at time zone 'UTC', v_contact), '22023');
    end loop;
    foreach v_contact in array array['', '123', '1234567890123456', 'not-a-phone', E'123\n4567'] loop
      perform pg_temp.rls_expect_error(format('select * from public.create_booking(%L,%L,%L,''Invalid phone'',%L)', gen_random_uuid(), v_service, (v_day + time '16:00') at time zone 'UTC', v_contact), '22023');
    end loop;

    reset role;
    select * into strict v_saved from public.bookings where id = v_rpc_id;
    perform pg_temp.rls_assert(v_saved.customer_name = v_marker and v_saved.phone = '+1 (202) 555-0100'
      and v_saved.slot_time = v_slot and v_saved.end_time = v_slot + interval '1 hour'
      and v_saved.status = 'confirmed', 'RPC fields and duration persist unchanged');
    perform pg_temp.rls_assert((select count(*) = 1 from private.booking_quota_events where booking_id = v_rpc_id), 'retries count once');
    v_index := v_index + 1;
  end loop;

  -- Pending historical/owner-maintained bookings still support admin actions.
  insert into public.bookings (id, service_id, slot_time, customer_name, phone)
  values (v_pending_id, v_second_service, (v_day + time '14:00') at time zone 'UTC', 'Existing pending fixture', '1234567');
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'role','authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.rls_assert(public.is_admin() and (select count(*) = 3 from public.bookings), 'only allowlisted admins read customer rows');
  perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Admin direct denied'',''1234567'',%L,%L)', v_service, (v_day + time '16:00') at time zone 'UTC'), '42501');
  update public.services set price = 70 where id = v_service;
  get diagnostics v_count = row_count;
  perform pg_temp.rls_assert(v_count = 1, 'allowlisted admin retains service editing');
  perform pg_temp.rls_assert((select count(*) = 3 from public.list_admin_bookings('upcoming')), 'existing pending and RPC bookings remain visible');
  perform public.admin_set_booking_status(v_pending_id, 'confirmed');
  perform pg_temp.rls_assert((select status = 'confirmed' from public.bookings where id = v_pending_id), 'admin can confirm existing pending rows');
  perform public.admin_set_booking_status(v_pending_id, 'cancelled');
  perform pg_temp.rls_assert(exists (select 1 from public.get_available_slots(v_second_service,v_day) where slot_time = (v_day + time '14:00') at time zone 'UTC'), 'admin cancellation releases reservation');
  reset role;

  update private.salon_booking_settings set time_zone = 'Asia/Kathmandu';
  v_slot := (v_day + 1 + time '10:00') at time zone 'Asia/Kathmandu';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select * into strict v_receipt from public.create_booking(gen_random_uuid(), v_service, v_slot, 'Public non-UTC fixture', '1234567');
  perform pg_temp.rls_expect_error(format('select * from public.create_booking(%L,%L,%L,''Local closing bypass'',''1234567'')', gen_random_uuid(), v_service, (v_day + 1 + time '19:30') at time zone 'Asia/Kathmandu'), '22023');
  reset role;
  perform pg_temp.rls_assert(exists (select 1 from public.bookings where id = v_receipt.id
    and slot_time = v_slot and end_time = v_slot + interval '1 hour' and status = 'confirmed'), 'RPC follows salon-local wall time');
  raise notice 'Public INSERT denial/RPC compatibility checks passed; fixtures will be rolled back.';
end;
$$;
rollback;
