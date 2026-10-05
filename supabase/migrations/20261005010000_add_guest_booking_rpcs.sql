begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.salon_booking_settings (
  singleton boolean primary key default true check (singleton),
  time_zone text not null default 'UTC'
);
alter table private.salon_booking_settings enable row level security;
revoke all on table private.salon_booking_settings from public, anon, authenticated;

comment on column private.salon_booking_settings.time_zone is
  'Editable IANA salon timezone. UTC is a configuration default, not an inferred salon location. Set this before accepting bookings.';

create function private.validate_salon_booking_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.time_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names as zone where zone.name = new.time_zone
  ) then
    raise exception using errcode = '22023', message = 'INVALID_SALON_TIME_ZONE';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_salon_booking_settings() from public, anon, authenticated;

create trigger salon_booking_settings_validate
before insert or update on private.salon_booking_settings
for each row execute function private.validate_salon_booking_settings();

insert into private.salon_booking_settings (singleton, time_zone) values (true, 'UTC');

alter table public.bookings add column end_time timestamptz;
update public.bookings as booking
set end_time = booking.slot_time + pg_catalog.make_interval(mins => service.duration)
from public.services as service
where service.id = booking.service_id;
alter table public.bookings alter column end_time set not null;
alter table public.bookings add constraint bookings_end_after_start check (end_time > slot_time);

comment on column public.bookings.end_time is
  'Duration snapshot at reservation time. Recomputed only when service_id or slot_time changes; later service edits do not move existing appointments.';

create function private.set_booking_end_time()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_duration integer;
begin
  if tg_op = 'INSERT' then
    -- Always derive the snapshot; callers cannot choose a shorter duration.
    select service.duration into v_duration from public.services as service where service.id = new.service_id;
    if not found and new.service_id is not null then
      raise exception using errcode = '23503', message = 'INVALID_SERVICE';
    end if;
    new.end_time := new.slot_time + pg_catalog.make_interval(mins => v_duration);
  elsif new.service_id is distinct from old.service_id or new.slot_time is distinct from old.slot_time then
    select service.duration into v_duration from public.services as service where service.id = new.service_id;
    if not found and new.service_id is not null then
      raise exception using errcode = '23503', message = 'INVALID_SERVICE';
    end if;
    new.end_time := new.slot_time + pg_catalog.make_interval(mins => v_duration);
  elsif new.end_time is distinct from old.end_time then
    raise exception using errcode = '23514', message = 'BOOKING_END_TIME_IS_DERIVED';
  end if;
  return new;
end;
$$;
revoke all on function private.set_booking_end_time() from public, anon, authenticated;

create trigger bookings_set_end_time
before insert or update on public.bookings
for each row execute function private.set_booking_end_time();

-- One shared calendar, including pending and completed appointments. Native
-- range GiST support needs no extension. Existing conflicts abort this entire
-- migration: never delete or silently cancel a customer's reservation.
alter table public.bookings add constraint bookings_no_overlap
exclude using gist (tstzrange(slot_time, end_time, '[)') with &&)
where (status <> 'cancelled'::public.booking_status);

-- Preserve the existing table-level privacy boundary and its lack of policies.
revoke all on table public.bookings from public, anon, authenticated;

