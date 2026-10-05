"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminRequestError, adminRequest } from "@/lib/admin-client";
import { validateServiceInput } from "@/lib/admin-validation";
import type { ServiceFieldErrors } from "@/lib/admin-validation";
import { formatDuration, formatPrice, salon } from "@/lib/salon";
import type { Service } from "@/types/database";

export function AdminServices({ services, error }: { services: Service[]; error: string | null }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<ServiceFieldErrors>({});
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const pendingRef = useRef(false);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const disabled = pending || refreshing || needsLogin;

  function edit(service?: Service) {
    setEditingId(service?.id ?? null);
    setName(service?.name ?? "");
    setDuration(service ? String(service.duration) : "");
    setPrice(service ? String(service.price) : "");
    setShowEditor(true);
    setDeleteId(null);
    setErrors({});
    setMessage("");
    setNotice("");
    // The editor sits above the list, which can extend below the fold.
    requestAnimationFrame(() => { editorHeading.current?.focus(); editorHeading.current?.scrollIntoView({ block: "nearest" }); });
  }

  function mutationError(failure: unknown) {
    setMessage(failure instanceof Error ? failure.message : "The service change could not be saved.");
    if (failure instanceof AdminRequestError) {
      if (failure.fieldErrors) setErrors(failure.fieldErrors);
      if (failure.status === 401 || failure.status === 403) setNeedsLogin(true);
    }
  }

  async function save() {
    if (pendingRef.current || disabled) return;
    setMessage("");
    setNotice("");
    setErrors({});
    const checked = validateServiceInput({ name, duration: duration.trim() ? Number(duration) : NaN, price: price.trim() ? Number(price) : NaN });
    if (!checked.valid) { setErrors(checked.errors); setMessage("Check the service details below."); if (checked.errors.name) nameInput.current?.focus(); return; }
    pendingRef.current = true;
    setPending(true);
    try {
      const result = await adminRequest(editingId ? `/api/admin/services/${editingId}` : "/api/admin/services", editingId ? "PATCH" : "POST", checked.value);
      if (!result.service || (editingId && result.service.id !== editingId)) throw new Error("The saved service could not be verified. Refresh before retrying.");
      setNotice(editingId ? "Service updated. The public menu will show the new details." : "Service added to the public menu.");
      setShowEditor(false);
      setEditingId(null);
      setName(""); setDuration(""); setPrice("");
      startTransition(() => router.refresh());
    } catch (failure) {
      mutationError(failure);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function remove(id: string) {
    if (pendingRef.current || disabled) return;
    pendingRef.current = true;
    setPending(true);
    setMessage("");
    setNotice("");
    try {
      const result = await adminRequest(`/api/admin/services/${id}`, "DELETE");
      if (result.deletedId !== id) throw new Error("The deletion could not be verified. Refresh before retrying.");
      setDeleteId(null);
      if (editingId === id) { setShowEditor(false); setEditingId(null); }
      setNotice("Service deleted from the public menu.");
      startTransition(() => router.refresh());
    } catch (failure) {
      mutationError(failure);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="admin-services-title" className="min-w-0 border-t border-line pt-8 lg:border-t-0 lg:pt-0">
      <p className="eyebrow">Keep the menu current</p>
      <h2 id="admin-services-title" className="mt-2 font-display text-3xl">Salon services</h2>
      <p className="mt-4 text-xs leading-6 text-muted">Prices are shown in {salon.currency}. Changing duration affects new bookings, not existing reserved times.</p>
      {error ? <p role="alert" className="booking-alert mt-5">{error}</p> : (
        <>
          <button type="button" disabled={disabled} className="button button-primary mt-5 w-full" onClick={() => edit()}>Add a service <span aria-hidden="true" className="text-xl leading-none">+</span></button>
          {message && <p role="alert" className="booking-alert mt-5">{message}</p>}
          {notice && <p role="status" className="mt-5 rounded-xl bg-[#e9ecdf] p-4 text-sm leading-7 text-forest">{notice}</p>}
          {needsLogin && <Link href="/admin/login" className="nav-link mt-3 text-sm">Sign in with an approved account</Link>}
          {showEditor && (
            <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} className="mt-6 rounded-2xl border border-olive/50 bg-white/60 p-5" aria-busy={pending}>
              <h3 ref={editorHeading} tabIndex={-1} className="font-display text-2xl">{editingId ? "Edit service" : "New service"}</h3>
              <fieldset disabled={disabled} className="mt-5 min-w-0 space-y-5">
                <legend className="sr-only">Service details</legend>
                <div>
                  <label htmlFor="service-name" className="booking-label">Service name</label>
                  <input ref={nameInput} id="service-name" type="text" className="booking-input mt-2" value={name} maxLength={120} required aria-invalid={!!errors.name} aria-describedby={errors.name ? "service-name-error" : undefined} onChange={(event) => setName(event.target.value)} />
                  {errors.name && <p id="service-name-error" className="field-error">{errors.name}</p>}
                </div>
                <div>
                  <label htmlFor="service-duration" className="booking-label">Duration in minutes</label>
                  <input id="service-duration" type="number" inputMode="numeric" min={1} max={600} step={1} className="booking-input mt-2" value={duration} required aria-invalid={!!errors.duration} aria-describedby={errors.duration ? "service-duration-error" : undefined} onChange={(event) => setDuration(event.target.value)} />
                  {errors.duration && <p id="service-duration-error" className="field-error">{errors.duration}</p>}
                </div>
                <div>
                  <label htmlFor="service-price" className="booking-label">Price ({salon.currency})</label>
                  <input id="service-price" type="number" inputMode="decimal" min={0} max={99999999.99} step="0.01" className="booking-input mt-2" value={price} required aria-invalid={!!errors.price} aria-describedby={errors.price ? "service-price-error" : undefined} onChange={(event) => setPrice(event.target.value)} />
                  {errors.price && <p id="service-price-error" className="field-error">{errors.price}</p>}
                </div>
                <button type="submit" disabled={disabled} className="button button-primary w-full">{pending ? "Saving service…" : editingId ? "Save changes" : "Add service"}</button>
                <button type="button" className="button button-outline w-full" onClick={() => { setShowEditor(false); setEditingId(null); setErrors({}); setMessage(""); }}>Discard edits</button>
              </fieldset>
            </form>
          )}
          {!services.length ? <p className="mt-6 rounded-2xl border border-line p-5 text-sm leading-7 text-muted">Your menu is empty. Add your first service with its appointment length and approved price.</p> : (
            <ul className="mt-6 space-y-3">
              {services.map((service) => (
                <li key={service.id} className="min-w-0 rounded-2xl border border-line bg-white/60 p-5">
                  <h3 className="font-display text-2xl leading-tight [overflow-wrap:anywhere]">{service.name}</h3>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-muted">{formatDuration(service.duration)}</span><span className="font-medium">{formatPrice(service.price)}</span></div>
                  <div className="mt-4 flex gap-2 border-t border-line pt-4"><button type="button" disabled={disabled} className="button button-outline flex-1 px-4" aria-label={`Edit ${service.name}`} onClick={() => edit(service)}>Edit</button><button type="button" disabled={disabled} className="button button-outline flex-1 border-[#d9b7a9] px-4 text-[#753c2b]" aria-label={`Delete ${service.name}`} onClick={() => { setDeleteId(service.id); setMessage(""); setNotice(""); }}>Delete</button></div>
                  {deleteId === service.id && (
                    <div role="group" aria-label={`Confirm deletion of ${service.name}`} className="mt-4 rounded-xl border border-[#d9b7a9] bg-[#fff3eb] p-4">
                      <p className="text-sm leading-7 text-[#753c2b]">Delete this service permanently? Services with any bookings attached cannot be deleted.</p>
                      <button type="button" disabled={disabled} className="button button-primary mt-3 w-full" onClick={() => void remove(service.id)}>{pending ? "Deleting…" : "Yes, delete service"}</button>
                      <button type="button" disabled={disabled} className="button button-outline mt-2 w-full" onClick={() => setDeleteId(null)}>Keep service</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
