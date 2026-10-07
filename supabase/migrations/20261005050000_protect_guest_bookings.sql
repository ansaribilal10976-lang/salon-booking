begin;

-- The website uses create_booking, never direct INSERT. Close the alternative
-- public write path (column grants survive a table-only REVOKE).
revoke insert on table public.bookings from public, anon, authenticated;
revoke insert (id, customer_name, phone, service_id, slot_time, end_time, status)
  on table public.bookings from public, anon, authenticated;
drop policy "Public can submit bookings" on public.bookings;

-- All three limits live in this private row. The owner can change any/all
-- with one UPDATE, without another migration or an application deployment.
-- They are not exposed by get_booking_config or any public RPC.
alter table private.salon_booking_settings
  add column max_active_future_per_phone integer not null default 5
    check (max_active_future_per_phone > 0),
  add column max_phone_bookings_per_24h integer not null default 5
    check (max_phone_bookings_per_24h > 0),
  add column max_daily_submissions integer not null default 40
    check (max_daily_submissions > 0);

-- Do not invent historical creation times. Active/future checks below include
-- old rows, but submission accounting begins with this migration. No FK: even
-- privileged deletion must not refund recent submission quotas.
create table private.booking_quota_events (
  booking_id uuid primary key,
  phone_key text not null check (phone_key ~ '^[0-9]{7,15}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
    check (pg_catalog.isfinite(created_at))
);
alter table private.booking_quota_events enable row level security;
revoke all on table private.booking_quota_events from public, anon, authenticated;
create index booking_quota_events_phone_time_idx
  on private.booking_quota_events (phone_key, created_at);
create index booking_quota_events_time_idx
  on private.booking_quota_events (created_at);
create index bookings_active_phone_time_idx
  on public.bookings ((pg_catalog.right(pg_catalog.regexp_replace(phone, '[^0-9]', '', 'g'), 10)), slot_time)
  where status in ('pending'::public.booking_status, 'confirmed'::public.booking_status);

comment on table private.booking_quota_events is
  'Private successful-RPC submission ledger. Retries add no event; cancellation does not refund quotas. Expired events are pruned on successful new bookings.';
comment on column private.salon_booking_settings.max_daily_submissions is
  'Global new future reservations per salon-local submission day, across every phone and appointment date. Owner-editable; cancellation does not refund this quota.';

create or replace function public.create_booking(
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
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(p_customer_name);
  v_phone text := pg_catalog.btrim(p_phone);
  v_phone_key text;
  v_settings private.salon_booking_settings%rowtype;
  v_time_zone text;
  v_now timestamptz;
  v_today date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_local_start timestamp;
  v_duration integer;
  v_end_time timestamptz;
  v_booking public.bookings%rowtype;
  v_created boolean := false;
begin
  if p_booking_id is null then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING_INPUT';
  end if;

  -- Retain the original UUID/details receipt contract, including old, cancelled
  -- and elapsed bookings. Hash collisions serialize, never authorize access.
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
    return query select v_booking.id, v_booking.service_id, v_booking.customer_name,
      v_booking.phone, v_booking.slot_time, v_booking.end_time, v_booking.status;
    return;
  end if;

  -- Fresh statement snapshots after the lock are essential to the counters.
  -- PostgREST uses READ COMMITTED. Fail safely rather than count stale snapshots
  -- if a privileged SQL caller chooses another transaction isolation level.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '40001', message = 'BOOKING_REQUIRES_READ_COMMITTED';
  end if;
  -- Two-int advisory locks occupy a namespace distinct from UUID bigint locks.
  -- Serialize *all* new RPC writes so rotating phones cannot race the global
  -- cap. The lock lasts through insert+ledger commit, not merely the count.
  perform pg_catalog.pg_advisory_xact_lock(177001, 1);
  select settings.* into strict v_settings
  from private.salon_booking_settings as settings where settings.singleton for share;
  v_time_zone := v_settings.time_zone;
  select service.duration into v_duration
  from public.services as service where service.id = p_service_id for share;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_SERVICE';
  end if;

  -- Measure the window after any lock wait, with DST-aware local day bounds.
  v_now := pg_catalog.clock_timestamp();
  v_today := (v_now at time zone v_time_zone)::date;
  v_day_start := v_today::timestamp at time zone v_time_zone;
  v_day_end := (v_today + 1)::timestamp at time zone v_time_zone;
  v_local_start := p_slot_time at time zone v_time_zone;
  v_end_time := p_slot_time + pg_catalog.make_interval(mins => v_duration);
  -- Match the last ten digits so country prefixes and harmless leading digits
  -- do not create unlimited quota identities. The 7-15 digit input validation
  -- and ledger check still reject too-short/too-long phone inputs.
  v_phone_key := pg_catalog.right(pg_catalog.regexp_replace(v_phone, '[^0-9]', '', 'g'), 10);

  if p_slot_time <= v_now then
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

  -- Pruning is housekeeping, not the expiry mechanism: queries independently
  -- bound their timestamps. Never delete an event still in either window.
  delete from private.booking_quota_events as event
  where event.created_at <= v_now - interval '24 hours'
    and event.created_at < v_day_start;

  if (select count(*) from public.bookings as booking
      where booking.status in ('pending', 'confirmed') and booking.slot_time > v_now
        and pg_catalog.right(pg_catalog.regexp_replace(booking.phone, '[^0-9]', '', 'g'), 10) = v_phone_key)
      >= v_settings.max_active_future_per_phone then
    raise exception using errcode = 'PT429', message = 'PHONE_ACTIVE_LIMIT';
  end if;
  if (select count(*) from private.booking_quota_events as event
      where event.phone_key = v_phone_key and event.created_at > v_now - interval '24 hours')
      >= v_settings.max_phone_bookings_per_24h then
    raise exception using errcode = 'PT429', message = 'PHONE_WINDOW_LIMIT';
  end if;
  if (select count(*) from private.booking_quota_events as event
      where event.created_at >= v_day_start and event.created_at < v_day_end)
      >= v_settings.max_daily_submissions then
    raise exception using errcode = 'PT429', message = 'GLOBAL_SUBMISSION_LIMIT';
  end if;

  begin
    insert into public.bookings as booking (id, service_id, customer_name, phone, slot_time, status)
    values (p_booking_id, p_service_id, v_name, v_phone, p_slot_time, 'confirmed')
    returning booking.* into v_booking;
    v_created := true;
  exception
    -- The exclusion constraint remains the final overlap boundary, including
    -- writes from trusted owner maintenance outside this RPC.
    when exclusion_violation then
      raise exception using errcode = '23P01', message = 'SLOT_UNAVAILABLE';
    when unique_violation then
      select booking.* into v_booking from public.bookings as booking where booking.id = p_booking_id;
      if not found or v_booking.service_id is distinct from p_service_id
         or v_booking.slot_time is distinct from p_slot_time
         or v_booking.customer_name is distinct from v_name
         or v_booking.phone is distinct from v_phone then
        raise exception using errcode = '22023', message = 'REQUEST_MISMATCH';
      end if;
  end;

  if v_created then
    insert into private.booking_quota_events (booking_id, phone_key, created_at)
    values (p_booking_id, v_phone_key, v_now);
  end if;
  return query select v_booking.id, v_booking.service_id, v_booking.customer_name,
    v_booking.phone, v_booking.slot_time, v_booking.end_time, v_booking.status;
end;
$$;
revoke all on function public.create_booking(uuid, uuid, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, uuid, timestamptz, text, text) to anon, authenticated;

commit;
