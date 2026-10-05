-- Run after ALL migrations as postgres in a DEVELOPMENT database only.
-- With psql: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin.sql
-- Synthetic auth.users/JWT fixtures only; no live logins, passwords, or accounts.
-- Fixtures replace the calendar using exclusive TRUNCATE locks. Always rollback.
begin;
set local timezone = 'Pacific/Honolulu'; -- Deliberately not the salon timezone.
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';
truncate table public.bookings, public.services;

create function pg_temp.admin_assert(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'Admin assertion failed: %', p_label;
  end if;
end;
$$;

create function pg_temp.admin_expect_error(p_sql text, p_state text, p_message text default null)
returns void language plpgsql as $$
declare
  v_detail text;
  v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    if sqlstate <> p_state or (p_message is not null and
      (sqlerrm <> p_message or coalesce(v_detail, '') <> '' or coalesce(v_hint, '') <> '')) then
      raise exception 'Unexpected error: state %, message %; expected % / %', sqlstate, sqlerrm, p_state, p_message;
    end if;
    return;
  end;
  raise exception 'Expected error % was not raised', p_state;
end;
$$;

create function pg_temp.admin_set_actor(p_id uuid, p_role text default 'authenticated', p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_id::text, ''), true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_id, 'role', p_role, 'user_metadata', p_metadata)::text, true);
end;
$$;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_spoof uuid := gen_random_uuid();
  v_deleted_user uuid := gen_random_uuid();
  v_actor uuid;
  v_service uuid := gen_random_uuid();
  v_new_service uuid;
  v_pending uuid := gen_random_uuid();
  v_confirmed uuid := gen_random_uuid();
  v_cancelled uuid := gen_random_uuid();
  v_completed uuid := gen_random_uuid();
  v_pending_cancel uuid := gen_random_uuid();
  v_today_first uuid;
  v_today_last uuid;
  v_upcoming_first uuid;
  v_receipt record;
  v_retry record;
  v_item record;
  v_role text;
  v_function text;
  v_oid oid;
  v_count integer;
  v_name text;
  v_duration integer;
  v_status public.booking_status;
  v_zone text;
  v_today date;
  v_day date := (statement_timestamp() at time zone 'UTC')::date + 7;
  v_today_start timestamptz;
  v_tomorrow_start timestamptz;
  v_previous_time timestamptz;
  v_previous_id uuid;
  v_expected uuid[];
  v_actual uuid[];
  v_year integer;
  v_spring date;
  v_fall date;
  v_spring_start timestamptz;
  v_spring_end timestamptz;
  v_fall_start timestamptz;
  v_fall_end timestamptz;
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'authenticated', 'authenticated', v_admin::text || '@admin-fixture.invalid', '{"provider":"email","providers":["email"]}', '{}'),
    (v_user, 'authenticated', 'authenticated', v_user::text || '@user-fixture.invalid', '{"provider":"email","providers":["email"]}', '{}'),
    (v_spoof, 'authenticated', 'authenticated', v_spoof::text || '@spoof-fixture.invalid', '{"provider":"email","providers":["email"]}', '{"admin":true,"role":"admin"}'),
    (v_deleted_user, 'authenticated', 'authenticated', v_deleted_user::text || '@cascade-fixture.invalid', '{"provider":"email","providers":["email"]}', '{}');
  insert into private.salon_admins (user_id) values (v_admin), (v_deleted_user);
  delete from auth.users where id = v_deleted_user;
  perform pg_temp.admin_assert(not exists (select 1 from private.salon_admins where user_id = v_deleted_user), 'auth deletion cascades membership');
  perform pg_temp.admin_expect_error(format('insert into private.salon_admins values (%L)', gen_random_uuid()), '23503');
  perform pg_temp.admin_expect_error(format('insert into private.salon_admins values (%L)', v_admin), '23505');

  insert into public.services (id, name, duration, price) values (v_service, 'Synthetic admin service', 30, 20);
  insert into public.bookings (id, service_id, customer_name, phone, slot_time, status) values
    (v_pending, v_service, 'Synthetic Pending', '+1 202-555-0101', (v_day + time '10:00') at time zone 'UTC', 'pending'),
    (v_confirmed, v_service, 'Synthetic Confirmed', '+1 202-555-0102', (v_day + time '11:00') at time zone 'UTC', 'confirmed'),
    (v_cancelled, v_service, 'Synthetic Cancelled', '+1 202-555-0103', (v_day + time '12:00') at time zone 'UTC', 'cancelled'),
    (v_completed, v_service, 'Synthetic Completed', '+1 202-555-0104', (v_day + time '13:00') at time zone 'UTC', 'completed'),
    (v_pending_cancel, v_service, 'Synthetic Pending Cancel', '+1 202-555-0105', (v_day + time '14:00') at time zone 'UTC', 'pending');

  perform pg_temp.admin_assert((select relrowsecurity from pg_class where oid = 'private.salon_admins'::regclass), 'allowlist has RLS');
  perform pg_temp.admin_assert(not exists (select 1 from pg_policy where polrelid = 'private.salon_admins'::regclass), 'no self-provisioning allowlist policy');
  perform pg_temp.admin_assert((select count(*) = 3 and bool_and(convalidated) from pg_constraint
    where conrelid = 'public.services'::regclass and conname in
      ('services_name_admin_bounds', 'services_duration_admin_bounds', 'services_price_admin_bounds')), 'new constraints validate existing rows');
  perform pg_temp.admin_assert(exists (select 1 from pg_constraint where conrelid = 'public.bookings'::regclass
    and conname = 'bookings_no_overlap' and contype = 'x'), 'overlap protection remains');
  perform pg_temp.admin_assert((select count(*) = 1 and bool_and(polcmd = 'r'
    and polroles = array['authenticated'::regrole::oid]) from pg_policy
    where polrelid = 'public.bookings'::regclass and polcmd = 'r'), 'only authenticated booking SELECT policy');

  foreach v_function in array array['public.is_admin()', 'public.list_admin_bookings(text,integer,integer)',
    'public.admin_set_booking_status(uuid,public.booking_status)'] loop
    v_oid := v_function::regprocedure::oid;
    perform pg_temp.admin_assert((select prosecdef and 'search_path=""' = any(proconfig)
      from pg_proc where oid = v_oid), 'admin functions use SECURITY DEFINER with empty search_path');
    perform pg_temp.admin_assert(not exists (
      select 1 from pg_proc as proc, lateral aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) as privilege
      where proc.oid = v_oid and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
    ), 'no PUBLIC function execute grant');
    perform pg_temp.admin_assert(not has_function_privilege('anon', v_oid, 'EXECUTE')
      and has_function_privilege('authenticated', v_oid, 'EXECUTE'), 'only authenticated API role can execute');
  end loop;
  perform pg_temp.admin_assert((select provolatile = 's' from pg_proc where oid = 'public.is_admin()'::regprocedure), 'is_admin is stable');
  foreach v_role in array array['anon', 'authenticated'] loop
    perform pg_temp.admin_assert(not has_schema_privilege(v_role, 'private', 'USAGE'), 'private schema is inaccessible');
    perform pg_temp.admin_assert(not has_table_privilege(v_role, 'private.salon_admins', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and not has_any_column_privilege(v_role, 'private.salon_admins', 'SELECT,INSERT,UPDATE,REFERENCES'), 'no allowlist privileges');
    perform pg_temp.admin_assert(not has_table_privilege(v_role, 'public.bookings', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and not has_any_column_privilege(v_role, 'public.bookings', 'UPDATE,REFERENCES'), 'no direct mutation or unrestricted insert privileges');
    perform pg_temp.admin_assert(has_table_privilege(v_role, 'public.services', 'SELECT'), 'public service reads remain');
    perform pg_temp.admin_assert(not has_column_privilege(v_role, 'public.services', 'id', 'INSERT')
      and not has_column_privilege(v_role, 'public.services', 'id', 'UPDATE'), 'no client service id write privileges');
  end loop;
  perform pg_temp.admin_assert(has_table_privilege('authenticated', 'public.bookings', 'SELECT')
    and not has_table_privilege('anon', 'public.bookings', 'SELECT'), 'booking read grant requires authenticated role');

  -- Even owner-executed definer functions do not bypass the explicit UID gate.
  perform pg_temp.admin_assert(not public.is_admin(), 'null UID is not an admin');
  perform pg_temp.admin_expect_error('select * from public.list_admin_bookings(null,null,null)', '42501', 'ADMIN_REQUIRED');
  perform pg_temp.admin_expect_error('select * from public.admin_set_booking_status(null,null)', '42501', 'ADMIN_REQUIRED');
  perform pg_temp.admin_set_actor(null, 'anon');
  set local role anon;
  perform pg_temp.admin_assert((select count(*) = 1 from public.services), 'anon can read services');
  perform pg_temp.admin_expect_error('select public.is_admin()', '42501');
  perform pg_temp.admin_expect_error('select * from public.list_admin_bookings(''today'')', '42501');
  perform pg_temp.admin_expect_error(format('select * from public.admin_set_booking_status(%L,''cancelled'')', v_pending), '42501');
  perform pg_temp.admin_expect_error('select * from public.bookings', '42501');
  perform pg_temp.admin_expect_error(format('insert into private.salon_admins values (%L)', v_user), '42501');
  perform pg_temp.admin_expect_error('insert into public.services (name,duration,price) values (''Forbidden'',30,1)', '42501');
  perform pg_temp.admin_expect_error('update public.services set price = 1', '42501');
  perform pg_temp.admin_expect_error('delete from public.services', '42501');
  perform pg_temp.admin_expect_error('update public.bookings set status = ''cancelled''', '42501');
  perform pg_temp.admin_expect_error('delete from public.bookings', '42501');
  perform pg_temp.admin_expect_error(format('insert into public.bookings (service_id,customer_name,phone,slot_time,status) values (%L,''Forbidden Status'',''1234567'',%L,''cancelled'')',
    v_service, (v_day + time '16:00') at time zone 'UTC'), '42501');
  reset role;

  -- Ordinary users and users claiming admin in editable metadata see no PII.
  foreach v_actor in array array[v_user, v_spoof] loop
    perform pg_temp.admin_set_actor(v_actor, 'authenticated', case when v_actor = v_spoof
      then '{"admin":true,"role":"admin"}'::jsonb else '{}'::jsonb end);
    set local role authenticated;
    perform pg_temp.admin_assert(auth.uid() = v_actor and not public.is_admin(), 'signed-in user/metadata is not authorization');
    perform pg_temp.admin_assert((select count(*) = 0 from public.bookings), 'non-admin booking SELECT is filtered by RLS');
    perform pg_temp.admin_assert((select count(*) = 1 from public.services), 'non-admin services remain readable');
    perform pg_temp.admin_expect_error('select * from public.list_admin_bookings(''today'')', '42501', 'ADMIN_REQUIRED');
    perform pg_temp.admin_expect_error('select * from public.list_admin_bookings(''upcoming'')', '42501', 'ADMIN_REQUIRED');
    perform pg_temp.admin_expect_error('select * from public.list_admin_bookings(null,-1,0)', '42501', 'ADMIN_REQUIRED');
    perform pg_temp.admin_expect_error(format('select * from public.admin_set_booking_status(%L,''cancelled'')', v_pending), '42501', 'ADMIN_REQUIRED');
    perform pg_temp.admin_expect_error('select * from public.admin_set_booking_status(null,null)', '42501', 'ADMIN_REQUIRED');
    perform pg_temp.admin_expect_error('select * from private.salon_admins', '42501');
    perform pg_temp.admin_expect_error(format('insert into private.salon_admins values (%L)', v_actor), '42501');
    perform pg_temp.admin_expect_error('update private.salon_admins set user_id = user_id', '42501');
    perform pg_temp.admin_expect_error('delete from private.salon_admins', '42501');
    perform pg_temp.admin_expect_error('insert into public.services (name,duration,price) values (''Forbidden'',30,1)', '42501');
    update public.services set price = 1 where id = v_service;
    get diagnostics v_count = row_count;
    perform pg_temp.admin_assert(v_count = 0, 'RLS filters non-admin service updates');
    delete from public.services where id = v_service;
    get diagnostics v_count = row_count;
    perform pg_temp.admin_assert(v_count = 0, 'RLS filters non-admin service deletes');
    perform pg_temp.admin_expect_error('update public.bookings set status = ''cancelled''', '42501');
    perform pg_temp.admin_expect_error('delete from public.bookings', '42501');
    perform pg_temp.admin_expect_error(format('insert into public.bookings (service_id,customer_name,phone,slot_time,status) values (%L,''Forbidden Status'',''1234567'',%L,''cancelled'')',
      v_service, (v_day + time '16:00') at time zone 'UTC'), '42501');
    reset role;
  end loop;
  perform pg_temp.admin_set_actor(null);
  set local role authenticated;
  perform pg_temp.admin_assert(not public.is_admin() and (select count(*) = 0 from public.bookings), 'authenticated role without UID is not admin');
  perform pg_temp.admin_expect_error('select * from public.list_admin_bookings(''today'')', '42501', 'ADMIN_REQUIRED');
  perform pg_temp.admin_expect_error('select * from public.admin_set_booking_status(null,null)', '42501', 'ADMIN_REQUIRED');
  reset role;

  perform pg_temp.admin_set_actor(v_admin);
  set local role authenticated;
  perform pg_temp.admin_assert(public.is_admin(), 'owner-allowlisted UID is admin without metadata');
  perform pg_temp.admin_assert((select count(*) = 5 from public.bookings), 'allowlisted admin can read bookings through RLS');
  perform pg_temp.admin_expect_error('select * from private.salon_admins', '42501');
  perform pg_temp.admin_expect_error(format('insert into private.salon_admins values (%L)', v_user), '42501');
  perform pg_temp.admin_expect_error('update private.salon_admins set user_id = user_id', '42501');
  perform pg_temp.admin_expect_error('delete from private.salon_admins', '42501');

  insert into public.services (name, duration, price) values (repeat('n', 120), 600, 99999999.99)
    returning id into v_new_service;
  perform pg_temp.admin_assert((select duration = 600 and price = 99999999.99 from public.services where id = v_new_service), 'inclusive service maxima');
  update public.services set name = 'S', duration = 1, price = 0 where id = v_new_service;
  get diagnostics v_count = row_count;
  perform pg_temp.admin_assert(v_count = 1 and (select name = 'S' and duration = 1 and price = 0
    from public.services where id = v_new_service), 'admin service update and inclusive minima');
  foreach v_name in array array['', '   ', repeat('n', 121), E'Service\nName', E'Service\tName', E'Service\rName', E'Service\x7fName'] loop
    perform pg_temp.admin_expect_error(format('insert into public.services (name,duration,price) values (%L,30,10)', v_name), '23514');
    perform pg_temp.admin_expect_error(format('update public.services set name = %L where id = %L', v_name, v_new_service), '23514');
  end loop;
  foreach v_duration in array array[-1, 0, 601] loop
    perform pg_temp.admin_expect_error(format('insert into public.services (name,duration,price) values (''Invalid duration'',%s,10)', v_duration), '23514');
    perform pg_temp.admin_expect_error(format('update public.services set duration = %s where id = %L', v_duration, v_new_service), '23514');
  end loop;
  perform pg_temp.admin_expect_error('insert into public.services (name,duration,price) values (''Negative price'',30,-1)', '23514');
  perform pg_temp.admin_expect_error('insert into public.services (name,duration,price) values (''NaN price'',30,''NaN'')', '23514');
  perform pg_temp.admin_expect_error(format('update public.services set price = -1 where id = %L', v_new_service), '23514');
  perform pg_temp.admin_expect_error(format('update public.services set price = ''NaN'' where id = %L', v_new_service), '23514');
  perform pg_temp.admin_expect_error('insert into public.services (name,duration,price) values (''Overflow price'',30,100000000)', '22003');
  perform pg_temp.admin_expect_error(format('insert into public.services (id,name,duration,price) values (%L,''Chosen id'',30,1)', gen_random_uuid()), '42501');
  perform pg_temp.admin_expect_error(format('update public.services set id = %L where id = %L', gen_random_uuid(), v_new_service), '42501');
  perform pg_temp.admin_expect_error(format('delete from public.services where id = %L', v_service), '23503');
  update public.services set duration = 45 where id = v_service;
  perform pg_temp.admin_assert((select end_time = slot_time + interval '30 minutes' from public.bookings where id = v_pending), 'admin service edits preserve booking duration snapshot');
  delete from public.services where id = v_new_service;
  get diagnostics v_count = row_count;
  perform pg_temp.admin_assert(v_count = 1, 'admin can delete unreferenced service');

  perform pg_temp.admin_expect_error('update public.bookings set status = ''cancelled''', '42501');
  perform pg_temp.admin_expect_error('delete from public.bookings', '42501');
  perform pg_temp.admin_expect_error(format('insert into public.bookings (service_id,customer_name,phone,slot_time,status) values (%L,''Forbidden Status'',''1234567'',%L,''cancelled'')',
    v_service, (v_day + time '16:00') at time zone 'UTC'), '42501');
  select * into strict v_receipt from public.admin_set_booking_status(v_pending, 'confirmed');
  perform pg_temp.admin_assert(v_receipt.id = v_pending and v_receipt.customer_name = 'Synthetic Pending'
    and v_receipt.phone = '+1 202-555-0101' and v_receipt.service_id = v_service
    and v_receipt.slot_time = (v_day + time '10:00') at time zone 'UTC'
    and v_receipt.end_time = v_receipt.slot_time + interval '30 minutes' and v_receipt.status = 'confirmed', 'pending confirmation receipt');
  select * into strict v_retry from public.admin_set_booking_status(v_pending, 'confirmed');
  perform pg_temp.admin_assert(v_receipt = v_retry, 'confirmed repeat returns identical receipt');
  select * into strict v_receipt from public.admin_set_booking_status(v_pending, 'cancelled');
  perform pg_temp.admin_assert(v_receipt.status = 'cancelled'
    and (select status = 'cancelled' from public.bookings where id = v_pending), 'confirmed cancellation is saved');
  select * into strict v_retry from public.admin_set_booking_status(v_pending, 'cancelled');
  perform pg_temp.admin_assert(v_receipt = v_retry, 'cancelled repeat returns identical receipt');
  perform pg_temp.admin_expect_error(format('select * from public.admin_set_booking_status(%L,''confirmed'')', v_pending), '22023', 'BOOKING_STATUS_FINAL');
  select * into strict v_receipt from public.admin_set_booking_status(v_pending_cancel, 'cancelled');
  perform pg_temp.admin_assert(v_receipt.status = 'cancelled', 'pending can be cancelled without confirmation');
  select * into strict v_receipt from public.admin_set_booking_status(v_confirmed, 'confirmed');
  perform pg_temp.admin_assert(v_receipt.status = 'confirmed', 'existing confirmed repeat succeeds');
  select * into strict v_receipt from public.admin_set_booking_status(v_cancelled, 'cancelled');
  perform pg_temp.admin_assert(v_receipt.status = 'cancelled', 'existing cancelled repeat succeeds');
  perform pg_temp.admin_expect_error(format('select * from public.admin_set_booking_status(%L,''confirmed'')', v_cancelled), '22023', 'BOOKING_STATUS_FINAL');
  foreach v_status in array array['confirmed', 'cancelled']::public.booking_status[] loop
    perform pg_temp.admin_expect_error(format('select * from public.admin_set_booking_status(%L,%L)', v_completed, v_status), '22023', 'BOOKING_STATUS_FINAL');
  end loop;
  foreach v_status in array array[null::public.booking_status, 'pending', 'completed']::public.booking_status[] loop
    perform pg_temp.admin_expect_error(format('select * from public.admin_set_booking_status(%L,%L)', v_confirmed, v_status), '22023', 'INVALID_BOOKING_STATUS');
  end loop;
  perform pg_temp.admin_expect_error('select * from public.admin_set_booking_status(null,''confirmed'')', '22023', 'INVALID_BOOKING_INPUT');
  perform pg_temp.admin_expect_error(format('select * from public.admin_set_booking_status(%L,''confirmed'')', gen_random_uuid()), '22023', 'BOOKING_NOT_FOUND');
  perform pg_temp.admin_expect_error(format('select * from public.admin_set_booking_status(%L,''unknown'')', v_confirmed), '22P02');
  perform pg_temp.admin_assert((select status = 'completed' from public.bookings where id = v_completed)
    and (select status = 'cancelled' from public.bookings where id = v_cancelled), 'final rows stay final');
  reset role;

  -- Local-midnight fixtures detect UTC/session-date filtering and exclusion of
  -- elapsed appointments. Each view must include every booking status.
  foreach v_zone in array array['UTC', 'Asia/Kathmandu', 'Pacific/Kiritimati', 'America/Adak', 'America/New_York', 'America/Havana'] loop
    truncate table public.bookings;
    update public.services set duration = 1 where id = v_service;
    update private.salon_booking_settings set time_zone = v_zone;
    v_today := (statement_timestamp() at time zone v_zone)::date;
    v_today_start := v_today::timestamp at time zone v_zone;
    v_tomorrow_start := (v_today + 1)::timestamp at time zone v_zone;
    -- Havana repeats midnight by one hour at fallback. Fixtures must include
    -- its first occurrence, not PostgreSQL's default later/standard occurrence.
    if ((v_today_start - interval '1 hour') at time zone v_zone)::date = v_today then
      v_today_start := v_today_start - interval '1 hour';
    end if;
    if ((v_tomorrow_start - interval '1 hour') at time zone v_zone)::date = v_today + 1 then
      v_tomorrow_start := v_tomorrow_start - interval '1 hour';
    end if;
    v_today_first := gen_random_uuid();
    v_today_last := gen_random_uuid();
    v_upcoming_first := gen_random_uuid();
    insert into public.bookings (id, service_id, customer_name, phone, slot_time, status) values
      (gen_random_uuid(), v_service, 'Yesterday Boundary', '1234567', v_today_start - interval '1 minute', 'completed'),
      (v_today_first, v_service, 'Today Midnight', '1234567', v_today_start, 'pending'),
      (gen_random_uuid(), v_service, 'Today Confirmed', '1234567', v_today_start + interval '1 minute', 'confirmed'),
      (gen_random_uuid(), v_service, 'Today Completed', '1234567', v_today_start + interval '2 minutes', 'completed'),
      (v_today_last, v_service, 'Today Last Minute', '1234567', v_tomorrow_start - interval '1 minute', 'cancelled'),
      (v_upcoming_first, v_service, 'Tomorrow Midnight', '1234567', v_tomorrow_start, 'pending'),
      (gen_random_uuid(), v_service, 'Tomorrow Confirmed', '1234567', v_tomorrow_start + interval '1 minute', 'confirmed'),
      (gen_random_uuid(), v_service, 'Tomorrow Completed', '1234567', v_tomorrow_start + interval '2 minutes', 'completed'),
      (gen_random_uuid(), v_service, 'Beyond Guest Horizon', '1234567', (v_today + 120 + time '10:00') at time zone v_zone, 'cancelled');
    set local role authenticated;
    perform pg_temp.admin_assert((select count(*) = 4 from public.list_admin_bookings('today')), 'today local-date count');
    perform pg_temp.admin_assert((select count(*) = 4 from public.list_admin_bookings('upcoming')), 'upcoming includes all future local dates');
    perform pg_temp.admin_assert(exists (select 1 from public.list_admin_bookings('today') where id = v_today_first)
      and exists (select 1 from public.list_admin_bookings('today') where id = v_today_last), 'today includes elapsed midnight and final minute');
    perform pg_temp.admin_assert(not exists (select 1 from public.list_admin_bookings('today') where id = v_upcoming_first)
      and exists (select 1 from public.list_admin_bookings('upcoming') where id = v_upcoming_first), 'next midnight belongs only to upcoming');
    foreach v_function in array array['today', 'upcoming'] loop
      v_previous_time := null;
      v_previous_id := null;
      foreach v_status in array enum_range(null::public.booking_status) loop
        perform pg_temp.admin_assert(exists (select 1 from public.list_admin_bookings(v_function) where status = v_status), 'views include all statuses');
      end loop;
      for v_item in select * from public.list_admin_bookings(v_function) loop
        perform pg_temp.admin_assert(v_item.service_id = v_service and v_item.service_name = 'Synthetic admin service'
          and v_item.phone = '1234567' and v_item.end_time = v_item.slot_time + interval '1 minute', 'list returns joined name and receipt fields');
        perform pg_temp.admin_assert(case when v_function = 'today'
          then (v_item.slot_time at time zone v_zone)::date = v_today
          else (v_item.slot_time at time zone v_zone)::date > v_today end, 'salon date, not session date');
        perform pg_temp.admin_assert(v_previous_time is null or (v_item.slot_time, v_item.id) > (v_previous_time, v_previous_id), 'slot_time/id ordering');
        v_previous_time := v_item.slot_time;
        v_previous_id := v_item.id;
      end loop;
    end loop;
    reset role;
  end loop;

  -- Future named-zone DST fixtures exercise both 23/25-hour local days and
  -- both instants of the repeated fall hour without a hard-coded current date.
  -- The today view's transition-day boundary is exercised when run on that day;
  -- PostgreSQL's statement clock is deliberately not mocked/overridden here.
  truncate table public.bookings;
  update private.salon_booking_settings set time_zone = 'America/New_York';
  v_today := (statement_timestamp() at time zone 'America/New_York')::date;
  v_year := extract(year from v_today)::integer + 1;
  v_spring := make_date(v_year, 3, 1);
  v_spring := v_spring + ((7 - extract(dow from v_spring)::integer) % 7) + 7;
  v_fall := make_date(v_year, 11, 1);
  v_fall := v_fall + ((7 - extract(dow from v_fall)::integer) % 7);
  v_spring_start := v_spring::timestamp at time zone 'America/New_York';
  v_spring_end := (v_spring + 1)::timestamp at time zone 'America/New_York';
  v_fall_start := v_fall::timestamp at time zone 'America/New_York';
  v_fall_end := (v_fall + 1)::timestamp at time zone 'America/New_York';
  perform pg_temp.admin_assert(v_spring_end - v_spring_start = interval '23 hours'
    and v_fall_end - v_fall_start = interval '25 hours', 'DST oracle uses independently converted local midnights');
  insert into public.bookings (service_id, customer_name, phone, slot_time, status)
  select v_service, 'Synthetic DST Boundary', '1234567', instant, 'cancelled'::public.booking_status
  from unnest(array[v_spring_start - interval '1 minute', v_spring_start, v_spring_end - interval '1 minute', v_spring_end,
    v_fall_start - interval '1 minute', v_fall_start, v_fall_end - interval '1 minute', v_fall_end,
    ((v_fall + time '01:30') at time zone 'America/New_York') - interval '1 hour',
    (v_fall + time '01:30') at time zone 'America/New_York']) as fixture(instant);
  select array_agg(id order by slot_time, id) into v_expected from public.bookings;
  set local role authenticated;
  select array_agg(id) into v_actual from public.list_admin_bookings('upcoming');
  perform pg_temp.admin_assert(v_actual = v_expected and cardinality(v_actual) = 10, 'upcoming preserves DST instants/order across both transitions');
  perform pg_temp.admin_assert((select count(*) = 0 from public.list_admin_bookings('today')), 'future DST rows are not today');
  reset role;

  -- Tied starts are legal for cancelled bookings and must page by UUID, too.
  truncate table public.bookings;
  update private.salon_booking_settings set time_zone = 'UTC';
  insert into public.bookings (id, service_id, customer_name, phone, slot_time, status)
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    v_service, 'Synthetic Pagination', '1234567', (v_day + time '10:00') at time zone 'UTC', 'cancelled'::public.booking_status
  from generate_series(1, 53) as fixture(n);
  select array_agg(id order by slot_time, id) into v_expected from public.bookings;
  set local role authenticated;
  select array_agg(id) into v_actual from public.list_admin_bookings('upcoming');
  perform pg_temp.admin_assert(v_actual = v_expected[1:51], 'default page is 51 rows with stable tie ordering');
  select array_agg(id) into v_actual from public.list_admin_bookings('upcoming', 51, 51);
  perform pg_temp.admin_assert(v_actual = v_expected[52:53], 'next page has no gaps or duplicates');
  perform pg_temp.admin_assert((select id = v_expected[1] from public.list_admin_bookings('upcoming', 0, 1)), 'minimum limit is one');
  perform pg_temp.admin_assert((select count(*) = 0 from public.list_admin_bookings('upcoming', 53, 51))
    and (select count(*) = 0 from public.list_admin_bookings('upcoming', 10000, 51)), 'empty page and inclusive offset maximum');
  foreach v_name in array array[null::text, '', 'TODAY', 'past', 'upcoming '] loop
    perform pg_temp.admin_expect_error(format('select * from public.list_admin_bookings(%L)', v_name), '22023', 'INVALID_ADMIN_BOOKING_INPUT');
  end loop;
  foreach v_count in array array[null::integer, -1, 10001] loop
    perform pg_temp.admin_expect_error(format('select * from public.list_admin_bookings(''today'',%L,51)', v_count), '22023', 'INVALID_ADMIN_BOOKING_INPUT');
  end loop;
  foreach v_count in array array[null::integer, -1, 0, 52] loop
    perform pg_temp.admin_expect_error(format('select * from public.list_admin_bookings(''today'',0,%L)', v_count), '22023', 'INVALID_ADMIN_BOOKING_INPUT');
  end loop;
  reset role;

  delete from private.salon_admins where user_id = v_admin;
  set local role authenticated;
  perform pg_temp.admin_assert(not public.is_admin() and (select count(*) = 0 from public.bookings), 'membership revocation immediately removes booking access');
  perform pg_temp.admin_expect_error('select * from public.list_admin_bookings(''upcoming'')', '42501', 'ADMIN_REQUIRED');
  perform pg_temp.admin_expect_error(format('select * from public.admin_set_booking_status(%L,''cancelled'')', v_expected[1]), '42501', 'ADMIN_REQUIRED');
  reset role;
  raise notice 'Admin authorization regression checks passed; all fixtures will be rolled back.';
end;
$$;

rollback;
