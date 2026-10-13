import { cloud } from "./client";

const safeBillingCodes = new Set([
  "backend_not_configured",
  "billing_portal_unavailable",
  "billing_provider_unavailable",
  "invalid_plan",
  "session_expired",
]);

function payloadCode(data: unknown): string | undefined {
  if (data && typeof data === "object" && "code" in data && typeof data.code === "string")
    return safeBillingCodes.has(data.code) ? data.code : undefined;
  return undefined;
}

async function code(error: unknown, data: unknown): Promise<Error> {
  const direct = payloadCode(data);
  if (direct) return new Error(direct);

  const context = error && typeof error === "object" && "context" in error
    ? error.context
    : undefined;

  if (context instanceof Response) {
    const responsePayload = await context.clone().json().catch(() => null);
    const responseCode = payloadCode(responsePayload);
    if (responseCode) return new Error(responseCode);
  }

  return new Error("billing_provider_unavailable");
}

async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//i.test(url)) throw new Error("billing_provider_unavailable");
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      throw new Error("billing_external_open_failed");
    }
    return;
  }
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.assign(url);
  } catch {
    throw new Error("billing_external_open_failed");
  }
}

export const billing = {
  async checkout(plan: "plus" | "pro", billingPeriod: "monthly" | "annual"): Promise<void> {
    const { data, error } = await cloud().functions.invoke<{ checkoutUrl?: string }>("billing-checkout", {
      body: { plan, billingPeriod },
    });
    if (error || typeof data?.checkoutUrl !== "string") throw await code(error, data);
    await openExternal(data.checkoutUrl);
  },
  async portal(): Promise<void> {
    const { data, error } = await cloud().functions.invoke<{ portalUrl?: string }>("billing-portal", { body: {} });
    if (error || typeof data?.portalUrl !== "string") throw await code(error, data);
    await openExternal(data.portalUrl);
  },
};
