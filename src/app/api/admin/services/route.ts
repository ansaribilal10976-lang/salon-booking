import type { NextRequest } from "next/server";
import { adminResponse, authorizeAdminRequest, readAdminJson } from "@/lib/admin-http";
import { saveAdminService } from "@/lib/admin-operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.authorized) return auth.response;
  const input = await readAdminJson(request);
  if (!input.valid) return input.response;
  const result = await saveAdminService(input.value, null, async (values) =>
    await auth.supabase.from("services").insert(values).select("id, name, duration, price")
      .abortSignal(AbortSignal.timeout(10000)),
  );
  return adminResponse(result);
}
