import { redirect } from "next/navigation";
import { AdminLogin } from "@/components/admin-login";
import { FlowerIcon } from "@/components/icons";
import { getAdminAccess } from "@/lib/admin-server";

export default async function AdminLoginPage() {
  const { access } = await getAdminAccess();
  if (access.allowed) redirect("/admin");
  if (access.status === 403) redirect("/admin/access-denied");
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return (
    <section aria-labelledby="admin-login-title" className="mx-auto max-w-md rounded-2xl border border-line bg-white/60 p-6 sm:mt-6 sm:p-9">
      <FlowerIcon className="mb-7 h-12 w-12 text-olive" />
      <p className="eyebrow">For the salon team</p>
      <h1 id="admin-login-title" className="mt-3 font-display text-4xl leading-tight">Welcome back.</h1>
      <p className="mt-4 text-sm leading-7 text-muted">Sign in to manage appointments and keep your service menu up to date.</p>
      <AdminLogin configured={configured} />
    </section>
  );
}
