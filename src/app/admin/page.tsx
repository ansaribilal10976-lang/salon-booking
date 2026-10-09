import { redirect } from "next/navigation";
import { AdminBookings } from "@/components/admin-bookings";
import { AdminServices } from "@/components/admin-services";
import { AdminSignOut } from "@/components/admin-sign-out";
import { AdminRefresh } from "@/components/admin-refresh";
import { getAdminAccess } from "@/lib/admin-server";
import { parseAdminFilters } from "@/lib/admin-validation";
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
    accessLost = appointments.error?.code === "42501";
    config = settings.error ? undefined : settings.data?.[0];
    bookings = appointments.data ?? [];
    services = menu.data ?? [];
    bookingError = appointments.error || !appointments.data ? "Bookings could not be loaded. Refresh the dashboard to try again." : null;
    serviceError = menu.error || !menu.data ? "The service menu could not be loaded. Refresh before making changes." : null;
    if (config) new Intl.DateTimeFormat("en-US", { timeZone: config.time_zone }).format();
  } catch { return <AdminUnavailable message="The salon’s schedule could not be loaded. Please try again." />; }
  if (accessLost) redirect("/admin/access-denied");
  if (!config) return <AdminUnavailable message="The salon’s booking configuration is unavailable. Please check the Supabase migrations and try again." />;

  return (
    <>
      <div className="flex flex-col justify-between gap-7 border-b border-[var(--line)] pb-9 lg:flex-row lg:items-end"><div><p className="eyebrow">Good morning, studio team</p><h1 className="mt-4 max-w-3xl font-display text-5xl leading-[0.96] tracking-[-0.06em] sm:text-7xl">A clear view of <span className="italic text-[var(--clay)]">your day.</span></h1><p className="mt-5 max-w-xl text-sm leading-7 text-[var(--muted)]">Keep appointments moving and your service menu ready for the next guest.</p><p className="mt-3 text-xs text-[var(--muted)] [overflow-wrap:anywhere]">Signed in as <span className="font-medium text-[var(--ink)]">{access.user.email ?? "salon administrator"}</span></p></div><div className="flex flex-col gap-3 sm:flex-row"><AdminRefresh /><AdminSignOut /></div></div>
      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10"><AdminBookings bookings={bookings.slice(0, 50)} view={filters.view} page={filters.page} hasMore={bookings.length > 50} timeZone={config.time_zone} error={bookingError} /><AdminServices services={services} error={serviceError} /></div>
    </>
  );
}

function AdminUnavailable({ message }: { message: string }) {
  return <section className="admin-surface mx-auto max-w-xl p-7 sm:p-10"><p className="eyebrow">Studio workspace</p><h1 className="mt-3 font-display text-4xl">The workspace is temporarily unavailable.</h1><p role="alert" className="mt-5 text-sm leading-7 text-[var(--muted)]">{message}</p><div className="mt-7 flex flex-col gap-3 sm:flex-row"><AdminRefresh /><AdminSignOut /></div></section>;
}
