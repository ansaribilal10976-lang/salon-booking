"use client";

import "./globals.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="page-width flex min-h-screen items-center justify-center py-16">
          <section className="admin-surface w-full max-w-xl p-6 sm:p-10" aria-labelledby="global-error-title">
            <p className="eyebrow">A temporary interruption</p>
            <h1 id="global-error-title" className="mt-3 font-display text-4xl leading-tight sm:text-5xl">The salon website is unavailable.</h1>
            <p className="mt-4 text-sm leading-7 text-[var(--muted)]">Please try again in a moment.</p>
            <button type="button" className="button button-primary mt-8" onClick={() => reset()}>Try again</button>
          </section>
        </main>
      </body>
    </html>
  );
}
