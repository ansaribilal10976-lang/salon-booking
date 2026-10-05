import type { Metadata } from "next";
import Link from "next/link";
import { FlowerIcon } from "@/components/icons";
import { salon } from "@/lib/salon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Salon workspace — ${salon.name}`, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#admin-main" className="skip-link">Skip to admin content</a>
      <header className="page-width site-header flex flex-wrap items-center justify-between gap-3 border-b border-line py-5">
        <Link href="/" className="flex min-h-12 items-center gap-2 text-forest" aria-label={`${salon.name} salon home`}>
          <FlowerIcon className="h-9 w-9" /><span className="font-display text-4xl tracking-[-0.07em]">{salon.name.toLowerCase()}.</span>
        </Link>
        <Link href="/" className="nav-link text-sm">View salon website</Link>
      </header>
      <main id="admin-main" tabIndex={-1} className="page-width pb-16 pt-8 sm:pt-12">{children}</main>
      <footer className="page-width site-footer border-t border-line py-6 text-xs leading-6 text-muted">{salon.name} · Private salon workspace</footer>
    </>
  );
}
