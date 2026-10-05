"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowIcon, ClockIcon, FlowerIcon } from "@/components/icons";
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

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [step]);

  useEffect(() => {
    if (receipt) successHeading.current?.focus();
  }, [receipt]);

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
        if (!Array.isArray(payload.slots) || !payload.slots.every((slot: AvailableSlot) => isSlotInstant(slot?.slot_time))) {
          throw new Error("Available times could not be loaded.");
        }
        if (active) setAvailability({ key, status: "ready", slots: payload.slots });
      } catch (error) {
        if (active) setAvailability({ key, status: "error", slots: [], error: controller.signal.aborted
          ? "The schedule took too long to load. Please try again."
          : error instanceof Error ? error.message : "Available times could not be loaded." });
      } finally {
        clearTimeout(timeout);
      }
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
    if (!service || !selectedTimeIsAvailable) {
      setMessage("Please choose a service and an available time before confirming.");
      setStep(service ? 1 : 0);
      return;
    }
    setMessage("");
    setErrors({});
    // Keep the same request ID for retries with unchanged details. If a network
    // response is lost after a successful write, the database returns that
    // receipt instead of making a second reservation.
    const signature = JSON.stringify([serviceId, slotTime, customerName.trim(), phone.trim()]);
    try {
      if (!attempt.current || attempt.current.signature !== signature) {
        attempt.current = { signature, id: crypto.randomUUID() };
      }
    } catch {
      setMessage("This browser cannot create a secure booking request. Please use a current browser over HTTPS.");
      return;
    }
    const checked = validateBookingRequest({ bookingId: attempt.current.id, serviceId, slotTime, customerName, phone });
    if (!checked.valid) {
      setErrors(checked.errors);
      setMessage("Please check your name and phone number.");
      if (checked.errors.customerName) nameInput.current?.focus();
      else if (checked.errors.phone) phoneInput.current?.focus();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checked.value), signal: controller.signal, cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(typeof payload.error === "string" ? payload.error : "The appointment could not be confirmed. Please try again.");
        if (payload.fieldErrors) setErrors(payload.fieldErrors);
        if (response.status === 409) {
          setSlotTime("");
          attempt.current = null;
          setRefresh((value) => value + 1);
          setStep(1);
        }
        return;
      }
      const booking = getConfirmedBooking(payload.booking, checked.value);
      if (!booking) throw new Error("Missing receipt");
      setReceipt(booking);
    } catch {
      setMessage("We couldn’t verify whether your appointment was saved. Please retry with the same details; the same request won’t create a second booking.");
    } finally {
      clearTimeout(timeout);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (receipt) {
    const bookedService = services.find((item) => item.id === receipt.service_id);
    const bookedDate = new Intl.DateTimeFormat("en-US", { timeZone: config.time_zone, dateStyle: "full" }).format(new Date(receipt.slot_time));
    return (
      <section aria-labelledby="booking-confirmed-title" className="mx-auto max-w-2xl rounded-2xl border border-line bg-white/60 p-6 sm:p-10">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#e9ecdf] text-forest">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        </div>
        <p className="eyebrow">Appointment confirmed</p>
        <h1 id="booking-confirmed-title" ref={successHeading} tabIndex={-1} className="mt-3 font-display text-4xl leading-tight [overflow-wrap:anywhere] sm:text-5xl">You’re booked, {receipt.customer_name}.</h1>
        <p className="mt-4 text-sm leading-7 text-muted">Your time is reserved. Keep this confirmation and booking reference for your records.</p>
        <dl className="mt-7 space-y-4 rounded-xl border border-line bg-cream p-5 text-sm">
          <div><dt className="text-muted">Status</dt><dd className="mt-1 inline-flex rounded-full bg-[#e9ecdf] px-3 py-1 text-xs font-medium text-forest">Confirmed</dd></div>
          <div><dt className="text-muted">Service</dt><dd className="mt-1 font-medium [overflow-wrap:anywhere]">{bookedService?.name ?? "Salon appointment"}</dd></div>
          <div className="grid grid-cols-2 gap-4">
            <div><dt className="text-muted">Reserved duration</dt><dd className="mt-1 font-medium">{formatDuration(Math.round((Date.parse(receipt.end_time) - Date.parse(receipt.slot_time)) / 60000))}</dd></div>
            {bookedService && <div><dt className="text-muted">Menu price</dt><dd className="mt-1 font-medium">{formatPrice(bookedService.price)} <span className="text-xs font-normal">{salon.currency}</span></dd></div>}
          </div>
          <div><dt className="text-muted">Date & time</dt><dd className="mt-1 font-medium">{bookedDate}<br />{formatSlotTime(receipt.slot_time, config.time_zone)} – {formatSlotTime(receipt.end_time, config.time_zone)}<span className="mt-1 block font-normal text-muted">Time zone: {config.time_zone}</span></dd></div>
          <div><dt className="text-muted">Customer</dt><dd className="mt-1 font-medium [overflow-wrap:anywhere]">{receipt.customer_name}</dd></div>
          <div><dt className="text-muted">Contact number</dt><dd className="mt-1 font-medium [overflow-wrap:anywhere]">{receipt.phone}</dd></div>
          <div><dt className="text-muted">Booking reference</dt><dd className="mt-1 select-all break-all font-mono text-xs">{receipt.id}</dd></div>
        </dl>
        <p className="mt-4 text-xs leading-6 text-muted">This confirms your reservation only. No payment was collected.</p>
        <Link href="/" className="button button-primary mt-7 w-full sm:w-auto">Back to the salon <ArrowIcon className="h-4 w-4" /></Link>
      </section>
    );
  }

  return (
    <>
      <p className="eyebrow">Appointments at {salon.name}</p>
      <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">Your next good hair day.</h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">Choose your service and a time that suits you. No account is needed.</p>
      <ol aria-label="Booking progress" className="my-8 grid max-w-2xl grid-cols-3 gap-2 sm:gap-5">
        {stepNames.map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined} className={`flex flex-col gap-2 border-t-2 pt-3 text-xs sm:flex-row sm:items-center sm:gap-3 sm:text-sm ${index <= step ? "border-forest text-forest" : "border-line text-muted"}`}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${index <= step ? "bg-forest text-cream" : "bg-[#e9ecdf]"}`} aria-hidden="true">{index < step ? "✓" : index + 1}</span>
            <span>{label}<span className="sr-only">{index < step ? ", completed" : ""}</span></span>
          </li>
        ))}
      </ol>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <form noValidate onSubmit={(event) => { event.preventDefault(); if (step === 2) void confirmBooking(); else nextStep(); }} className="min-w-0 rounded-2xl border border-line bg-white/50 p-5 sm:p-8" aria-busy={submitting}>
          <h2 ref={heading} tabIndex={-1} className="font-display text-3xl leading-tight">{["Choose your service", "Find your time", "Your appointment details"][step]}</h2>
          {message && <div role="alert" className="booking-alert mt-5">{message}</div>}
          <fieldset disabled={submitting} className="mt-6 min-w-0">
            <legend className="sr-only">{stepNames[step]}</legend>
            {step === 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {services.map((item) => (
                  <label key={item.id} className="relative min-w-0 cursor-pointer">
                    <input type="radio" name="service" value={item.id} checked={item.id === serviceId} className="peer sr-only" onChange={() => { setServiceId(item.id); setSlotTime(""); setMessage(""); setErrors({}); }} />
                    <span className="booking-choice flex h-full flex-col gap-4 p-4 peer-checked:border-forest peer-checked:bg-[#eef0e8] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-forest">
                      <span className="font-display text-2xl leading-tight [overflow-wrap:anywhere]">{item.name}</span>
                      <span className="mt-auto flex flex-wrap justify-between gap-2 text-sm"><span className="text-muted">{formatDuration(item.duration)}</span><span className="font-medium">{formatPrice(item.price)}</span></span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {step === 1 && (
              <>
                <label htmlFor="appointment-date" className="booking-label">Appointment date</label>
                <input id="appointment-date" type="date" className="booking-input mt-2" min={config.min_date} max={config.max_date} value={date} required aria-invalid={!!date && !dateIsValid} aria-describedby="schedule-hours" onChange={(event) => { setDate(event.target.value); setSlotTime(""); setMessage(""); }} />
                <p id="schedule-hours" className="mt-3 text-xs leading-6 text-muted">10:00 AM–8:00 PM daily · 30-minute start times<br />All times are in <strong className="font-medium text-forest">{config.time_zone}</strong>. Your service must finish by 8:00 PM.</p>
                <fieldset className="mt-7 min-w-0">
                  <legend className="booking-label">Available times{isCalendarDate(date) ? ` · ${formatBookingDate(date)}` : ""}</legend>
                  {!dateIsValid ? <p className="mt-4 text-sm text-muted">Choose a date between {formatBookingDate(config.min_date)} and {formatBookingDate(config.max_date)} to see the schedule.</p>
                    : availability.key !== queryKey || availability.status === "loading" ? (
                      <p role="status" className="mt-4 rounded-xl bg-[#eef0e8] px-4 py-5 text-sm text-muted">Checking the salon’s schedule…</p>
                    ) : availability.status === "error" ? (
                      <div className="mt-4"><p role="alert" className="booking-alert">{availability.error}</p><button type="button" className="button button-outline mt-3" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div>
                    ) : !availability.slots.length ? (
                      <p role="status" className="mt-4 rounded-xl border border-line bg-cream px-4 py-5 text-sm leading-7 text-muted">No times are available for this service on this date. Please choose another date or service.</p>
                    ) : (
                      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {availability.slots.map((slot) => (
                          <label key={slot.slot_time} className="cursor-pointer">
                            <input type="radio" name="slot" className="peer sr-only" checked={slotTime === slot.slot_time} value={slot.slot_time} onChange={() => { setSlotTime(slot.slot_time); setMessage(""); }} />
                            <span className="booking-choice flex min-h-12 items-center justify-center px-1 py-3 text-center text-sm peer-checked:border-forest peer-checked:bg-forest peer-checked:text-cream peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-forest">{formatSlotTime(slot.slot_time, config.time_zone)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                </fieldset>
              </>
            )}
            {step === 2 && (
              <div className="space-y-6">
                <p className="text-sm leading-7 text-muted">Add your name and a phone number the salon can use to reach you about this appointment.</p>
                <div>
                  <label htmlFor="customer-name" className="booking-label">Full name</label>
                  <input ref={nameInput} id="customer-name" name="customerName" autoComplete="name" type="text" className="booking-input mt-2" value={customerName} maxLength={100} required aria-invalid={!!errors.customerName} aria-describedby={errors.customerName ? "customer-name-error" : undefined} onChange={(event) => { setCustomerName(event.target.value); setErrors((old) => ({ ...old, customerName: undefined })); }} />
                  {errors.customerName && <p id="customer-name-error" className="field-error">{errors.customerName}</p>}
                </div>
                <div>
                  <label htmlFor="customer-phone" className="booking-label">Phone number</label>
                  <input ref={phoneInput} id="customer-phone" name="phone" autoComplete="tel" type="tel" inputMode="tel" className="booking-input mt-2" value={phone} maxLength={32} required aria-invalid={!!errors.phone} aria-describedby={`phone-hint${errors.phone ? " phone-error" : ""}`} onChange={(event) => { setPhone(event.target.value); setErrors((old) => ({ ...old, phone: undefined })); }} />
                  <p id="phone-hint" className="mt-2 text-xs leading-6 text-muted">Include your country code if needed. Spaces, brackets, and hyphens are accepted.</p>
                  {errors.phone && <p id="phone-error" className="field-error">{errors.phone}</p>}
                </div>
                <p className="rounded-xl bg-[#eef0e8] p-4 text-sm leading-7 text-muted">Your time is reserved only after you select <strong className="font-medium text-forest">Confirm booking</strong> and receive a confirmation. Availability is checked again when you confirm.</p>
              </div>
            )}
            <div className="mt-8 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-between">
              {step > 0 && <button type="button" className="button button-outline" onClick={() => { setStep((step - 1) as Step); setMessage(""); }}>Back</button>}
              <button type="submit" disabled={submitting || (step === 0 && !service) || (step === 1 && !selectedTimeIsAvailable)} className="button button-primary w-full sm:ml-auto sm:w-auto">
                {submitting ? "Confirming your appointment…" : step === 2 ? "Confirm booking" : "Continue"}
                {!submitting && <ArrowIcon className="h-4 w-4 shrink-0" />}
              </button>
            </div>
          </fieldset>
        </form>

        <aside aria-labelledby="appointment-summary-title" className="min-w-0 rounded-2xl border border-line bg-[#eef0e8] p-5 sm:p-7">
          <FlowerIcon className="mb-5 h-10 w-10 text-olive" />
          <h2 id="appointment-summary-title" className="font-display text-2xl">Your appointment</h2>
          {service ? (
            <dl className="mt-5 space-y-5 text-sm">
              <div><dt className="text-xs text-muted">Service</dt><dd className="mt-1.5 font-medium [overflow-wrap:anywhere]">{service.name}</dd></div>
              <div className="flex flex-wrap justify-between gap-3"><dt className="inline-flex items-center gap-2 text-muted"><ClockIcon className="h-4 w-4" />Duration</dt><dd>{formatDuration(service.duration)}</dd></div>
              <div className="flex flex-wrap justify-between gap-3"><dt className="text-muted">Menu price</dt><dd className="font-medium">{formatPrice(service.price)} <span className="text-xs font-normal">{salon.currency}</span></dd></div>
              {slotTime && <div className="border-t border-line pt-5"><dt className="text-xs text-muted">Selected time</dt><dd className="mt-1.5 font-medium">{formatBookingDate(date)}<br />{formatSlotTime(slotTime, config.time_zone)}<span className="mt-1 block text-xs font-normal text-muted">{config.time_zone}</span></dd></div>}
            </dl>
          ) : <p className="mt-4 text-sm leading-7 text-muted">Choose a service to see its duration and menu price here.</p>}
          <p className="mt-6 border-t border-line pt-5 text-xs leading-6 text-muted">Availability is shared across the salon. Your service’s full duration is reserved, not just its start time.</p>
        </aside>
      </div>
    </>
  );
}
