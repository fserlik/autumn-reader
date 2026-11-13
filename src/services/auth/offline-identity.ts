import { localDelete, localGet, localPut } from "../local/database";

export type OfflineIdentity = {
  id: "offline_identity";
  ownerId: string;
  email?: string;
  authenticatedAt: number;
  version: 1;
};

const ownerKey = "autumn-offline-owner";
const signedOutKey = "autumn-offline-signed-out";
const identityId = "offline_identity";

function validOwner(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export async function readOfflineIdentity(): Promise<OfflineIdentity | null> {
  if (localStorage.getItem(signedOutKey) === "1") return null;
  try {
    const stored = await localGet<OfflineIdentity>("cloud_state", identityId);
    if (stored?.id === identityId && validOwner(stored.ownerId)) {
      localStorage.setItem(ownerKey, stored.ownerId);
      return stored;
    }
  } catch { /* Fall back to the marker used by existing installations. */ }
  const legacy = localStorage.getItem(ownerKey);
  if (!validOwner(legacy)) return null;
  const migrated: OfflineIdentity = {
    id: identityId,
    ownerId: legacy,
    authenticatedAt: 0,
    version: 1,
  };
  void localPut("cloud_state", migrated).catch(() => {});
  return migrated;
}

export function rememberOfflineIdentity(ownerId: string, email?: string): void {
  if (!validOwner(ownerId)) return;
  localStorage.setItem(ownerKey, ownerId);
  localStorage.removeItem(signedOutKey);
  const value: OfflineIdentity = {
    id: identityId,
    ownerId,
    email,
    authenticatedAt: Date.now(),
    version: 1,
  };
  void localPut("cloud_state", value).catch(() => {});
}

export async function forgetOfflineIdentity(): Promise<void> {
  // The tombstone is synchronous so a force-close during logout cannot restore the account.
  localStorage.setItem(signedOutKey, "1");
  localStorage.removeItem(ownerKey);
  await localDelete("cloud_state", identityId).catch(() => {});
}
