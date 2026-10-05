begin;

create type public.booking_status as enum (
  'pending',
  'confirmed',
  'completed',
  'cancelled'
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint services_name_not_blank check (btrim(name) <> ''),
  duration integer not null constraint services_duration_positive check (duration > 0),
  price numeric(10, 2) not null constraint services_price_nonnegative
    check (price >= 0 and price <> 'NaN'::numeric)
);

comment on column public.services.duration is 'Service duration in whole minutes.';
comment on column public.services.price is 'Amount in the salon currency, not minor units (cents).';

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null constraint bookings_customer_name_not_blank
    check (btrim(customer_name) <> ''),
  phone text not null constraint bookings_phone_not_blank check (btrim(phone) <> ''),
  service_id uuid not null constraint bookings_service_id_fkey
    references public.services (id) on delete restrict,
  slot_time timestamptz not null,
  status public.booking_status not null default 'pending'
);

comment on column public.bookings.phone is 'Text preserves country codes, formatting, and leading zeros.';
comment on column public.bookings.slot_time is 'Appointment start instant; submit a timestamp with a timezone offset.';

create index bookings_service_id_idx on public.bookings (service_id);
create index bookings_slot_time_idx on public.bookings (slot_time);

alter table public.services enable row level security;
alter table public.bookings enable row level security;

-- Supabase may grant default table privileges to its API roles. Start with
-- explicit least-privilege access so customer contact data remains private.
revoke all privileges on table public.services, public.bookings from public, anon, authenticated;
grant select on table public.services to anon, authenticated;

create policy "Services are publicly readable"
  on public.services
  for select
  to anon, authenticated
  using (true);

-- No booking policies or client write grants yet. Authenticated customer/admin
-- access needs an ownership model in Phase 2, not a blanket public policy.

commit;
