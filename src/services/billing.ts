import { cloud } from "./client";

function code(error: unknown, data: unknown): Error {
  if (data && typeof data === "object" && "code" in data && typeof data.code === "string")
    return new Error(data.code);
  return error instanceof Error ? error : new Error("billing_provider_unavailable");
}

async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//i.test(url)) throw new Error("billing_provider_unavailable");
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}

export const billing = {
  async checkout(plan: "plus" | "pro", billingPeriod: "monthly" | "annual"): Promise<void> {
    const { data, error } = await cloud().functions.invoke<{ checkoutUrl?: string }>("billing-checkout", {
      body: { plan, billingPeriod },
    });
    if (error || typeof data?.checkoutUrl !== "string") throw code(error, data);
    await openExternal(data.checkoutUrl);
  },
  async portal(): Promise<void> {
    const { data, error } = await cloud().functions.invoke<{ portalUrl?: string }>("billing-portal", { body: {} });
    if (error || typeof data?.portalUrl !== "string") throw code(error, data);
    await openExternal(data.portalUrl);
  },
};
