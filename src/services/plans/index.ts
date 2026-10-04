import { auth } from "../auth";
import { cloud, checkError } from "../client";
import { CloudError } from "../errors";

export type PlanCode = "free" | "plus" | "pro";
export type PlanFeature = "advanced_themes" | "advanced_stats";
export interface PlanDefinition {
  code: PlanCode;
  monthly_usd_cents: number;
  annual_usd_cents: number | null;
  cloud_bytes: number;
  max_devices: number | null;
  advanced_themes: boolean;
  advanced_stats: boolean;
  translation_tier: "very_limited" | "standard" | "high";
  premium_tts_tier: "none" | "limited" | "full";
}
export interface AccountPlan extends PlanDefinition {
  subscription_status: string;
  billing_cycle: "monthly" | "annual" | null;
  starts_at: string | null;
  renews_at: string | null;
  expires_at: string | null;
  grace_until: string | null;
  active_devices: number;
}
let current: AccountPlan | undefined;
let currentOwner: string | null = null;
let currentCheckedAt = 0;
let catalogCache: PlanDefinition[] | undefined;

export const plans = {
  async current(): Promise<AccountPlan> {
    const owner = auth.requireUser();
    if (currentOwner === owner && current && Date.now() - currentCheckedAt < 60_000) return current;
    const { data, error } = await cloud().rpc("account_plan", {});
    checkError(error);
    if (!data || auth.state.ownerId !== owner) throw new CloudError("session_expired");
    currentOwner = owner;
    currentCheckedAt = Date.now();
    return current = data;
  },
  async catalog(): Promise<PlanDefinition[]> {
    auth.requireUser();
    if (catalogCache) return catalogCache;
    const { data, error } = await cloud().rpc("plan_catalog", {});
    checkError(error);
    return catalogCache = data ?? [];
  },
  invalidate(): void { current = undefined; currentCheckedAt = 0; catalogCache = undefined; },
  canUse(feature: PlanFeature): boolean { return Boolean(current?.[feature]); },
  getCloudStorageLimit(): number | undefined { return current?.cloud_bytes; },
  getDeviceLimit(): number | null | undefined { return current?.max_devices; },
  getTranslationTier(): PlanDefinition["translation_tier"] | undefined { return current?.translation_tier; },
  getPremiumTtsTier(): PlanDefinition["premium_tts_tier"] | undefined { return current?.premium_tts_tier; },
};
