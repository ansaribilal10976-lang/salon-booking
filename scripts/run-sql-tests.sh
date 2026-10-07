#!/usr/bin/env bash
# Destructive fixture tests: disposable local database ONLY. Never auto-run races.
set -euo pipefail
TESTDB="${TESTDB:-}"

if [[ -z "${TESTDB//[[:space:]]/}" ]]; then
  printf '%s\n' 'Refusing SQL tests: TESTDB must identify a disposable local database.' >&2
  exit 1
fi
if [[ "${TESTDB,,}" == *ytlmlixldsxfaveaokkv* ]]; then
  printf '%s\n' 'Refusing SQL tests: TESTDB contains the forbidden live project reference.' >&2
  exit 1
fi

# Fail closed on ambiguous libpq conninfo, multi-hosts, services, Unix sockets,
# remote hosts and URI query parameters that could override the target. Never
# print the URI (it may contain a password). Use the existing Node toolchain.
node - "$TESTDB" <<'NODE'
const fail = () => {
  console.error('Refusing SQL tests: use a postgres:// or postgresql:// URI with an explicit loopback host and database; target overrides are forbidden.');
  process.exit(1);
};
try {
  const raw = process.argv[2];
  if (/\s/.test(raw) || /[\x00-\x1f\x7f]/.test(raw)) fail();
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
    || url.hash || !url.pathname.startsWith('/')
    || !decodeURIComponent(url.pathname.slice(1)).trim()
    || url.pathname.slice(1).includes('/')) fail();
  // A percent-encoded live ref must not evade the literal shell check.
  if (decodeURIComponent(raw).toLowerCase().includes('ytlmlixldsxfaveaokkv')) fail();
  for (const key of url.searchParams.keys()) {
    if (!['sslmode', 'connect_timeout', 'application_name'].includes(key)) fail();
  }
} catch {
  fail();
}
NODE

# Ignore startup scripts and inherited target defaults (notably PGHOSTADDR,
# which libpq could use even alongside a hostname). Do not prompt for passwords.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGSERVICE PGSERVICEFILE
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
for file in "$repo_root"/supabase/tests/*.sql; do
  if [[ "$(basename -- "$file")" == booking_concurrency.sql ]]; then
    continue
  fi
  printf 'Running %s\n' "${file#"$repo_root/"}"
  psql -X -w "$TESTDB" -v ON_ERROR_STOP=1 -f "$file"
done

printf '%s\n' \
  'Ordinary SQL tests completed. booking_concurrency.sql was NOT executed.' \
  'Manual concurrency instructions (disposable local database only):' \
  '  Read supabase/tests/booking_concurrency.sql first; setup/winners COMMIT.' \
  '  Run setup, then session a and session b in two terminals during the pause, then cleanup.' \
  '  Separately repeat quota_setup/quota_a/quota_b/quota_cleanup with quota_kind=global, active, window.' \
  '  Each quota setup requires an empty disposable calendar/ledger; always run cleanup.' \
  '  Example: psql "$TESTDB" -X -w -v ON_ERROR_STOP=1 -v phase=setup -f supabase/tests/booking_concurrency.sql'
