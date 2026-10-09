"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import admin from "@/app/admin/admin.module.css";
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
    setEditingId(service?.id ?? null); setName(service?.name ?? ""); setDuration(service ? String(service.duration) : ""); setPrice(service ? String(service.price) : ""); setShowEditor(true); setDeleteId(null); setErrors({}); setMessage(""); setNotice("");
    requestAnimationFrame(() => { editorHeading.current?.focus(); editorHeading.current?.scrollIntoView({ block: "nearest" }); });
  }
  function mutationError(failure: unknown) { setMessage(failure instanceof Error ? failure.message : "The service change could not be saved."); if (failure instanceof AdminRequestError) { if (failure.fieldErrors) setErrors(failure.fieldErrors); if (failure.status === 401 || failure.status === 403) setNeedsLogin(true); } }
  async function save() {
    if (pendingRef.current || disabled) return;
    setMessage(""); setNotice(""); setErrors({});
    const checked = validateServiceInput({ name, duration: duration.trim() ? Number(duration) : NaN, price: price.trim() ? Number(price) : NaN });
    if (!checked.valid) { setErrors(checked.errors); setMessage("Check the service details below."); if (checked.errors.name) nameInput.current?.focus(); return; }
    pendingRef.current = true; setPending(true);
    try {
      const result = await adminRequest(editingId ? `/api/admin/services/${editingId}` : "/api/admin/services", editingId ? "PATCH" : "POST", checked.value);
      if (!result.service || (editingId && result.service.id !== editingId)) throw new Error("The saved service could not be verified. Refresh before retrying.");
      setNotice(editingId ? "Service updated. The public menu will show the new details." : "Service added to the public menu."); setShowEditor(false); setEditingId(null); setName(""); setDuration(""); setPrice(""); startTransition(() => router.refresh());
    } catch (failure) { mutationError(failure); } finally { pendingRef.current = false; setPending(false); }
  }
  async function remove(id: string) {
    if (pendingRef.current || disabled) return;
    pendingRef.current = true; setPending(true); setMessage(""); setNotice("");
    try { const result = await adminRequest(`/api/admin/services/${id}`, "DELETE"); if (result.deletedId !== id) throw new Error("The deletion could not be verified. Refresh before retrying."); setDeleteId(null); if (editingId === id) { setShowEditor(false); setEditingId(null); } setNotice("Service deleted from the public menu."); startTransition(() => router.refresh()); }
    catch (failure) { mutationError(failure); } finally { pendingRef.current = false; setPending(false); }
  }

  return (
    <section aria-labelledby="admin-services-title" className={admin.services}>
      <Card className={admin.servicePanel}>
        <CardContent className={admin.serviceContent}>
          <h2 id="admin-services-title" className={admin.sectionTitle}>Salon services</h2>
          <p className={admin.serviceIntro}>Prices are shown in {salon.currency}. Changes affect new bookings, not existing reserved times.</p>
          {error ? <p role="alert" className={`booking-alert ${admin.alert}`}>{error}</p> : (
            <>
              <Button type="button" disabled={disabled} className={admin.addService} onClick={() => edit()}><Plus aria-hidden="true" />Add a service</Button>
              {message && <p role="alert" className={`booking-alert ${admin.alert}`}>{message}</p>}
              {notice && <p role="status" className={admin.notice}>{notice}</p>}
              {needsLogin && <Link href="/admin/login" className={admin.loginLink}>Sign in with an approved account</Link>}
              {showEditor && (
                <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} className={admin.editor} aria-busy={pending}>
                  <h3 ref={editorHeading} tabIndex={-1} className={admin.editorTitle}>{editingId ? "Edit service" : "New service"}</h3>
                  <fieldset disabled={disabled} className={admin.editorFields}>
                    <legend className="sr-only">Service details</legend>
                    <div>
                      <label htmlFor="service-name" className="booking-label">Service name</label>
                      <input ref={nameInput} id="service-name" type="text" className="booking-input" value={name} maxLength={120} required aria-invalid={!!errors.name} aria-describedby={errors.name ? "service-name-error" : undefined} onChange={(event) => setName(event.target.value)} />
                      {errors.name && <p id="service-name-error" className="field-error">{errors.name}</p>}
                    </div>
                    <div>
                      <label htmlFor="service-duration" className="booking-label">Duration in minutes</label>
                      <input id="service-duration" type="number" inputMode="numeric" min={1} max={600} step={1} className="booking-input" value={duration} required aria-invalid={!!errors.duration} aria-describedby={errors.duration ? "service-duration-error" : undefined} onChange={(event) => setDuration(event.target.value)} />
                      {errors.duration && <p id="service-duration-error" className="field-error">{errors.duration}</p>}
                    </div>
                    <div>
                      <label htmlFor="service-price" className="booking-label">Price ({salon.currency})</label>
                      <input id="service-price" type="number" inputMode="decimal" min={0} max={99999999.99} step="0.01" className="booking-input" value={price} required aria-invalid={!!errors.price} aria-describedby={errors.price ? "service-price-error" : undefined} onChange={(event) => setPrice(event.target.value)} />
                      {errors.price && <p id="service-price-error" className="field-error">{errors.price}</p>}
                    </div>
                    <div className={admin.editorActions}>
                      <Button type="submit" disabled={disabled}>{pending ? "Saving service…" : editingId ? "Save changes" : "Add service"}</Button>
                      <Button type="button" variant="outline" onClick={() => { setShowEditor(false); setEditingId(null); setErrors({}); setMessage(""); }}>Discard edits</Button>
                    </div>
                  </fieldset>
                </form>
              )}
              {!services.length ? (
                <p className={admin.serviceEmpty}>Your menu is empty. Add your first service with its appointment length and approved price.</p>
              ) : (
                <ul className={admin.serviceList}>
                  {services.map((service) => (
                    <li key={service.id} className={admin.service}>
                      <h3 className={admin.menuName}>{service.name}</h3>
                      <div className={admin.menuDetails}>
                        <span>{formatDuration(service.duration)}</span>
                        <span className={admin.menuPrice}>{formatPrice(service.price)}</span>
                      </div>
                      <div className={admin.menuActions}>
                        <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={`Edit ${service.name}`} onClick={() => edit(service)}>Edit</Button>
                        <Button type="button" variant="outline" size="sm" disabled={disabled} className={admin.dangerAction} aria-label={`Delete ${service.name}`} onClick={() => { setDeleteId(service.id); setMessage(""); setNotice(""); }}>Delete</Button>
                      </div>
                      {deleteId === service.id && (
                        <div role="group" aria-label={`Confirm deletion of ${service.name}`} className={admin.confirmation}>
                          <p>Delete this service permanently? Services with any bookings attached cannot be deleted.</p>
                          <Button type="button" variant="destructive" disabled={disabled} onClick={() => void remove(service.id)}>{pending ? "Deleting…" : "Yes, delete service"}</Button>
                          <Button type="button" variant="outline" disabled={disabled} onClick={() => setDeleteId(null)}>Keep service</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
