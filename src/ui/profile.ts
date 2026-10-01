import { profiles } from "../services/profiles";
import { errorMessage } from "../services/errors";
import type { Profile } from "../services/types";
import { t } from "../i18n";
import { prepareAvatar } from "../services/profiles/avatar";

export function createProfileEditor(
  profile: Profile,
  saved: (username: string) => Promise<void>,
  id = "profile-form",
): HTMLFormElement {
  const form = document.createElement("form");
  form.id = id;
  form.className = "cloud-form cloud-panel";
  form.innerHTML = `<h3>${t("editProfile")}</h3>
    <label>${t("username")}<input name="username" pattern="[a-z0-9_]{3,30}" maxlength="30" required /></label>
    <label>${t("publicName")}<input name="display_name" maxlength="100" /></label>
    <div class="avatar-picker">
      <img class="avatar-preview" alt="${t("profilePhoto")}" hidden />
      <div><span class="avatar-label">${t("profilePhoto")}</span>
        <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="${t("profilePhoto")}" hidden />
        <button class="secondary-button avatar-choose" type="button">${t("profileChooseImage")}</button>
        <button class="text-link avatar-discard" type="button" hidden>${t("profileDiscardImage")}</button>
        <span class="avatar-filename"></span><small>${t("profileImageHelp")}</small>
      </div>
    </div>
    <label>${t("profileDescription")}<textarea name="bio" maxlength="2000" rows="3"></textarea></label>
    <button class="primary-button" type="submit">${t("saveProfile")}</button>
    <p role="status" aria-live="polite"></p>`;
  for (const key of [
    "username",
    "display_name",
    "bio",
  ] as const) {
    form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[name="${key}"]`,
    )!.value = profile[key] ?? "";
  }
  const picker = form.querySelector<HTMLInputElement>('[name="avatar"]')!;
  const choose = form.querySelector<HTMLButtonElement>(".avatar-choose")!;
  const discard = form.querySelector<HTMLButtonElement>(".avatar-discard")!;
  const preview = form.querySelector<HTMLImageElement>(".avatar-preview")!;
  const message = form.querySelector<HTMLElement>('[role="status"]')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  let avatar: Blob | undefined;
  let previewUrl: string | undefined;
  let imageSequence = 0;
  let saving = false;
  function clearPreview(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    preview.hidden = true;
    preview.removeAttribute("src");
  }
  choose.addEventListener("click", () => picker.click());
  discard.addEventListener("click", () => {
    ++imageSequence; avatar = undefined; picker.value = "";
    clearPreview(); discard.hidden = true;
    form.querySelector(".avatar-filename")!.textContent = "";
    message.textContent = ""; submit.disabled = false;
  });
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (!file || saving) return;
    const token = ++imageSequence;
    submit.disabled = true;
    message.textContent = t("profileImagePreparing");
    discard.hidden = false;
    void prepareAvatar(file).then((blob) => {
      if (token !== imageSequence) return;
      clearPreview(); avatar = blob;
      previewUrl = URL.createObjectURL(blob);
      preview.src = previewUrl; preview.hidden = false;
      form.querySelector(".avatar-filename")!.textContent = file.name;
      message.textContent = ""; submit.disabled = false;
    }).catch((error: unknown) => {
      if (token !== imageSequence) return;
      avatar = undefined; clearPreview();
      message.textContent = errorMessage(error);
      // Keep saving disabled until the invalid selection is discarded or replaced.
    });
  });
  preview.addEventListener("load", () => {
    // The decoded image stays visible; release the temporary URL even if the editor is closed.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (saving || submit.disabled) return;
    const values = new FormData(form);
    saving = true;
    submit.disabled = true; choose.disabled = true; discard.disabled = true;
    message.textContent = t(avatar ? "profileImageUploading" : "profileSaving");
    const username = String(values.get("username")).toLowerCase();
    void profiles
      .update({
        username,
        display_name: String(values.get("display_name")),
        avatar_url: profile.avatar_url,
        bio: String(values.get("bio")),
      }, avatar)
      .then(() => saved(username))
      .catch((error: unknown) => {
        message.textContent = errorMessage(error);
      })
      .finally(() => {
        saving = false;
        submit.disabled = false; choose.disabled = false; discard.disabled = false;
      });
  });
  return form;
}
