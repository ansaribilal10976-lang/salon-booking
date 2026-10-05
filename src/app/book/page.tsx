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
    const supabase = createClient();
    const [menu, settings] = await Promise.all([
      supabase.from("services").select("id, name, duration, price").order("name").abortSignal(AbortSignal.timeout(5000)),
      supabase.rpc("get_booking_config").abortSignal(AbortSignal.timeout(5000)),
    ]);
    const config = settings.data?.[0];
    if (menu.error || settings.error || !menu.data || !config
      || !isCalendarDate(config.min_date) || !isCalendarDate(config.max_date)) return null;
    // Reject broken configuration instead of rendering misleading local times.
    new Intl.DateTimeFormat("en-US", { timeZone: config.time_zone }).format();
    return { services: menu.data, config };
  } catch {
    return null;
  }
}

export default async function BookPage({ searchParams }: { searchParams: { service?: string | string[] } }) {
  const data = await loadBookingPage();
  const initialServiceId = typeof searchParams.service === "string" ? searchParams.service : "";

  return (
    <>
      <a href="#booking-main" className="skip-link">Skip to booking</a>
      <header className="page-width site-header flex flex-wrap items-center justify-between gap-3 border-b border-line py-5">
        <Link href="/" aria-label={`${salon.name} home`} className="flex min-h-12 items-center gap-2 text-forest">
          <FlowerIcon className="h-9 w-9" />
          <span className="font-display text-4xl tracking-[-0.07em]">{salon.name.toLowerCase()}.</span>
        </Link>
        <Link href="/#services" className="nav-link gap-2 text-sm"><ArrowIcon className="h-4 w-4 rotate-[-135deg]" />Back to services</Link>
      </header>
      <main id="booking-main" className="page-width pb-16 pt-8 sm:pt-12" tabIndex={-1}>
        {data && data.services.length ? (
          <BookingFlow services={data.services} config={data.config} initialServiceId={initialServiceId} />
        ) : (
          <section aria-labelledby="booking-unavailable-title" className="mx-auto max-w-xl rounded-2xl border border-line bg-white/50 px-6 py-12 text-center sm:mt-8 sm:p-12">
            <FlowerIcon className="mx-auto mb-6 h-14 w-14 text-olive" />
            <p className="eyebrow">Appointments at {salon.name}</p>
            <h1 id="booking-unavailable-title" className="mt-3 font-display text-4xl leading-tight">{data ? "No services are available to book yet." : "Online booking is unavailable right now."}</h1>
            <p className="mt-5 text-sm leading-7 text-muted">{data
              ? "Please check back for the salon’s service menu. No appointment has been reserved."
              : "We can’t check the salon’s schedule at the moment. Please try again shortly. No appointment has been reserved."}</p>
            <form action="/book" method="get" className="mt-7">
              <button type="submit" className="button button-primary w-full sm:w-auto">Try again <ArrowIcon className="h-4 w-4" /></button>
            </form>
          </section>
        )}
      </main>
      <footer className="page-width site-footer border-t border-line py-6 text-sm text-muted">{salon.name} · Cuts, color & everyday hair care</footer>
    </>
  );
}
