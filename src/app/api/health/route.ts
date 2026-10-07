import * as crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isCalendarDate } from "@/lib/booking-validation";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function healthResponse(status: 200 | 401 | 503) {
  return NextResponse.json({ ok: status === 200 }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

function isValidConfig(data: unknown): boolean {
  if (!Array.isArray(data) || data.length !== 1) return false;
  const config = data[0];
  if (!config || typeof config !== "object" || Array.isArray(config)
    || typeof config.time_zone !== "string" || !config.time_zone
    // Intl also accepts numeric offsets on some runtimes; require a named zone.
    || /^[+-]/.test(config.time_zone)
    || !isCalendarDate(config.min_date) || !isCalendarDate(config.max_date)
    || config.min_date > config.max_date) return false;
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone: config.time_zone }).format();
    return true;
  } catch {
    return false;
  }
}

function hasCronAuthorization(request: NextRequest, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(request.headers.get("Authorization") ?? "", "utf8");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && !hasCronAuthorization(request, secret)) {
    return healthResponse(401);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return healthResponse(503);

  try {
    // Independent of visitor cookies/sessions: use only the public project key.
    const supabase = createClient<Database>(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    });
    const { data, error } = await supabase.rpc("get_booking_config")
      .abortSignal(AbortSignal.timeout(5000));
    return healthResponse(!error && isValidConfig(data) ? 200 : 503);
  } catch {
    // Never return configuration, credentials, or upstream error details.
    return healthResponse(503);
  }
}
