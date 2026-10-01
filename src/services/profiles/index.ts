import { auth } from "../auth";
import { t } from "../../i18n";
import { cloud, checkError } from "../client";
import type { Profile } from "../types";
import { localGet, localPut } from "../local/database";
import { cacheAvatar, uploadAvatar } from "./avatar";
interface CachedProfile { id: string; ownerId: string; profile: Profile }
async function cache(profile: Profile): Promise<void> {
  await localPut<CachedProfile>("cloud_state", { id: `profile:${profile.id}`, ownerId: profile.id, profile });
}
export const profiles = {
  async cachedOwn(): Promise<Profile | null> {
    const owner = auth.state.ownerId;
    if (!owner) return null;
    const cached = await localGet<CachedProfile>("cloud_state", `profile:${owner}`);
    return cached?.ownerId === owner && cached.profile.id === owner ? cached.profile : null;
  },
  async get(username: string): Promise<Profile | null> {
    const { data, error } = await cloud()
      .from("profiles")
      .select("*")
      .eq("username", username.toLowerCase())
      .maybeSingle();
    checkError(error);
    return data;
  },
  async own(): Promise<Profile | null> {
    const owner = auth.requireUser();
    const { data, error } = await cloud()
      .from("profiles")
      .select("*")
      .eq("id", owner)
      .maybeSingle();
    checkError(error);
    if (auth.state.ownerId !== owner) return null;
    if (data) await cache(data);
    return data;
  },
  async update(
    values: Pick<Profile, "username" | "display_name" | "avatar_url" | "bio">,
    avatar?: Blob,
  ): Promise<void> {
    if (!/^[a-z0-9_]{3,30}$/.test(values.username))
      throw new Error(
        t("authUsernameInvalid"),
      );
    if (values.avatar_url && !values.avatar_url.startsWith("https://"))
      throw new Error(t("profileAvatarHttps"));
    const owner = auth.requireUser();
    const updated = { ...values };
    if (avatar) updated.avatar_url = await uploadAvatar(owner, avatar);
    if (auth.state.ownerId !== owner) throw new Error(t("profileAccountChanged"));
    const { error } = await cloud()
      .from("profiles")
      .update(updated)
      .eq("id", owner);
    checkError(error);
    if (auth.state.ownerId !== owner) return;
    const previous = await profiles.cachedOwn();
    if (previous) await cache({ ...previous, ...updated });
    if (avatar && updated.avatar_url) await cacheAvatar(owner, updated.avatar_url, avatar);
  },
};
