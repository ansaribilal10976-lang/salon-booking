import type { NextRequest } from "next/server";
import { adminResponse, authorizeAdminRequest, readAdminJson } from "@/lib/admin-http";
import { setAdminBookingStatus } from "@/lib/admin-operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.authorized) return auth.response;
  const input = await readAdminJson(request);
  if (!input.valid) return input.response;
  const result = await setAdminBookingStatus(params.id, input.value, async (id, status) =>
    await auth.supabase.rpc("admin_set_booking_status", { p_booking_id: id, p_status: status })
      .abortSignal(AbortSignal.timeout(10000)),
  );
  return adminResponse(result);
}
