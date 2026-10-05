begin;

-- numeric(10,2) rounds before CHECK constraints see the input: 1.239 becomes
-- 1.24 and -0.001 becomes 0.00. Remove the typemod, not the monetary limits.
-- Existing prices retain their exact values; no service prices are rewritten.
alter table public.services alter column price type numeric using price::numeric;
alter table public.services
  drop constraint services_price_nonnegative,
  add constraint services_price_nonnegative
    check (price >= 0 and price not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  add constraint services_price_two_decimals
    check (price = pg_catalog.trunc(price, 2));
-- services_price_admin_bounds still enforces the inclusive 99999999.99 maximum.
-- All CHECK constraints are validated, including against existing rows. Extra
-- trailing zeroes (e.g. 1.2300) represent a valid two-decimal monetary value.
comment on column public.services.price is
  'Finite nonnegative amount in the salon currency, not cents; at most two decimal places in value, maximum 99999999.99. Raw fractional cents are rejected, not rounded.';

-- This helper uses only NEW and schema-qualified builtins. It neither reads
-- private data nor elevates the writer's privileges; existing RLS/grants stay.
create function private.normalize_service_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(new.name);
  return new;
end;
$$;
revoke all on function private.normalize_service_name() from public, anon, authenticated;

create trigger services_normalize_name
before insert or update on public.services
for each row execute function private.normalize_service_name();

-- Deliberately normalize existing outer space padding, including padding that
-- the old trimmed-length check allowed to exceed 120 stored characters. Keep
-- internal spaces, IDs, durations, prices and booking snapshots unchanged.
update public.services set name = pg_catalog.btrim(name)
where name is distinct from pg_catalog.btrim(name);

alter table public.services
  drop constraint services_name_admin_bounds,
  add constraint services_name_admin_bounds
    check (pg_catalog.char_length(name) between 1 and 120
      and name = pg_catalog.btrim(name)
      and name !~ '[[:cntrl:]]');
-- btrim removes outer spaces, not controls: tabs/newlines still fail the CHECK.
-- Bound the actual stored name, not merely a trimmed projection of it.
comment on column public.services.name is
  'Outer spaces are trimmed on insert/update. Stored names contain 1-120 characters and no control characters; internal spaces are preserved.';

commit;
