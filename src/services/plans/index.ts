import { auth } from "../auth";
import { cloud, checkError } from "../client";
import { CloudError } from "../errors";
import { localGet, localPut } from "../local/database";

export type PlanCode = "free" | "premium";
export type PlanFeature = "advanced_themes" | "advanced_stats";
export interface PlanDefinition {
  code: PlanCode;
  monthly_usd_cents: number;
  lifetime_usd_cents: number | null;
  cloud_bytes: number;
  max_devices: number | null;
  advanced_themes: boolean;
  advanced_stats: boolean;
  translation_monthly_characters: number;
  cloud_tts_monthly_characters: number;
  sync_enabled?: boolean;
  offline_enabled?: boolean;
  notes_and_highlights_enabled?: boolean;
}
export interface AccountPlan extends PlanDefinition {
  subscription_status: string;
  billing_cycle: "monthly" | "annual" | "lifetime" | null;
  purchase_type: "monthly" | "lifetime" | "legacy" | null;
  access_source: "free" | "subscription" | "purchase" | "legacy" | "manual";
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
  translationMonthlyCharacters: number;
  cloudTtsMonthlyCharacters: number;
  subscriptionStatus: string;
  billingPeriod: "monthly" | "annual" | "lifetime" | null;
  purchaseType: "monthly" | "lifetime" | "legacy" | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  provider: AccountPlan["provider"];
  activeDevices: number;
  accessSource: AccountPlan["access_source"];
}
let current: AccountPlan | undefined;
let currentOwner: string | null = null;
let currentCheckedAt = 0;
let catalogCache: PlanDefinition[] | undefined;
type CachedPlan = { id: string; ownerId: string; checkedAt: number; value: AccountPlan };
const planCacheId = (owner: string) => `account_plan:${owner}`;

const canonicalCatalog: Record<PlanCode, PlanDefinition> = {
  free: {
    code: "free",
    monthly_usd_cents: 0,
    lifetime_usd_cents: null,
    cloud_bytes: 1_073_741_824,
    max_devices: 2,
    advanced_themes: false,
    advanced_stats: false,
    translation_monthly_characters: 2_000,
    cloud_tts_monthly_characters: 0,
    sync_enabled: true,
    offline_enabled: true,
    notes_and_highlights_enabled: true,
  },
  premium: {
    code: "premium",
    monthly_usd_cents: 599,
    lifetime_usd_cents: 11_999,
    cloud_bytes: 26_843_545_600,
    max_devices: null,
    advanced_themes: true,
    advanced_stats: true,
    translation_monthly_characters: 20_000,
    cloud_tts_monthly_characters: 25_000,
    sync_enabled: true,
    offline_enabled: true,
    notes_and_highlights_enabled: true,
  },
};

const finiteNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

function normalizePlan(value: unknown, code: PlanCode): PlanDefinition {
  const fallback = canonicalCatalog[code];
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const maxDevices = source.max_devices === null
    ? null
    : finiteNumber(source.max_devices, fallback.max_devices ?? 0);
  return {
    code,
    monthly_usd_cents: finiteNumber(source.monthly_usd_cents, fallback.monthly_usd_cents),
    lifetime_usd_cents: code === "free"
      ? null
      : finiteNumber(source.lifetime_usd_cents, fallback.lifetime_usd_cents ?? 0),
    cloud_bytes: finiteNumber(source.cloud_bytes, fallback.cloud_bytes),
    max_devices: maxDevices,
    advanced_themes: typeof source.advanced_themes === "boolean" ? source.advanced_themes : fallback.advanced_themes,
    advanced_stats: typeof source.advanced_stats === "boolean" ? source.advanced_stats : fallback.advanced_stats,
    translation_monthly_characters: finiteNumber(source.translation_monthly_characters, fallback.translation_monthly_characters),
    cloud_tts_monthly_characters: finiteNumber(source.cloud_tts_monthly_characters, fallback.cloud_tts_monthly_characters),
    sync_enabled: typeof source.sync_enabled === "boolean" ? source.sync_enabled : fallback.sync_enabled,
    offline_enabled: typeof source.offline_enabled === "boolean" ? source.offline_enabled : fallback.offline_enabled,
    notes_and_highlights_enabled: typeof source.notes_and_highlights_enabled === "boolean"
      ? source.notes_and_highlights_enabled
      : fallback.notes_and_highlights_enabled,
  };
}

