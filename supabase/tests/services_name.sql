-- Regression case: audit #5, trim raw service writes and bound STORED names.
-- Run after ALL five migrations as postgres in a DISPOSABLE development DB.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/services_name.sql
-- Only synthetic services/auth.users/allowlist fixtures; no calendar truncation,
-- real logins or passwords. All fixtures and temporary helpers roll back.
begin;
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';

create function pg_temp.service_name_assert(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'Service name assertion failed: %', p_label;
  end if;
end;
$$;

create function pg_temp.service_name_expect_error(p_sql text, p_state text)
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
  v_saved text;
  v_raw text;
  v_role text;
  v_index integer;
  v_count integer;
  v_raw_names text[] := array['  N  ', '  Cut   & Style  ', repeat('n', 119),
    '  ' || repeat('n', 120) || '  ', repeat('界', 120),
    repeat(' ', 10000) || 'Padded service' || repeat(' ', 10000)];
  v_stored_names text[] := array['N', 'Cut   & Style', repeat('n', 119),
    repeat('n', 120), repeat('界', 120), 'Padded service'];
begin
  insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 'authenticated', 'authenticated', v_admin::text || '@name-fixture.invalid', '{}', '{}');
  insert into private.salon_admins (user_id) values (v_admin);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- No RPC/JavaScript trimming. The very first leading/trailing whitespace
  -- INSERT stores '  N  ' on the old schema, so its read-back fails this case.
  foreach v_role in array array['owner', 'authenticated'] loop
    if v_role = 'authenticated' then
      set local role authenticated;
      perform pg_temp.service_name_assert(auth.uid() = v_admin and public.is_admin(), 'direct writer is allowlisted');
    end if;
    for v_index in 1 .. cardinality(v_raw_names) loop
      insert into public.services (name, duration, price)
      values (v_raw_names[v_index], 30, 1)
      returning id, name into v_service, v_saved;
      perform pg_temp.service_name_assert(v_saved = v_stored_names[v_index]
        and (select name = v_stored_names[v_index] and char_length(name) between 1 and 120
          from public.services where id = v_service), 'INSERT stores trimmed name, including huge outer padding');
      update public.services set name = 'Before update' where id = v_service;
      update public.services set name = v_raw_names[v_index] where id = v_service returning name into v_saved;
      get diagnostics v_count = row_count;
      perform pg_temp.service_name_assert(v_count = 1 and v_saved = v_stored_names[v_index]
        and (select name = v_stored_names[v_index] and char_length(name) between 1 and 120
          from public.services where id = v_service), 'UPDATE stores trimmed name and preserves internal spaces');
    end loop;

    -- Empty/blank, the 121-character neighbour, and leading/trailing as well
    -- as internal controls fail. Trimming spaces must not sanitize controls.
    foreach v_raw in array array['', '   ', repeat('n', 121), '  ' || repeat('n', 121) || '  ',
      E'\tName\t', E'Name\n', E'Name\r', E'Service\nName', E'Service\tName', E'Service\x7fName'] loop
      perform pg_temp.service_name_expect_error(format(
        'insert into public.services (name,duration,price) values (%L,30,1)', v_raw), '23514');
      perform pg_temp.service_name_expect_error(format(
        'update public.services set name = %L where id = %L', v_raw, v_service), '23514');
      perform pg_temp.service_name_assert((select name = 'Padded service' from public.services
        where id = v_service), 'rejected UPDATE leaves stored name unchanged');
    end loop;
    perform pg_temp.service_name_expect_error(
      'insert into public.services (name,duration,price) values (null,30,1)', '23502');
    perform pg_temp.service_name_expect_error(format(
      'update public.services set name = null where id = %L', v_service), '23502');
    reset role;
  end loop;

  -- Owner maintenance that disables normalization cannot leave padded or huge
  -- stored names behind. Only this new trigger is disabled, then re-enabled.
  alter table public.services disable trigger services_normalize_name;
  foreach v_raw in array array['  N  ', repeat(' ', 10000) || 'N' || repeat(' ', 10000)] loop
    perform pg_temp.service_name_expect_error(format(
      'insert into public.services (name,duration,price) values (%L,30,1)', v_raw), '23514');
    perform pg_temp.service_name_expect_error(format(
      'update public.services set name = %L where id = %L', v_raw, v_service), '23514');
  end loop;
  alter table public.services enable trigger services_normalize_name;

  perform pg_temp.service_name_assert((select convalidated from pg_constraint
    where conrelid = 'public.services'::regclass and conname = 'services_name_admin_bounds'), 'stored-name CHECK validates existing rows');
  perform pg_temp.service_name_assert((select not prosecdef and 'search_path=""' = any(proconfig)
    from pg_proc where oid = 'private.normalize_service_name()'::regprocedure), 'normalizer is SECURITY INVOKER with empty search_path');
  perform pg_temp.service_name_assert(not has_function_privilege('anon', 'private.normalize_service_name()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.normalize_service_name()', 'EXECUTE'), 'normalization is trigger-only');
  perform pg_temp.service_name_assert(not exists (
    select 1 from pg_proc as proc, lateral aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) as privilege
    where proc.oid = 'private.normalize_service_name()'::regprocedure and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
  ), 'no PUBLIC helper execution');
  perform pg_temp.service_name_assert((select relrowsecurity from pg_class
    where oid = 'public.services'::regclass), 'service RLS remains enabled');
  raise notice 'Raw service-name INSERT/UPDATE regression passed for owner and allowlisted authenticated role; fixtures will roll back.';
end;
$$;

rollback;
