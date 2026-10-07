import type { AvailableSlot, BookingReceipt } from "@/types/database";
import type { BookingFieldErrors, BookingRequest } from "./booking-validation.ts";
import { isCalendarDate, isSlotInstant, isUuid, validateBookingRequest } from "./booking-validation.ts";

type QueryResult<T> = { data: T[] | null; error: unknown };
type Failure = { status: 400 | 409 | 429 | 503; body: { error: string; fieldErrors?: BookingFieldErrors } };

const quotaMessages: Record<string, string> = {
  PHONE_ACTIVE_LIMIT: "This phone number already has the maximum number of upcoming appointments. Please contact the salon for help.",
  PHONE_WINDOW_LIMIT: "This phone number has reached its booking limit for the past 24 hours. Please try again later or contact the salon.",
  GLOBAL_SUBMISSION_LIMIT: "The salon has reached its daily online booking limit. Please try again tomorrow or contact the salon.",
};

function databaseFailure(error: unknown, writing = false): Failure {
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  if (detail.code === "PT429") {
    const message = typeof detail.message === "string" && Object.hasOwn(quotaMessages, detail.message)
      ? quotaMessages[detail.message]
      : "The online booking limit has been reached. Please try again later or contact the salon.";
    return { status: 429, body: { error: message } };
  }
  if (detail.code === "23P01" || detail.code === "23505" || detail.message === "SLOT_UNAVAILABLE") {
    return { status: 409, body: { error: "That time was just reserved. Please choose another available time." } };
  }
  if (typeof detail.code === "string" && detail.code.startsWith("22")) {
    return { status: 400, body: { error: "Please check the service, appointment time, and contact details, then try again." } };
  }
  return {
    status: 503,
    body: { error: writing
      ? "We couldn’t verify whether your appointment was saved. Please retry with the same details."
      : "We couldn’t load available times. Please try again." },
  };
}

export async function getAvailability(
  serviceId: unknown,
  date: unknown,
  query: (serviceId: string, date: string) => Promise<QueryResult<AvailableSlot>>,
): Promise<Failure | { status: 200; body: { slots: AvailableSlot[] } }> {
  if (!isUuid(serviceId) || !isCalendarDate(date)) {
    return { status: 400, body: { error: "Choose a valid service and date." } };
  }
  try {
    const result = await query(serviceId, date);
    if (result.error || !Array.isArray(result.data)) return databaseFailure(result.error);
    if (!result.data.every((slot) => isSlotInstant(slot?.slot_time))) return databaseFailure(null);
    return { status: 200, body: { slots: result.data.map(({ slot_time }) => ({ slot_time })) } };
  } catch {
    return databaseFailure(null);
  }
}

export function getConfirmedBooking(saved: unknown, request: BookingRequest): BookingReceipt | null {
  if (!saved || typeof saved !== "object") return null;
  const booking = saved as Record<string, unknown>;
  if (booking.id !== request.bookingId || booking.service_id !== request.serviceId
    || booking.status !== "confirmed" || !isSlotInstant(booking.slot_time)
    || Date.parse(booking.slot_time) !== Date.parse(request.slotTime)
    || !isSlotInstant(booking.end_time) || Date.parse(booking.end_time) <= Date.parse(booking.slot_time)
    || booking.customer_name !== request.customerName || booking.phone !== request.phone) return null;
  // Select receipt fields explicitly; do not propagate unexpected database data.
  return {
    id: request.bookingId, service_id: request.serviceId,
    customer_name: request.customerName, phone: request.phone,
    slot_time: booking.slot_time, end_time: booking.end_time, status: "confirmed",
  };
}

export async function submitBooking(
  input: unknown,
  persist: (request: BookingRequest) => Promise<QueryResult<BookingReceipt>>,
): Promise<Failure | { status: 201; body: { booking: BookingReceipt } }> {
  const checked = validateBookingRequest(input);
  if (!checked.valid) {
    return { status: 400, body: { error: "Please check the highlighted details.", fieldErrors: checked.errors } };
  }
  try {
    const result = await persist(checked.value);
    if (result.error) return databaseFailure(result.error, true);
    // Confirm only an actual matching database receipt, never echo submitted
    // data as a successful reservation when the write outcome is unknown.
    const saved = getConfirmedBooking(result.data?.[0], checked.value);
    if (!saved) return databaseFailure(null, true);
    return { status: 201, body: { booking: saved } };
  } catch {
    return databaseFailure(null, true);
  }
}
