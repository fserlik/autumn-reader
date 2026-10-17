import { auth, type AuthState } from "../services/auth";
import { cloudConfigured } from "../services/client";
import { errorMessage } from "../services/errors";
import leafUrl from "../assets/autumn-leaf.png";
import { t } from "../i18n";

type EntryMode = "login" | "register" | "recover" | "verify";
type VerificationType = "signup" | "recovery";
type ResendState = {
  email: string;
  type: VerificationType;
  count: number;
  availableAt: number;
};

const pendingVerificationKey = "autumn-pending-verification";
const pendingEmailKey = "autumn-pending-email";
const resendStateKey = "autumn-verification-resend-state";
const resendCooldownMs = 60_000;
const maxResends = 3;

export function mountAccount(
  root: HTMLElement,
  shell: HTMLElement,
  settings: HTMLElement,
): void {
  const entry = document.createElement("section");
  entry.id = "auth-entry";
  entry.className = "auth-entry";
  entry.setAttribute("aria-labelledby", "auth-heading");
  entry.innerHTML = `
    <div class="auth-story">
      <div class="auth-brand"><img src="${leafUrl}" alt="" /><span>Autumn <strong>Reader</strong></span></div>
      <div class="auth-story-copy"><h2>${t("authStoryTitle")}</h2><p>${t("authStoryText")}</p></div>
      <img class="auth-leaf" src="${leafUrl}" alt="" />
    </div>
    <div class="auth-content"><div class="auth-card">
      <h1 id="auth-heading">${t("authWelcome")}</h1>
      <p id="auth-description">${t("authLoginHelp")}</p>
      <p id="account-state" role="status" aria-live="polite"></p>
      <div class="auth-switch" aria-label="${t("authAccess")}">
        <button id="auth-login-tab" type="button" aria-pressed="true">${t("authSignIn")}</button>
        <button id="auth-register-tab" type="button" aria-pressed="false">${t("authRegister")}</button>
      </div>
      <div id="auth-google-block" class="auth-google-block">
        <button id="auth-google" class="auth-google-button" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.3h5.4a4.7 4.7 0 0 1-2 3v2.8h3.3c1.9-1.8 2.9-4.4 2.9-7.9Z"/><path fill="#34a853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.7c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.8A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.4 13.8A6 6 0 0 1 6.1 12c0-.6.1-1.2.3-1.8V7.4H3A10 10 0 0 0 3 16.6l3.4-2.8Z"/><path fill="#ea4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.4l3.4 2.8A6 6 0 0 1 12 6.1Z"/></svg>
          <span>${t("authContinueGoogle")}</span>
        </button>
        <div class="auth-divider"><span>${t("authOrEmail")}</span></div>
      </div>
      <form id="account-form" class="cloud-form">
        <label id="auth-username-label" hidden>${t("username")}<input name="username" autocomplete="username" minlength="3" maxlength="30" pattern="[a-z0-9_]{3,30}" autocapitalize="none" spellcheck="false" required disabled /><small>${t("authUsernameHelp")}</small></label>
        <label>${t("authEmail")}<input name="email" type="email" autocomplete="email" maxlength="254" required /></label>
        <label id="auth-password-label">${t("authPassword")}<input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required /></label>
        <button id="auth-submit" class="primary-button" type="submit">${t("authSignIn")}</button>
        <button id="auth-recover" class="text-link" type="button">${t("authForgot")}</button>
      </form>
      <form id="email-token-form" class="cloud-form" hidden>
        <div class="auth-code-destination">
          <span>${t("authCodeSentTo")}</span>
          <strong id="auth-code-email"></strong>
        </div>
        <label class="auth-code-field">${t("authEmailCode")}<input name="token" autocomplete="one-time-code" maxlength="2000" required /></label>
        <button type="submit" class="primary-button">${t("authVerifyCode")}</button>
        <div class="auth-resend">
          <button id="auth-resend" class="text-link" type="button" aria-describedby="auth-resend-note">${t("authResendCode")}</button>
          <p id="auth-resend-note"></p>
        </div>
      </form>
      <form id="password-form" class="cloud-form" hidden>
        <label>${t("authNewPassword")}<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
        <button class="primary-button" type="submit">${t("authSavePassword")}</button>
      </form>
      <button id="auth-back" class="text-link auth-extra" type="button" hidden>${t("authBack")}</button>
      <p id="account-message" role="status" aria-live="polite"></p>
    </div></div>`;
  root.insertBefore(entry, shell);
  const accountSettings = document.createElement("section");
  accountSettings.className = "settings-session account-settings";
  accountSettings.innerHTML = `<button id="account-logout" class="secondary-button" type="button">${t("authLogout")}</button>`;
  settings.append(accountSettings);
  const find = <T extends HTMLElement>(selector: string): T =>
    entry.querySelector<T>(selector)!;
  const form = find<HTMLFormElement>("#account-form");
  const googleButton = find<HTMLButtonElement>("#auth-google");
  const googleLabel = googleButton.querySelector<HTMLElement>("span")!;
  const password = form.querySelector<HTMLInputElement>('[name="password"]')!;
  const tokenForm = find<HTMLFormElement>("#email-token-form");
  const resendButton = find<HTMLButtonElement>("#auth-resend");
  const resendNote = find<HTMLParagraphElement>("#auth-resend-note");
  const codeEmail = find<HTMLElement>("#auth-code-email");
  const passwordForm = find<HTMLFormElement>("#password-form");
  const username = form.querySelector<HTMLInputElement>('[name="username"]')!;
  let verificationType: VerificationType = "signup";
  const logout =
    accountSettings.querySelector<HTMLButtonElement>("#account-logout")!;
  let mode: EntryMode = "login";
  let busy = false;
  let googleBusy = false;
  let enteredOwner: string | undefined;
  let previousOwner: string | null | undefined;
  let resendTimer: number | undefined;
  const message = (text: string): void => {
    find("#account-message").textContent = text;
  };

  function pendingEmail(): string {
    return localStorage.getItem(pendingEmailKey)?.trim() ?? "";
  }

  function readResendState(): ResendState {
    const email = pendingEmail();
    try {
      const value = JSON.parse(localStorage.getItem(resendStateKey) ?? "null") as Partial<ResendState> | null;
      if (
        value?.email === email &&
        value.type === verificationType &&
        Number.isInteger(value.count) &&
        typeof value.availableAt === "number"
      ) {
        return {
          email,
          type: verificationType,
          count: Math.min(maxResends, Math.max(0, value.count!)),
          availableAt: Math.max(0, value.availableAt),
        };
      }
    } catch { /* Replace malformed local state below. */ }
    return { email, type: verificationType, count: 0, availableAt: 0 };
  }

  function saveResendState(value: ResendState): void {
    localStorage.setItem(resendStateKey, JSON.stringify(value));
  }

  function clearResendTimer(): void {
    if (resendTimer !== undefined) window.clearInterval(resendTimer);
    resendTimer = undefined;
  }

  function updateResendUi(state: AuthState): void {
    if (mode !== "verify") {
      clearResendTimer();
      return;
    }
    const resend = readResendState();
    const remainingSeconds = Math.max(0, Math.ceil((resend.availableAt - Date.now()) / 1000));
    codeEmail.textContent = resend.email;
    resendNote.textContent = resend.count >= maxResends
      ? t("authResendLimit")
      : t("authResendsAvailable", { count: maxResends - resend.count });
    resendButton.textContent = resend.count >= maxResends
      ? t("authResendLimitShort")
      : remainingSeconds > 0
        ? t("authResendIn", { seconds: remainingSeconds })
        : t("authResendCode");
    resendButton.disabled =
      busy ||
      state.status === "loading" ||
      !cloudConfigured ||
      !navigator.onLine ||
      !resend.email ||
      resend.count >= maxResends ||
      remainingSeconds > 0;
    if (remainingSeconds > 0 && resendTimer === undefined) {
      resendTimer = window.setInterval(() => {
        updateResendUi(auth.state);
        if (readResendState().availableAt <= Date.now()) clearResendTimer();
      }, 1000);
    } else if (remainingSeconds === 0) {
      clearResendTimer();
    }
  }

  function clearVerification(): void {
    localStorage.removeItem(pendingVerificationKey);
    localStorage.removeItem(pendingEmailKey);
    localStorage.removeItem(resendStateKey);
    clearResendTimer();
  }

  function beginVerification(type: VerificationType, email: string): void {
    const normalizedEmail = email.trim();
    mode = "verify";
    verificationType = type;
    localStorage.setItem(pendingVerificationKey, type);
    localStorage.setItem(pendingEmailKey, normalizedEmail);
    saveResendState({
      email: normalizedEmail,
      type,
      count: 0,
      availableAt: Date.now() + resendCooldownMs,
    });
  }

  function render(state: AuthState): void {
    if (previousOwner !== state.ownerId) {
      previousOwner = state.ownerId;
      enteredOwner = undefined;
    }
    const canReadCached =
      state.status === "expired" &&
      Boolean(state.ownerId) &&
      (!navigator.onLine || enteredOwner === state.ownerId);
    const open =
      state.status !== "loading" &&
      !state.recovery &&
      !busy &&
      (state.status === "authenticated" || canReadCached);
    entry.hidden = open;
    shell.hidden = !open;
    if (open && state.ownerId) enteredOwner = state.ownerId;
    const loading = state.status === "loading";
    find("#auth-heading").textContent = loading
      ? t("authOpening")
      : state.recovery
        ? t("authChoosePassword")
        : {
            login: t("authWelcome"),
            register: t("authCreateAccount"),
            recover: t("authRecoverPassword"),
            verify: verificationType === "signup" ? t("authConfirmSignup") : t("authRecoverPassword"),
          }[mode];
    find("#auth-description").textContent = state.recovery
      ? t("authNewPasswordHelp")
      : {
          login: t("authLoginHelp"),
          register: t("authRegisterHelp"),
          recover: t("authRecoverHelp"),
          verify: t("authVerifyHelp"),
        }[mode];
    find("#account-state").textContent = loading
      ? t("authChecking")
      : !cloudConfigured
        ? t("authUnconfigured")
        : state.status === "expired"
          ? t("authExpired")
          : "";
    form.hidden = loading || state.recovery || mode === "verify";
    tokenForm.hidden = loading || state.recovery || mode !== "verify";
    passwordForm.hidden = !state.recovery;
    find(".auth-switch").hidden =
      loading || state.recovery || mode === "recover" || mode === "verify";
    find("#auth-google-block").hidden =
      loading || state.recovery || mode === "recover" || mode === "verify";
    find("#auth-password-label").hidden = mode === "recover";
    find("#auth-username-label").hidden = mode !== "register";
    password.autocomplete =
      mode === "register" ? "new-password" : "current-password";
    find("#auth-submit").textContent =
      mode === "register"
        ? t("authRegister")
        : mode === "recover"
          ? t("authSendCode")
          : t("authSignIn");
    find("#auth-recover").hidden = mode !== "login";
    find("#auth-back").hidden =
      loading || state.recovery || (mode !== "verify" && mode !== "recover");
    find("#auth-login-tab").setAttribute(
      "aria-pressed",
      String(mode === "login"),
    );
    find("#auth-register-tab").setAttribute(
      "aria-pressed",
      String(mode === "register"),
    );
    entry
      .querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLButtonElement
      >("input, select, button")
      .forEach((control) => {
        control.disabled =
          busy ||
          loading ||
          (!cloudConfigured &&
            ![
              "auth-login-tab",
              "auth-register-tab",
              "auth-back",
            ].includes(control.id));
      });
    password.disabled =
      busy || loading || !cloudConfigured || mode === "recover";
    username.disabled = busy || loading || !cloudConfigured || mode !== "register";
    googleButton.disabled = busy || loading || !cloudConfigured || !navigator.onLine;
    googleLabel.textContent = googleBusy ? t("authGoogleOpening") : t("authContinueGoogle");
    logout.disabled = busy || loading;
    updateResendUi(state);
  }
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    render(auth.state);
    message("");
    try {
      await action();
    } catch (error: unknown) {
      message(errorMessage(error));
    } finally {
      busy = false;
      render(auth.state);
    }
  }
  function select(next: EntryMode): void {
    mode = next;
    if (next !== "verify") {
      clearVerification();
    }
    message("");
    render(auth.state);
  }
  find("#auth-login-tab").addEventListener("click", () => select("login"));
  find("#auth-register-tab").addEventListener("click", () =>
    select("register"),
  );
  find("#auth-recover").addEventListener("click", () => select("recover"));
  find("#auth-back").addEventListener("click", () => select("login"));
  googleButton.addEventListener("click", () => {
    googleBusy = true;
    void run(() => auth.loginWithGoogle()).finally(() => {
      googleBusy = false;
      render(auth.state);
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const email = String(values.get("email"));
    const credential = String(values.get("password") ?? "");
    void run(async () => {
      if (mode === "recover") {
        await auth.recover(email);
        beginVerification("recovery", email);
      } else if (mode === "register") {
        const signedIn = await auth.register(email, credential, String(values.get("username") ?? ""));
        password.value = "";
        if (!signedIn) {
          beginVerification("signup", email);
        }
      } else {
        try {
          await auth.login(email, credential);
        } catch (error: unknown) {
          if (error instanceof Error && "code" in error && error.code === "email_not_confirmed") {
            beginVerification("signup", email);
            password.value = "";
            return;
          }
          throw error;
        }
        clearVerification();
        form.reset();
      }
    });
  });
  tokenForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(tokenForm);
    void run(async () => {
      await auth.verifyEmail(
        pendingEmail(),
        String(values.get("token")),
        verificationType,
      );
      clearVerification();
      tokenForm.reset();
    });
  });
  resendButton.addEventListener("click", () => {
    const resend = readResendState();
    if (
      resend.count >= maxResends ||
      resend.availableAt > Date.now() ||
      !resend.email
    ) return;
    void run(async () => {
      await auth.resendEmail(resend.email, verificationType);
      saveResendState({
        ...resend,
        count: resend.count + 1,
        availableAt: Date.now() + resendCooldownMs,
      });
      message(t("authResendSent"));
    });
  });
  passwordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(passwordForm);
    void run(async () => {
      await auth.changePassword(String(values.get("password")));
      passwordForm.reset();
    });
  });
  logout.addEventListener("click", () => {
    enteredOwner = undefined;
    mode = "login";
    clearVerification();
    void run(async () => {
      if (cloudConfigured) await auth.logout();
      form.reset();
      tokenForm.reset();
      passwordForm.reset();
    });
  });
  const pendingVerification = localStorage.getItem(pendingVerificationKey);
  if (pendingVerification === "signup" || pendingVerification === "recovery") {
    mode = "verify";
    verificationType = pendingVerification;
    const resend = readResendState();
    saveResendState(resend);
  }
  auth.subscribe(render);
  auth.subscribeOAuth((oauth) => {
    if (oauth.status === "waiting") message(t("authGoogleWaiting"));
    else if (oauth.status === "exchanging") message(t("authGoogleFinishing"));
    else if (oauth.status === "error") message(errorMessage(oauth.error));
    render(auth.state);
  });
  window.addEventListener("online", () => render(auth.state));
  window.addEventListener("offline", () => render(auth.state));
}
