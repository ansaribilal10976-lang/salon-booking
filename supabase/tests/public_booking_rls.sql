-- Run as postgres after ALL five migrations on a DISPOSABLE development DB.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/public_booking_rls.sql
-- Synthetic fixtures only. TRUNCATE takes exclusive locks; never run on a live
-- salon calendar. The transaction rolls back all rows/accounts/configuration.
begin;
set local timezone = 'Pacific/Honolulu';
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';
truncate table public.bookings, public.services;

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
begin
  update private.salon_booking_settings set time_zone = 'UTC';
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'authenticated', 'authenticated', v_admin::text || '@rls-admin.invalid', '{}', '{}'),
    (v_user, 'authenticated', 'authenticated', v_user::text || '@rls-customer.invalid', '{}', '{"role":"admin"}');
  insert into private.salon_admins (user_id) values (v_admin);
  insert into public.services (id, name, duration, price) values
    (v_service, 'Synthetic public booking 60 minutes', 60, 65),
    (v_second_service, 'Synthetic public booking 30 minutes', 30, 35);

  perform pg_temp.rls_assert((select relrowsecurity from pg_class where oid = 'public.bookings'::regclass), 'booking RLS is enabled');
  perform pg_temp.rls_assert((select count(*) = 1 from pg_policy where polrelid = 'public.bookings'::regclass and polcmd = 'r'), 'only one booking read policy');
  perform pg_temp.rls_assert((select count(*) = 1 and bool_and(polroles @> array['anon'::regrole::oid, 'authenticated'::regrole::oid])
    from pg_policy where polrelid = 'public.bookings'::regclass and polcmd = 'a'), 'public insert policy covers both API roles');

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_column in array array['customer_name', 'phone', 'service_id', 'slot_time'] loop
      perform pg_temp.rls_assert(has_column_privilege(v_role, 'public.bookings', v_column, 'INSERT'), 'customer field insert grant');
    end loop;
    foreach v_column in array array['id', 'end_time', 'status'] loop
      perform pg_temp.rls_assert(not has_column_privilege(v_role, 'public.bookings', v_column, 'INSERT'), 'database-owned field is not client-insertable');
    end loop;
    perform pg_temp.rls_assert(not has_table_privilege(v_role, 'public.bookings', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'no broad insert/mutation privileges');
    perform pg_temp.rls_assert(not has_any_column_privilege(v_role, 'public.bookings', 'UPDATE,REFERENCES'), 'no direct booking updates');
    perform pg_temp.rls_assert(not has_function_privilege(v_role, 'private.validate_public_booking_insert()', 'EXECUTE'), 'validation is trigger-only');

    if v_role = 'authenticated' then
      perform set_config('request.jwt.claim.sub', v_user::text, true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', v_role, 'user_metadata', jsonb_build_object('role', 'admin'))::text, true);
    else
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{}', true);
    end if;
    v_marker := 'Public RLS fixture ' || v_user::text || ' ' || v_role;
    v_slot := (v_day + time '10:00' + v_index * interval '1 hour') at time zone 'UTC';
    execute format('set local role %I', v_role);

    perform pg_temp.rls_assert((select count(*) = 2 from public.services), 'public service reads work');
    -- No RETURNING/SELECT needed: guests may submit but not read booking rows.
    insert into public.bookings (customer_name, phone, service_id, slot_time)
    values ('  ' || v_marker || '  ', '  +1 (202) 555-0100  ', v_service, v_slot);

    if v_role = 'anon' then
      perform pg_temp.rls_expect_error('select * from public.bookings', '42501');
      perform pg_temp.rls_expect_error('update public.services set price = 0', '42501');
      perform pg_temp.rls_expect_error('delete from public.services', '42501');
    else
      perform pg_temp.rls_assert(not public.is_admin(), 'editable metadata is not admin authorization');
      perform pg_temp.rls_assert((select count(*) = 0 from public.bookings), 'ordinary signed-in users cannot read even their inserted rows');
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

    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time,status) values (''Status bypass'',''1234567'',%L,%L,''cancelled'')', v_service, v_slot), '42501');
    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time,end_time) values (''Duration bypass'',''1234567'',%L,%L,%L)', v_service, v_slot, v_slot + interval '1 minute'), '42501');
    perform pg_temp.rls_expect_error(format('insert into public.bookings (id,customer_name,phone,service_id,slot_time) values (%L,''ID bypass'',''1234567'',%L,%L)', v_rpc_id, v_service, v_slot), '42501');
    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Read bypass'',''1234567'',%L,%L) returning *', v_service, (v_day + time '16:00') at time zone 'UTC'), '42501');

    -- Direct writes cannot bypass the same-slot or full-duration overlap check.
    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Duplicate time'',''1234567'',%L,%L)', v_second_service, v_slot), '23P01');
    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Overlapping time'',''1234567'',%L,%L)', v_second_service, v_slot + interval '30 minutes'), '23P01');
    perform pg_temp.rls_assert(not exists (select 1 from public.get_available_slots(v_second_service, v_day) where slot_time in (v_slot, v_slot + interval '30 minutes')), 'pending direct requests block availability');

    foreach v_bad_slot in array array[
      (v_day + time '09:30') at time zone 'UTC',
      (v_day + time '20:00') at time zone 'UTC',
      (v_day + time '10:15') at time zone 'UTC',
      (v_day + time '10:00:01') at time zone 'UTC',
      (v_day + time '19:30') at time zone 'UTC',
      ((clock_timestamp() at time zone 'UTC')::date + 91 + time '10:00') at time zone 'UTC',
      'infinity'::timestamptz
    ] loop
      perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Invalid schedule'',''1234567'',%L,%L)', v_service, v_bad_slot), '22023');
    end loop;
    perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Past schedule'',''1234567'',%L,%L)', v_service, clock_timestamp() - interval '1 day'), '23P01');
    foreach v_contact in array array['', ' ', 'A', repeat('n',101), E'Name\nBreak'] loop
      perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (%L,''1234567'',%L,%L)', v_contact, v_service, (v_day + time '16:00') at time zone 'UTC'), '22023');
    end loop;
    foreach v_contact in array array['', '123', '1234567890123456', 'not-a-phone', E'123\n4567'] loop
      perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Invalid phone'',%L,%L,%L)', v_contact, v_service, (v_day + time '16:00') at time zone 'UTC'), '22023');
    end loop;

    reset role;
    select * into strict v_saved from public.bookings where customer_name = v_marker;
    perform pg_temp.rls_assert(v_saved.phone = '+1 (202) 555-0100'
      and v_saved.slot_time = v_slot and v_saved.end_time = v_slot + interval '1 hour'
      and v_saved.status = 'pending' and v_saved.id is not null, 'public submission persists normalized fields and derived defaults');
    v_index := v_index + 1;
  end loop;

  -- The existing website RPC still saves confirmed appointments and receipts.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select * into strict v_receipt from public.create_booking(v_rpc_id, v_second_service,
    (v_day + time '15:00') at time zone 'UTC', 'RPC after RLS migration', '1234567');
  perform pg_temp.rls_assert(v_receipt.id = v_rpc_id and v_receipt.status = 'confirmed', 'existing guest confirmation flow remains compatible');
  reset role;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'role','authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.rls_assert(public.is_admin() and (select count(*) = 3 from public.bookings), 'only the allowlisted admin can read persisted submissions');
  update public.services set price = 70 where id = v_service;
  get diagnostics v_count = row_count;
  perform pg_temp.rls_assert(v_count = 1, 'allowlisted admin retains service editing');
  perform pg_temp.rls_assert((select count(*) = 3 from public.list_admin_bookings('upcoming')), 'direct pending submissions appear in the admin dashboard');
  perform public.admin_set_booking_status(v_saved.id, 'confirmed');
  perform pg_temp.rls_assert((select status = 'confirmed' from public.bookings where id = v_saved.id), 'admin can confirm a direct pending submission');
  perform public.admin_set_booking_status(v_saved.id, 'cancelled');
  perform pg_temp.rls_assert(exists (select 1 from public.get_available_slots(v_service,v_day) where slot_time = v_saved.slot_time), 'admin cancellation releases the direct reservation');
  reset role;

  -- Direct inserts use the configured salon zone, not the SQL/session timezone
  -- or the UTC minute component (Kathmandu has a 45-minute offset).
  update private.salon_booking_settings set time_zone = 'Asia/Kathmandu';
  v_slot := (v_day + 1 + time '10:00') at time zone 'Asia/Kathmandu';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  insert into public.bookings (customer_name, phone, service_id, slot_time)
  values ('Public non-UTC fixture', '1234567', v_service, v_slot);
  perform pg_temp.rls_expect_error(format('insert into public.bookings (customer_name,phone,service_id,slot_time) values (''Local closing bypass'',''1234567'',%L,%L)',
    v_service, (v_day + 1 + time '19:30') at time zone 'Asia/Kathmandu'), '22023');
  reset role;
  perform pg_temp.rls_assert(exists (select 1 from public.bookings where customer_name = 'Public non-UTC fixture'
    and slot_time = v_slot and end_time = v_slot + interval '1 hour' and status = 'pending'), 'direct insert follows salon-local wall time');

  raise notice 'Public booking insert/RLS checks passed; all fixtures will be rolled back.';
end;
$$;

rollback;
