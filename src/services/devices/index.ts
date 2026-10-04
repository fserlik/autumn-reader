import type { Session } from "@supabase/supabase-js";
import { auth } from "../auth";
import { cloud, checkError } from "../client";
import { CloudError } from "../errors";

const idKey = "autumn-installation-id", secretKey = "autumn-installation-secret";
function installation(): {id:string;secret:string} {
  let id = localStorage.getItem(idKey), secret = localStorage.getItem(secretKey);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !secret || !/^[0-9a-f-]{36}$/i.test(secret)) {
    id = crypto.randomUUID(); secret = crypto.randomUUID();
    localStorage.setItem(idKey, id); localStorage.setItem(secretKey, secret);
  }
  return { id, secret };
}
function platform(): "android" | "windows" | "linux" | "macos" | "web" | "other" {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes("android")) return "android";
  if (agent.includes("windows")) return "windows";
  if (agent.includes("mac")) return "macos";
  if (agent.includes("linux")) return "linux";
  return "web";
}
export interface DeviceAccess { allowed: boolean; active_devices: number; max_devices: number | null }
export interface AccountDevice {
  device_id: string; platform: string; display_name: string;
  first_seen_at: string; last_seen_at: string;
}
let owner: string | null = null;
let sessionToken: string | undefined;
let access: DeviceAccess | undefined;
let checkedAt = 0;
let pending: Promise<DeviceAccess> | undefined;
let generation = 0;
function announce(result: DeviceAccess): void {
  window.dispatchEvent(new CustomEvent("autumn-device-access", { detail: result }));
}
export const devices = {
  get id(): string { return installation().id; },
  get access(): DeviceAccess | undefined { return access; },
  async registerSession(session: Session, force = false): Promise<DeviceAccess> {
    const account = session.user.id;
    const token = session.access_token;
    if (owner !== account || sessionToken !== token) {
      ++generation;
      owner = account; sessionToken = token; access = undefined; pending = undefined; checkedAt = 0;
    }
    if (!navigator.onLine) return { allowed: true, active_devices: 0, max_devices: null };
    if (!force && access && Date.now() - checkedAt < 60_000) return access;
    if (pending) return pending;
    const requestGeneration = generation;
    const work = (async () => {
      const os = platform(), credentials = installation();
      const { data, error } = await cloud().rpc("register_device", {
        p_device: credentials.id, p_secret: credentials.secret,
        p_platform: os, p_name: "Autumn Reader",
      });
      checkError(error);
      if (!data || generation !== requestGeneration ||
          (auth.state.status === "authenticated" && auth.state.ownerId !== account))
        throw new CloudError("session_expired");
      access = data; checkedAt = Date.now();
      if (auth.state.status === "authenticated" && auth.state.ownerId === account) announce(data);
      return data;
    })().finally(() => { if (pending === work) pending = undefined; });
    return pending = work;
  },
  async register(force = false): Promise<DeviceAccess> {
    auth.requireUser();
    const session = auth.state.session;
    if (!session) throw new CloudError("session_expired");
    try { return await devices.registerSession(session, force); }
    catch (error) {
      if (error instanceof CloudError && ["device_revoked", "forbidden"].includes(error.code) && auth.state.session === session)
        await auth.logout();
      throw error;
    }
  },
  async requireAccess(): Promise<void> {
    if (!navigator.onLine) return;
    if (!(await devices.register()).allowed) throw new CloudError("device_limit");
  },
  async list(): Promise<AccountDevice[]> {
    auth.requireUser();
    const { data, error } = await cloud().rpc("account_devices", {});
    checkError(error);
    return data ?? [];
  },
  async remove(deviceId: string): Promise<void> {
    auth.requireUser();
    const { error } = await cloud().rpc("remove_account_device", { p_device: deviceId });
    checkError(error);
    access = undefined; checkedAt = 0;
  },
  reset(): void { ++generation; owner = null; sessionToken = undefined; access = undefined; pending = undefined; checkedAt = 0; },
};
