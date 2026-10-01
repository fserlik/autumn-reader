import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { t } from "../i18n";
import type { Database } from "./types";
import { CloudError } from "./errors";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();
export const cloudConfigured = Boolean(url && key);
let client: SupabaseClient<Database> | undefined;
export function cloud(): SupabaseClient<Database> {
  if (!cloudConfigured) throw new CloudError("not_configured");
  return (client ??= createClient<Database>(url!, key!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storageKey: "autumn-auth",
    },
  }));
}
/** Recheck credentials without replacing or persisting the reader's active session. */
export function temporaryAuthClient(): SupabaseClient<Database> {
  if (!cloudConfigured) throw new CloudError("not_configured");
  return createClient<Database>(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
export function checkError(
  error: { message: string; code?: string } | null,
): void {
  if (!error) return;
  if (error.code === "PGRST301" || error.code === "PGRST303")
    throw new CloudError("session_expired");
  if (error.code === "42501") throw new CloudError("forbidden");
  if (error.code === "23505")
    throw new Error(t("duplicateName"));
  throw new Error(error.message);
}
