import { auth } from "../services/auth";
import { errorMessage } from "../services/errors";
import { t } from "../i18n";

export function mountAccountSecurity(parent: HTMLElement): void {
  const section = document.createElement("section");
  section.className = "account-feature";
  section.innerHTML = `<div class="settings-copy"><h3>${t("accountSecurity")}</h3><p>${t("accountSecurityHelp")}</p></div>
    <button class="secondary-button account-change-password" type="button">${t("changeAccountPassword")}</button>
    <p class="account-security-status" role="status" aria-live="polite"></p>`;
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog";
  dialog.setAttribute("aria-labelledby", "account-password-heading");
  dialog.innerHTML = `<form class="account-password-form">
    <h2 id="account-password-heading">${t("changeAccountPassword")}</h2>
    <label>${t("currentPassword")}<span class="password-field"><input name="current" type="password" autocomplete="current-password" required /><button type="button" class="password-visibility" aria-label="${t("showPassword")}" aria-pressed="false">${t("showPassword")}</button></span></label>
    <label>${t("newAccountPassword")}<span class="password-field"><input name="next" type="password" autocomplete="new-password" minlength="8" required /><button type="button" class="password-visibility" aria-label="${t("showPassword")}" aria-pressed="false">${t("showPassword")}</button></span></label>
    <label>${t("confirmAccountPassword")}<span class="password-field"><input name="confirm" type="password" autocomplete="new-password" minlength="8" required /><button type="button" class="password-visibility" aria-label="${t("showPassword")}" aria-pressed="false">${t("showPassword")}</button></span></label>
    <p class="account-password-error" role="alert"></p>
    <footer><button type="button" class="secondary-button account-password-cancel">${t("cancel")}</button><button type="submit" class="primary-button">${t("changeAccountPassword")}</button></footer>
  </form>`;
  parent.append(section, dialog);
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const status = section.querySelector<HTMLElement>(".account-security-status")!;
  const error = dialog.querySelector<HTMLElement>(".account-password-error")!;
  let busy = false;
  const resetFields = () => {
    form.reset();
    for (const button of dialog.querySelectorAll<HTMLButtonElement>(".password-visibility")) {
      button.parentElement!.querySelector<HTMLInputElement>("input")!.type = "password";
      button.textContent = t("showPassword");
      button.setAttribute("aria-label", button.textContent);
      button.setAttribute("aria-pressed", "false");
    }
  };
  section.querySelector<HTMLButtonElement>(".account-change-password")!.addEventListener("click", () => {
    status.textContent = "";
    error.textContent = "";
    resetFields();
    dialog.showModal();
    form.querySelector<HTMLInputElement>('[name="current"]')!.focus();
  });
  dialog.querySelector<HTMLButtonElement>(".account-password-cancel")!.addEventListener("click", () => {
    if (!busy) dialog.close();
  });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { resetFields(); error.textContent = ""; });
  for (const button of dialog.querySelectorAll<HTMLButtonElement>(".password-visibility"))
    button.addEventListener("click", () => {
      const input = button.parentElement!.querySelector<HTMLInputElement>("input")!;
      const shown = input.type === "password";
      input.type = shown ? "text" : "password";
      button.textContent = t(shown ? "hidePassword" : "showPassword");
      button.setAttribute("aria-label", button.textContent);
      button.setAttribute("aria-pressed", String(shown));
    });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(form);
    const current = String(values.get("current") ?? "");
    const next = String(values.get("next") ?? "");
    const confirm = String(values.get("confirm") ?? "");
    if (next !== confirm) { error.textContent = t("passwordMismatch"); return; }
    if (next.length < 8) { error.textContent = t("passwordTooShort"); return; }
    if (!navigator.onLine) { error.textContent = t("passwordOffline"); return; }
    busy = true;
    error.textContent = "";
    for (const button of form.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
    void auth.changeOwnPassword(current, next).then(() => {
      dialog.close();
      status.textContent = t("passwordChanged");
    }).catch((reason: unknown) => {
      error.textContent = errorMessage(reason);
      form.querySelector<HTMLInputElement>('[name="current"]')!.value = "";
    }).finally(() => {
      busy = false;
      for (const button of form.querySelectorAll<HTMLButtonElement>("button")) button.disabled = false;
    });
  });
}
