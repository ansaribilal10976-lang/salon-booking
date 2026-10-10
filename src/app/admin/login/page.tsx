import { redirect } from "next/navigation";
import { AdminLogin } from "@/components/admin-login";
import { FlowerIcon } from "@/components/icons";
import { getAdminAccess } from "@/lib/admin-server";
import { salon } from "@/lib/salon";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { access } = await getAdminAccess();
  if (access.allowed) redirect("/admin");
  if (access.status === 403) redirect("/admin/access-denied");
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const params = await searchParams;
  const verificationFailed = params.error === "verification";

  return (
    <section aria-labelledby="admin-login-title" className="admin-surface mx-auto grid max-w-4xl overflow-hidden md:grid-cols-[0.9fr_1.1fr]">
      <div className="dark-panel hidden min-h-[520px] flex-col justify-between p-10 md:flex">
        <div>
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--blush)] text-[var(--blush)]">
            <FlowerIcon className="h-7 w-7" />
          </span>
          <p className="eyebrow mt-10 text-[var(--blush)]">Private studio workspace</p>
          <h1 className="mt-4 font-display text-5xl leading-[0.98]">
            Welcome back <span className="italic text-[var(--blush)]">to {salon.name}.</span>
          </h1>
        </div>
        <p className="max-w-xs text-sm leading-7 text-[var(--cream)]/65">A calm place to keep the day moving, one appointment at a time.</p>
      </div>
      <div className="p-6 sm:p-10">
        <div className="md:hidden"><FlowerIcon className="h-12 w-12 text-[var(--clay)]" /></div>
        <p className="eyebrow mt-7 md:mt-0">For the salon team</p>
        <h2 id="admin-login-title" className="mt-3 font-display text-4xl leading-tight sm:text-5xl">Sign in to continue.</h2>
        <p className="mt-4 text-sm leading-7 text-[var(--muted)]">Manage appointments and keep your service menu ready for the next guest.</p>
        {verificationFailed && (
          <p role="alert" className="booking-alert mt-6">
            We couldn’t verify your session. Please try signing in again.
          </p>
        )}
        <AdminLogin configured={configured} />
      </div>
    </section>
  );
}
