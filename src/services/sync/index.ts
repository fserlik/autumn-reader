import { auth } from "../auth";
import { devices } from "../devices";
import { cloud, checkError } from "../client";
import { queued, settleOperation, resetRetry } from "./queue";
import { errorMessage } from "../errors";
import { t } from "../../i18n";
import { bookCache } from "../storage";
import { markPrivateCoverUploaded, uploadPrivateCover } from "../storage/book-covers";
export interface SyncStatus {
  pending: number;
  syncing: boolean;
  message: string;
}
const listeners = new Set<(status: SyncStatus) => void>();
const syncPriority = (entity: string): number => entity === "folder" ? 0 : entity === "user_book" ? 2 : entity === "book_metadata" ? 3 : 1;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let statusOwner: string | null = null;
let status: SyncStatus = {
  pending: 0,
  syncing: false,
  message: t("changesOnDevice"),
};
function publish(values: Partial<SyncStatus>): void {
  status = { ...status, ...values };
  listeners.forEach((listener) => listener(status));
}
export const sync = {
  subscribe(listener: (status: SyncStatus) => void): () => void {
    listeners.add(listener);
    listener(status);
    return () => listeners.delete(listener);
  },
  schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void sync.flush(), 1500);
  },
  async flush(force = false): Promise<void> {
    if (running) return running;
    const owner = auth.state.ownerId;
    if (!owner) return;
    running = (async () => {
      const all = await queued(owner);
      if (auth.state.ownerId !== owner) return;
      publish({ pending: all.length });
      if (!navigator.onLine || auth.state.status !== "authenticated") {
        publish({
          message: all.length
            ? t("changesWaiting")
            : t("offlineAvailable"),
        });
        return;
      }
      if (force) await resetRetry(owner);
      if (auth.state.ownerId !== owner) return;
      const due = (await queued(owner))
        .filter((op) => op.retryAt <= Date.now())
        .sort(
          (a, b) =>
            syncPriority(a.entity) - syncPriority(b.entity),
        )
        .slice(0, 100);
      if (auth.state.ownerId !== owner) return;
      if (!due.length) {
        publish({
          message: all.length
            ? t("waitingRetry")
            : t("synced"),
        });
        return;
      }
      publish({ syncing: true, message: t("synchronizing") });
      try {
        await devices.requireAccess();
        const ready = [];
        for (const op of due) {
          if (auth.state.ownerId !== owner) return;
          if (op.entity !== "book_metadata" || !op.payload.cover_path) { ready.push(op); continue; }
          try {
            const book = await bookCache.get(`cloud-${owner}-${op.bookId}`);
            if (!book || book.ownerId !== owner || book.coverPath !== op.payload.cover_path) { await settleOperation(op); continue; }
            if (book.coverUploadedPath !== book.coverPath) {
              await uploadPrivateCover(book);
              await markPrivateCoverUploaded(book.id, book.coverPath!);
            }
            ready.push(op);
          } catch (error: unknown) { await settleOperation(op, errorMessage(error)); }
        }
        if (!ready.length) {
          const pending = (await queued(owner)).length;
          if (auth.state.ownerId === owner) publish({ pending, message: t("syncRetryNeeded") });
          return;
        }
        if (auth.state.ownerId !== owner) return;
        const { data, error } = await cloud().rpc("sync_changes", {
          operations: ready.map((op) => ({
            id: op.id,
            entity: op.entity,
            payload: op.payload,
          })),
        });
        checkError(error);
        if (auth.state.ownerId !== owner) return;
        const outcomes = data ?? [];
        for (const op of ready) {
          const result = outcomes.find((r) => r.id === op.id);
          await settleOperation(
            op,
            result?.outcome === "applied" || result?.outcome === "superseded"
              ? undefined
              : (result?.outcome ?? t("syncNoResponse")),
          );
        }
        const remaining = await queued(owner);
        if (auth.state.ownerId !== owner) return;
        publish({
          pending: remaining.length,
          message: outcomes.some((o) => o.outcome === "superseded")
            ? t("newerDeviceChange")
            : remaining.length
              ? t("syncRetryNeeded")
              : t("synced"),
        });
        if (remaining.some((op) => op.retryAt <= Date.now())) {
          clearTimeout(timer);
          timer = setTimeout(() => void sync.flush(), 250);
        }
        window.dispatchEvent(new Event("autumn-synced"));
      } catch (error: unknown) {
        if (auth.state.ownerId !== owner) return;
        for (const op of due) await settleOperation(op, errorMessage(error));
        publish({ message: errorMessage(error) });
      } finally {
        if (auth.state.ownerId === owner) publish({ syncing: false });
      }
    })()
      .catch((error: unknown) => {
        if (auth.state.ownerId === owner) publish({ message: errorMessage(error), syncing: false });
      })
      .finally(() => {
        running = undefined;
        if (auth.state.ownerId && auth.state.ownerId !== owner) sync.schedule();
      });
    return running;
  },
  initialize(): void {
    window.addEventListener("autumn-local-change", () => sync.schedule());
    window.addEventListener("online", () => void sync.flush(true));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void auth.refresh().then(() => sync.flush(true));
    });
    auth.subscribe(state => {
      if (statusOwner !== state.ownerId) {
        statusOwner = state.ownerId;
        clearTimeout(timer);
        publish({ pending: 0, syncing: false, message: t("changesOnDevice") });
      }
      void sync.flush();
    });
    setInterval(() => {
      if (!document.hidden) void sync.flush();
    }, 15000);
  },
};
