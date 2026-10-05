-- Regression case: audit #3, reject raw fractional cents before any rounding.
-- Run after ALL five migrations as postgres in a DISPOSABLE development DB.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/services_price.sql
-- Only synthetic services/auth.users/allowlist fixtures; no calendar truncation,
-- real logins or passwords. All fixtures and temporary helpers roll back.
begin;
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';

create function pg_temp.service_price_assert(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'Service price assertion failed: %', p_label;
  end if;
end;
$$;

create function pg_temp.service_price_expect_error(p_sql text, p_state text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state then
      raise exception 'Unexpected state %, expected % for %', sqlstate, p_state, p_sql;
    end if;
    return;
  end;
  raise exception 'Expected state % was not raised for %', p_state, p_sql;
end;
$$;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_service uuid;
  v_saved numeric;
  v_price numeric; -- Unbounded: do not round the regression input in the test.
  v_role text;
  v_count integer;
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 'authenticated', 'authenticated', v_admin::text || '@price-fixture.invalid', '{}', '{}');
  insert into private.salon_admins (user_id) values (v_admin);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Exercise the same raw INSERT/UPDATE paths as owner and as an allowlisted
  -- API role. There is no RPC, JavaScript validation, or fixed-scale test cast.
  foreach v_role in array array['owner', 'authenticated'] loop
    if v_role = 'authenticated' then
      set local role authenticated;
      perform pg_temp.service_price_assert(auth.uid() = v_admin and public.is_admin(), 'direct writer is allowlisted');
    end if;

    -- Inclusive extrema and valid neighbours of 1.239/-0.001. Trailing zeroes
    -- are allowed because 1.2300 is exactly the two-decimal monetary value 1.23.
    foreach v_price in array array[0::numeric, 0.01, 1.23, 1.24, 1.2300, 99999999.98, 99999999.99] loop
      insert into public.services (name, duration, price)
      values ('Raw price regression', 30, v_price)
      returning id, price into v_service, v_saved;
      perform pg_temp.service_price_assert(v_saved = v_price
        and (select price = v_price from public.services where id = v_service), 'INSERT preserves valid value');
      update public.services set price = 0 where id = v_service;
      update public.services set price = v_price where id = v_service;
      get diagnostics v_count = row_count;
      perform pg_temp.service_price_assert(v_count = 1
        and (select price = v_price from public.services where id = v_service), 'UPDATE preserves valid value');
    end loop;

    -- 1.239 and -0.001 both pass the old schema after typemod rounding. This
    -- regression must fail there and reject BOTH raw INSERT and UPDATE here.
    foreach v_price in array array[1.239::numeric, -0.001::numeric, 0.001, -0.01, 99999999.991,
      100000000, 'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric] loop
      perform pg_temp.service_price_expect_error(format(
        'insert into public.services (name,duration,price) values (''Invalid raw price'',30,%L::numeric)', v_price), '23514');
      perform pg_temp.service_price_expect_error(format(
        'update public.services set price = %L::numeric where id = %L', v_price, v_service), '23514');
      perform pg_temp.service_price_assert((select price = 99999999.99 from public.services where id = v_service), 'rejected UPDATE leaves price unchanged');
    end loop;
    perform pg_temp.service_price_expect_error(
      'insert into public.services (name,duration,price) values (''Missing price'',30,null)', '23502');
    perform pg_temp.service_price_expect_error(format(
      'update public.services set price = null where id = %L', v_service), '23502');
    reset role;
  end loop;

  perform pg_temp.service_price_assert((select atttypid = 'numeric'::regtype and atttypmod = -1 and attnotnull
    from pg_attribute where attrelid = 'public.services'::regclass and attname = 'price'), 'price is NOT NULL unbounded numeric');
  perform pg_temp.service_price_assert((select count(*) = 3 and bool_and(convalidated)
    from pg_constraint where conrelid = 'public.services'::regclass and contype = 'c' and conname in
      ('services_price_nonnegative', 'services_price_admin_bounds', 'services_price_two_decimals')), 'all three monetary CHECKs validate existing rows');
  perform pg_temp.service_price_assert((select relrowsecurity from pg_class
    where oid = 'public.services'::regclass), 'service RLS remains enabled');
  raise notice 'Raw service-price INSERT/UPDATE regression passed for owner and allowlisted authenticated role; fixtures will roll back.';
end;
$$;

rollback;
