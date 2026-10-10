"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowIcon } from "@/components/icons";
import { isAdminPasswordInput } from "@/lib/admin-validation";
import { createClient } from "@/lib/supabase/client";

export function AdminLogin({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);

  async function signIn() {
    if (pendingRef.current || !configured) return;
    setError("");
    if (!isAdminPasswordInput(email, password)) { setError("Enter your email address and password."); return; }
    pendingRef.current = true; setPending(true);
    try {
      const supabase = createClient();
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setPassword("");
      if (result.error || !result.data.user) { setError("Sign-in failed. Check your email and password, or try again shortly."); return; }
      const admin = await supabase.rpc("is_admin").abortSignal(AbortSignal.timeout(5000));
      if (admin.error || admin.data === null) { setError("You’re signed in, but admin access could not be verified. Please try again."); return; }
      router.replace(admin.data === true ? "/admin" : "/admin/access-denied"); router.refresh();
    } catch { setPassword(""); setError("We couldn’t reach the sign-in service. Please try again."); }
    finally { pendingRef.current = false; setPending(false); }
  }

  return <form onSubmit={(event) => { event.preventDefault(); void signIn(); }} className="mt-8" aria-busy={pending}>{!configured && <p role="status" className="booking-alert mb-6">Admin sign-in is unavailable until the complete Supabase project configuration is added.</p>}{error && <p role="alert" className="booking-alert mb-6">{error}</p>}<fieldset disabled={pending || !configured} className="min-w-0 space-y-5"><legend className="sr-only">Administrator sign-in</legend><div><label htmlFor="admin-email" className="booking-label">Email address</label><input id="admin-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} className="booking-input mt-2" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></div><div><label htmlFor="admin-password" className="booking-label">Password</label><input id="admin-password" name="password" type="password" autoComplete="current-password" className="booking-input mt-2" required maxLength={4096} value={password} onChange={(event) => setPassword(event.target.value)} /></div><button type="submit" disabled={pending || !configured} className="button button-primary w-full">{pending ? "Signing in…" : "Sign in"}{!pending && <ArrowIcon className="h-4 w-4" />}</button></fieldset><p className="mt-5 text-xs leading-6 text-[var(--muted)]">Use your salon-approved Supabase account. Public account creation does not grant admin access. For access or a password reset, contact the account owner.</p></form>;
}
