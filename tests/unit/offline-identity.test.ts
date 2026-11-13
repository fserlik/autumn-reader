import "fake-indexeddb/auto";
import { beforeEach, expect, test, vi } from "vitest";
import { localGet } from "../../src/services/local/database";
import {
  forgetOfflineIdentity,
  readOfflineIdentity,
  rememberOfflineIdentity,
} from "../../src/services/auth/offline-identity";

const owner = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});

test("offline identity persists only an account reference and survives a fresh read", async () => {
  rememberOfflineIdentity(owner, "reader@example.org");
  await expect.poll(() => localGet<{ ownerId: string }>("cloud_state", "offline_identity"))
    .toMatchObject({ ownerId: owner });
  expect(await readOfflineIdentity()).toMatchObject({
    ownerId: owner,
    email: "reader@example.org",
    version: 1,
  });
  expect(JSON.stringify(await localGet("cloud_state", "offline_identity"))).not.toContain("password");
});

test("explicit logout tombstones the identity before asynchronous storage cleanup", async () => {
  rememberOfflineIdentity(owner);
  await expect.poll(() => localGet("cloud_state", "offline_identity")).not.toBeUndefined();
  await forgetOfflineIdentity();
  expect(await readOfflineIdentity()).toBeNull();
  expect(localStorage.getItem("autumn-offline-signed-out")).toBe("1");
  expect(await localGet("cloud_state", "offline_identity")).toBeUndefined();
});
