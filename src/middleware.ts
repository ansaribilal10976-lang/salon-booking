import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  try {
    const supabase = createServerClient<Database>(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          // Pass refreshed cookies to Server Components AND back to the browser.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          response.headers.set("Cache-Control", "private, no-store, max-age=0");
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    // Refresh/verify the token here. Pages/APIs still verify identity and the
    // database allowlist independently; middleware is not authorization.
    await supabase.auth.getUser();
  } catch {
    console.error("middleware:auth_failed");
    if (request.nextUrl.pathname === "/admin/login") return response;
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/admin/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("error", "verification");
    const redirect = NextResponse.redirect(loginUrl);
    redirect.headers.set("Cache-Control", "private, no-store, max-age=0");
    return redirect;
  }
  return response;
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
