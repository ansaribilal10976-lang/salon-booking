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
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = request.body?.getReader();
    if (!reader) throw new Error("Missing request body");
    const bytes = new Uint8Array(4096);
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (size + chunk.value.byteLength > bytes.byteLength) {
        // Do not retain the oversized chunk or wait for cancellation to finish.
        // A stalled/failed cancellation must not delay or replace the 413.
        void reader.cancel().catch(() => console.error("api:booking_cancel_failed"));
        return NextResponse.json({ error: "Booking details are too long." }, { status: 413, headers });
      }
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
    input = JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)));
  } catch {
    console.error("api:booking_body_failed");
    return NextResponse.json({ error: "The booking details could not be read. Please try again." }, { status: 400, headers });
  } finally {
    reader?.releaseLock();
  }

  const result = await submitBooking(input, async (values) => {
    const supabase = await createClient();
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
