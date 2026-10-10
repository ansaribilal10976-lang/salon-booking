import { redirect } from "next/navigation";
import { AdminBookings } from "@/components/admin-bookings";
import { AdminServices } from "@/components/admin-services";
import { AdminSignOut } from "@/components/admin-sign-out";
import { AdminRefresh } from "@/components/admin-refresh";
import { Card, CardContent } from "@/components/ui/card";
import admin from "./admin.module.css";
import { getAdminAccess } from "@/lib/admin-server";
import { parseAdminFilters } from "@/lib/admin-validation";
import { salon } from "@/lib/salon";
import type { AdminBooking, BookingConfiguration, Service } from "@/types/database";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ view?: string | string[]; page?: string | string[] }> }) {
  const { supabase, access } = await getAdminAccess();
  if (!access.allowed) {
    if (access.status === 401) redirect("/admin/login");
    if (access.status === 403) redirect("/admin/access-denied");
    return <AdminUnavailable message={access.error} />;
  }
  if (!supabase) return <AdminUnavailable message="The admin workspace is unavailable right now." />;
  const resolvedSearchParams = await searchParams;
  const filters = parseAdminFilters(resolvedSearchParams.view, resolvedSearchParams.page);
  let config: BookingConfiguration | undefined;
  let bookings: AdminBooking[] = [];
  let services: Service[] = [];
  let bookingError: string | null = null;
  let serviceError: string | null = null;
  let accessLost = false;
  try {
    const [settings, appointments, menu] = await Promise.all([
      supabase.rpc("get_booking_config").abortSignal(AbortSignal.timeout(5000)),
      supabase.rpc("list_admin_bookings", { p_view: filters.view, p_offset: filters.offset, p_limit: 51 }).abortSignal(AbortSignal.timeout(5000)),
      supabase.from("services").select("id, name, duration, price").order("name").abortSignal(AbortSignal.timeout(5000)),
    ]);
    if (settings.error) console.error("admin:config_query_failed");
    if (appointments.error) console.error("admin:bookings_query_failed");
    if (menu.error) console.error("admin:services_query_failed");
    accessLost = appointments.error?.code === "42501";
    config = settings.error ? undefined : settings.data?.[0];
    bookings = appointments.data ?? [];
    services = menu.data ?? [];
    bookingError = appointments.error || !appointments.data ? "Bookings could not be loaded. Refresh the dashboard to try again." : null;
    serviceError = menu.error || !menu.data ? "The service menu could not be loaded. Refresh before making changes." : null;
    if (config) new Intl.DateTimeFormat(salon.locale, { timeZone: config.time_zone }).format();
  } catch {
    console.error("admin:load_failed");
    return <AdminUnavailable message="The salon’s schedule could not be loaded. Please try again." />;
  }
  if (accessLost) redirect("/admin/access-denied");
  if (!config) return <AdminUnavailable message="The salon’s booking configuration is unavailable. Please check the Supabase migrations and try again." />;

  return (
    <>
      <div className={admin.intro}>
        <div>
          <p className={admin.label}>Appointments & services</p>
          <h1 className={admin.title}>The salon, at a glance.</h1>
          <p className={admin.description}>Keep appointments moving and your service menu ready for the next guest.</p>
          <p className={admin.identity}>Signed in as <span>{access.user.email ?? "salon administrator"}</span></p>
        </div>
        <div className={admin.toolbar}><AdminRefresh /><AdminSignOut /></div>
      </div>
      <nav aria-label="Workspace sections" className={admin.jumpLinks}>
        <a href="#admin-bookings-title">Appointment book</a>
        <a href="#admin-services-title">Service menu</a>
      </nav>
      <div className={admin.layout}>
        <AdminBookings bookings={bookings.slice(0, 50)} view={filters.view} page={filters.page} hasMore={bookings.length > 50} timeZone={config.time_zone} error={bookingError} />
        <AdminServices services={services} error={serviceError} />
      </div>
    </>
  );
}

function AdminUnavailable({ message }: { message: string }) {
  return (
    <section className={admin.unavailable}>
      <Card className={admin.unavailableCard}>
        <CardContent>
          <p className={admin.label}>Salon workspace</p>
          <h1 className={admin.unavailableTitle}>The workspace is temporarily unavailable.</h1>
          <p role="alert" className={admin.description}>{message}</p>
          <div className={admin.toolbar}><AdminRefresh /><AdminSignOut /></div>
        </CardContent>
      </Card>
    </section>
  );
}
