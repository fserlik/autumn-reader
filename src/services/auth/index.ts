import type { Session } from "@supabase/supabase-js";
import { isTauri } from "@tauri-apps/api/core";
import { cloud, cloudConfigured, temporaryAuthClient } from "../client";
import { CloudError, requireOnline } from "../errors";
import { devices } from "../devices";
import { t } from "../../i18n";
import { connectivity, isNetworkFailure } from "../connectivity";
import { forgetOfflineIdentity, readOfflineIdentity, rememberOfflineIdentity, type OfflineIdentity } from "./offline-identity";

export type AuthState = {
  status: "loading" | "anonymous" | "authenticated" | "offline" | "expired";
  session: Session | null;
  ownerId: string | null;
  recovery: boolean;
};
export type OAuthState = {
  status: "idle" | "waiting" | "exchanging" | "error";
  error: unknown | null;
};
let state: AuthState = {
  status: "loading",
  session: null,
  ownerId: null,
  recovery: false,
};
const subscribers = new Set<(state: AuthState) => void>();
const oauthSubscribers = new Set<(state: OAuthState) => void>();
let oauthState: OAuthState = { status: "idle", error: null };
let loggingOut = false;
let suppressAuthEvents = false;
let authRevision = 0;
let initialized = false;
let offlineIdentity: OfflineIdentity | null = null;
const nativeOAuthCallback = "autumnreader://auth/callback";
const pendingOAuthFlowKey = "autumn-google-oauth-flow";
const processedOAuthCallbacks = new Set<string>();

function publishOAuth(next: OAuthState): void {
  oauthState = next;
  oauthSubscribers.forEach((listener) => listener(oauthState));
}

function discardPkceFlow(flowId: string | null): void {
  if (!flowId || !/^[a-zA-Z0-9_-]{8,64}$/.test(flowId)) return;
  localStorage.removeItem(`autumn-auth-flow-${flowId}-code-verifier`);
  const indexKey = "autumn-auth-flows-code-verifier";
  try {
    const ids = JSON.parse(localStorage.getItem(indexKey) ?? "[]") as unknown;
    if (!Array.isArray(ids)) return;
    const remaining = ids.filter((id): id is string => typeof id === "string" && id !== flowId);
    if (remaining.length) localStorage.setItem(indexKey, JSON.stringify(remaining));
    else localStorage.removeItem(indexKey);
  } catch {
    localStorage.removeItem(indexKey);
  }
}

function clearPendingOAuth(): void {
  discardPkceFlow(localStorage.getItem(pendingOAuthFlowKey));
  localStorage.removeItem(pendingOAuthFlowKey);
  if (oauthState.status !== "idle") publishOAuth({ status: "idle", error: null });
}

function clearPkceVerifiers(): void {
  const indexKey = "autumn-auth-flows-code-verifier";
  try {
    const ids = JSON.parse(localStorage.getItem(indexKey) ?? "[]") as unknown;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(id))
          localStorage.removeItem(`autumn-auth-flow-${id}-code-verifier`);
      }
    }
  } catch { /* Remove the malformed index below. */ }
  localStorage.removeItem(indexKey);
  localStorage.removeItem("autumn-auth-code-verifier");
}

function webOAuthCallback(): string {
  const url = new URL(window.location.href);
  for (const key of ["code", "sb_flow_id", "error", "error_code", "error_description"])
    url.searchParams.delete(key);
  url.hash = "";
  return url.toString();
}

function oauthCallbackUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (isTauri()) {
      return url.protocol === "autumnreader:" && url.hostname === "auth" && url.pathname === "/callback"
        ? url
        : null;
    }
    return url.origin === window.location.origin && url.pathname === window.location.pathname
      ? url
      : null;
  } catch {
    return null;
  }
}

