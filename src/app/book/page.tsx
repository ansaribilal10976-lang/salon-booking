import type { Metadata } from "next";
import Link from "next/link";
import { BookingFlow } from "@/components/booking-flow";
import { ArrowIcon, FlowerIcon } from "@/components/icons";
import { isCalendarDate } from "@/lib/booking-validation";
import { salon } from "@/lib/salon";
import { createClient } from "@/lib/supabase/server";
import type { BookingConfiguration, Service } from "@/types/database";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `Book an appointment — ${salon.name}`,
  description: "Choose your salon service, find an available time, and confirm your appointment.",
  robots: { index: false, follow: true },
};

async function loadBookingPage(): Promise<{ services: Service[]; config: BookingConfiguration } | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  try {
    const supabase = await createClient();
    const [menu, settings] = await Promise.all([
      supabase.from("services").select("id, name, duration, price").order("name").abortSignal(AbortSignal.timeout(5000)),
      supabase.rpc("get_booking_config").abortSignal(AbortSignal.timeout(5000)),
    ]);
    const config = settings.data?.[0];
    if (menu.error || settings.error || !menu.data || !config || !isCalendarDate(config.min_date) || !isCalendarDate(config.max_date)) return null;
    new Intl.DateTimeFormat("en-US", { timeZone: config.time_zone }).format();
    return { services: menu.data, config };
  } catch { return null; }
}

export default async function BookPage({ searchParams }: { searchParams: Promise<{ service?: string | string[] }> }) {
  const data = await loadBookingPage();
  const resolvedSearchParams = await searchParams;
  const initialServiceId = typeof resolvedSearchParams.service === "string" ? resolvedSearchParams.service : "";

  return (
    <>
      <a href="#booking-main" className="skip-link">Skip to booking</a>
      <header className="page-width site-header flex min-h-[76px] items-center justify-between gap-4 border-b border-[var(--ink)]/15">
        <Link href="/" aria-label={`${salon.name} home`} className="flex min-h-12 items-center gap-2 text-[var(--ink)]"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ink)]"><FlowerIcon className="h-6 w-6 text-[var(--clay)]" /></span><span className="font-display text-[2rem] leading-none tracking-[-0.08em]">{salon.name.toLowerCase()}<span className="text-[var(--clay)]">.</span></span></Link>
        <Link href="/#services" className="nav-link gap-2 text-sm"><ArrowIcon className="h-4 w-4 rotate-[-135deg]" />Back to menu</Link>
      </header>
      <main id="booking-main" className="page-width pb-20 pt-12 sm:pt-20" tabIndex={-1}>
        {data && data.services.length ? <BookingFlow services={data.services} config={data.config} initialServiceId={initialServiceId} /> : <section aria-labelledby="booking-unavailable-title" className="mx-auto max-w-xl border border-[var(--line)] bg-[var(--paper)] px-6 py-14 text-center sm:p-16"><FlowerIcon className="mx-auto h-14 w-14 text-[var(--clay)]" /><p className="eyebrow mt-7">Appointments at {salon.name}</p><h1 id="booking-unavailable-title" className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{data ? "No services are available to book yet." : "Online booking is unavailable right now."}</h1><p className="mt-5 text-sm leading-7 text-[var(--muted)]">{data ? "Please check back for the salon’s service menu. No appointment has been reserved." : "We can’t check the salon’s schedule at the moment. Please try again shortly. No appointment has been reserved."}</p><form action="/book" method="get" className="mt-7"><button type="submit" className="button button-primary mx-auto">Try again <ArrowIcon className="h-4 w-4" /></button></form></section>}
      </main>
      <footer className="page-width site-footer border-t border-[var(--line)] py-7 text-xs text-[var(--muted)]">{salon.name} · Your next good hair day</footer>
    </>
  );
}
