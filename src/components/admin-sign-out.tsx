"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AdminSignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  async function signOut() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const result = await createClient().auth.signOut({ scope: "local" });
      if (result.error) throw new Error("Sign-out failed");
      // A full navigation discards customer data held by the dashboard's client.
      window.location.replace("/admin/login");
    } catch {
      setError("Sign-out could not be completed. Please try again.");
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <div>
      <button type="button" onClick={() => void signOut()} className="button button-outline w-full sm:w-auto" disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>
      {error && <p role="alert" className="field-error max-w-xs">{error}</p>}
    </div>
  );
}
