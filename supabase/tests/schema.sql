-- Run after all migrations, as postgres in a development Supabase SQL Editor.
-- Uses only synthetic fixtures. All changes are rolled back on success.
-- With psql, run with -v ON_ERROR_STOP=1 so any failed assertion fails the command.
begin;
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';

do $$
declare
  v_service_id uuid;
  v_booking_id uuid;
  v_booking public.bookings%rowtype;
  v_price numeric;
  v_status public.booking_status;
  v_role text;
  v_count integer;
begin
  insert into public.services (name, duration, price)
  values ('Schema smoke-test service', 30, 49.50)
  returning id into v_service_id;

  insert into public.bookings (customer_name, phone, service_id, slot_time)
  values ('Schema smoke-test customer', '+1 202-555-0100', v_service_id, '2030-01-15T10:00:00+02:00')
  returning id into v_booking_id;

  select * into v_booking from public.bookings where id = v_booking_id;
  if not found
     or v_booking.customer_name <> 'Schema smoke-test customer'
     or v_booking.phone <> '+1 202-555-0100'
     or v_booking.service_id <> v_service_id
     or v_booking.slot_time <> '2030-01-15T08:00:00Z'::timestamptz
     or v_booking.status <> 'pending' then
    raise exception 'Booking round-trip, timezone, or default status failed';
  end if;

  foreach v_status in array enum_range(null::public.booking_status) loop
    update public.bookings set status = v_status where id = v_booking_id;
  end loop;

  begin
    insert into public.services (name, duration, price) values ('   ', 30, 10);
    raise exception 'Blank service name was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.services (name, duration, price) values ('Invalid duration', 0, 10);
    raise exception 'Zero duration was accepted';
  exception when check_violation then null;
  end;

  foreach v_price in array array[-1::numeric, 'NaN'::numeric] loop
    begin
      insert into public.services (name, duration, price) values ('Invalid price', 30, v_price);
      raise exception 'Invalid price was accepted: %', v_price;
    exception when check_violation then null;
    end;
  end loop;

  begin
    update public.bookings set customer_name = '   ' where id = v_booking_id;
    raise exception 'Blank customer name was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.bookings set phone = '   ' where id = v_booking_id;
    raise exception 'Blank phone was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.bookings set slot_time = null where id = v_booking_id;
    raise exception 'Missing slot time was accepted';
  exception when not_null_violation then null;
  end;

  begin
    update public.bookings set status = 'invalid' where id = v_booking_id;
    raise exception 'Unknown booking status was accepted';
  exception when invalid_text_representation then null;
  end;

  begin
    update public.bookings set service_id = gen_random_uuid() where id = v_booking_id;
    raise exception 'Nonexistent service was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    delete from public.services where id = v_service_id;
    raise exception 'A service with a booking was deleted';
  exception when foreign_key_violation then null;
  end;

  if exists (
    select 1 from pg_class
    where oid in ('public.services'::regclass, 'public.bookings'::regclass)
      and not relrowsecurity
  ) then
    raise exception 'Row-level security must be enabled on both tables';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_role);

    perform 1 from public.services
      where id = v_service_id and name = 'Schema smoke-test service'
        and duration = 30 and price = 49.50;
    if not found then
      raise exception 'Services are not publicly readable for %', v_role;
    end if;

    if v_role = 'anon' then
      begin
        update public.services set price = 1 where id = v_service_id;
        raise exception 'Anonymous clients can change service prices';
      exception when insufficient_privilege then null;
      end;
      begin
        perform 1 from public.bookings where id = v_booking_id;
        raise exception 'Anonymous clients have access to the bookings table';
      exception when insufficient_privilege then null;
      end;
    else
      -- Authenticated grants permit admin reads/writes, but RLS must filter
      -- ordinary users (including an authenticated role with no UID).
      update public.services set price = 1 where id = v_service_id;
      get diagnostics v_count = row_count;
      if v_count <> 0 then
        raise exception 'Non-admin authenticated clients can change service prices';
      end if;
      perform 1 from public.bookings where id = v_booking_id;
      if found then
        raise exception 'Non-admin authenticated clients can read bookings';
      end if;
    end if;

    begin
      insert into public.bookings (customer_name, phone, service_id, slot_time, status)
      values ('Disallowed status write', '+1 202-555-0100', v_service_id, '2030-01-16T08:00:00Z', 'cancelled');
      raise exception 'Client role % can choose a booking status directly', v_role;
    exception when insufficient_privilege then null;
    end;

    reset role;
  end loop;

  raise notice 'Schema smoke checks passed; fixture changes will be rolled back.';
end;
$$;

rollback;
