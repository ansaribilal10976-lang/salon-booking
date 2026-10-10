"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import admin from "@/app/admin/admin.module.css";
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
    setError(""); setNotice(""); pendingRef.current = true; setPending(true);
    try {
      const payload = await adminRequest(`/api/admin/bookings/${booking.id}`, "PATCH", { status });
      if (payload.booking?.id !== booking.id || payload.booking.status !== status) throw new Error("Missing result");
      setAskCancel(false); setNotice(status === "confirmed" ? "Appointment confirmed." : "Appointment cancelled. Its time is now available to book.");
      startTransition(() => router.refresh());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This status could not be changed.");
      if (failure instanceof AdminRequestError && (failure.status === 401 || failure.status === 403)) setNeedsLogin(true);
    } finally { pendingRef.current = false; setPending(false); }
  }
  const disabled = pending || refreshing || needsLogin;
  if (booking.status === "completed" || booking.status === "cancelled") return <p className={admin.finalStatus}>{booking.status === "cancelled" ? "Cancelled appointments cannot be reopened." : "This appointment is complete."}</p>;

  return (
    <div className={admin.bookingActions}>
      <div className={admin.actionRow}>
        {booking.status === "pending" && <Button type="button" size="sm" disabled={disabled} onClick={() => void setStatus("confirmed")}>{pending ? "Saving…" : "Confirm"}</Button>}
        {canChangeBookingStatus(booking.status, "cancelled") && <Button type="button" variant="outline" size="sm" className={admin.dangerAction} disabled={disabled} onClick={() => { setAskCancel(true); setError(""); setNotice(""); }}>Cancel booking</Button>}
      </div>
      {askCancel && (
        <div role="group" aria-label="Confirm appointment cancellation" className={admin.confirmation}>
          <p>Cancel this appointment for {booking.customer_name}? The reserved time will become available and this cancellation cannot be undone.</p>
          <div className={admin.actionRow}>
            <Button type="button" variant="destructive" disabled={disabled} onClick={() => void setStatus("cancelled")}>{pending ? "Cancelling…" : "Yes, cancel appointment"}</Button>
            <Button type="button" variant="outline" disabled={disabled} onClick={() => setAskCancel(false)}>Keep booking</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className={`field-error ${admin.alert}`}>{error}</p>}
      {notice && <p role="status" className={admin.notice}>{notice}</p>}
      {needsLogin && <Link href="/admin/login" className={admin.loginLink}>Sign in with an approved account</Link>}
    </div>
  );
}

export function AdminBookings({ bookings, view, page, hasMore, timeZone, error }: { bookings: AdminBooking[]; view: AdminView; page: number; hasMore: boolean; timeZone: string; error: string | null }) {
  const dateLabel = (instant: string) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(instant));
  const statusStyles = { pending: admin.pending, confirmed: admin.confirmed, cancelled: admin.cancelled, completed: admin.completed };
  return (
    <section aria-labelledby="admin-bookings-title" className={admin.bookings}>
      <div className={admin.sectionHeader}>
        <h2 id="admin-bookings-title" className={admin.sectionTitle}>{view === "today" ? "Today’s bookings" : "Upcoming bookings"}</h2>
        <nav aria-label="Booking date filter" className={admin.filters}>
          <Button asChild variant={view === "today" ? "default" : "outline"} size="sm" className={admin.filter}>
            <Link href="/admin?view=today" aria-current={view === "today" ? "page" : undefined}>Today</Link>
          </Button>
          <Button asChild variant={view === "upcoming" ? "default" : "outline"} size="sm" className={admin.filter}>
            <Link href="/admin?view=upcoming" aria-current={view === "upcoming" ? "page" : undefined}>Upcoming</Link>
          </Button>
        </nav>
      </div>
      <p className={admin.scheduleNote}>{view === "today" ? "All appointments on the salon’s current date, including earlier today." : "Appointments from tomorrow onwards."} Time zone: <strong>{timeZone}</strong>.</p>
      {error ? <p role="alert" className="booking-alert">{error}</p> : !bookings.length ? (
        <Card className={admin.emptyCard}>
          <CardContent>
            <CalendarDays className={admin.emptyIcon} aria-hidden="true" />
            <h3 className={admin.emptyTitle}>{view === "today" ? "No appointments today." : "No upcoming appointments."}</h3>
            <p className={admin.emptyText}>New reservations will appear here once customers complete their booking.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className={admin.appointmentList}>
          {bookings.map((booking) => (
            <li key={booking.id} className={admin.appointment}>
              <div className={admin.timeColumn}>
                <p>
                  <time dateTime={booking.slot_time} className={admin.startTime}>{formatSlotTime(booking.slot_time, timeZone)}</time>
                  <span className={admin.endTime}>to <time dateTime={booking.end_time}>{formatSlotTime(booking.end_time, timeZone)}</time></span>
                </p>
                <p className={admin.date}>{dateLabel(booking.slot_time)}</p>
              </div>
              <div className={admin.appointmentBody}>
                <div className={admin.appointmentHeader}>
                  <h3 className={admin.customer}>{booking.customer_name}</h3>
                  <span className={`${admin.status} ${statusStyles[booking.status]}`}>{booking.status}</span>
                </div>
                <p className={admin.serviceName}>{booking.service_name}</p>
                <p className={admin.contact}>Phone: <span>{booking.phone}</span></p>
                <p className={admin.reference}>Reference: <span>{booking.id}</span></p>
                <BookingActions booking={booking} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Bookings pagination" className={admin.pagination}>
        {page > 1 ? <Button asChild variant="outline" size="sm"><Link href={`/admin?view=${view}&page=${page - 1}`}><ArrowLeft aria-hidden="true" />Previous page</Link></Button> : <span />}
        <span className={admin.pageLabel}>Page {page} · up to 50 appointments</span>
        {hasMore && page < 201 ? <Button asChild variant="outline" size="sm"><Link href={`/admin?view=${view}&page=${page + 1}`}>Next page <ArrowRight aria-hidden="true" /></Link></Button> : <span />}
      </nav>
    </section>
  );
}
