import { NextResponse, type NextRequest } from "next/server";
import { getAdminAccess } from "@/lib/admin-server";
import { runAdminOperation } from "@/lib/admin-access";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export function adminResponse(result: { status: number; body: unknown }) {
  return NextResponse.json(result.body, { status: result.status, headers: privateHeaders });
}

export async function authorizeAdminRequest(request: NextRequest) {
  // All admin handlers are mutations. Cookies must not authorize cross-site
  // requests; browser fetches send their Origin. Missing origins fail closed.
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return { authorized: false as const, response: adminResponse({ status: 403, body: { error: "Make changes directly from the admin dashboard." } }) };
  }
  const result = await getAdminAccess();
  const decision = await runAdminOperation(result.access, async () => {
    if (!result.supabase) return { status: 503 as const, body: { error: "Admin access is unavailable." } };
    return { status: 200 as const, body: null, supabase: result.supabase };
  });
  if (decision.status !== 200 || !("supabase" in decision)) {
    return { authorized: false as const, response: adminResponse(decision) };
  }
  return { authorized: true as const, supabase: decision.supabase };
}

export async function readAdminJson(request: NextRequest): Promise<
  { valid: true; value: unknown } | { valid: false; response: NextResponse }
> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { valid: false, response: adminResponse({ status: 415, body: { error: "Send service or booking details as JSON." } }) };
  }
  const reader = request.body?.getReader();
  if (!reader) return { valid: false, response: adminResponse({ status: 400, body: { error: "The update could not be read." } }) };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return { valid: false, response: adminResponse({ status: 413, body: { error: "The update is too large." } }) };
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { valid: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { valid: false, response: adminResponse({ status: 400, body: { error: "The update could not be read. Please try again." } }) };
  } finally {
    reader.releaseLock();
  }
}
