import type { Session } from "@supabase/supabase-js";
import { cloud, cloudConfigured, temporaryAuthClient } from "../client";
import { CloudError, requireOnline } from "../errors";
import { t } from "../../i18n";

export type AuthState = {
  status: "loading" | "anonymous" | "authenticated" | "expired";
  session: Session | null;
  ownerId: string | null;
  recovery: boolean;
};
let state: AuthState = {
  status: "loading",
  session: null,
  ownerId: null,
  recovery: false,
};
const subscribers = new Set<(state: AuthState) => void>();
function publish(next: AuthState): void {
  state = next;
  subscribers.forEach((listener) => listener(state));
}
function accept(session: Session | null, recovery = state.recovery): void {
  const ownerId =
    session?.user.id ?? localStorage.getItem("autumn-offline-owner");
  if (session) localStorage.setItem("autumn-offline-owner", session.user.id);
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
  async initialize(): Promise<void> {
    if (!cloudConfigured) {
      publish({
        status: "anonymous",
        session: null,
        ownerId: null,
        recovery: false,
      });
      return;
    }
    cloud().auth.onAuthStateChange((event, session) => {
      // No awaited Supabase calls inside the SDK's auth lock.
      if (event === "SIGNED_OUT") {
        accept(null, false);
      } else accept(session, event === "PASSWORD_RECOVERY");
    });
    const { data, error } = await cloud().auth.getSession();
    if (error) accept(null);
    else accept(data.session);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cloud().auth.stopAutoRefresh();
      else {
        cloud().auth.startAutoRefresh();
        void auth.refresh().catch(() => {});
      }
    });
    window.addEventListener(
      "online",
      () => void auth.refresh().catch(() => {}),
    );
  },
  async refresh(): Promise<void> {
    if (!cloudConfigured || !navigator.onLine || !state.ownerId) return;
    const { data, error } = await cloud().auth.getSession();
    if (error) {
      accept(null);
      return;
    }
    accept(data.session);
  },
  async login(email: string, password: string): Promise<void> {
    requireOnline();
    const { data, error } = await cloud().auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    cloud().auth.startAutoRefresh();
    accept(data.session, false);
  },
  async register(
    email: string,
    password: string,
    username: string,
  ): Promise<boolean> {
    requireOnline();
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
    const { data, error } = await cloud().auth.signUp({
      email,
      password,
      options: { data: { username: normalized } },
    });
    if (error) throw error;
    if (data.session) accept(data.session, false);
    return Boolean(data.session);
  },
  async logout(): Promise<void> {
    // The SDK reads persistent session storage; local logout must also work without an HTTP response.
    if (navigator.onLine) await cloud().auth.signOut({ scope: "local" });
    cloud().auth.stopAutoRefresh();
    for (const key of [
      "autumn-auth",
      "autumn-auth-code-verifier",
      "autumn-auth-user",
    ])
      localStorage.removeItem(key);
    localStorage.removeItem("autumn-offline-owner");
    accept(null, false);
  },
  async recover(email: string): Promise<void> {
    requireOnline();
    const { error } = await cloud().auth.resetPasswordForEmail(email);
    if (error) throw error;
  },
  // Accept short email OTPs and older TokenHash emails during the template transition.
  async verifyEmail(email: string, token: string, type: "recovery" | "signup"): Promise<void> {
    requireOnline();
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
    if (!navigator.onLine) throw new Error(t("passwordOffline"));
    const owner = auth.requireUser();
    if (!currentPassword) throw new Error(t("currentPasswordWrong"));
    if (nextPassword.length < 8) throw new Error(t("passwordTooShort"));
    const email = state.session?.user.email;
    if (!email) throw new CloudError("session_expired");
    // This memory-only sign-in verifies the password even when the project's
    // optional current-password policy has not yet been enabled.
    const verification = await temporaryAuthClient().auth.signInWithPassword({
      email, password: currentPassword,
    });
    if (verification.error) {
      if (["invalid_credentials", "invalid_password"].includes(verification.error.code ?? "") ||
          /invalid login credentials/i.test(verification.error.message))
        throw new Error(t("currentPasswordWrong"));
      throw verification.error;
    }
    if (verification.data.user?.id !== owner || auth.state.ownerId !== owner)
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
  requireUser(): string {
    if (auth.state.status !== "authenticated" || !state.session)
      throw new CloudError("session_expired");
    return state.session.user.id;
  },
};
