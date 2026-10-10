import "server-only";
import { resolveAdminAccess } from "@/lib/admin-access";
import { createClient } from "@/lib/supabase/server";

export async function getAdminAccess() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {
      supabase: null,
      access: { allowed: false as const, status: 503 as const, error: "Admin login is unavailable until Supabase is configured." },
    };
  }
  try {
    const supabase = await createClient();
    const access = await resolveAdminAccess(
      async () => { const result = await supabase.auth.getUser(); return { user: result.data.user, error: result.error }; },
      async () => await supabase.rpc("is_admin").abortSignal(AbortSignal.timeout(5000)),
    );
    return { supabase, access };
  } catch {
    return {
      supabase: null,
      access: { allowed: false as const, status: 503 as const, error: "Admin access could not be verified. Please try again." },
    };
  }
}
