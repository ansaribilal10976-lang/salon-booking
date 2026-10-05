import { NextRequest, NextResponse } from "next/server";
import { getAvailability } from "@/lib/booking-operations";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const result = await getAvailability(
    request.nextUrl.searchParams.get("serviceId"),
    request.nextUrl.searchParams.get("date"),
    async (serviceId, date) => {
      const supabase = createClient();
      return await supabase.rpc("get_available_slots", { p_service_id: serviceId, p_date: date })
        .abortSignal(AbortSignal.timeout(5000));
    },
  );
  return NextResponse.json(result.body, {
    status: result.status, headers: { "Cache-Control": "private, no-store" },
  });
}
