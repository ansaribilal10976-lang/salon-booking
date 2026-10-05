begin;

-- Only the database owner provisions admins, using an existing auth.users ID.
-- Password/email authentication or editable user_metadata is not authorization.
create table private.salon_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table private.salon_admins enable row level security;
revoke all on table private.salon_admins from public, anon, authenticated;

comment on table private.salon_admins is
  'Owner-managed admin allowlist. Manually insert an existing auth.users ID; never expose provisioning to API roles or infer it from user_metadata.';

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.salon_admins as admin
    where admin.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- Validated constraints intentionally abort for incompatible existing rows.
-- No customer data or services are silently rewritten or removed.
alter table public.services add constraint services_name_admin_bounds
  check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 120
    and name !~ '[[:cntrl:]]');
alter table public.services add constraint services_duration_admin_bounds
  check (duration between 1 and 600);
alter table public.services add constraint services_price_admin_bounds
  check (price <= 99999999.99);
-- The original numeric(10,2), nonnegative, and no-NaN constraints remain.

revoke all on table public.services from public, anon, authenticated;
grant select on table public.services to anon, authenticated;
-- Column privileges exclude id, even for allowlisted administrators.
grant insert (name, duration, price), update (name, duration, price)
  on table public.services to authenticated;
grant delete on table public.services to authenticated;

-- Retain the existing public service SELECT policy.
create policy "Admins can insert services"
  on public.services for insert to authenticated
  with check ((select public.is_admin()));
create policy "Admins can update services"
  on public.services for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "Admins can delete services"
  on public.services for delete to authenticated
  using ((select public.is_admin()));

revoke all on table public.bookings from public, anon, authenticated;
grant select on table public.bookings to authenticated;
create policy "Admins can read bookings"
  on public.bookings for select to authenticated
  using ((select public.is_admin()));
-- No direct client booking write privileges or write policies. The guest RPC
-- remains available; admin status changes go through the locked RPC below.

create function public.list_admin_bookings(
  p_view text,
  p_offset integer default 0,
  p_limit integer default 51
)
returns table (
  id uuid,
  customer_name text,
  phone text,
  service_id uuid,
  service_name text,
  slot_time timestamptz,
  end_time timestamptz,
  status public.booking_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_time_zone text;
  v_today date;
  v_today_start timestamp;
  v_tomorrow_start timestamp;
begin
  -- Gate before validating input or inspecting any booking/customer data.
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  if p_view is null or p_view not in ('today', 'upcoming')
     or p_offset is null or p_offset not between 0 and 10000
     or p_limit is null or p_limit not between 1 and 51 then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_BOOKING_INPUT';
  end if;

  select settings.time_zone into strict v_time_zone
  from private.salon_booking_settings as settings where settings.singleton;
  v_today := (pg_catalog.statement_timestamp() at time zone v_time_zone)::date;
  -- Compare salon wall times to local midnights, not a fixed 24-hour instant
  -- range. This also includes BOTH occurrences of a repeated midnight (e.g.
  -- America/Havana); converting an ambiguous midnight to one instant would
  -- silently exclude the earlier occurrence on a DST fallback day.
  v_today_start := v_today::timestamp;
  v_tomorrow_start := (v_today + 1)::timestamp;

  return query
  select booking.id, booking.customer_name, booking.phone, booking.service_id,
         service.name, booking.slot_time, booking.end_time, booking.status
  from public.bookings as booking
  join public.services as service on service.id = booking.service_id
  where (p_view = 'today'
           and (booking.slot_time at time zone v_time_zone) >= v_today_start
           and (booking.slot_time at time zone v_time_zone) < v_tomorrow_start)
     or (p_view = 'upcoming'
           and (booking.slot_time at time zone v_time_zone) >= v_tomorrow_start)
  order by booking.slot_time, booking.id
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.list_admin_bookings(text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_admin_bookings(text, integer, integer) to authenticated;

create function public.admin_set_booking_status(
  p_booking_id uuid,
  p_status public.booking_status
)
returns table (
  id uuid,
  customer_name text,
  phone text,
  service_id uuid,
  slot_time timestamptz,
  end_time timestamptz,
  status public.booking_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  if p_booking_id is null then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING_INPUT';
  end if;
  if p_status is null or p_status not in ('confirmed', 'cancelled') then
    raise exception using errcode = '22023', message = 'INVALID_BOOKING_STATUS';
  end if;

  -- Serialize changes to this row so a concurrent cancellation cannot reopen it.
  select booking.* into v_booking
  from public.bookings as booking where booking.id = p_booking_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'BOOKING_NOT_FOUND';
  end if;

  if v_booking.status is distinct from p_status then
    if v_booking.status not in ('pending', 'confirmed') then
      raise exception using errcode = '22023', message = 'BOOKING_STATUS_FINAL';
    end if;
    update public.bookings as booking set status = p_status
    where booking.id = v_booking.id returning booking.* into v_booking;
  end if;
  -- Exact confirmed/cancelled retries return the unchanged receipt.
  return query select v_booking.id, v_booking.customer_name, v_booking.phone,
    v_booking.service_id, v_booking.slot_time, v_booking.end_time, v_booking.status;
end;
$$;
revoke all on function public.admin_set_booking_status(uuid, public.booking_status) from public, anon, authenticated;
grant execute on function public.admin_set_booking_status(uuid, public.booking_status) to authenticated;

commit;
