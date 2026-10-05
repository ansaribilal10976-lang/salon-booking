export type BookingRequest = {
  bookingId: string;
  serviceId: string;
  slotTime: string;
  customerName: string;
  phone: string;
};

export type BookingFieldErrors = Partial<Record<keyof BookingRequest, string>>;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isSlotInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  return isCalendarDate(value.slice(0, 10)) && hour < 24 && minute < 60 && second < 60
    && Number.isFinite(Date.parse(value));
}

export function validateBookingRequest(input: unknown):
  | { valid: true; value: BookingRequest }
  | { valid: false; errors: BookingFieldErrors } {
  const values = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  const errors: BookingFieldErrors = {};
  const name = typeof values.customerName === "string" ? values.customerName.trim() : "";
  const phone = typeof values.phone === "string" ? values.phone.trim() : "";

  if (!isUuid(values.bookingId)) errors.bookingId = "Please reload the booking page and try again.";
  if (!isUuid(values.serviceId)) errors.serviceId = "Choose a service from the menu.";
  if (!isSlotInstant(values.slotTime)) errors.slotTime = "Choose an available appointment time.";
  if (Array.from(name).length < 2 || Array.from(name).length > 100 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    errors.customerName = "Enter a name between 2 and 100 characters.";
  }
  const digits = phone.replace(/\D/g, "");
  if (phone.length > 32 || !/^[0-9+(). \-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    errors.phone = "Enter a phone number with 7 to 15 digits, including your country code if needed.";
  }

  if (Object.keys(errors).length) return { valid: false, errors };
  return {
    valid: true,
    value: {
      bookingId: values.bookingId as string,
      serviceId: values.serviceId as string,
      slotTime: new Date(values.slotTime as string).toISOString(),
      customerName: name,
      phone,
    },
  };
}

export function formatSlotTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(instant));
}

export function formatBookingDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}
