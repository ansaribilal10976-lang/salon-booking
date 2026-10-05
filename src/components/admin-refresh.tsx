"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function AdminRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" disabled={pending} className="button button-outline w-full sm:w-auto" onClick={() => startTransition(() => router.refresh())} aria-live="polite">
      {pending ? "Refreshing…" : "Refresh dashboard"}
    </button>
  );
}
