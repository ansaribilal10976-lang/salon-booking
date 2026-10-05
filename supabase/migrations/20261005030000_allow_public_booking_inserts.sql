begin;

-- Preserve admin-only SELECT and existing RPCs; expose only the columns a
-- customer needs to submit an appointment request. IDs/status/end times are
-- database-owned. No anonymous booking SELECT or client UPDATE/DELETE grants.
revoke insert on table public.bookings from public, anon, authenticated;
revoke insert (id, customer_name, phone, service_id, slot_time, end_time, status)
  on table public.bookings from public, anon, authenticated;
grant insert (customer_name, phone, service_id, slot_time)
  on table public.bookings to anon, authenticated;

create policy "Public can submit bookings"
  on public.bookings
  for insert
  to anon, authenticated
  with check (status = 'pending'::public.booking_status);

-- Direct inserts must not bypass the RPC's schedule/contact checks. Definer
-- access is needed to read private salon settings without granting their use
-- to customers. Invocation remains trigger-only, with a fixed search path.
create function private.validate_public_booking_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(nullif(pg_catalog.current_setting('role', true), 'none'), session_user::text);
  v_time_zone text;
  v_today date;
  v_local_start timestamp;
  v_duration integer;
  v_now timestamptz;
begin
  -- Owner/service-role maintenance remains possible (e.g. importing historic
  -- bookings). SECURITY DEFINER RPCs keep the original SET ROLE value, so their
  -- API-origin inserts are checked here as well. No user-supplied metadata or
  -- request claim is used to decide whether validation is required.
  if v_role not in ('anon', 'authenticated') then
    return new;
  end if;

  new.customer_name := pg_catalog.btrim(new.customer_name);
  new.phone := pg_catalog.btrim(new.phone);
  if new.service_id is null or new.slot_time is null
     or not pg_catalog.isfinite(new.slot_time)
     or new.customer_name is null
     or pg_catalog.char_length(new.customer_name) not between 2 and 100
     or new.customer_name ~ '[[:cntrl:]]'
     or new.phone is null or pg_catalog.char_length(new.phone) > 32
     or new.phone !~ '^[0-9+(). -]+$'
     or pg_catalog.char_length(pg_catalog.regexp_replace(new.phone, '[^0-9]', '', 'g')) not between 7 and 15
     or new.status not in ('pending', 'confirmed') then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING_INPUT';
  end if;

  select settings.time_zone into strict v_time_zone
  from private.salon_booking_settings as settings where settings.singleton for share;
  select service.duration into v_duration
  from public.services as service where service.id = new.service_id for share;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_SERVICE';
  end if;

  -- BEFORE triggers run in name order. The duration trigger already ran; derive
  -- again while holding the service lock to prevent a concurrent duration edit
  -- from shortening the interval the customer actually reserves.
  new.end_time := new.slot_time + pg_catalog.make_interval(mins => v_duration);
  v_now := pg_catalog.clock_timestamp();
  v_today := (v_now at time zone v_time_zone)::date;
  v_local_start := new.slot_time at time zone v_time_zone;
  if new.slot_time <= v_now then
    raise exception using errcode = '23P01', message = 'SLOT_UNAVAILABLE';
  end if;
  if v_local_start::date < v_today or v_local_start::date > v_today + 90
     or v_local_start::time < time '10:00' or v_local_start::time > time '19:30'
     or extract(minute from v_local_start) not in (0, 30)
     or extract(second from v_local_start) <> 0
     or (v_local_start at time zone v_time_zone) <> new.slot_time
     or new.end_time > (v_local_start::date + time '20:00') at time zone v_time_zone then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING_INPUT';
  end if;

  -- Existing bookings_no_overlap is the race-safe enforcement layer for both
  -- direct inserts and RPC reservations; don't expose private rows to check it.
  return new;
end;
$$;
revoke all on function private.validate_public_booking_insert() from public, anon, authenticated;

create trigger bookings_validate_public_insert
before insert on public.bookings
for each row execute function private.validate_public_booking_insert();

comment on policy "Public can submit bookings" on public.bookings is
  'Guests and ordinary authenticated users can submit pending requests using customer fields only. Customer records remain admin-readable only.';

commit;
