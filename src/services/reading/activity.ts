import { localAll, localPut } from "../local/database";

/** Local-first reading activity. One row per opened reading session, scoped to its owner. */
export interface ReadingSession {
  id: string;
  ownerId: string;
  bookId: string;
  format: "epub" | "pdf";
  startedAt: number;
  endedAt: number;
  activeMs: number;
  navigationCount: number;
  syncState: "local";
}

const IDLE_AFTER_MS = 90_000;
const MAX_TICK_MS = 20_000;
let current: ReadingSession | null = null;
let lastTick = 0;
let lastInteraction = 0;
let lastPosition: string | null = null;
let writeChain: Promise<void> = Promise.resolve();

function persist(session: ReadingSession): void {
  const snapshot = { ...session };
  writeChain = writeChain.catch(() => {}).then(() => localPut("reading_sessions", snapshot));
  void writeChain.catch(error => console.error("Reading activity could not be saved", error));
}

function eligible(now: number): boolean {
  return !document.hidden && document.hasFocus() && now - lastInteraction < IDLE_AFTER_MS;
}

function tick(): void {
  if (!current) return;
  const now = performance.now();
  const elapsed = Math.max(0, Math.min(MAX_TICK_MS, now - lastTick));
  // Count only intervals during which the reader was recently active and visible.
  if (eligible(now)) current.activeMs += elapsed;
  lastTick = now;
  current.endedAt = Date.now();
}

export const readingActivity = {
  start(ownerId: string, bookId: string, format: "epub" | "pdf"): void {
    this.stop();
    const now = Date.now();
    current = { id: crypto.randomUUID(), ownerId, bookId, format, startedAt: now, endedAt: now, activeMs: 0, navigationCount: 0, syncState: "local" };
    lastTick = performance.now();
    lastInteraction = lastTick;
    lastPosition = null;
    persist(current);
  },
  interact(): void {
    if (!current) return;
    tick();
    lastInteraction = performance.now();
  },
  position(position: string): void {
    if (!current || !position) return;
    if (lastPosition !== null && position !== lastPosition) {
      this.interact();
      current.navigationCount++;
    }
    lastPosition = position;
  },
  flush(): void {
    if (!current) return;
    tick();
    persist(current);
  },
  stop(): void {
    if (!current) return;
    tick();
    persist(current);
    current = null;
    lastPosition = null;
  },
  async sessions(ownerId: string): Promise<ReadingSession[]> {
    const all = await localAll<ReadingSession>("reading_sessions");
    return all.filter(row => row.ownerId === ownerId);
  },
};

// Heartbeats limit loss on abrupt shutdown; hidden tabs never accumulate time.
window.setInterval(() => readingActivity.flush(), 15_000);
document.addEventListener("visibilitychange", () => readingActivity.flush());
window.addEventListener("blur", () => readingActivity.flush());
window.addEventListener("pagehide", () => readingActivity.stop());
