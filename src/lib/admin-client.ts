export class AdminRequestError extends Error {
  status: number;
  fieldErrors?: Record<string, string>;
  constructor(message: string, status: number, fieldErrors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export async function adminRequest(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new AdminRequestError(typeof payload.error === "string" ? payload.error : "This change could not be saved.", response.status, payload.fieldErrors);
    }
    return payload;
  } catch (error) {
    if (error instanceof AdminRequestError) throw error;
    throw new AdminRequestError("We couldn’t verify whether the change was saved. Refresh the dashboard before retrying.", 503);
  } finally {
    clearTimeout(timeout);
  }
}
