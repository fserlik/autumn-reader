import { auth, type AuthState } from "../services/auth";
import { cloudConfigured } from "../services/client";
import { errorMessage } from "../services/errors";
import leafUrl from "../assets/autumn-leaf.png";
import { t } from "../i18n";

type EntryMode = "login" | "register" | "recover" | "verify";

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
      <form id="account-form" class="cloud-form">
        <label id="auth-username-label" hidden>${t("username")}<input name="username" autocomplete="username" minlength="3" maxlength="30" pattern="[a-z0-9_]{3,30}" autocapitalize="none" spellcheck="false" required disabled /><small>${t("authUsernameHelp")}</small></label>
        <label>${t("authEmail")}<input name="email" type="email" autocomplete="email" maxlength="254" required /></label>
        <label id="auth-password-label">${t("authPassword")}<input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required /></label>
        <button id="auth-submit" class="primary-button" type="submit">${t("authSignIn")}</button>
        <button id="auth-recover" class="text-link" type="button">${t("authForgot")}</button>
      </form>
      <form id="email-token-form" class="cloud-form" hidden>
        <label>${t("authEmail")}<input name="email" type="email" autocomplete="email" maxlength="254" required /></label>
        <label>${t("authEmailCode")}<input name="token" autocomplete="one-time-code" maxlength="2000" required /></label>
        <button type="submit" class="primary-button">${t("authVerifyCode")}</button>
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
  settings.prepend(accountSettings);
  const find = <T extends HTMLElement>(selector: string): T =>
    entry.querySelector<T>(selector)!;
  const form = find<HTMLFormElement>("#account-form");
  const password = form.querySelector<HTMLInputElement>('[name="password"]')!;
  const tokenForm = find<HTMLFormElement>("#email-token-form");
  const tokenEmail = tokenForm.querySelector<HTMLInputElement>('[name="email"]')!;
  const passwordForm = find<HTMLFormElement>("#password-form");
  const username = form.querySelector<HTMLInputElement>('[name="username"]')!;
  let verificationType: "signup" | "recovery" = "signup";
  const logout =
    accountSettings.querySelector<HTMLButtonElement>("#account-logout")!;
  let mode: EntryMode = "login";
  let busy = false;
  let enteredOwner: string | undefined;
  let previousOwner: string | null | undefined;
  const message = (text: string): void => {
    find("#account-message").textContent = text;
  };

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
    logout.disabled = busy || loading;
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
      localStorage.removeItem("autumn-pending-verification");
      localStorage.removeItem("autumn-pending-email");
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
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const email = String(values.get("email"));
    const credential = String(values.get("password") ?? "");
    void run(async () => {
      if (mode === "recover") {
        await auth.recover(email);
        mode = "verify";
        verificationType = "recovery";
        localStorage.setItem("autumn-pending-verification", verificationType);
        localStorage.setItem("autumn-pending-email", email.trim());
        tokenEmail.value = email.trim();
        message(
          t("authRecoverySent"),
        );
      } else if (mode === "register") {
        const signedIn = await auth.register(email, credential, String(values.get("username") ?? ""));
        password.value = "";
        if (!signedIn) {
          mode = "verify";
          verificationType = "signup";
          localStorage.setItem("autumn-pending-verification", verificationType);
          localStorage.setItem("autumn-pending-email", email.trim());
          tokenEmail.value = email.trim();
          message(t("authSignupSent"));
        }
      } else {
        try {
          await auth.login(email, credential);
        } catch (error: unknown) {
          if (error instanceof Error && "code" in error && error.code === "email_not_confirmed") {
            verificationType = "signup";
            mode = "verify";
            localStorage.setItem("autumn-pending-verification", verificationType);
            localStorage.setItem("autumn-pending-email", email.trim());
            tokenEmail.value = email.trim();
            password.value = "";
            message(t("authSignupPending"));
            return;
          }
          throw error;
        }
        localStorage.removeItem("autumn-pending-verification");
        localStorage.removeItem("autumn-pending-email");
        form.reset();
      }
    });
  });
  tokenForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(tokenForm);
    void run(async () => {
      await auth.verifyEmail(
        String(values.get("email")),
        String(values.get("token")),
        verificationType,
      );
      localStorage.removeItem("autumn-pending-verification");
      localStorage.removeItem("autumn-pending-email");
      tokenForm.reset();
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
    localStorage.removeItem("autumn-pending-verification");
    localStorage.removeItem("autumn-pending-email");
    void run(async () => {
      if (cloudConfigured) await auth.logout();
      form.reset();
      tokenForm.reset();
      passwordForm.reset();
    });
  });
  const pendingVerification = localStorage.getItem("autumn-pending-verification");
  tokenEmail.value = localStorage.getItem("autumn-pending-email") ?? "";
  if (pendingVerification === "signup" || pendingVerification === "recovery") {
    mode = "verify";
    verificationType = pendingVerification;
  }
  auth.subscribe(render);
  window.addEventListener("online", () => render(auth.state));
  window.addEventListener("offline", () => render(auth.state));
}