create function public.get_booking_config()
returns table (time_zone text, min_date date, max_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select settings.time_zone,
         (pg_catalog.statement_timestamp() at time zone settings.time_zone)::date,
         (pg_catalog.statement_timestamp() at time zone settings.time_zone)::date + 90
  from private.salon_booking_settings as settings
  where settings.singleton;
$$;
revoke all on function public.get_booking_config() from public, anon, authenticated;
grant execute on function public.get_booking_config() to anon, authenticated;

create function public.get_available_slots(p_service_id uuid, p_date date)
returns table (slot_time timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_time_zone text;
  v_today date;
  v_duration integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select settings.time_zone into strict v_time_zone
  from private.salon_booking_settings as settings where settings.singleton;
  v_today := (v_now at time zone v_time_zone)::date;

  if p_service_id is null or p_date is null or not pg_catalog.isfinite(p_date)
     or p_date < v_today or p_date > v_today + 90 then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING_INPUT';
  end if;

  select service.duration into v_duration from public.services as service where service.id = p_service_id;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_SERVICE';
  end if;

  return query
  with candidates as (
    select p_date + time '10:00' + step.n * interval '30 minutes' as local_start
    from pg_catalog.generate_series(0, 19) as step(n)
  ), instants as (
    select candidate.local_start, candidate.local_start at time zone v_time_zone as start_at
    from candidates as candidate
  )
  select instant.start_at
  from instants as instant
  where instant.start_at > v_now
    -- Skip nonexistent wall times in timezones with a daytime offset change.
    and (instant.start_at at time zone v_time_zone) = instant.local_start
    and instant.start_at + pg_catalog.make_interval(mins => v_duration)
        <= (p_date + time '20:00') at time zone v_time_zone
    and not exists (
      select 1 from public.bookings as booking
      where booking.status <> 'cancelled'::public.booking_status
        and pg_catalog.tstzrange(booking.slot_time, booking.end_time, '[)')
            && pg_catalog.tstzrange(instant.start_at,
                 instant.start_at + pg_catalog.make_interval(mins => v_duration), '[)')
    )
  order by instant.start_at;
end;
$$;
revoke all on function public.get_available_slots(uuid, date) from public, anon, authenticated;
grant execute on function public.get_available_slots(uuid, date) to anon, authenticated;

create function public.create_booking(
  p_booking_id uuid,
  p_service_id uuid,
  p_slot_time timestamptz,
  p_customer_name text,
  p_phone text
)
returns table (
  id uuid,
  service_id uuid,
  customer_name text,
  phone text,
  slot_time timestamptz,
  end_time timestamptz,
  status public.booking_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(p_customer_name);
  v_phone text := pg_catalog.btrim(p_phone);
  v_time_zone text;
  v_today date;
  v_local_start timestamp;
  v_duration integer;
  v_end_time timestamptz;
  v_booking public.bookings%rowtype;
begin
  if p_booking_id is null then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING_INPUT';
  end if;

  -- Serialize retries of the same client UUID before looking up a receipt.
  -- Hash collisions only serialize unrelated requests; they never grant access.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_booking_id::text, 0));
  select booking.* into v_booking from public.bookings as booking where booking.id = p_booking_id for share;
  if found and (v_booking.service_id is distinct from p_service_id
       or v_booking.slot_time is distinct from p_slot_time
       or v_booking.customer_name is distinct from v_name
       or v_booking.phone is distinct from v_phone) then
    raise exception using errcode = '22023', message = 'REQUEST_MISMATCH';
  end if;

  if p_service_id is null or p_slot_time is null
     or not pg_catalog.isfinite(p_slot_time)
     or v_name is null or pg_catalog.char_length(v_name) not between 2 and 100
     or v_name ~ '[[:cntrl:]]'
     or v_phone is null or pg_catalog.char_length(v_phone) > 32
     or v_phone !~ '^[0-9+(). -]+$'
     or pg_catalog.char_length(pg_catalog.regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING_INPUT';
  end if;

  if v_booking.id is not null then
    -- An exact, normalized retry succeeds even after its appointment has passed,
    -- been cancelled, or its service duration/configuration has since changed.
    return query select v_booking.id, v_booking.service_id, v_booking.customer_name,
      v_booking.phone, v_booking.slot_time, v_booking.end_time, v_booking.status;
    return;
  end if;

  -- Keep configuration and duration stable through validation and the insert.
  select settings.time_zone into strict v_time_zone
  from private.salon_booking_settings as settings where settings.singleton for share;
  select service.duration into v_duration
  from public.services as service where service.id = p_service_id for share;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_SERVICE';
  end if;

  v_today := (pg_catalog.clock_timestamp() at time zone v_time_zone)::date;
  v_local_start := p_slot_time at time zone v_time_zone;
  v_end_time := p_slot_time + pg_catalog.make_interval(mins => v_duration);

  if p_slot_time <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '23P01', message = 'SLOT_UNAVAILABLE';
  end if;
  if v_local_start::date < v_today or v_local_start::date > v_today + 90
     or v_local_start::time < time '10:00' or v_local_start::time > time '19:30'
     or extract(minute from v_local_start) not in (0, 30)
     or extract(second from v_local_start) <> 0
     or (v_local_start at time zone v_time_zone) <> p_slot_time
     or v_end_time > (v_local_start::date + time '20:00') at time zone v_time_zone then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING_INPUT';
  end if;

  if exists (
    select 1 from public.bookings as booking
    where booking.status <> 'cancelled'::public.booking_status
      and pg_catalog.tstzrange(booking.slot_time, booking.end_time, '[)')
          && pg_catalog.tstzrange(p_slot_time, v_end_time, '[)')
  ) then
    raise exception using errcode = '23P01', message = 'SLOT_UNAVAILABLE';
  end if;

  begin
    insert into public.bookings as booking (id, service_id, customer_name, phone, slot_time, status)
    values (p_booking_id, p_service_id, v_name, v_phone, p_slot_time, 'confirmed')
    returning booking.* into v_booking;
  exception
    -- The exclusion constraint, not the earlier availability read, decides
    -- concurrent claims (including different services and different start times).
    when exclusion_violation then
      raise exception using errcode = '23P01', message = 'SLOT_UNAVAILABLE';
    when unique_violation then
      -- Also handle a privileged writer that did not take the advisory lock.
      select booking.* into v_booking from public.bookings as booking where booking.id = p_booking_id;
      if not found or v_booking.service_id is distinct from p_service_id
         or v_booking.slot_time is distinct from p_slot_time
         or v_booking.customer_name is distinct from v_name
         or v_booking.phone is distinct from v_phone then
        raise exception using errcode = '22023', message = 'REQUEST_MISMATCH';
      end if;
  end;

  return query select v_booking.id, v_booking.service_id, v_booking.customer_name,
    v_booking.phone, v_booking.slot_time, v_booking.end_time, v_booking.status;
end;
$$;
revoke all on function public.create_booking(uuid, uuid, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, uuid, timestamptz, text, text) to anon, authenticated;

commit;
