import type { NextRequest } from "next/server";
import { adminResponse, authorizeAdminRequest, readAdminJson } from "@/lib/admin-http";
import { deleteAdminService, saveAdminService } from "@/lib/admin-operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.authorized) return auth.response;
  const input = await readAdminJson(request);
  if (!input.valid) return input.response;
  const { id } = await params;
  const result = await saveAdminService(input.value, id, async (values, id) =>
    await auth.supabase.from("services").update(values).eq("id", id!)
      .select("id, name, duration, price").abortSignal(AbortSignal.timeout(10000)),
  );
  return adminResponse(result);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.authorized) return auth.response;
  const { id } = await params;
  const result = await deleteAdminService(id, async (id) =>
    await auth.supabase.from("services").delete().eq("id", id).select("id")
      .abortSignal(AbortSignal.timeout(10000)),
  );
  return adminResponse(result);
}
