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
  sync_enabled?: boolean;
  offline_enabled?: boolean;
  notes_and_highlights_enabled?: boolean;
}
export interface AccountPlan extends PlanDefinition {
  subscription_status: string;
  billing_cycle: "monthly" | "annual" | null;
  starts_at: string | null;
  renews_at: string | null;
  expires_at: string | null;
  grace_until: string | null;
  active_devices: number;
  cancel_at_period_end: boolean;
  provider: "lemonsqueezy" | "google_play" | "apple" | "microsoft_store" | "manual" | null;
}
interface EntitlementResponse {
  plan: PlanCode;
  cloudStorageBytes: number;
  maxDevices: number | null;
  sync: boolean;
  offline: boolean;
  notesAndHighlights: boolean;
  advancedThemes: boolean;
  advancedStats: boolean;
  translationTier: PlanDefinition["translation_tier"];
  premiumTtsTier: PlanDefinition["premium_tts_tier"];
  subscriptionStatus: string;
  billingPeriod: "monthly" | "annual" | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  provider: AccountPlan["provider"];
  activeDevices: number;
}
let current: AccountPlan | undefined;
let currentOwner: string | null = null;
let currentCheckedAt = 0;
let catalogCache: PlanDefinition[] | undefined;

export const plans = {
  async current(): Promise<AccountPlan> {
    const owner = auth.requireUser();
    if (currentOwner === owner && current && Date.now() - currentCheckedAt < 60_000) return current;
    const { data, error } = await cloud().rpc("get_user_entitlements", {});
    checkError(error);
    if (!data || auth.state.ownerId !== owner) throw new CloudError("session_expired");
    currentOwner = owner;
    currentCheckedAt = Date.now();
    const value = data as EntitlementResponse;
    return current = {
      code: value.plan,
      monthly_usd_cents: 0,
      annual_usd_cents: null,
      cloud_bytes: value.cloudStorageBytes,
      max_devices: value.maxDevices,
      advanced_themes: value.advancedThemes,
      advanced_stats: value.advancedStats,
      translation_tier: value.translationTier,
      premium_tts_tier: value.premiumTtsTier,
      sync_enabled: value.sync,
      offline_enabled: value.offline,
      notes_and_highlights_enabled: value.notesAndHighlights,
      subscription_status: value.subscriptionStatus,
      billing_cycle: value.billingPeriod,
      starts_at: value.currentPeriodStart,
      renews_at: value.cancelAtPeriodEnd ? null : value.currentPeriodEnd,
      expires_at: value.currentPeriodEnd,
      grace_until: null,
      active_devices: value.activeDevices,
      cancel_at_period_end: value.cancelAtPeriodEnd,
      provider: value.provider,
    };
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
