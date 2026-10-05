import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSignOut } from "@/components/admin-sign-out";
import { getAdminAccess } from "@/lib/admin-server";

export default async function AdminAccessDeniedPage() {
  const { access } = await getAdminAccess();
  if (access.allowed) redirect("/admin");
  if (access.status === 401) redirect("/admin/login");
  return (
    <section aria-labelledby="admin-access-title" className="mx-auto max-w-xl rounded-2xl border border-line bg-white/60 p-6 sm:p-10">
      <p className="eyebrow">Administrator access</p>
      <h1 id="admin-access-title" className="mt-3 font-display text-4xl leading-tight">{access.status === 403 ? "This account isn’t on the salon team yet." : "Admin access could not be checked."}</h1>
      <p className="mt-5 text-sm leading-7 text-muted">{access.status === 403 ? "A salon account owner must explicitly grant administrator access. Being signed in alone does not give access to customer bookings or service changes." : "Please try again shortly. No customer bookings have been shown."}</p>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row"><AdminSignOut /><Link href="/admin" className="button button-outline">Check access again</Link></div>
    </section>
  );
}
