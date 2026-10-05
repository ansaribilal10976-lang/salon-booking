import type { BookingReceipt, Service } from "@/types/database";
import { isUuid } from "./booking-validation.ts";
import { validateServiceInput } from "./admin-validation.ts";
import type { ServiceFieldErrors, ServiceInput } from "./admin-validation.ts";

type Result<T> = { data: T[] | null; error: unknown };
type Failure = { status: 400 | 403 | 404 | 409 | 503; body: { error: string; fieldErrors?: ServiceFieldErrors } };

function mutationFailure(error: unknown, action: "service" | "booking"): Failure {
  const failure = error && typeof error === "object" ? error as Record<string, unknown> : {};
  if (failure.code === "42501") return { status: 403, body: { error: "Administrator access is required. Please sign in with an approved account." } };
  if (failure.code === "23503") return { status: 409, body: { error: "This service has bookings attached and cannot be deleted. You can edit its name, duration, or price instead." } };
  if (failure.code === "23P01" || failure.code === "23505") return { status: 409, body: { error: "That update conflicts with an existing reservation. Refresh the dashboard and try again." } };
  if (typeof failure.code === "string" && (failure.code.startsWith("22") || failure.code === "23514")) {
    return { status: 400, body: { error: action === "booking"
      ? "This booking cannot be changed to that status. Cancelled and completed bookings cannot be reopened."
      : "Please check the service name, duration, and price." } };
  }
  return { status: 503, body: { error: "We couldn’t verify whether the change was saved. Refresh the dashboard before trying again." } };
}

function serviceRow(value: unknown): Service | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const checked = validateServiceInput(row);
  return isUuid(row.id) && checked.valid
    ? { id: row.id, ...checked.value } : null;
}

export async function saveAdminService(
  input: unknown,
  id: unknown,
  persist: (values: ServiceInput, id: string | null) => Promise<Result<Service>>,
): Promise<Failure | { status: 200 | 201; body: { service: Service } }> {
  if (id !== null && !isUuid(id)) return { status: 400, body: { error: "Choose a valid service to edit." } };
  const checked = validateServiceInput(input);
  if (!checked.valid) return { status: 400, body: { error: "Please check the highlighted service details.", fieldErrors: checked.errors } };
  try {
    const result = await persist(checked.value, id);
    if (result.error) return mutationFailure(result.error, "service");
    if (result.data?.length === 0) return { status: 404, body: { error: "This service no longer exists. Refresh the menu." } };
    const saved = serviceRow(result.data?.[0]);
    if (!saved || (id && saved.id !== id) || saved.name !== checked.value.name
      || saved.duration !== checked.value.duration || saved.price !== checked.value.price) return mutationFailure(null, "service");
    return { status: id ? 200 : 201, body: { service: saved } };
  } catch {
    return mutationFailure(null, "service");
  }
}

export async function deleteAdminService(
  id: unknown,
  remove: (id: string) => Promise<Result<{ id: string }>>,
): Promise<Failure | { status: 200; body: { deletedId: string } }> {
  if (!isUuid(id)) return { status: 400, body: { error: "Choose a valid service to delete." } };
  try {
    const result = await remove(id);
    if (result.error) return mutationFailure(result.error, "service");
    if (result.data?.length === 0) return { status: 404, body: { error: "This service no longer exists. Refresh the menu." } };
    if (result.data?.[0]?.id !== id) return mutationFailure(null, "service");
    return { status: 200, body: { deletedId: id } };
  } catch {
    return mutationFailure(null, "service");
  }
}

export async function setAdminBookingStatus(
  id: unknown,
  input: unknown,
  update: (id: string, status: "confirmed" | "cancelled") => Promise<Result<BookingReceipt>>,
): Promise<Failure | { status: 200; body: { booking: { id: string; status: "confirmed" | "cancelled" } } }> {
  const status = input && typeof input === "object" ? (input as Record<string, unknown>).status : null;
  if (!isUuid(id) || (status !== "confirmed" && status !== "cancelled")) return { status: 400, body: { error: "Choose a valid booking and a confirm or cancel action." } };
  try {
    const result = await update(id, status);
    if (result.error) return mutationFailure(result.error, "booking");
    if (result.data?.[0]?.id !== id || result.data[0].status !== status) return mutationFailure(null, "booking");
    // The action response doesn't need to send customer contact details again.
    return { status: 200, body: { booking: { id, status } } };
  } catch {
    return mutationFailure(null, "booking");
  }
}
