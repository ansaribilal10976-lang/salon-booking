"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClockIcon } from "@/components/icons";
import { AdminRequestError, adminRequest } from "@/lib/admin-client";
import { canChangeBookingStatus } from "@/lib/admin-validation";
import type { AdminView } from "@/lib/admin-validation";
import { formatSlotTime } from "@/lib/booking-validation";
import type { AdminBooking } from "@/types/database";

function BookingActions({ booking }: { booking: AdminBooking }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [askCancel, setAskCancel] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const pendingRef = useRef(false);

  async function setStatus(status: "confirmed" | "cancelled") {
    if (pendingRef.current || refreshing) return;
    setError("");
    setNotice("");
    pendingRef.current = true;
    setPending(true);
    try {
      const payload = await adminRequest(`/api/admin/bookings/${booking.id}`, "PATCH", { status });
      if (payload.booking?.id !== booking.id || payload.booking.status !== status) throw new Error("Missing result");
      setAskCancel(false);
      setNotice(status === "confirmed" ? "Appointment confirmed." : "Appointment cancelled. Its time is now available to book.");
      startTransition(() => router.refresh());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This status could not be changed.");
      if (failure instanceof AdminRequestError && (failure.status === 401 || failure.status === 403)) setNeedsLogin(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  const disabled = pending || refreshing || needsLogin;
  if (booking.status === "completed" || booking.status === "cancelled") return <p className="mt-4 text-xs leading-6 text-muted">{booking.status === "cancelled" ? "Cancelled appointments cannot be reopened." : "This appointment is complete."}</p>;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap gap-2">
        {booking.status === "pending" && <button type="button" className="button button-primary px-5" disabled={disabled} onClick={() => void setStatus("confirmed")}>{pending ? "Saving…" : "Confirm"}</button>}
        {canChangeBookingStatus(booking.status, "cancelled") && <button type="button" className="button button-outline border-[#d9b7a9] text-[#753c2b]" disabled={disabled} onClick={() => { setAskCancel(true); setError(""); setNotice(""); }}>Cancel booking</button>}
      </div>
      {askCancel && (
        <div role="group" aria-label="Confirm appointment cancellation" className="mt-4 rounded-xl border border-[#d9b7a9] bg-[#fff3eb] p-4">
          <p className="text-sm leading-7 text-[#753c2b]">Cancel this appointment for {booking.customer_name}? The reserved time will become available and this cancellation cannot be undone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={disabled} className="button button-primary px-4" onClick={() => void setStatus("cancelled")}>{pending ? "Cancelling…" : "Yes, cancel appointment"}</button>
            <button type="button" disabled={disabled} className="button button-outline" onClick={() => setAskCancel(false)}>Keep booking</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="field-error mt-4">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm leading-7 text-forest">{notice}</p>}
      {needsLogin && <Link href="/admin/login" className="nav-link mt-2 text-sm">Sign in with an approved account</Link>}
    </div>
  );
}

export function AdminBookings({ bookings, view, page, hasMore, timeZone, error }: {
  bookings: AdminBooking[]; view: AdminView; page: number; hasMore: boolean; timeZone: string; error: string | null;
}) {
  const dateLabel = (instant: string) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(instant));
  const statusStyles = { pending: "bg-[#f5ead0] text-[#6c501f]", confirmed: "bg-[#e0e9d8] text-forest", cancelled: "bg-[#f3dfd5] text-[#753c2b]", completed: "bg-[#e4e7e1] text-muted" };
  return (
    <section aria-labelledby="admin-bookings-title" className="min-w-0">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="eyebrow">The appointment book</p><h2 id="admin-bookings-title" className="mt-2 font-display text-3xl">{view === "today" ? "Today’s bookings" : "Upcoming bookings"}</h2></div>
        <nav aria-label="Booking date filter" className="flex gap-2 rounded-full border border-line bg-white/60 p-1">
          <Link href="/admin?view=today" aria-current={view === "today" ? "page" : undefined} className={`button flex-1 px-5 ${view === "today" ? "bg-forest text-cream" : "text-muted hover:bg-[#eef0e8]"}`}>Today</Link>
          <Link href="/admin?view=upcoming" aria-current={view === "upcoming" ? "page" : undefined} className={`button flex-1 px-5 ${view === "upcoming" ? "bg-forest text-cream" : "text-muted hover:bg-[#eef0e8]"}`}>Upcoming</Link>
        </nav>
      </div>
      <p className="mb-6 mt-4 text-xs leading-6 text-muted">{view === "today" ? "All appointments on the salon’s current date, including earlier today." : "Appointments from tomorrow onwards."} Time zone: <strong className="font-medium text-forest">{timeZone}</strong>.</p>
      {error ? <p role="alert" className="booking-alert">{error}</p> : !bookings.length ? (
        <div className="rounded-2xl border border-line bg-white/50 p-8 text-center"><h3 className="font-display text-2xl">{view === "today" ? "No appointments on this page today." : "No upcoming appointments on this page."}</h3><p className="mt-3 text-sm leading-7 text-muted">New reservations will appear here once customers complete their booking.</p></div>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {bookings.map((booking) => (
            <li key={booking.id} className="min-w-0 rounded-2xl border border-line bg-white/60 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3"><p className="text-xs leading-6 text-muted">{dateLabel(booking.slot_time)}</p><span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${statusStyles[booking.status]}`}>{booking.status}</span></div>
              <h3 className="mt-3 font-display text-2xl leading-tight [overflow-wrap:anywhere]">{booking.customer_name}</h3>
              <p className="mt-2 text-sm font-medium [overflow-wrap:anywhere]">{booking.service_name}</p>
              <p className="mt-4 flex items-center gap-2 text-sm tabular-nums"><ClockIcon className="h-4 w-4 shrink-0 text-olive" />{formatSlotTime(booking.slot_time, timeZone)} – {formatSlotTime(booking.end_time, timeZone)}</p>
              <p className="mt-3 text-sm"><span className="text-muted">Phone: </span><span className="select-all [overflow-wrap:anywhere]">{booking.phone}</span></p>
              <p className="mt-3 text-xs leading-6 text-muted">Reference: <span className="select-all break-all font-mono">{booking.id}</span></p>
              <BookingActions booking={booking} />
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Bookings pagination" className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {page > 1 ? <Link href={`/admin?view=${view}&page=${page - 1}`} className="button button-outline">Previous page</Link> : <span />}
        <span className="text-xs text-muted">Page {page} · up to 50 appointments</span>
        {hasMore && page < 201 ? <Link href={`/admin?view=${view}&page=${page + 1}`} className="button button-outline">Next page</Link> : <span />}
      </nav>
    </section>
  );
}
