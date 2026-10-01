import { auth } from "../auth";
import { cloud } from "../client";
import { optimizeCover } from "../storage/covers";
import { localGet, localPut } from "../local/database";
import { t } from "../../i18n";
import type { Profile } from "../types";
import { newUuid } from "../platform/ids";

interface AvatarCache { id: string; ownerId: string; url: string; blob: Blob }
export const AVATAR_INPUT_LIMIT = 10 * 1024 * 1024;
export const AVATAR_OUTPUT_LIMIT = 512 * 1024;
export function validateAvatar(file: Blob): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(t("profileImageInvalid"));
  if (!file.size || file.size > AVATAR_INPUT_LIMIT)
    throw new Error(t("profileImageTooLarge"));
}
export async function prepareAvatar(file: Blob): Promise<Blob> {
  validateAvatar(file);
  try {
    // 256 px suits the circular avatar; PNG fallback also stays below the upload limit.
    const optimized = await optimizeCover(file, 256);
    if (!["image/webp", "image/png"].includes(optimized.type)) throw new Error("Unsupported encoder");
    return optimized;
  } catch {
    throw new Error(t("profileImageInvalid"));
  }
}
export async function uploadAvatar(owner: string, blob: Blob): Promise<string> {
  if (auth.requireUser() !== owner) throw new Error(t("profileImageFailed"));
  if (!["image/webp", "image/png"].includes(blob.type) || !blob.size || blob.size > AVATAR_OUTPUT_LIMIT)
    throw new Error(t("profileImageInvalid"));
  const path = `${owner}/avatar`;
  const { error } = await cloud().storage.from("avatars").upload(path, await blob.arrayBuffer(), {
    contentType: blob.type, upsert: true, cacheControl: "0",
  });
  if (error) {
    if (/bucket.*not found/i.test(error.message)) throw new Error(t("profileImageNotConfigured"));
    throw new Error(t("profileImageFailed"));
  }
  return `${cloud().storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${newUuid()}`;
}
export async function cacheAvatar(owner: string, url: string, blob: Blob): Promise<void> {
  await localPut<AvatarCache>("cloud_state", { id: `avatar:${owner}`, ownerId: owner, url, blob });
}
export async function ownAvatar(profile: Profile): Promise<Blob | null> {
  const owner = auth.state.ownerId;
  if (!owner || profile.id !== owner || !profile.avatar_url) return null;
  const cached = await localGet<AvatarCache>("cloud_state", `avatar:${owner}`);
  if (cached?.ownerId === owner && cached.url === profile.avatar_url) return cached.blob;
  if (!navigator.onLine) return null;
  // Fetch only this application's public avatar object, without credentials or external URLs.
  const expected = cloud().storage.from("avatars").getPublicUrl(`${owner}/avatar`).data.publicUrl;
  const remote = new URL(profile.avatar_url), allowed = new URL(expected);
  if (remote.origin !== allowed.origin || remote.pathname !== allowed.pathname) return null;
  const response = await fetch(remote, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok || !["image/webp", "image/png"].includes(response.headers.get("content-type")?.split(";")[0] ?? "")) return null;
  const blob = await response.blob();
  if (blob.size > AVATAR_OUTPUT_LIMIT || auth.state.ownerId !== owner) return null;
  const latest = await localGet<{ profile: Profile }>("cloud_state", `profile:${owner}`);
  if (latest && latest.profile.avatar_url !== profile.avatar_url) return null;
  await cacheAvatar(owner, profile.avatar_url, blob);
  return blob;
}
