import { NextRequest, NextResponse } from "next/server";
import { submitBooking } from "@/lib/booking-operations";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Please book directly through this website." }, { status: 403, headers });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Send booking details as JSON." }, { status: 415, headers });
  }
  if (Number(request.headers.get("content-length")) > 4096) {
    return NextResponse.json({ error: "Booking details are too long." }, { status: 413, headers });
  }
  let input: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4096) {
      return NextResponse.json({ error: "Booking details are too long." }, { status: 413, headers });
    }
    input = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "The booking details could not be read. Please try again." }, { status: 400, headers });
  }

  const result = await submitBooking(input, async (values) => {
    const supabase = createClient();
    return await supabase.rpc("create_booking", {
      p_booking_id: values.bookingId,
      p_service_id: values.serviceId,
      p_slot_time: values.slotTime,
      p_customer_name: values.customerName,
      p_phone: values.phone,
    }).abortSignal(AbortSignal.timeout(10000));
  });
  return NextResponse.json(result.body, { status: result.status, headers });
}
