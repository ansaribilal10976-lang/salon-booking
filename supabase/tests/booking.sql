-- Run after ALL migrations as postgres in a DEVELOPMENT database only.
-- With psql: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/booking.sql
-- Fixtures temporarily replace the calendar inside this rolled-back transaction.
-- Never use this test on a live booking database: TRUNCATE takes exclusive locks.
begin;
set local timezone = 'Pacific/Honolulu'; -- Intentionally not the salon timezone.
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';
truncate table public.bookings, public.services;

create function pg_temp.booking_assert(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'Booking assertion failed: %', p_label;
  end if;
end;
$$;

create function pg_temp.booking_expect_error(p_sql text, p_state text, p_message text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state or (p_message is not null and sqlerrm <> p_message) then
      raise exception 'Unexpected error: state %, message %; expected % / %', sqlstate, sqlerrm, p_state, p_message;
    end if;
    return;
  end;
  raise exception 'Expected error % was not raised', p_state;
end;
$$;

do $$
declare
  v_short uuid := gen_random_uuid();
  v_medium uuid := gen_random_uuid();
  v_long uuid := gen_random_uuid();
  v_full_day uuid := gen_random_uuid();
  v_booking_id uuid := gen_random_uuid();
  v_second_id uuid := gen_random_uuid();
  v_direct_id uuid := gen_random_uuid();
  v_day date := (clock_timestamp() at time zone 'UTC')::date + 7;
  v_start timestamptz;
  v_previous timestamptz;
  v_slot record;
  v_config record;
  v_receipt record;
  v_retry record;
  v_saved public.bookings%rowtype;
  v_value text;
  v_role text;
  v_zone text;
  v_status public.booking_status;
  v_oid oid;
  v_function text;
  v_bad_time timestamptz;
begin
  update private.salon_booking_settings set time_zone = 'UTC' where singleton;
  insert into public.services (id, name, duration, price) values
    (v_short, 'Synthetic 30-minute service', 30, 10),
    (v_medium, 'Synthetic 45-minute service', 45, 15),
    (v_long, 'Synthetic 60-minute service', 60, 20),
    (v_full_day, 'Synthetic full-day service', 600, 30);

  perform pg_temp.booking_assert((select count(*) = 1 from public.get_booking_config()), 'one configuration row');
  select * into strict v_config from public.get_booking_config();
  perform pg_temp.booking_assert(v_config.time_zone = 'UTC'
    and v_config.min_date = (statement_timestamp() at time zone 'UTC')::date
    and v_config.max_date = v_config.min_date + 90, 'configured date horizon, not session timezone');
  perform pg_temp.booking_assert((select count(*) = 20 from public.get_available_slots(v_short, v_day)), '30-minute service has 20 starts');
  perform pg_temp.booking_assert((select min(slot_time) = (v_day + time '10:00') at time zone 'UTC'
    and max(slot_time) = (v_day + time '19:30') at time zone 'UTC'
    from public.get_available_slots(v_short, v_day)), '10:00 opening and finish-at-20:00 boundary');
  perform pg_temp.booking_assert((select count(*) = 19
    and max(slot_time) = (v_day + time '19:00') at time zone 'UTC'
    from public.get_available_slots(v_medium, v_day)), '45-minute service must finish before closing');
  perform pg_temp.booking_assert((select count(*) = 19 from public.get_available_slots(v_long, v_day)), '60-minute service excludes 19:30');
  perform pg_temp.booking_assert((select count(*) = 1
    and min(slot_time) = (v_day + time '10:00') at time zone 'UTC'
    from public.get_available_slots(v_full_day, v_day)), 'maximum 600-minute service fits only at opening');
  perform pg_temp.booking_assert((select count(*) = 20 from public.get_available_slots(v_short, v_config.max_date)), 'inclusive day-90 horizon');
  perform pg_temp.booking_assert((select count(*) = 20 from public.get_available_slots(v_short,
    v_day + ((6 - extract(dow from v_day)::integer + 7) % 7))), 'Saturday is open');
  perform pg_temp.booking_assert((select count(*) = 20 from public.get_available_slots(v_short,
    v_day + ((7 - extract(dow from v_day)::integer) % 7))), 'Sunday is open');

  for v_slot in select * from public.get_available_slots(v_short, v_day) loop
    perform pg_temp.booking_assert(extract(minute from v_slot.slot_time at time zone 'UTC') in (0, 30)
      and extract(second from v_slot.slot_time) = 0
      and (v_previous is null or v_slot.slot_time > v_previous), 'chronological :00/:30 grid');
    v_previous := v_slot.slot_time;
  end loop;
  perform pg_temp.booking_assert(not exists (
    select 1 from public.get_available_slots(v_short, v_config.min_date) where slot_time <= statement_timestamp()
  ), 'today availability excludes the past');

  perform pg_temp.booking_expect_error(format('select * from public.get_available_slots(%L, null)', v_short), '22023');
  perform pg_temp.booking_expect_error(format('select * from public.get_available_slots(null, %L)', v_day), '22023');
  perform pg_temp.booking_expect_error(format('select * from public.get_available_slots(%L, %L)', gen_random_uuid(), v_day), '22023', 'INVALID_SERVICE');
  perform pg_temp.booking_expect_error(format('select * from public.get_available_slots(%L, %L)', v_short, v_config.min_date - 1), '22023');
  perform pg_temp.booking_expect_error(format('select * from public.get_available_slots(%L, %L)', v_short, v_config.max_date + 1), '22023');
  perform pg_temp.booking_expect_error(format('select * from public.get_available_slots(%L, %L)', v_short, 'infinity'), '22023');
  perform pg_temp.booking_expect_error($sql$update private.salon_booking_settings set time_zone = 'Not/A_Zone'$sql$, '22023', 'INVALID_SALON_TIME_ZONE');
  perform pg_temp.booking_expect_error('update private.salon_booking_settings set time_zone = null', '22023', 'INVALID_SALON_TIME_ZONE');
  perform pg_temp.booking_expect_error($sql$insert into private.salon_booking_settings values (false, 'UTC')$sql$, '23514');
  perform pg_temp.booking_expect_error($sql$insert into private.salon_booking_settings values (true, 'UTC')$sql$, '23505');

  -- Named-zone wall-clock scheduling works with non-hour offsets and independently
  -- of the SQL session timezone. The horizon uses the salon's local date, too.
  foreach v_zone in array array['Asia/Kathmandu', 'Europe/Berlin', 'Pacific/Kiritimati', 'America/Adak'] loop
    update private.salon_booking_settings set time_zone = v_zone;
    select * into strict v_config from public.get_booking_config();
    perform pg_temp.booking_assert(v_config.time_zone = v_zone
      and v_config.min_date = (statement_timestamp() at time zone v_zone)::date
      and v_config.max_date = v_config.min_date + 90, 'IANA timezone controls horizon');
    perform pg_temp.booking_assert((select count(*) = 20
      and min(slot_time) = (v_day + time '10:00') at time zone v_zone
      and max(slot_time) = (v_day + time '19:30') at time zone v_zone
      from public.get_available_slots(v_short, v_day)), 'IANA wall times control availability');
  end loop;
  update private.salon_booking_settings set time_zone = 'Asia/Kathmandu';
  v_start := (v_day + time '10:00') at time zone 'Asia/Kathmandu';
  select * into strict v_receipt from public.create_booking(gen_random_uuid(), v_short, v_start, 'Timezone Guest', '+1 202-555-0100');
  perform pg_temp.booking_assert(v_receipt.slot_time = v_start and v_receipt.end_time = v_start + interval '30 minutes', 'non-UTC slot saves');
  update public.bookings set status = 'cancelled' where id = v_receipt.id;
  update private.salon_booking_settings set time_zone = 'UTC';

  v_start := (v_day + time '10:00') at time zone 'UTC';
  foreach v_value in array array[null::text, '', ' ', 'A', repeat('x', 101), E'Guest\nName', E'Guest\tName', E'Guest\rName'] loop
    perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
      gen_random_uuid(), v_short, v_start, v_value, '+1 202-555-0100'), '22023', 'INVALID_BOOKING_INPUT');
  end loop;
  foreach v_value in array array[null::text, '', '123456', '1234567890123456', '202-555-0100x1', E'202\n5550100', repeat('+', 26) || '1234567', '١٢٣٤٥٦٧'] loop
    perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
      gen_random_uuid(), v_short, v_start, 'Valid Guest', v_value), '22023', 'INVALID_BOOKING_INPUT');
  end loop;
  perform pg_temp.booking_expect_error(format('select * from public.create_booking(null,%L,%L,%L,%L)',
    v_short, v_start, 'Valid Guest', '+1 202-555-0100'), '22023');
  perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,null,%L,%L,%L)',
    gen_random_uuid(), v_start, 'Valid Guest', '+1 202-555-0100'), '22023');
  perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,null,%L,%L)',
    gen_random_uuid(), v_short, 'Valid Guest', '+1 202-555-0100'), '22023');
  perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
    gen_random_uuid(), gen_random_uuid(), v_start, 'Valid Guest', '+1 202-555-0100'), '22023', 'INVALID_SERVICE');

  foreach v_bad_time in array array[
    (v_day + time '09:30') at time zone 'UTC',
    (v_day + time '20:00') at time zone 'UTC',
    (v_day + time '10:15') at time zone 'UTC',
    (v_day + time '10:00:01') at time zone 'UTC',
    (v_day + time '10:00:00.001') at time zone 'UTC',
    ((clock_timestamp() at time zone 'UTC')::date + 91 + time '10:00') at time zone 'UTC',
    'infinity'::timestamptz, '-infinity'::timestamptz
  ] loop
    perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
      gen_random_uuid(), v_short, v_bad_time, 'Valid Guest', '+1 202-555-0100'), '22023', 'INVALID_BOOKING_INPUT');
  end loop;
  perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
    gen_random_uuid(), v_short, clock_timestamp() - interval '1 day', 'Valid Guest', '+1 202-555-0100'), '23P01', 'SLOT_UNAVAILABLE');
  perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
    gen_random_uuid(), v_medium, (v_day + time '19:30') at time zone 'UTC', 'Valid Guest', '+1 202-555-0100'), '22023');
  -- Inclusive validation boundaries and an appointment ending exactly at closing.
  select * into strict v_receipt from public.create_booking(gen_random_uuid(), v_short,
    (v_day + time '19:30') at time zone 'UTC', 'Li', '1234567');
  perform pg_temp.booking_assert(v_receipt.end_time = (v_day + time '20:00') at time zone 'UTC', 'finish exactly at closing is accepted');
  select * into strict v_retry from public.create_booking(gen_random_uuid(), v_short,
    (v_day + time '18:30') at time zone 'UTC', repeat('x', 100), repeat('+', 17) || '123456789012345');
  perform pg_temp.booking_assert(char_length(v_retry.customer_name) = 100 and char_length(v_retry.phone) = 32, 'maximum trimmed name and phone lengths accepted');
  update public.bookings set status = 'cancelled' where id in (v_receipt.id, v_retry.id);

  -- Guests can create a receipt but still cannot read the underlying table.
  set local role anon;
  select * into strict v_receipt from public.create_booking(v_booking_id, v_long, v_start, '  Synthetic Guest  ', '  +1 (202) 555.0100  ');
  reset role;
  select * into strict v_saved from public.bookings where id = v_booking_id;
  perform pg_temp.booking_assert(v_receipt.id = v_booking_id and v_receipt.service_id = v_long
    and v_receipt.customer_name = 'Synthetic Guest' and v_receipt.phone = '+1 (202) 555.0100'
    and v_receipt.slot_time = v_start and v_receipt.end_time = v_start + interval '1 hour'
    and v_receipt.status = 'confirmed', 'guest receipt contains normalized saved values');
  perform pg_temp.booking_assert(v_saved.customer_name = v_receipt.customer_name and v_saved.phone = v_receipt.phone
    and v_saved.slot_time = v_receipt.slot_time and v_saved.end_time = v_receipt.end_time
    and v_saved.service_id = v_receipt.service_id and v_saved.status = v_receipt.status, 'saved booking read-back');
  select * into strict v_retry from public.create_booking(v_booking_id, v_long, v_start, 'Synthetic Guest', '+1 (202) 555.0100');
  perform pg_temp.booking_assert(v_retry = v_receipt
    and (select count(*) = 1 from public.bookings where id = v_booking_id), 'identical retry returns same single receipt');

  foreach v_value in array array[
    format('select * from public.create_booking(%L,%L,%L,%L,%L)', v_booking_id, v_short, v_start, 'Synthetic Guest', '+1 (202) 555.0100'),
    format('select * from public.create_booking(%L,%L,%L,%L,%L)', v_booking_id, v_long, v_start + interval '30 minutes', 'Synthetic Guest', '+1 (202) 555.0100'),
    format('select * from public.create_booking(%L,%L,%L,%L,%L)', v_booking_id, v_long, v_start, 'Different Guest', '+1 (202) 555.0100'),
    format('select * from public.create_booking(%L,%L,%L,%L,%L)', v_booking_id, v_long, v_start, 'Synthetic Guest', '+1 202-555-0199'),
    format('select * from public.create_booking(%L,null,%L,%L,%L)', v_booking_id, v_start, 'Synthetic Guest', '+1 (202) 555.0100')
  ] loop
    perform pg_temp.booking_expect_error(v_value, '22023', 'REQUEST_MISMATCH');
  end loop;

  perform pg_temp.booking_assert(not exists (select 1 from public.get_available_slots(v_short, v_day)
    where slot_time in (v_start, v_start + interval '30 minutes')), 'all services share calendar and duration blocking');
  perform pg_temp.booking_assert(exists (select 1 from public.get_available_slots(v_short, v_day)
    where slot_time = v_start + interval '1 hour'), 'half-open ranges allow adjacent appointments');
  perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
    gen_random_uuid(), v_short, v_start, 'Another Guest', '+1 202-555-0101'), '23P01', 'SLOT_UNAVAILABLE');
  perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
    gen_random_uuid(), v_medium, v_start + interval '30 minutes', 'Another Guest', '+1 202-555-0101'), '23P01', 'SLOT_UNAVAILABLE');
  perform public.create_booking(v_second_id, v_short, v_start + interval '1 hour', 'Adjacent Guest', '1234567');
  perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
    gen_random_uuid(), v_short, v_start + interval '1 hour', 'Stale Slot Guest', '123456789012345'), '23P01', 'SLOT_UNAVAILABLE');

  -- Exercise the constraint itself, bypassing the public RPC availability check.
  perform pg_temp.booking_expect_error(format('insert into public.bookings (service_id,slot_time,customer_name,phone) values (%L,%L,%L,%L)',
    v_short, v_start + interval '30 minutes', 'Direct Conflict', '+1 202-555-0102'), '23P01');
  foreach v_status in array array['pending', 'confirmed', 'completed']::public.booking_status[] loop
    update public.bookings set status = v_status where id = v_booking_id;
    perform pg_temp.booking_assert(not exists (select 1 from public.get_available_slots(v_short, v_day)
      where slot_time = v_start), 'every non-cancelled status reserves its range');
  end loop;
  update public.bookings set status = 'cancelled' where id = v_booking_id;
  perform pg_temp.booking_assert(exists (select 1 from public.get_available_slots(v_short, v_day)
    where slot_time = v_start), 'cancellation frees a slot');
  select * into strict v_retry from public.create_booking(v_booking_id, v_long, v_start, 'Synthetic Guest', '+1 (202) 555.0100');
  perform pg_temp.booking_assert(v_retry.status = 'cancelled', 'retry does not resurrect a cancelled booking');
  perform public.create_booking(gen_random_uuid(), v_short, v_start, 'Replacement Guest', '123456789012345');
  perform pg_temp.booking_expect_error(format('update public.bookings set status = %L where id = %L', 'confirmed', v_booking_id), '23P01');

  -- Trigger snapshots cannot be shortened or retroactively changed by service edits.
  insert into public.bookings (id, service_id, slot_time, end_time, customer_name, phone)
  values (v_direct_id, v_medium, v_start + interval '4 hours', v_start + interval '4 hours 1 minute', 'Snapshot Guest', '1234567');
  perform pg_temp.booking_assert((select end_time = slot_time + interval '45 minutes' from public.bookings where id = v_direct_id), 'insert overwrites a supplied shorter end time');
  update public.services set duration = 90 where id = v_medium;
  perform pg_temp.booking_assert((select end_time = slot_time + interval '45 minutes' from public.bookings where id = v_direct_id), 'service edit preserves existing duration snapshot');
  update public.bookings set slot_time = slot_time + interval '30 minutes' where id = v_direct_id;
  perform pg_temp.booking_assert((select end_time = slot_time + interval '90 minutes' from public.bookings where id = v_direct_id), 'start edit refreshes duration snapshot');
  update public.bookings set service_id = v_short where id = v_direct_id;
  perform pg_temp.booking_assert((select end_time = slot_time + interval '30 minutes' from public.bookings where id = v_direct_id), 'service edit on booking refreshes duration snapshot');
  perform pg_temp.booking_expect_error(format('update public.bookings set end_time = slot_time where id = %L', v_direct_id), '23514', 'BOOKING_END_TIME_IS_DERIVED');
  perform pg_temp.booking_expect_error(format('update public.bookings set end_time = null where id = %L', v_direct_id), '23514');
  perform pg_temp.booking_expect_error(format('update public.bookings set slot_time = %L where id = %L', v_start, v_direct_id), '23P01');

  -- Exact retries of older saved reservations bypass today's booking window.
  update public.bookings set slot_time = v_start - interval '20 days' where id = v_direct_id;
  select * into strict v_retry from public.create_booking(v_direct_id, v_short, v_start - interval '20 days', 'Snapshot Guest', '1234567');
  perform pg_temp.booking_assert(v_retry.id = v_direct_id, 'past saved receipt remains retryable');

  perform pg_temp.booking_assert((select relrowsecurity from pg_class where oid = 'public.bookings'::regclass), 'bookings RLS remains enabled');
  perform pg_temp.booking_assert((select count(*) = 1
    and bool_and(polcmd = 'r' and polroles = array['authenticated'::regrole::oid])
    from pg_policy where polrelid = 'public.bookings'::regclass and polcmd = 'r'), 'only authenticated admin booking SELECT policy');
  perform pg_temp.booking_assert(exists (select 1 from pg_constraint where conrelid = 'public.bookings'::regclass
    and conname = 'bookings_end_after_start' and contype = 'c'), 'positive-duration check exists');
  perform pg_temp.booking_assert(exists (select 1 from pg_constraint where conrelid = 'public.bookings'::regclass
    and conname = 'bookings_no_overlap' and contype = 'x'), 'race-protecting exclusion constraint exists');

  foreach v_function in array array['public.get_booking_config()', 'public.get_available_slots(uuid,date)',
    'public.create_booking(uuid,uuid,timestamp with time zone,text,text)'] loop
    v_oid := v_function::regprocedure::oid;
    perform pg_temp.booking_assert((select prosecdef and 'search_path=""' = any(proconfig) from pg_proc where oid = v_oid), 'RPC uses SECURITY DEFINER and fixed empty search_path');
    perform pg_temp.booking_assert(not exists (
      select 1 from pg_proc as proc, lateral aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) as privilege
      where proc.oid = v_oid and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
    ), 'RPC has no PUBLIC execute grant');
    foreach v_role in array array['anon', 'authenticated'] loop
      perform pg_temp.booking_assert(has_function_privilege(v_role, v_oid, 'EXECUTE'), 'named API roles can execute RPC');
    end loop;
  end loop;
  foreach v_role in array array['anon', 'authenticated'] loop
    perform pg_temp.booking_assert(not has_function_privilege(v_role, 'private.set_booking_end_time()', 'EXECUTE')
      and not has_function_privilege(v_role, 'private.validate_salon_booking_settings()', 'EXECUTE'), 'helper execution is not public');
    perform pg_temp.booking_assert(not has_table_privilege(v_role, 'public.bookings', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and not has_any_column_privilege(v_role, 'public.bookings', 'UPDATE,REFERENCES'), 'no direct mutation or unrestricted insert privileges');
    perform pg_temp.booking_assert(has_table_privilege(v_role, 'public.bookings', 'SELECT') = (v_role = 'authenticated')
      and has_any_column_privilege(v_role, 'public.bookings', 'SELECT') = (v_role = 'authenticated'), 'booking SELECT grant requires authenticated role and RLS');
    perform pg_temp.booking_assert(not has_table_privilege(v_role, 'private.salon_booking_settings', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'settings are private');
    execute format('set local role %I', v_role);
    perform pg_temp.booking_assert((select count(*) = 1 from public.get_booking_config()), 'client can get configuration');
    perform 1 from public.get_available_slots(v_short, v_day);
    select * into strict v_retry from public.create_booking(v_booking_id, v_long, v_start, 'Synthetic Guest', '+1 (202) 555.0100');
    perform pg_temp.booking_assert(v_retry.id = v_booking_id, 'both API roles can retry only a matching receipt');
    if v_role = 'anon' then
      perform pg_temp.booking_expect_error('select * from public.bookings', '42501');
    else
      perform pg_temp.booking_assert((select count(*) = 0 from public.bookings), 'ordinary authenticated users cannot read bookings through RLS');
    end if;
    perform pg_temp.booking_expect_error('select * from private.salon_booking_settings', '42501');
    perform pg_temp.booking_expect_error(format('insert into public.bookings (service_id,slot_time,customer_name,phone,status) values (%L,%L,%L,%L,%L)',
      v_short, v_start, 'Forbidden Status', '1234567', 'cancelled'), '42501');
    perform pg_temp.booking_expect_error('update public.bookings set status = ''cancelled''', '42501');
    perform pg_temp.booking_expect_error('delete from public.bookings', '42501');
    perform pg_temp.booking_expect_error(format('select * from public.create_booking(%L,%L,%L,%L,%L)',
      v_booking_id, v_long, v_start, 'Wrong Guest', '+1 (202) 555.0100'), '22023', 'REQUEST_MISMATCH');
    reset role;
  end loop;

  raise notice 'Booking RPC regression checks passed; fixtures will be rolled back.';
end;
$$;

rollback;
