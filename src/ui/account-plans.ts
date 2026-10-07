import { auth } from "../services/auth";
import { billing } from "../services/billing";
import { library } from "../services/books";
import { devices, type AccountDevice } from "../services/devices";
import { plans, type AccountPlan, type PlanDefinition } from "../services/plans";
import { errorMessage } from "../services/errors";
import { language, t } from "../i18n";
import leafUrl from "../assets/autumn-leaf.png";
import { accountIcon } from "./account-icons";

const size = (bytes: number): string => {
  const unit = bytes >= 1073741824 ? 1073741824 : 1048576;
  const value = bytes / unit;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${unit === 1073741824 ? "GB" : "MB"}`;
};
const name = (code: PlanDefinition["code"]): string =>
  t(code === "free" ? "planFree" : code === "plus" ? "planPlus" : "planPro");
const price = (cents: number): string => cents === 0 ? "0" : (cents / 100).toFixed(2);

export function mountAccountPlans(parent: HTMLElement): void {
  const section = document.createElement("section");
  section.className = "account-feature plan-feature";
  section.innerHTML = `<div class="plan-identity"><img class="plan-leaf" src="${leafUrl}" alt="" />
      <div><h3>${t("planSection")}</h3><p class="plan-name"></p><span class="plan-current">${t("planCurrent")}</span><p class="plan-subscription-detail"></p></div></div>
    <div class="plan-usage"><div class="plan-storage-row">${accountIcon("cloud")}
      <div class="plan-storage-detail"><div class="plan-storage-heading"><p class="plan-storage"></p><span class="plan-percent"></span></div>
        <progress class="plan-meter" max="100" value="0" aria-label="${t("planStorage")}"></progress></div></div>
      <div class="plan-devices-row">${accountIcon("device")}<p class="plan-devices"></p>
        <button class="plan-manage-devices" type="button">${t("manageDevices")}${accountIcon("arrow")}</button></div>
      <p class="plan-warning" role="status"></p><div class="plan-sync-feedback"></div></div>
    <div class="plan-actions"><button class="secondary-button plan-compare plan-action" type="button">${accountIcon("plans")}<span>${t("viewPlans")}</span>${accountIcon("arrow")}</button></div>`;
  const comparison = document.createElement("dialog");
  comparison.className = "account-dialog plan-dialog";
  comparison.innerHTML = `<header><h2>${t("plansTitle")}</h2><button class="note-close" type="button" aria-label="${t("plansClose")}">×</button></header>
    <p class="plan-dialog-intro">${t("planCheckoutSecure")}</p><div class="plan-cards"></div><p class="plan-message" role="status"></p>`;
  const deviceDialog = document.createElement("dialog");
  deviceDialog.className = "account-dialog devices-dialog";
  deviceDialog.innerHTML = `<header><h2>${t("deviceListTitle")}</h2><button class="note-close" type="button" aria-label="${t("close")}">×</button></header>
    <p class="device-limit-message" role="status"></p><div class="device-rows"></div><p class="device-message" role="status"></p>`;
  parent.append(section);
  document.body.append(comparison, deviceDialog);
  const find = <T extends HTMLElement>(root: HTMLElement, selector: string): T => root.querySelector<T>(selector)!;
  const planName = find<HTMLElement>(section, ".plan-name");
  const subscriptionDetail = find<HTMLElement>(section, ".plan-subscription-detail");
  const storage = find<HTMLElement>(section, ".plan-storage");
  const deviceCount = find<HTMLElement>(section, ".plan-devices");
  const warning = find<HTMLElement>(section, ".plan-warning");
  const meter = find<HTMLProgressElement>(section, ".plan-meter");
  const percent = find<HTMLElement>(section, ".plan-percent");
  const cards = find<HTMLElement>(comparison, ".plan-cards");
  const planMessage = find<HTMLElement>(comparison, ".plan-message");
  const deviceRows = find<HTMLElement>(deviceDialog, ".device-rows");
  const deviceMessage = find<HTMLElement>(deviceDialog, ".device-message");
  const limitMessage = find<HTMLElement>(deviceDialog, ".device-limit-message");
  let generation = 0, deviceLoad = 0;
  let owner: string | null = null;
  let currentPlan: AccountPlan | undefined;
  let billingBusy = false;

  function feature(label: string, value: string): HTMLElement {
    const row = document.createElement("li");
    const left = document.createElement("span"), right = document.createElement("strong");
    left.textContent = label; right.textContent = value; row.append(left, right);
    return row;
  }
  async function beginCheckout(plan: "plus" | "pro", period: "monthly" | "annual"): Promise<void> {
    if (billingBusy) return;
    billingBusy = true; planMessage.textContent = t("planPurchaseOpening");
    try { await billing.checkout(plan, period); planMessage.textContent = t("planCheckoutPending"); }
    catch { planMessage.textContent = t("planPurchaseFailed"); }
    finally { billingBusy = false; }
  }
  async function showPlans(): Promise<void> {
    if (!comparison.open) comparison.showModal();
    cards.replaceChildren(); planMessage.textContent = "";
    try {
      const catalog = await plans.catalog();
      if (!comparison.open) return;
      for (const plan of catalog) {
        const card = document.createElement("article");
        card.className = `plan-card ${plan.code === "plus" ? "plan-card-featured" : ""}`;
        const heading = document.createElement("h3"); heading.textContent = name(plan.code);
        const pricing = document.createElement("p"); pricing.className = "plan-card-price";
        pricing.textContent = plan.code === "free" ? t("planIncludedFree") : t("planPerMonth", { price: price(plan.monthly_usd_cents) });
        const annual = document.createElement("p"); annual.className = "plan-card-annual";
        annual.textContent = plan.annual_usd_cents === null ? "" : t("planPerYear", { price: price(plan.annual_usd_cents) });
        const details = document.createElement("ul");
        details.append(
          feature(t("planStorage"), size(plan.cloud_bytes)),
          feature(t("planDevices"), plan.max_devices === null ? t("planUnlimited") : String(plan.max_devices)),
          feature(t("planSync"), t("planIncluded")), feature(t("planOffline"), t("planIncluded")),
          feature(t("planNotes"), t("planIncluded")), feature(t("planSocial"), t("planIncluded")),
          feature(t("planBasicThemes"), t("planIncluded")),
          feature(t("planAdvancedThemes"), t(plan.advanced_themes ? "planIncluded" : "planNotIncluded")),
          feature(t("planAdvancedStats"), t(plan.advanced_stats ? "planIncluded" : "planNotIncluded")),
          feature(t("planTranslation"), t(plan.translation_tier === "very_limited" ? "planTranslationVeryLimited" : plan.translation_tier === "standard" ? "planTranslationStandard" : "planTranslationHigh")),
          feature(t("planTts"), t(plan.premium_tts_tier === "none" ? "planTtsNone" : plan.premium_tts_tier === "limited" ? "planTtsLimited" : "planTtsFull")),
        );
        const actions = document.createElement("div"); actions.className = "plan-purchase-actions";
        if (plan.code === currentPlan?.code || plan.code === "free") {
          const action = document.createElement("button"); action.type = "button"; action.className = "secondary-button";
          action.textContent = plan.code === currentPlan?.code ? t("planCurrent") : t("planIncludedFree");
          action.disabled = true; actions.append(action);
        } else {
          for (const period of ["monthly", "annual"] as const) {
            const action = document.createElement("button"); action.type = "button"; action.className = "plan-store-choice";
            const cents = period === "monthly" ? plan.monthly_usd_cents : plan.annual_usd_cents ?? 0;
            action.innerHTML = `<span>${t(period === "monthly" ? "planMonthly" : "planYearly")}</span><strong></strong>`;
            action.querySelector("strong")!.textContent = t(period === "monthly" ? "planPerMonth" : "planPerYear", { price: price(cents) });
            action.setAttribute("aria-label", t("planChoose", { plan: name(plan.code), period: t(period === "monthly" ? "planMonthly" : "planYearly") }));
            action.addEventListener("click", () => void beginCheckout(plan.code as "plus" | "pro", period));
            actions.append(action);
          }
        }
        card.append(heading, pricing, annual, details, actions); cards.append(card);
      }
    } catch (error) { planMessage.textContent = errorMessage(error); }
  }
  async function manageSubscription(): Promise<void> {
    if (billingBusy) return;
    billingBusy = true; warning.textContent = t("planPortalOpening");
    try { await billing.portal(); warning.textContent = ""; }
    catch { warning.textContent = t("planPortalFailed"); }
    finally { billingBusy = false; }
  }
  async function showDevices(limited = false): Promise<void> {
    const token = ++deviceLoad;
    if (!deviceDialog.open) deviceDialog.showModal();
    limitMessage.textContent = limited ? t("deviceLimitReached") : "";
    deviceRows.replaceChildren(); deviceMessage.textContent = "";
    if (!navigator.onLine) { deviceMessage.textContent = t("deviceOffline"); return; }
    try {
      const entries = await devices.list();
      if (!deviceDialog.open || token !== deviceLoad) return;
      if (!entries.length) { deviceMessage.textContent = t("deviceListEmpty"); return; }
      for (const entry of entries) renderDevice(entry);
    } catch (error) { if (token === deviceLoad) deviceMessage.textContent = errorMessage(error); }
  }
  function renderDevice(entry: AccountDevice): void {
    const row = document.createElement("div"); row.className = "device-row";
    const details = document.createElement("div"), title = document.createElement("strong");
    const platform = ({ android: "Android", windows: "Windows", linux: "Linux", macos: "macOS", web: t("devicePlatformWeb"), other: t("devicePlatformOther") })[entry.platform] ?? t("devicePlatformOther");
    title.textContent = `${entry.display_name} · ${platform}`;
    const meta = document.createElement("small");
    meta.textContent = entry.device_id === devices.id ? t("deviceThis") : new Date(entry.last_seen_at).toLocaleDateString(language);
    details.append(title, meta);
    if (entry.device_id === devices.id) { row.append(details); deviceRows.append(row); return; }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-button"; remove.textContent = t("deviceRemove");
    remove.addEventListener("click", async () => {
      if (!window.confirm(t("deviceRemoveConfirm", { name: title.textContent ?? entry.display_name }))) return;
      remove.disabled = true;
      try {
        await devices.remove(entry.device_id); deviceMessage.textContent = t("deviceRemoved");
        const status = await devices.register(true);
        if (status.allowed) { limitMessage.textContent = ""; window.dispatchEvent(new Event("autumn-device-ready")); }
        await showDevices(!status.allowed); await refresh();
      } catch (error) { deviceMessage.textContent = errorMessage(error); }
      finally { remove.disabled = false; }
    });
    row.append(details, remove); deviceRows.append(row);
  }
  async function refresh(): Promise<void> {
    const activeOwner = auth.state.ownerId;
    if (!activeOwner || auth.state.status !== "authenticated") return;
    if (!navigator.onLine) { warning.textContent = t("quotaOffline"); return; }
    const token = ++generation;
    try {
      const access = await devices.register();
      if (!access.allowed) { void showDevices(true); return; }
      const [plan, usage] = await Promise.all([plans.current(), library.quota()]);
      if (auth.state.ownerId !== activeOwner || token !== generation) return;
      currentPlan = plan; planName.textContent = name(plan.code);
      const period = plan.billing_cycle === "monthly" ? t("planMonthly") : plan.billing_cycle === "annual" ? t("planYearly") : "";
      const status = t(plan.subscription_status === "trialing" ? "planStatusTrialing"
        : plan.subscription_status === "past_due" ? "planStatusPastDue"
        : plan.subscription_status === "canceled" || plan.subscription_status === "expired" ? "planStatusEnded" : "planStatusActive");
      const renewal = plan.expires_at ? new Date(plan.expires_at).toLocaleDateString(language) : "";
      subscriptionDetail.textContent = plan.code === "free" ? t("planFreeDescription")
        : plan.cancel_at_period_end && renewal ? t("planEndsOn", { date: renewal })
        : renewal ? t("planRenewsOn", { period, status, date: renewal }) : [period, status].filter(Boolean).join(" · ");
      storage.textContent = t("planStorageUsage", { used: size(usage.used_bytes), limit: size(usage.max_bytes) });
      const usedRatio = usage.max_bytes > 0 ? usage.used_bytes / usage.max_bytes : 0;
      meter.value = Math.min(100, Math.round(usedRatio * 100));
      percent.textContent = new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(usedRatio);
      deviceCount.textContent = plan.max_devices === null ? `${t("planDevices")}: ${t("planUnlimited")}`
        : t("planDevicesUsage", { used: access.active_devices, limit: plan.max_devices });
      warning.textContent = usage.used_bytes > usage.max_bytes ? t("planOverQuota") : "";
      find<HTMLElement>(section, ".plan-compare span").textContent = plan.code === "free" ? t("viewPlans") : t("manageSubscription");
    } catch { if (token === generation) warning.textContent = t("planLoadFailed"); }
  }
  find<HTMLButtonElement>(section, ".plan-compare").addEventListener("click", () =>
    currentPlan?.code === "free" ? void showPlans() : void manageSubscription());
  find<HTMLButtonElement>(section, ".plan-manage-devices").addEventListener("click", () => void showDevices());
  find<HTMLButtonElement>(comparison, ".note-close").addEventListener("click", () => comparison.close());
  find<HTMLButtonElement>(deviceDialog, ".note-close").addEventListener("click", () => deviceDialog.close());
  deviceDialog.addEventListener("close", () => { if (!deviceDialog.open) ++deviceLoad; });
  auth.subscribe((state) => {
    if (state.ownerId !== owner) {
      owner = state.ownerId; currentPlan = undefined; ++generation; ++deviceLoad; plans.invalidate();
      planName.textContent = storage.textContent = deviceCount.textContent = warning.textContent = percent.textContent = subscriptionDetail.textContent = "";
      if (comparison.open) comparison.close(); if (deviceDialog.open) deviceDialog.close();
    }
    if (state.status === "authenticated") void refresh();
  });
  window.addEventListener("online", () => void refresh());
  window.addEventListener("autumn-cloud-storage-changed", () => void refresh());
  window.addEventListener("autumn-device-access", (event) => {
    if (!(event as CustomEvent<{ allowed: boolean }>).detail.allowed) void showDevices(true);
  });
}
