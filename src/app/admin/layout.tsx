import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import admin from "./admin.module.css";
import { salon } from "@/lib/salon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Salon workspace — ${salon.name}`, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={admin.shell}>
      <a href="#admin-main" className="skip-link">Skip to admin content</a>
      <header className={admin.header}>
        <div className={`page-width ${admin.headerInner}`}>
          <div className={admin.brand}>
            <Link href="/admin" className={admin.wordmark} aria-label={`${salon.name} workspace home`}>
              {salon.name.toLowerCase()}<span aria-hidden="true">.</span>
            </Link>
            <span className={admin.workspaceLabel}>Salon workspace</span>
          </div>
          <Link href="/" className={admin.siteLink}>View salon website <ArrowUpRight className={admin.icon} aria-hidden="true" /></Link>
        </div>
      </header>
      <main id="admin-main" tabIndex={-1} className={`page-width ${admin.main}`}>{children}</main>
      <footer className={`page-width site-footer ${admin.footer}`}>{salon.name} · Private salon workspace</footer>
    </div>
  );
}
