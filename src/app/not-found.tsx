import Link from "next/link";
import { salon } from "@/lib/salon";

export default function NotFound() {
  return (
    <main className="page-width flex min-h-[60vh] items-center justify-center py-16">
      <section className="admin-surface w-full max-w-xl p-6 sm:p-10" aria-labelledby="not-found-title">
        <p className="eyebrow">{salon.name}</p>
        <h1 id="not-found-title" className="mt-3 font-display text-4xl leading-tight sm:text-5xl">We couldn’t find that page.</h1>
        <p className="mt-4 text-sm leading-7 text-[var(--muted)]">The link may be out of date, or the page may have moved.</p>
        <Link href="/" className="button button-primary mt-8">Back to the salon</Link>
      </section>
    </main>
  );
}
