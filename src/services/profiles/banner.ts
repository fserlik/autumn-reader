import { auth } from "../auth";
import { cloud, checkError } from "../client";
import { localGet, localPut } from "../local/database";
import { optimizeCover } from "../storage/covers";
import { newUuid } from "../platform/ids";
import { t } from "../../i18n";
import type { Profile } from "../types";

interface BannerCache { id: string; ownerId: string; url: string; blob: Blob }
const inputLimit = 10 * 1024 * 1024;
const outputLimit = 1024 * 1024;

export async function prepareBanner(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size)
    throw new Error(t("profileImageInvalid"));
  if (file.size > inputLimit) throw new Error(t("profileImageTooLarge"));
  try { return await optimizeCover(file, 1200, outputLimit); }
  catch { throw new Error(t("profileImageInvalid")); }
}

export async function updateBanner(profile: Profile, blob: Blob): Promise<void> {
  const owner = auth.requireUser();
  if (profile.id !== owner || !["image/webp", "image/png"].includes(blob.type) || !blob.size || blob.size > outputLimit)
    throw new Error(t("profileImageInvalid"));
  const path = `${owner}/banner`;
  const { error: uploadError } = await cloud().storage.from("avatars").upload(path, await blob.arrayBuffer(), {
    contentType: blob.type, upsert: true, cacheControl: "0",
  });
  checkError(uploadError);
  if (auth.state.ownerId !== owner) return;
  const url = `${cloud().storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${newUuid()}`;
  const { error } = await cloud().from("profiles").update({ banner_url: url }).eq("id", owner);
  checkError(error);
  if (auth.state.ownerId !== owner) return;
  await localPut<BannerCache>("cloud_state", { id: `banner:${owner}`, ownerId: owner, url, blob });
  const cached = await localGet<{ id: string; ownerId: string; profile: Profile }>("cloud_state", `profile:${owner}`);
  if (cached?.ownerId === owner) await localPut("cloud_state", { ...cached, profile: { ...cached.profile, banner_url: url } });
}

export async function ownBanner(profile: Profile): Promise<Blob | null> {
  const owner = auth.state.ownerId;
  if (!owner || owner !== profile.id || !profile.banner_url) return null;
  const cached = await localGet<BannerCache>("cloud_state", `banner:${owner}`);
  if (cached?.ownerId === owner && cached.url === profile.banner_url) return cached.blob;
  if (!navigator.onLine) return null;
  const expected = cloud().storage.from("avatars").getPublicUrl(`${owner}/banner`).data.publicUrl;
  const remote = new URL(profile.banner_url), allowed = new URL(expected);
  if (remote.origin !== allowed.origin || remote.pathname !== allowed.pathname) return null;
  const response = await fetch(remote, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok || !["image/webp", "image/png"].includes(response.headers.get("content-type")?.split(";")[0] ?? "")) return null;
  const blob = await response.blob();
  if (blob.size > outputLimit || auth.state.ownerId !== owner) return null;
  await localPut<BannerCache>("cloud_state", { id: `banner:${owner}`, ownerId: owner, url: profile.banner_url, blob });
  return blob;
}
