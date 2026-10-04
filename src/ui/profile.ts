import { profiles } from "../services/profiles";
import { errorMessage } from "../services/errors";
import type { Profile } from "../services/types";
import { t } from "../i18n";

export function createProfileEditor(profile: Profile, saved: (username: string) => void, id = "profile-form"): HTMLFormElement {
  const form = document.createElement("form");
  form.id = id;
  form.className = "cloud-form cloud-panel";
  form.innerHTML = `<h3>${t("editProfile")}</h3>
    <label>${t("username")}<input name="username" pattern="[a-z0-9_]{3,30}" maxlength="30" required /></label>
    <label>${t("publicName")}<input name="display_name" maxlength="100" /></label>
    <label>${t("profileDescription")}<textarea name="bio" maxlength="2000" rows="3"></textarea></label>
    <button class="primary-button" type="submit">${t("saveProfile")}</button>
    <p role="status" aria-live="polite"></p>`;
  for (const key of ["username", "display_name", "bio"] as const)
    form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${key}"]`)!.value = profile[key] ?? "";
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const message = form.querySelector<HTMLElement>('[role="status"]')!;
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    message.textContent = t("profileSaving");
    const values = new FormData(form);
    const username = String(values.get("username")).toLowerCase();
    void profiles.cachedOwn().then(latest => profiles.update({
      username,
      display_name: String(values.get("display_name")),
      bio: String(values.get("bio")),
      avatar_url: latest?.avatar_url ?? profile.avatar_url,
    })).then(() => saved(username)).catch((error: unknown) => {
      message.textContent = errorMessage(error);
    }).finally(() => { submit.disabled = false; });
  });
  return form;
}
