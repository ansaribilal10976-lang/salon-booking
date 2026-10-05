export type AdminIdentity = { id: string; email?: string };
export type AdminAccess =
  | { allowed: true; user: AdminIdentity }
  | { allowed: false; status: 401 | 403 | 503; error: string };

export async function resolveAdminAccess(
  authenticate: () => Promise<{ user: AdminIdentity | null; error: unknown }>,
  checkAdmin: () => Promise<{ data: boolean | null; error: unknown }>,
): Promise<AdminAccess> {
  try {
    // Must be server-verified getUser(), not a locally decoded session, email
    // address, or editable user_metadata role.
    const identity = await authenticate();
    if (identity.error || !identity.user) {
      return { allowed: false, status: 401, error: "Your session has expired. Please sign in again." };
    }
    const role = await checkAdmin();
    if (role.error || role.data === null) {
      return { allowed: false, status: 503, error: "Admin access could not be verified. Please try again." };
    }
    if (role.data !== true) {
      return { allowed: false, status: 403, error: "This account has not been granted salon administrator access." };
    }
    return { allowed: true, user: { id: identity.user.id, email: identity.user.email } };
  } catch {
    return { allowed: false, status: 503, error: "Admin access could not be verified. Please try again." };
  }
}

export async function runAdminOperation<T>(
  access: AdminAccess,
  operation: () => Promise<T>,
): Promise<T | { status: 401 | 403 | 503; body: { error: string } }> {
  if (!access.allowed) return { status: access.status, body: { error: access.error } };
  return await operation();
}