function cleanBrowserCallback(url: URL): void {
  if (isTauri()) return;
  for (const key of ["code", "sb_flow_id", "error", "error_code", "error_description"])
    url.searchParams.delete(key);
  if (/^(#|#.*&)(error|error_code|error_description)=/.test(url.hash)) url.hash = "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function oauthParameters(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  for (const [key, value] of fragment) if (!params.has(key)) params.set(key, value);
  return params;
}

async function completeOAuthCallback(raw: string): Promise<boolean> {
  if (processedOAuthCallbacks.has(raw)) return false;
  processedOAuthCallbacks.add(raw);
  const url = oauthCallbackUrl(raw);
  if (!url) return false;
  const params = oauthParameters(url);
  const code = params.get("code") ?? "";
  const flowId = params.get("sb_flow_id") ?? "";
  const providerError = params.get("error") ?? params.get("error_code") ?? "";
  if (!code && !providerError) return false;
  if (!isTauri()) cleanBrowserCallback(url);
  const pendingFlow = localStorage.getItem(pendingOAuthFlowKey);
  if (!pendingFlow || flowId !== pendingFlow || !/^[a-zA-Z0-9_-]{8,64}$/.test(flowId)) return false;
  localStorage.removeItem(pendingOAuthFlowKey);
  if (providerError) {
    discardPkceFlow(flowId);
    publishOAuth({
      status: "error",
      error: new Error(providerError === "access_denied" ? t("authGoogleCancelled") : t("authGoogleFailed")),
    });
    return false;
  }
  if (!code || code.length > 4096) {
    discardPkceFlow(flowId);
    publishOAuth({ status: "error", error: new Error(t("authGoogleFailed")) });
    return false;
  }
  publishOAuth({ status: "exchanging", error: null });
  suppressAuthEvents = true;
  let signedIn = false;
  try {
    const { data, error } = await cloud().auth.exchangeCodeForSession(code, { flowId });
    if (error) throw error;
    if (!data.session) throw new CloudError("session_expired");
    signedIn = true;
    await devices.registerSession(data.session, true);
    cloud().auth.startAutoRefresh();
    accept(data.session, false);
    publishOAuth({ status: "idle", error: null });
    return true;
  } catch (reason) {
    if (signedIn) await cloud().auth.signOut({ scope: "local" }).catch(() => {});
    publishOAuth({
      status: "error",
      error: reason instanceof CloudError ? reason : new Error(t("authGoogleFailed")),
    });
    return false;
  } finally {
    suppressAuthEvents = false;
  }
}

async function initializeOAuthCallbacks(): Promise<boolean> {
  if (!isTauri()) return completeOAuthCallback(window.location.href);
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  await onOpenUrl((urls) => {
    for (const url of urls) void completeOAuthCallback(url);
  });
  const current = await getCurrent();
  if (!current) return false;
  for (const url of current) if (await completeOAuthCallback(url)) return true;
  return false;
}

function publish(next: AuthState): void {
  state = next;
  subscribers.forEach((listener) => listener(state));
}
function accept(session: Session | null, recovery = state.recovery): void {
  authRevision++;
  const ownerId = session?.user.id ?? offlineIdentity?.ownerId ?? null;
  if (session) {
    offlineIdentity = {
      id: "offline_identity",
      ownerId: session.user.id,
      email: session.user.email,
      authenticatedAt: Date.now(),
      version: 1,
    };
    rememberOfflineIdentity(session.user.id, session.user.email);
  }
  publish({
    session,
    ownerId,
    recovery,
    status: session
      ? (session.expires_at ?? 0) * 1000 > Date.now()
        ? "authenticated"
        : "expired"
      : ownerId
        ? "expired"
        : "anonymous",
  });
}
function acceptOffline(identity = offlineIdentity): void {
  authRevision++;
  publish({
    status: identity ? "offline" : "anonymous",
    session: null,
    ownerId: identity?.ownerId ?? null,
    recovery: false,
  });
}
function acceptExpired(identity = offlineIdentity): void {
  authRevision++;
  publish({
    status: identity ? "expired" : "anonymous",
    session: null,
    ownerId: identity?.ownerId ?? null,
    recovery: false,
  });
}
function timed<T>(operation: Promise<T>, milliseconds = 4_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new DOMException("Network request timed out", "TimeoutError")), milliseconds);
    operation.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}
