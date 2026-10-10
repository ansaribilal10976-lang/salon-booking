"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleCheck, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import booking from "@/app/book/booking.module.css";
import { formatBookingDate, formatSlotTime, isCalendarDate, isSlotInstant, validateBookingRequest } from "@/lib/booking-validation";
import type { BookingFieldErrors } from "@/lib/booking-validation";
import { formatDuration, formatPrice, salon } from "@/lib/salon";
import type { AvailableSlot, BookingConfiguration, BookingReceipt, Service } from "@/types/database";
import { getConfirmedBooking } from "@/lib/booking-operations";

type Props = { services: Service[]; config: BookingConfiguration; initialServiceId: string };
type Availability = { key: string; status: "loading" | "ready" | "error"; slots: AvailableSlot[]; error?: string };
type Step = 0 | 1 | 2;
const stepNames = ["Service", "Date & time", "Your details"];

export function BookingFlow({ services, config, initialServiceId }: Props) {
  const initialService = services.find((service) => service.id === initialServiceId);
  const [step, setStep] = useState<Step>(initialService ? 1 : 0);
  const [serviceId, setServiceId] = useState(initialService?.id ?? "");
  const [date, setDate] = useState(config.min_date);
  const [slotTime, setSlotTime] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [availability, setAvailability] = useState<Availability>({ key: "", status: "loading", slots: [] });
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<BookingFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  const submittingRef = useRef(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const nameInput = useRef<HTMLInputElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);
  const service = services.find((item) => item.id === serviceId);
  const queryKey = `${serviceId}:${date}`;
  const dateIsValid = isCalendarDate(date) && date >= config.min_date && date <= config.max_date;
  const timesReady = availability.key === queryKey && availability.status === "ready";
  const selectedTimeIsAvailable = timesReady && availability.slots.some((item) => item.slot_time === slotTime);

  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } heading.current?.focus(); }, [step]);
  useEffect(() => { if (receipt) successHeading.current?.focus(); }, [receipt]);

  useEffect(() => {
    if (!serviceId || !dateIsValid || receipt) return;
    const controller = new AbortController();
    const key = `${serviceId}:${date}`;
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 12000);
    setAvailability({ key, status: "loading", slots: [] });
    async function load() {
      try {
        const query = new URLSearchParams({ serviceId, date });
        const response = await fetch(`/api/availability?${query}`, { signal: controller.signal, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Available times could not be loaded.");
        if (!Array.isArray(payload.slots) || !payload.slots.every((slot: AvailableSlot) => isSlotInstant(slot?.slot_time))) throw new Error("Available times could not be loaded.");
        if (active) setAvailability({ key, status: "ready", slots: payload.slots });
      } catch (error) {
        if (active) setAvailability({ key, status: "error", slots: [], error: controller.signal.aborted ? "The schedule took too long to load. Please try again." : error instanceof Error ? error.message : "Available times could not be loaded." });
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [serviceId, date, dateIsValid, refresh, receipt]);

  function nextStep() {
    setMessage("");
    if (!service) { setMessage("Choose a service to continue."); setStep(0); return; }
    if (step === 0) { setStep(1); return; }
    if (!selectedTimeIsAvailable) { setMessage("Choose an available appointment time."); return; }
    setStep(2);
  }

  async function confirmBooking() {
    if (submittingRef.current) return;
    if (!service || !selectedTimeIsAvailable) { setMessage("Please choose a service and an available time before confirming."); setStep(service ? 1 : 0); return; }
    setMessage(""); setErrors({});
    const signature = JSON.stringify([serviceId, slotTime, customerName.trim(), phone.trim()]);
    try {
      if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
    } catch { setMessage("This browser cannot create a secure booking request. Please use a current browser over HTTPS."); return; }
    const checked = validateBookingRequest({ bookingId: attempt.current.id, serviceId, slotTime, customerName, phone });
    if (!checked.valid) {
      setErrors(checked.errors); setMessage("Please check your name and phone number.");
      if (checked.errors.customerName) nameInput.current?.focus(); else if (checked.errors.phone) phoneInput.current?.focus();
      return;
    }
    submittingRef.current = true; setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(checked.value), signal: controller.signal, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(typeof payload.error === "string" ? payload.error : "The appointment could not be confirmed. Please try again.");
        if (payload.fieldErrors) setErrors(payload.fieldErrors);
        if (response.status === 409) { setSlotTime(""); attempt.current = null; setRefresh((value) => value + 1); setStep(1); }
        return;
      }
      const booking = getConfirmedBooking(payload.booking, checked.value);
      if (!booking) throw new Error("Missing receipt");
      setReceipt(booking);
    } catch { setMessage("We couldn’t verify whether your appointment was saved. Please retry with the same details; the same request won’t create a second booking."); }
    finally { clearTimeout(timeout); submittingRef.current = false; setSubmitting(false); }
  }

  if (receipt) {
    const bookedService = services.find((item) => item.id === receipt.service_id);
    const bookedDate = new Intl.DateTimeFormat(salon.locale, { timeZone: config.time_zone, dateStyle: "full" }).format(new Date(receipt.slot_time));
    return (
      <section aria-labelledby="booking-confirmed-title" className={booking.confirmation}>
        <p className={booking.confirmedLabel}><CircleCheck aria-hidden="true" />Appointment confirmed</p>
        <h1 id="booking-confirmed-title" ref={successHeading} tabIndex={-1} className={booking.title}>You’re booked, {receipt.customer_name}.</h1>
        <p className={booking.description}>Your time is reserved. Keep this confirmation and booking reference for your records.</p>
        <dl className={booking.receipt}>
          <div><dt>Status</dt><dd>Confirmed</dd></div>
          <div><dt>Service</dt><dd>{bookedService?.name ?? "Salon appointment"}</dd></div>
          <div><dt>Date & time</dt><dd>{bookedDate}<br />{formatSlotTime(receipt.slot_time, config.time_zone)} – {formatSlotTime(receipt.end_time, config.time_zone)}<span>{config.time_zone}</span></dd></div>
          <div><dt>Menu price</dt><dd>{bookedService ? formatPrice(bookedService.price) : "—"}<span>{bookedService ? salon.currency : ""}</span></dd></div>
          <div><dt>Contact number</dt><dd>{receipt.phone}</dd></div>
          <div><dt>Booking reference</dt><dd className={booking.reference}>{receipt.id}</dd></div>
        </dl>
        <p className={booking.reservationNote}>This confirms your reservation only. No payment was collected.</p>
        <Button asChild className={booking.confirmationAction}><Link href="/">Back to the salon <ArrowRight aria-hidden="true" /></Link></Button>
      </section>
    );
  }

  return (
    <>
      <div className={booking.intro}>
        <p className={booking.label}>Appointments at {salon.name}</p>
        <h1 className={booking.title}>Make time for you.</h1>
        <p className={booking.description}>Choose your service and a time that suits you. No account is needed.</p>
      </div>
      <ol aria-label="Booking progress" className={booking.progress}>
        {stepNames.map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined} data-reached={index <= step} className={booking.progressStep}>
            <span className={booking.stepNumber} aria-hidden="true">{index < step ? <Check className={booking.icon} /> : index + 1}</span>
            <span>{label}<span className="sr-only">{index < step ? ", completed" : ""}</span></span>
          </li>
        ))}
      </ol>
      <div className={booking.layout}>
        <form noValidate onSubmit={(event) => { event.preventDefault(); if (step === 2) void confirmBooking(); else nextStep(); }} className={booking.form} aria-busy={submitting}>
          <div className={booking.formHeading}>
            <h2 ref={heading} tabIndex={-1} className={booking.sectionTitle}>{["Choose your service", "Find your time", "Your appointment details"][step]}</h2>
            <p className={booking.formHint}>{["Select one service. Prices are shown in INR.", "Choose a date, then pick an available start time.", "Add your name and a phone number the salon can use to reach you about this appointment."][step]}</p>
          </div>
          {message && <div role="alert" className="booking-alert">{message}</div>}
          <fieldset disabled={submitting} className={booking.fields}>
            <legend className="sr-only">{stepNames[step]}</legend>
            {step === 0 && (
              <div className={booking.serviceList}>
                {services.map((item) => (
                  <label key={item.id} className={booking.serviceOption}>
                    <input type="radio" name="service" value={item.id} checked={item.id === serviceId} className="sr-only" onChange={() => { setServiceId(item.id); setSlotTime(""); setMessage(""); setErrors({}); }} />
                    <span className={booking.serviceChoice}>
                      <span className={booking.radioMark} aria-hidden="true" />
                      <span><span className={booking.serviceName}>{item.name}</span><span className={booking.serviceDuration}>{formatDuration(item.duration)}</span></span>
                      <span className={booking.servicePrice}><span className="sr-only">Menu price: </span>{formatPrice(item.price)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {step === 1 && (
              <>
                <label htmlFor="appointment-date" className="booking-label">Appointment date</label>
                <input id="appointment-date" type="date" className={`booking-input ${booking.dateInput}`} min={config.min_date} max={config.max_date} value={date} required aria-invalid={!!date && !dateIsValid} aria-describedby="schedule-hours" onChange={(event) => { setDate(event.target.value); setSlotTime(""); setMessage(""); }} />
                <p id="schedule-hours" className={booking.hint}>10:00 AM–8:00 PM daily · 30-minute start times<br />All times are in <strong>{config.time_zone}</strong>.</p>
                <fieldset className={booking.times}>
                  <legend className="booking-label">Available times{isCalendarDate(date) ? ` · ${formatBookingDate(date)}` : ""}</legend>
                  {!dateIsValid ? (
                    <p className={booking.state}>Choose a date between {formatBookingDate(config.min_date)} and {formatBookingDate(config.max_date)} to see the schedule.</p>
                  ) : availability.key !== queryKey || availability.status === "loading" ? (
                    <p role="status" className={booking.state}>Checking the salon’s schedule…</p>
                  ) : availability.status === "error" ? (
                    <div className={booking.retry}>
                      <p role="alert" className="booking-alert">{availability.error}</p>
                      <Button type="button" variant="outline" className={booking.retry} onClick={() => setRefresh((value) => value + 1)}>Try again <RotateCcw aria-hidden="true" /></Button>
                    </div>
                  ) : !availability.slots.length ? (
                    <p role="status" className={booking.state}>No times are available for this service on this date. Please choose another date or service.</p>
                  ) : (
                    <div className={booking.timeGrid}>
                      {availability.slots.map((slot) => (
                        <label key={slot.slot_time} className={booking.timeOption}>
                          <input type="radio" name="slot" className="sr-only" checked={slotTime === slot.slot_time} value={slot.slot_time} onChange={() => { setSlotTime(slot.slot_time); setMessage(""); }} />
                          <span className={booking.timeChoice}>{formatSlotTime(slot.slot_time, config.time_zone)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              </>
            )}
            {step === 2 && (
              <div className={booking.details}>
                <div>
                  <label htmlFor="customer-name" className="booking-label">Full name</label>
                  <input ref={nameInput} id="customer-name" name="customerName" autoComplete="name" type="text" className="booking-input" value={customerName} maxLength={100} required aria-invalid={!!errors.customerName} aria-describedby={errors.customerName ? "customer-name-error" : undefined} onChange={(event) => { setCustomerName(event.target.value); setErrors((old) => ({ ...old, customerName: undefined })); }} />
                  {errors.customerName && <p id="customer-name-error" className="field-error">{errors.customerName}</p>}
                </div>
                <div>
                  <label htmlFor="customer-phone" className="booking-label">Phone number</label>
                  <input ref={phoneInput} id="customer-phone" name="phone" autoComplete="tel" type="tel" inputMode="tel" className="booking-input" value={phone} maxLength={32} required aria-invalid={!!errors.phone} aria-describedby={`phone-hint${errors.phone ? " phone-error" : ""}`} onChange={(event) => { setPhone(event.target.value); setErrors((old) => ({ ...old, phone: undefined })); }} />
                  <p id="phone-hint" className={booking.hint}>Include your country code if needed. Spaces, brackets, and hyphens are accepted.</p>
                  {errors.phone && <p id="phone-error" className="field-error">{errors.phone}</p>}
                </div>
                <p className={booking.state}>Your time is reserved only after you select <strong className="font-medium">Confirm booking</strong> and receive a confirmation.</p>
              </div>
            )}
            <div className={booking.actions}>
              {step > 0 && <Button type="button" variant="outline" onClick={() => { setStep((step - 1) as Step); setMessage(""); }}><ArrowLeft aria-hidden="true" />Back</Button>}
              <Button type="submit" disabled={submitting || (step === 0 && !service) || (step === 1 && !selectedTimeIsAvailable)} className={booking.continue}>
                {submitting ? "Confirming your appointment…" : step === 2 ? "Confirm booking" : "Continue"}
                {!submitting && <ArrowRight aria-hidden="true" />}
              </Button>
            </div>
          </fieldset>
        </form>
        <aside aria-labelledby="appointment-summary-title" className={booking.summary}>
          <Card className={booking.summaryCard}>
            <CardContent className={booking.summaryContent}>
              <div className={booking.summaryHeader}>
                <p className={booking.label}>Your visit</p>
                <h2 id="appointment-summary-title" className={booking.summaryTitle}>Your appointment.</h2>
              </div>
              {service ? (
                <dl className={booking.summaryList}>
                  <div className={booking.summaryService}><dt>Service</dt><dd>{service.name}</dd></div>
                  <div className={booking.summaryRow}><dt>Duration</dt><dd>{formatDuration(service.duration)}</dd></div>
                  <div className={booking.summaryRow}><dt>Menu price</dt><dd>{formatPrice(service.price)}</dd></div>
                  {slotTime && <div className={booking.summaryTime}><dt>Selected time</dt><dd>{formatBookingDate(date)}<br />{formatSlotTime(slotTime, config.time_zone)}<span>{config.time_zone}</span></dd></div>}
                </dl>
              ) : <p className={booking.formHint}>Choose a service to see its duration and menu price here.</p>}
              <p className={booking.summaryNote}>Availability is shared across the salon. Your service’s full duration is reserved.</p>
            </CardContent>
          </Card>
          <p className={booking.reservationNote}>Choosing a time doesn’t hold it. Your appointment is reserved once you receive a confirmation.</p>
        </aside>
      </div>
    </>
  );
}
