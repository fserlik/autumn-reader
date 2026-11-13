const cloudUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const cloudPublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim() || null;
const cloudConfigured = Boolean(cloudUrl && cloudPublishableKey);
const cloudHealthUrl = cloudUrl ? `${cloudUrl.replace(/\/$/, "")}/auth/v1/health` : null;

export type ConnectivityStatus = "checking" | "online" | "offline";
export type ConnectivityState = {
  status: ConnectivityStatus;
  checkedAt: number;
  reason: "initial" | "browser" | "service" | "timeout" | "network" | null;
};

const subscribers = new Set<(state: ConnectivityState) => void>();
let state: ConnectivityState = { status: "checking", checkedAt: 0, reason: "initial" };
let pending: Promise<ConnectivityState> | undefined;
let initialized = false;
let retryTimer: number | undefined;
let generation = 0;

function publish(next: ConnectivityState): ConnectivityState {
  if (state.status === next.status && state.reason === next.reason && state.checkedAt === next.checkedAt) return state;
  state = next;
  document.documentElement.dataset.connectivity = state.status;
  subscribers.forEach(listener => listener(state));
  window.dispatchEvent(new CustomEvent("autumn-connectivity-change", { detail: state }));
  return state;
}

function scheduleRetry(): void {
  if (retryTimer !== undefined || document.hidden || state.status !== "offline" || !navigator.onLine) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void connectivity.check(true);
  }, 15_000);
}

async function probe(timeoutMs: number): Promise<ConnectivityState> {
  const checkedAt = Date.now();
  if (!navigator.onLine) return { status: "offline", checkedAt, reason: "browser" };
  if (!cloudConfigured || !cloudHealthUrl || !cloudPublishableKey)
    return { status: "online", checkedAt, reason: null };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(cloudHealthUrl, {
      method: "GET",
      cache: "no-store",
      headers: { apikey: cloudPublishableKey },
      signal: controller.signal,
    });
    // Authentication/service errors still prove that the required host is reachable.
    return response.status < 500
      ? { status: "online", checkedAt, reason: null }
      : { status: "offline", checkedAt, reason: "service" };
  } catch (error) {
    return {
      status: "offline",
      checkedAt,
      reason: controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError") ? "timeout" : "network",
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export const connectivity = {
  get state(): ConnectivityState { return state; },
  // Standalone service/unit consumers retain the historical browser signal
  // until the application starts the verified probe. The shell stays hidden
  // during this short `checking` phase, so users cannot launch cloud actions.
  get usable(): boolean { return state.status === "online" || (!initialized && navigator.onLine); },
  subscribe(listener: (state: ConnectivityState) => void): () => void {
    subscribers.add(listener);
    listener(state);
    return () => subscribers.delete(listener);
  },
  async initialize(): Promise<ConnectivityState> {
    if (!initialized) {
      initialized = true;
      document.documentElement.dataset.connectivity = state.status;
      window.addEventListener("offline", () => {
        generation++;
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        retryTimer = undefined;
        publish({ status: "offline", checkedAt: Date.now(), reason: "browser" });
      });
      window.addEventListener("online", () => void connectivity.check(true));
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && (state.status !== "online" || Date.now() - state.checkedAt > 60_000))
          void connectivity.check(true);
      });
    }
    return connectivity.check(true);
  },
  async check(force = false, timeoutMs = 3_500): Promise<ConnectivityState> {
    if (!force && state.checkedAt && Date.now() - state.checkedAt < 10_000) return state;
    if (pending) return pending;
    const requestGeneration = ++generation;
    // `checking` is an initial/bootstrap state. Background retries keep the
    // established offline UI stable until the service has actually recovered.
    if (navigator.onLine && state.checkedAt === 0)
      publish({ status: "checking", checkedAt: state.checkedAt, reason: state.reason });
    const work = probe(timeoutMs).then(result => {
      if (requestGeneration === generation) publish(result);
      if (result.status === "offline") scheduleRetry();
      else if (retryTimer !== undefined) { window.clearTimeout(retryTimer); retryTimer = undefined; }
      return state;
    }).finally(() => { if (pending === work) pending = undefined; });
    return pending = work;
  },
  /** Downgrade a successful browser-link check after a real service request fails. */
  markOffline(reason: ConnectivityState["reason"] = "network"): void {
    generation++;
    publish({ status: "offline", checkedAt: Date.now(), reason });
    scheduleRetry();
  },
};

export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof DOMException && ["AbortError", "NetworkError", "TimeoutError"].includes(error.name)) return true;
  if (error instanceof TypeError && /fetch|network|load failed|internet/i.test(error.message)) return true;
  if (error instanceof Error && /failed to fetch|network request failed|timed? ?out|load failed/i.test(error.message)) return true;
  return false;
}
