import type { Metadata } from "next";
import Link from "next/link";
import { BookingFlow } from "@/components/booking-flow";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import booking from "./booking.module.css";
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
    <div className={booking.shell}>
      <a href="#booking-main" className="skip-link">Skip to booking</a>
      <header className={`page-width ${booking.header}`}>
        <Link href="/" aria-label={`${salon.name} home`} className={booking.wordmark}>
          {salon.name.toLowerCase()}<span aria-hidden="true">.</span>
        </Link>
        <Link href="/#services" className={booking.backLink}>
          <ArrowLeft className={booking.icon} aria-hidden="true" />Back to menu
        </Link>
      </header>
      <main id="booking-main" className={`page-width ${booking.main}`} tabIndex={-1}>
        {data && data.services.length ? (
          <BookingFlow services={data.services} config={data.config} initialServiceId={initialServiceId} />
        ) : (
          <section aria-labelledby="booking-unavailable-title" className={booking.unavailable}>
            <Card className={booking.unavailableCard}>
              <CardContent className={booking.unavailableContent}>
                <p className={booking.label}>Appointments at {salon.name}</p>
                <h1 id="booking-unavailable-title" className={booking.title}>
                  {data ? "No services are available to book yet." : "Online booking is unavailable right now."}
                </h1>
                <p className={booking.description}>
                  {data ? "Please check back for the salon’s service menu. No appointment has been reserved." : "We can’t check the salon’s schedule at the moment. Please try again shortly. No appointment has been reserved."}
                </p>
                <form action="/book" method="get">
                  <Button type="submit">Try again <RotateCcw aria-hidden="true" /></Button>
                </form>
              </CardContent>
            </Card>
          </section>
        )}
      </main>
      <footer className={`page-width site-footer ${booking.footer}`}>
        <p>{salon.name} · Your next good hair day</p>
        <p>No account needed. No payment collected online.</p>
      </footer>
    </div>
  );
}
