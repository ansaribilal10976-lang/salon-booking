export type AdminView = "today" | "upcoming";
export type ServiceInput = { name: string; duration: number; price: number };
export type ServiceFieldErrors = Partial<Record<keyof ServiceInput, string>>;

export function parseAdminFilters(view: unknown, page: unknown): { view: AdminView; page: number; offset: number } {
  const selected = view === "upcoming" ? "upcoming" : "today";
  const parsed = typeof page === "string" && /^\d+$/.test(page) ? Number(page) : 1;
  const current = Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 201 ? parsed : 1;
  return { view: selected, page: current, offset: (current - 1) * 50 };
}

export function validateServiceInput(input: unknown):
  | { valid: true; value: ServiceInput }
  | { valid: false; errors: ServiceFieldErrors } {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const errors: ServiceFieldErrors = {};
  if (Array.from(name).length < 1 || Array.from(name).length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    errors.name = "Enter a service name between 1 and 120 characters.";
  }
  if (typeof source.duration !== "number" || !Number.isInteger(source.duration) || source.duration < 1 || source.duration > 600) {
    errors.duration = "Enter a whole-number duration between 1 and 600 minutes.";
  }
  if (typeof source.price !== "number" || !Number.isFinite(source.price) || source.price < 0 || source.price > 99999999.99
    || Math.abs(source.price * 100 - Math.round(source.price * 100)) > 0.000001) {
    errors.price = "Enter a non-negative price with at most two decimal places.";
  }
  return Object.keys(errors).length ? { valid: false, errors } : {
    valid: true, value: { name, duration: source.duration as number, price: source.price as number },
  };
}

export function canChangeBookingStatus(current: string, target: string): boolean {
  return (current === "pending" || current === "confirmed") && (target === "confirmed" || target === "cancelled");
}

export function isAdminPasswordInput(email: unknown, password: unknown): boolean {
  return typeof email === "string" && email.trim().length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    && typeof password === "string" && password.length > 0 && password.length <= 4096;
}
