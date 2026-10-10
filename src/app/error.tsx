"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page-width flex min-h-[60vh] items-center justify-center py-16">
      <section className="admin-surface w-full max-w-xl p-6 sm:p-10" aria-labelledby="error-title">
        <p className="eyebrow">A temporary interruption</p>
        <h1 id="error-title" className="mt-3 font-display text-4xl leading-tight sm:text-5xl">We couldn’t load this page.</h1>
        <p className="mt-4 text-sm leading-7 text-[var(--muted)]">Please try again. Your information has not been displayed here.</p>
        <button type="button" className="button button-primary mt-8" onClick={() => reset()}>Try again</button>
      </section>
    </main>
  );
}
