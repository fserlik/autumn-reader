import { auth } from "../services/auth";
import { billing } from "../services/billing";
import { library } from "../services/books";
import { devices, type AccountDevice } from "../services/devices";
import { plans, type AccountPlan, type PlanDefinition } from "../services/plans";
import { errorMessage } from "../services/errors";
import { language, t } from "../i18n";
import leafUrl from "../assets/autumn-leaf.png";
import freeLogoUrl from "../assets/autumn-free-logo.png";
import plusLogoUrl from "../assets/autumnplus-logo.png";
import proLogoUrl from "../assets/autumnpro-logo.png";
import { accountIcon } from "./account-icons";
import { aiSpeech, type AiSpeechUsage } from "../services/ai-speech";

const size = (bytes: number): string => {
  const unit = bytes >= 1073741824 ? 1073741824 : 1048576;
  const value = bytes / unit;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${unit === 1073741824 ? "GB" : "MB"}`;
};
const name = (code: PlanDefinition["code"]): string =>
  t(code === "free" ? "planFree" : code === "plus" ? "planPlus" : "planPro");
const price = (cents: number): string => cents === 0 ? "0" : (cents / 100).toFixed(2);

export function mountAccountPlans(accountParent: HTMLElement, ttsParent: HTMLElement): { actions: HTMLElement; open(): Promise<void> } {
  const section = document.createElement("section");
  section.id = "settings-plan";
  section.className = "account-feature plan-feature";
  section.innerHTML = `<div class="plan-identity"><img class="plan-leaf" src="${leafUrl}" alt="" />
      <div><h3>${t("planSection")}</h3><p class="plan-name"></p><span class="plan-current">${t("planCurrent")}</span><p class="plan-subscription-detail"></p></div></div>
    <div class="plan-usage"><div class="plan-storage-row">${accountIcon("cloud")}
      <div class="plan-storage-detail"><div class="plan-storage-heading"><p class="plan-storage"></p><span class="plan-percent"></span></div>
        <progress class="plan-meter" max="100" value="0" aria-label="${t("planStorage")}"></progress></div></div>
      <div class="plan-devices-row">${accountIcon("device")}<p class="plan-devices"></p>
        <button class="plan-manage-devices" type="button">${t("manageDevices")}${accountIcon("arrow")}</button></div>
      <p class="plan-warning" role="status"></p><div class="plan-sync-feedback"></div></div>
    <div class="plan-actions"><button class="secondary-button plan-compare plan-action" type="button">${accountIcon("plans")}<span>${t("managePlan")}</span>${accountIcon("arrow")}</button></div>`;
  const comparison = document.createElement("dialog");
  comparison.className = "account-dialog plan-dialog plan-comparison-dialog";
  comparison.setAttribute("aria-labelledby", "plan-comparison-title");
  comparison.innerHTML = `<header><div><h2 id="plan-comparison-title">${t("plansTitle")}</h2><p class="plan-dialog-intro">${t("planCheckoutSecure")}</p></div><button class="note-close" type="button" aria-label="${t("plansClose")}">×</button></header>
    <div class="plan-dialog-management"></div><div class="plan-cards"></div><p class="plan-message" role="status" aria-live="polite"></p>`;
  const aiUsage = document.createElement("section");
  aiUsage.className = "plan-ai-speech-usage tts-ai-speech-usage";
  aiUsage.hidden = true;
  aiUsage.setAttribute("aria-labelledby", "tts-ai-speech-heading");
  aiUsage.innerHTML = `<div class="plan-ai-heading"><h3 id="tts-ai-speech-heading">${t("aiSpeechName")}</h3><p>${t("aiSpeechCachedHelp")}</p></div>
    <dl><div><dt>${t("planSection")}</dt><dd class="plan-ai-plan"></dd></div><div><dt>${t("aiSpeechQuotaMonthly")}</dt><dd class="plan-ai-included"></dd></div><div><dt>${t("aiSpeechUsed")}</dt><dd class="plan-ai-used"></dd></div><div><dt>${t("aiSpeechRemaining")}</dt><dd class="plan-ai-remaining"></dd></div><div><dt>${t("aiSpeechReset",{date:""})}</dt><dd class="plan-ai-reset"></dd></div><div><dt>${t("aiSpeechName")}</dt><dd class="plan-ai-status"></dd></div></dl>`;
  const deviceDialog = document.createElement("dialog");
  deviceDialog.className = "account-dialog devices-dialog";
  deviceDialog.innerHTML = `<header><h2>${t("deviceListTitle")}</h2><button class="note-close" type="button" aria-label="${t("close")}">×</button></header>
    <p class="device-limit-message" role="status"></p><div class="device-rows"></div><p class="device-message" role="status"></p>`;
  accountParent.append(section);
  ttsParent.querySelector(".settings-section-heading")?.after(aiUsage);
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

  function minutes(seconds: number): string {
    return new Intl.NumberFormat(language, { maximumFractionDigits: seconds < 600 ? 1 : 0 }).format(seconds / 60);
  }
  function renderAiUsage(usage: AiSpeechUsage): void {
    const panel = aiUsage; panel.hidden = false;
    find<HTMLElement>(panel, ".plan-ai-plan").textContent = name(usage.plan);
    find<HTMLElement>(panel, ".plan-ai-included").textContent = t("aiSpeechMinutesAvailable", { minutes: minutes(usage.includedSeconds) });
    find<HTMLElement>(panel, ".plan-ai-used").textContent = `${minutes(usage.usedSeconds)} min`;
    find<HTMLElement>(panel, ".plan-ai-remaining").textContent = `${minutes(usage.remainingSeconds)} min`;
    find<HTMLElement>(panel, ".plan-ai-reset").textContent = new Date(usage.resetsAt).toLocaleDateString(language);
    find<HTMLElement>(panel, ".plan-ai-status").textContent = t(usage.serviceAvailable ? "aiSpeechServiceReady" : "aiSpeechServicePaused");
  }

  function feature(label: string, value: string): HTMLElement {
    const row = document.createElement("li");
    const symbol = document.createElement("span"); symbol.className = "plan-feature-icon"; symbol.textContent = "✓";
    const left = document.createElement("span"), right = document.createElement("strong");
    left.textContent = label; right.textContent = value; row.append(symbol, left, right);
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
    const management = find<HTMLElement>(comparison, ".plan-dialog-management");
    management.replaceChildren();
    if (currentPlan && currentPlan.code !== "free") {
      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = "secondary-button plan-manage-subscription";
      manage.textContent = t("manageSubscription");
      manage.addEventListener("click", () => void manageSubscription(manage));
      management.append(manage);
    }
    try {
      const catalog = await plans.catalog();
      if (!comparison.open) return;
      for (const plan of catalog) {
        const card = document.createElement("article");
        card.className = `plan-card ${plan.code === "plus" ? "plan-card-featured" : ""}`;
        card.dataset.plan = plan.code;
        const emblem = document.createElement("div"); emblem.className = "plan-emblem";
        if (plan.code === "free") {
          const image = document.createElement("img");
          image.src = freeLogoUrl;
          image.alt = "";
          image.className = "plan-emblem-image";
          emblem.append(image);
        } else {
          const image = document.createElement("img");
          image.src = plan.code === "plus" ? plusLogoUrl : proLogoUrl;
          image.alt = "";
          image.className = "plan-emblem-image";
          emblem.append(image);
        }
        emblem.setAttribute("aria-hidden", "true");
        const heading = document.createElement("h3"); heading.textContent = name(plan.code);
        const tagline = document.createElement("p"); tagline.className = "plan-tagline";
        tagline.textContent = t(plan.code === "free" ? "planFreeTagline" : plan.code === "plus" ? "planPlusTagline" : "planProTagline");
        const pricing = document.createElement("div"); pricing.className = "plan-pricing-options";
        if (plan.code === "free") pricing.classList.add("single");
        let chosenPeriod: "monthly" | "annual" = "monthly";
        let updateAction = (): void => {};
        const periodButtons: HTMLButtonElement[] = [];
        for (const period of (plan.code === "free" ? ["monthly"] : ["monthly", "annual"]) as ("monthly" | "annual")[]) {
          const option = document.createElement("button"); option.type = "button";
          option.className = "plan-price-choice";
          const cents = period === "monthly" ? plan.monthly_usd_cents : plan.annual_usd_cents ?? 0;
          option.textContent = t(period === "monthly" ? "planPerMonth" : "planPerYear", { price: price(cents) });
          if (period === "annual" && plan.monthly_usd_cents > 0) {
            const savings = Math.round((1 - cents / (plan.monthly_usd_cents * 12)) * 100);
            if (savings > 0) { const small = document.createElement("small"); small.textContent = t("planSave", { percent: savings }); option.append(small); }
          }
          option.disabled = plan.code === "free";
          option.classList.toggle("selected", period === chosenPeriod);
          option.addEventListener("click", () => {
            chosenPeriod = period;
            periodButtons.forEach(button => button.classList.toggle("selected", button === option));
            updateAction();
          });
          periodButtons.push(option); pricing.append(option);
        }
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
          feature(t("planTts"), plan.premium_tts_tier === "none" ? t("planTtsNone") : t("aiSpeechMinutesAvailable", { minutes: plan.code === "plus" ? 60 : 180 })),
        );
        const actions = document.createElement("div"); actions.className = "plan-purchase-actions";
        const action = document.createElement("button"); action.type = "button";
        const isCurrent = plan.code === currentPlan?.code || (plan.code === "free" && !currentPlan);
        const isIncluded = plan.code === "free" || (plan.code === "plus" && currentPlan?.code === "pro");
        updateAction = () => {
          action.textContent = isCurrent ? t("planCurrent") : isIncluded ? t("planIncluded")
            : t("planChoose", { plan: name(plan.code), period: t(chosenPeriod === "monthly" ? "planMonthly" : "planYearly") });
        };
        updateAction();
        action.disabled = isCurrent || isIncluded;
        if (!action.disabled) action.addEventListener("click", () => void beginCheckout(plan.code as "plus" | "pro", chosenPeriod));
        actions.append(action);
        card.append(emblem, heading, tagline, pricing, details, actions); cards.append(card);
      }
    } catch (error) { planMessage.textContent = errorMessage(error); }
  }
  async function manageSubscription(button: HTMLButtonElement): Promise<void> {
    if (billingBusy) return;
    const feedback = comparison.open ? planMessage : warning;
    const label = button.textContent;
    billingBusy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = t("planPortalOpening");
    feedback.textContent = t("planPortalOpening");
    try { await billing.portal(); feedback.textContent = ""; }
    catch (error) {
      feedback.textContent = t(
        error instanceof Error && error.message === "billing_external_open_failed"
          ? "planPortalOpenFailed"
          : error instanceof Error && error.message === "billing_portal_unavailable"
          ? "planPortalUnavailable"
          : "planPortalFailed",
      );
    }
    finally {
      billingBusy = false;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = label;
    }
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
      try { renderAiUsage(await aiSpeech.usage()); } catch { aiUsage.hidden = true; }
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
      find<HTMLElement>(section, ".plan-compare span").textContent = t("managePlan");
    } catch { if (token === generation) warning.textContent = t("planLoadFailed"); }
  }
  find<HTMLButtonElement>(section, ".plan-compare").addEventListener("click", () => void showPlans());
  find<HTMLButtonElement>(section, ".plan-manage-devices").addEventListener("click", () => void showDevices());

  find<HTMLButtonElement>(comparison, ".note-close").addEventListener("click", () => comparison.close());
  comparison.addEventListener("click", event => {
    if (event.target !== comparison) return;
    const bounds = comparison.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) comparison.close();
  });
  find<HTMLButtonElement>(deviceDialog, ".note-close").addEventListener("click", () => deviceDialog.close());
  deviceDialog.addEventListener("close", () => { if (!deviceDialog.open) ++deviceLoad; });
  auth.subscribe((state) => {
    if (state.ownerId !== owner) {
      owner = state.ownerId; currentPlan = undefined; ++generation; ++deviceLoad; plans.invalidate();
      planName.textContent = storage.textContent = deviceCount.textContent = warning.textContent = percent.textContent = subscriptionDetail.textContent = "";
      if (deviceDialog.open) deviceDialog.close();
    }
    if (state.status === "authenticated") void refresh();
  });
  window.addEventListener("online", () => void refresh());
  window.addEventListener("autumn-cloud-storage-changed", () => void refresh());
  window.addEventListener("autumn-device-access", (event) => {
    if (!(event as CustomEvent<{ allowed: boolean }>).detail.allowed) void showDevices(true);
  });
  return {
    actions: find<HTMLElement>(section, ".plan-actions"),
    open: async () => {
      // Show plans before refreshing account status; network must not block the page.
      await showPlans();
      if (auth.state.status === "authenticated" && !currentPlan) {
        try { await refresh(); await showPlans(); } catch { /* Keep visible catalog. */ }
      }
    },
  };
}
