import type { Metadata } from "next";
import Link from "next/link";
import { FlowerIcon } from "@/components/icons";
import { salon } from "@/lib/salon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Salon workspace — ${salon.name}`, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--sand)]">
      <a href="#admin-main" className="skip-link">Skip to admin content</a>
      <header className="border-b border-[var(--ink)]/20 bg-[var(--ink)] text-[var(--cream)]">
        <div className="page-width flex min-h-[82px] items-center justify-between gap-4">
          <Link href="/admin" className="flex min-h-12 items-center gap-3" aria-label={`${salon.name} workspace home`}><span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--blush)] text-[var(--blush)]"><FlowerIcon className="h-6 w-6" /></span><span className="font-display text-[2rem] leading-none tracking-[-0.08em]">{salon.name.toLowerCase()}<span className="text-[var(--blush)]">.</span></span><span className="hidden border-l border-[var(--cream)]/25 pl-3 text-[10px] uppercase tracking-[0.17em] text-[var(--cream)]/60 sm:inline">Studio workspace</span></Link>
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--cream)]/75 transition-colors hover:text-[var(--cream)]">View salon website <span aria-hidden="true">↗</span></Link>
        </div>
      </header>
      <main id="admin-main" tabIndex={-1} className="page-width pb-20 pt-10 sm:pt-14">{children}</main>
      <footer className="page-width site-footer border-t border-[var(--line)] py-7 text-xs leading-6 text-[var(--muted)]">{salon.name} · Private salon workspace</footer>
    </div>
  );
}