function normalizeCatalog(value: unknown): PlanDefinition[] {
  const rows = Array.isArray(value) ? value : [];
  const find = (code: PlanCode): unknown => rows.find(row =>
    row && typeof row === "object" && (row as Record<string, unknown>).code === code);
  // Transitional display fallback only. Checkout and effective access remain
  // server-authoritative and fail closed in their Edge Functions/RPCs.
  return [normalizePlan(find("free"), "free"), normalizePlan(find("premium"), "premium")];
}

export const plans = {
  async restore(owner = auth.state.ownerId): Promise<AccountPlan | undefined> {
    if (!owner || auth.state.ownerId !== owner) return undefined;
    if (currentOwner === owner && current) return current;
    const cached = await localGet<CachedPlan>("cloud_state", planCacheId(owner)).catch(() => undefined);
    if (!cached || cached.ownerId !== owner || auth.state.ownerId !== owner) return undefined;
    currentOwner = owner;
    // A persisted entitlement is sufficient for local/offline feature access,
    // but it must never suppress fresh server validation after reconnection.
    currentCheckedAt = 0;
    return current = cached.value;
  },
  async current(): Promise<AccountPlan> {
    const owner = auth.requireUser();
    if (currentOwner === owner && current && Date.now() - currentCheckedAt < 60_000) return current;
    const { data, error } = await cloud().rpc("get_user_entitlements", {});
    checkError(error);
    if (!data || auth.state.ownerId !== owner) throw new CloudError("session_expired");
    currentOwner = owner;
    currentCheckedAt = Date.now();
    const value = data as EntitlementResponse;
    current = {
      code: value.plan,
      monthly_usd_cents: 0,
      lifetime_usd_cents: null,
      cloud_bytes: value.cloudStorageBytes,
      max_devices: value.maxDevices,
      advanced_themes: value.advancedThemes,
      advanced_stats: value.advancedStats,
      translation_monthly_characters: value.translationMonthlyCharacters,
      cloud_tts_monthly_characters: value.cloudTtsMonthlyCharacters,
      sync_enabled: value.sync,
      offline_enabled: value.offline,
      notes_and_highlights_enabled: value.notesAndHighlights,
      subscription_status: value.subscriptionStatus,
      billing_cycle: value.billingPeriod,
      purchase_type: value.purchaseType,
      starts_at: value.currentPeriodStart,
      renews_at: value.cancelAtPeriodEnd ? null : value.currentPeriodEnd,
      expires_at: value.currentPeriodEnd,
      grace_until: null,
      active_devices: value.activeDevices,
      cancel_at_period_end: value.cancelAtPeriodEnd,
      provider: value.provider,
      access_source: value.accessSource,
    };
    void localPut("cloud_state", {
      id: planCacheId(owner), ownerId: owner, checkedAt: currentCheckedAt, value: current,
    } satisfies CachedPlan).catch(() => {});
    return current;
  },
  async catalog(): Promise<PlanDefinition[]> {
    auth.requireUser();
    if (catalogCache) return catalogCache;
    const { data, error } = await cloud().rpc("plan_catalog", {});
    if (error) return catalogCache = normalizeCatalog(null);
    return catalogCache = normalizeCatalog(data);
  },
  invalidate(): void { current = undefined; currentCheckedAt = 0; catalogCache = undefined; },
  canUse(feature: PlanFeature): boolean { return Boolean(current?.[feature]); },
  getCloudStorageLimit(): number | undefined { return current?.cloud_bytes; },
  getDeviceLimit(): number | null | undefined { return current?.max_devices; },
  getTranslationLimit(): number | undefined { return current?.translation_monthly_characters; },
  getCloudTtsLimit(): number | undefined { return current?.cloud_tts_monthly_characters; },
};