export const auth = {
  get state(): AuthState {
    if (
      state.status === "authenticated" &&
      state.session &&
      (state.session.expires_at ?? 0) * 1000 <= Date.now()
    )
      publish({ ...state, status: "expired" });
    return state;
  },
  expire(): void {
    publish({ ...state, status: "expired" });
  },
  subscribe(listener: (state: AuthState) => void): () => void {
    subscribers.add(listener);
    listener(state);
    return () => subscribers.delete(listener);
  },
  subscribeOAuth(listener: (state: OAuthState) => void): () => void {
    oauthSubscribers.add(listener);
    listener(oauthState);
    return () => oauthSubscribers.delete(listener);
  },
  async initialize(): Promise<void> {
    if (initialized) return;
    initialized = true;
    offlineIdentity = await readOfflineIdentity();
    if (!cloudConfigured) {
      publish({
        status: "anonymous",
        session: null,
        ownerId: null,
        recovery: false,
      });
      return;
    }
    const connection = await connectivity.initialize();
    suppressAuthEvents = true;
    cloud().auth.onAuthStateChange((event, session) => {
      // No awaited Supabase calls inside the SDK's auth lock.
      if (suppressAuthEvents) return;
      if (event === "INITIAL_SESSION") return;
      if (loggingOut && event !== "SIGNED_OUT") return;
      if (event === "SIGNED_OUT") {
        // SDK sign-out can be caused by an invalid/expired remote token. Only the
        // explicit logout action is allowed to erase the device's local identity.
        acceptExpired();
      } else {
        accept(session, event === "PASSWORD_RECOVERY");
        if (session && connectivity.usable) window.setTimeout(() => void auth.refresh().catch(() => {}), 0);
      }
    });
    if (connection.status !== "online") {
      cloud().auth.stopAutoRefresh();
      acceptOffline();
      suppressAuthEvents = false;
    }
    let completedOAuth = false;
    if (connection.status === "online") {
      try { completedOAuth = await initializeOAuthCallbacks(); }
      catch (reason) {
        // A deep-link/plugin failure must not strand the whole application in
        // the loading state. Normal persisted-session restoration can continue.
        if (import.meta.env.DEV) console.info("OAuth callback initialization unavailable", reason);
      }
    }
    if (connection.status === "online" && !completedOAuth) {
      const revision = authRevision;
      try {
        const { data, error } = await timed(cloud().auth.getSession());
        if (revision === authRevision) {
          if (error) {
            if (isNetworkFailure(error)) { connectivity.markOffline(); acceptOffline(); }
            else acceptExpired();
          } else if (data.session) {
            const session = data.session;
            offlineIdentity = {
              id: "offline_identity", ownerId: session.user.id, email: session.user.email,
              authenticatedAt: Date.now(), version: 1,
            };
            rememberOfflineIdentity(session.user.id, session.user.email);
            publish({ status: "loading", session, ownerId: session.user.id, recovery: false });
            try {
              await timed(devices.registerSession(session, true));
              if (revision === authRevision) accept(session);
            } catch (reason) {
              if (reason instanceof CloudError && ["device_revoked", "forbidden"].includes(reason.code)) await auth.logout();
              else if (isNetworkFailure(reason)) { connectivity.markOffline(); acceptOffline(); }
              else if (revision === authRevision) accept(session);
            }
          } else acceptExpired();
        }
      } catch (reason) {
        if (revision === authRevision && isNetworkFailure(reason)) {
          connectivity.markOffline(reason instanceof DOMException && reason.name === "TimeoutError" ? "timeout" : "network");
          acceptOffline();
        } else if (revision === authRevision) acceptExpired();
      }
      suppressAuthEvents = false;
    }
    if (completedOAuth) suppressAuthEvents = false;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cloud().auth.stopAutoRefresh();
      else {
        if (connectivity.usable) {
          cloud().auth.startAutoRefresh();
          void auth.refresh().catch(() => {});
        }
      }
    });
    connectivity.subscribe(connectionState => {
      if (connectionState.status === "offline") {
        cloud().auth.stopAutoRefresh();
        if (state.ownerId && state.status !== "offline") acceptOffline();
      } else if (connectionState.status === "online") {
        cloud().auth.startAutoRefresh();
        if (state.ownerId && state.status !== "loading") void auth.refresh().catch(() => {});
      }
    });
    window.setInterval(() => {
      if (!document.hidden && connectivity.usable && state.ownerId) void auth.refresh().catch(() => {});
    }, 60_000);
  },
  async refresh(): Promise<void> {
    if (!cloudConfigured || !connectivity.usable || !state.ownerId) return;
    const owner = state.ownerId;
    let result: Awaited<ReturnType<ReturnType<typeof cloud>["auth"]["getSession"]>>;
    try { result = await timed(cloud().auth.getSession()); }
    catch (reason) {
      if (state.ownerId === owner && isNetworkFailure(reason)) { connectivity.markOffline(); acceptOffline(); }
      return;
    }
    const { data, error } = result;
    if (state.ownerId !== owner || loggingOut) return;
    if (error) {
      if (isNetworkFailure(error)) { connectivity.markOffline(); acceptOffline(); }
      else acceptExpired();
      return;
    }
    if (data.session) {
      try { await timed(devices.registerSession(data.session, true)); }
      catch (reason) {
        if (reason instanceof CloudError && ["device_revoked", "forbidden"].includes(reason.code)) await auth.logout();
        else if (isNetworkFailure(reason)) { connectivity.markOffline(); acceptOffline(); }
        else if (state.ownerId === owner && state.status !== "authenticated") accept(data.session);
        return;
      }
    }
    if (!data.session) { acceptExpired(); return; }
    if (state.ownerId === owner && !loggingOut &&
        (state.status !== "authenticated" || state.session?.access_token !== data.session?.access_token))
      accept(data.session);
  },
  async login(email: string, password: string): Promise<void> {
    requireOnline();
    clearPendingOAuth();
    suppressAuthEvents = true;
    let signedIn = false;
    try {
      const { data, error } = await cloud().auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new CloudError("session_expired");
      signedIn = true;
      await devices.registerSession(data.session, true);
      cloud().auth.startAutoRefresh();
      accept(data.session, false);
    } catch (error) {
      if (signedIn) await auth.logout();
      throw error;
    } finally { suppressAuthEvents = false; }
  },
  async register(
    email: string,
    password: string,
    username: string,
  ): Promise<boolean> {
    requireOnline();
    clearPendingOAuth();
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(normalized))
      throw new Error(
        t("authUsernameInvalid"),
      );
    const { data: existing, error: lookupError } = await cloud()
      .from("profiles")
      .select("id")
      .eq("username", normalized)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) throw new Error(t("authUsernameUsed"));
    suppressAuthEvents = true;
    try {
      const { data, error } = await cloud().auth.signUp({
        email,
        password,
        options: { data: { username: normalized } },
      });
      if (error) throw error;
      if (data.session) {
        await devices.registerSession(data.session, true);
        accept(data.session, false);
      }
      return Boolean(data.session);
    } catch (reason) { await auth.logout(); throw reason; }
    finally { suppressAuthEvents = false; }
  },
  async logout(): Promise<void> {
    // Hide this account immediately. Supabase can revoke its session afterwards.
    loggingOut = true;
    devices.reset();
    cloud().auth.stopAutoRefresh();
    offlineIdentity = null;
    await forgetOfflineIdentity();
    clearPendingOAuth();
    clearPkceVerifiers();
    accept(null, false);
    try {
      if (connectivity.usable) await cloud().auth.signOut({ scope: "local" });
    } catch { /* A failed network sign-out must not restore the local session. */ }
    finally {
      for (const key of [
        "autumn-auth",
        "autumn-auth-code-verifier",
        "autumn-auth-user",
      ]) localStorage.removeItem(key);
      accept(null, false);
      loggingOut = false;
    }
  },
  async recover(email: string): Promise<void> {
    requireOnline();
    clearPendingOAuth();
    const { error } = await cloud().auth.resetPasswordForEmail(email);
    if (error) throw error;
  },
  async resendEmail(email: string, type: "recovery" | "signup"): Promise<void> {
    requireOnline();
    const normalizedEmail = email.trim();
    const { error } = type === "recovery"
      ? await cloud().auth.resetPasswordForEmail(normalizedEmail)
      : await cloud().auth.resend({ type: "signup", email: normalizedEmail });
    if (error) throw error;
  },
  // Accept short email OTPs and older TokenHash emails during the template transition.
  async verifyEmail(email: string, token: string, type: "recovery" | "signup"): Promise<void> {
    requireOnline();
    clearPendingOAuth();
    const code = token.trim();
    const { data, error } = await cloud().auth.verifyOtp(
      /^\d{6,8}$/.test(code)
        ? { email: email.trim(), token: code, type: type === "signup" ? "email" : "recovery" }
        : { token_hash: code, type },
    );
    if (error) throw error;
    accept(data.session, type === "recovery");
  },
  async changePassword(password: string): Promise<void> {
    requireOnline();
    const { error } = await cloud().auth.updateUser({ password });
    if (error) throw error;
    publish({ ...state, recovery: false });
  },
  async changeOwnPassword(currentPassword: string, nextPassword: string): Promise<void> {
    if (!connectivity.usable) throw new Error(t("passwordOffline"));
    const owner = auth.requireUser();
    if (!currentPassword) throw new Error(t("currentPasswordWrong"));
    if (nextPassword.length < 8) throw new Error(t("passwordTooShort"));
    const email = state.session?.user.email;
    if (!email) throw new CloudError("session_expired");
    // This memory-only sign-in verifies the password even when the project's
    // optional current-password policy has not yet been enabled.
    const verifier = temporaryAuthClient();
    const verification = await verifier.auth.signInWithPassword({
      email, password: currentPassword,
    });
    if (verification.error) {
      if (["invalid_credentials", "invalid_password"].includes(verification.error.code ?? "") ||
          /invalid login credentials/i.test(verification.error.message))
        throw new Error(t("currentPasswordWrong"));
      throw verification.error;
    }
    const verifiedOwner = verification.data.user?.id;
    // Revoke the short-lived verification session. The primary reader client
    // owns a separate session and remains signed in for updateUser below.
    await verifier.auth.signOut({ scope: "local" }).catch(() => {});
    if (verifiedOwner !== owner || auth.state.ownerId !== owner)
      throw new CloudError("session_expired");
    const { error } = await cloud().auth.updateUser({
      current_password: currentPassword,
      password: nextPassword,
    });
    if (!error) return;
    const code = error.code?.toLowerCase() ?? "";
    if (["invalid_credentials", "invalid_password", "bad_password"].includes(code) ||
        /current password|current_password/i.test(error.message))
      throw new Error(t("currentPasswordWrong"));
    if (code === "weak_password" || code === "same_password")
      throw new Error(t("passwordPolicy"));
    if (code === "reauthentication_needed" || code === "reauthentication_required")
      throw new Error(t("passwordRecentLogin"));
    throw error;
  },
  async loginWithGoogle(): Promise<void> {
    requireOnline();
    clearPendingOAuth();
    const redirectTo = isTauri() ? nativeOAuthCallback : webOAuthCallback();
    publishOAuth({ status: "waiting", error: null });
    const { data, error } = await cloud().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error || !data.url || !data.flowId) {
      publishOAuth({ status: "idle", error: null });
      throw error ?? new Error(t("authGoogleFailed"));
    }
    const authorizationUrl = new URL(data.url);
    if (authorizationUrl.protocol !== "https:") {
      publishOAuth({ status: "idle", error: null });
      throw new Error(t("authGoogleFailed"));
    }
    localStorage.setItem(pendingOAuthFlowKey, data.flowId);
    if (isTauri()) {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(authorizationUrl.toString());
      } catch {
        clearPendingOAuth();
        throw new Error(t("authGoogleOpenFailed"));
      }
      publishOAuth({ status: "waiting", error: null });
      return;
    }
    window.location.assign(authorizationUrl.toString());
  },
  requireUser(): string {
    if (auth.state.status !== "authenticated" || !state.session)
      throw new CloudError("session_expired");
    return state.session.user.id;
  },
};
