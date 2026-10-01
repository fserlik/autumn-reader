import { auth } from "../services/auth";
import { sync } from "../services/sync";
import {
  migrateLibrary,
  migrationRemaining,
  cancelMigration,
  migrationIsRunning,
  retryApprovedMigrations,
} from "../services/sync/migration";
import type { UploadProgress } from "../services/storage";
import { listBooks, type StoredBook } from "../storage";
import { errorMessage } from "../services/errors";
import { library } from "../services/books";
import { t } from "../i18n";
export function mountSync(
  parent: HTMLElement,
  reload: () => Promise<void>,
): void {
  const panel = document.createElement("section");
  panel.className = "cloud-panel";
  panel.innerHTML = `<h3>${t("booksOnDevices")}</h3><p>${t("syncIntroduction")}</p><p id="library-quota" role="status"></p><p id="server-pending" role="status"></p><p id="migration-count"></p><div class="cloud-actions"><button id="migrate-library" class="primary-button" type="button">${t("syncAllLocal")}</button><button id="sync-now" class="secondary-button" type="button">${t("retrySynchronization")}</button><button id="cancel-upload" class="secondary-button" type="button" hidden>${t("cancel")}</button></div><progress id="upload-progress" max="100" hidden aria-label="${t("uploadProgress")}"></progress><p id="cloud-sync-status" role="status" aria-live="polite"></p><p id="migration-status" role="status" aria-live="polite"></p>`;
  parent.append(panel);
  const find = <T extends HTMLElement>(s: string) => panel.querySelector<T>(s)!;
  let controller: AbortController | undefined;
  let retrying = false;
  let lastFailure = "";
  const quota = async (): Promise<void> => {
    const owner = auth.state.ownerId;
    if (auth.state.status !== "authenticated" || !navigator.onLine) {
      find("#library-quota").textContent = t("quotaOffline");
      find("#server-pending").textContent = "";
      return;
    }
    try {
      const limit = await library.quota();
      if (auth.state.ownerId !== owner) return;
      find("#library-quota").textContent = t("quotaUsage", { used: limit.used_books, limit: limit.max_books, usedMb: (limit.used_bytes / 1048576).toFixed(1), limitMb: (limit.max_bytes / 1048576).toFixed(0) });
      find("#server-pending").textContent = limit.active_pending_uploads === undefined ? "" : t("serverPendingUploads", {
        count: limit.active_pending_uploads,
        usedMb: ((limit.reserved_bytes ?? 0) / 1048576).toFixed(1),
      });
    } catch (error: unknown) { if (auth.state.ownerId === owner) find("#library-quota").textContent = errorMessage(error); }
  };
  const count = async () => {
    const owner = auth.state.ownerId;
    const left = owner
      ? await migrationRemaining(owner, await listBooks(owner, true))
      : [];
    find("#migration-count").textContent = owner
      ? t("localBookCount", { count: left.length })
      : t("signInToSync");
    find<HTMLButtonElement>("#migrate-library").disabled =
      auth.state.status !== "authenticated" ||
      migrationIsRunning() || retrying || !!controller ||
      !left.length;
    find<HTMLButtonElement>("#sync-now").disabled =
      auth.state.status !== "authenticated" || migrationIsRunning() || retrying || !!controller;
  };
  find("#migrate-library").addEventListener("click", () => {
    if (controller || retrying || migrationIsRunning()) return;
    lastFailure = "";
    controller = new AbortController();
    find("#cancel-upload").hidden = false;
    void count();
    void listBooks(auth.state.ownerId, true)
      .then((books: StoredBook[]) =>
        migrateLibrary(books, controller!.signal, (progress) => {
          const stages = { hashing: t("hashing"), checking: t("checkingFile"), uploading: t("uploading"), saving: t("savingLibrary"), synced: t("synced") };
          find("#migration-status").textContent =
            `${progress.book} · ${stages[progress.stage]}`;
          const bar = find<HTMLProgressElement>("#upload-progress");
          bar.hidden = false;
          if (progress.percentage === undefined) bar.removeAttribute("value");
          else bar.value = progress.percentage;
        }),
      )
      .then(async (result) => {
        find("#migration-status").textContent =
          `${t("migrationSummary", { done: result.done, failed: result.failed })}${result.failed && lastFailure ? ` ${lastFailure}` : ""}`;
        await reload();
      })
      .catch((error: unknown) => {
        find("#migration-status").textContent = errorMessage(error);
      })
      .finally(() => {
        controller = undefined;
        find("#cancel-upload").hidden = true;
        find("#upload-progress").hidden = true;
        void count();
      });
  });
  find("#cancel-upload").addEventListener("click", () => {
    controller?.abort();
    cancelMigration();
  });
  find("#sync-now").addEventListener("click", () => {
    if (retrying || controller || migrationIsRunning()) return;
    retrying = true; lastFailure = ""; void count();
    void retryApprovedMigrations()
      .then(async (result) => {
        if (result) find("#migration-status").textContent =
          `${t("migrationSummary", { done: result.done, failed: result.failed })}${result.failed && lastFailure ? ` ${lastFailure}` : ""}`;
        await sync.flush(true);
        await reload();
      })
      .catch((error: unknown) => { find("#migration-status").textContent = errorMessage(error); })
      .finally(() => { retrying = false; void count(); void quota(); });
  });
  sync.subscribe((status) => {
    find("#cloud-sync-status").textContent =
      `${status.message} · ${t("pendingDataChanges", { count: status.pending })}`;
  });
  let owner: string | null | undefined;
  auth.subscribe((state) => {
    if (owner !== state.ownerId || state.status !== "authenticated") {
      controller?.abort();
      cancelMigration();
    }
    if (owner !== state.ownerId || state.status === "authenticated") void quota();
    owner = state.ownerId;
    void count();
  });
  window.addEventListener("autumn-local-change", () => void count());
  window.addEventListener("autumn-migration-error", (event) => {
    const failure = (event as CustomEvent<{ book: string; message: string }>).detail;
    lastFailure = `${failure.book} · ${failure.message} ${t("localBookSafe")}`;
    find("#migration-status").textContent = lastFailure;
  });
  window.addEventListener("autumn-upload-progress", (event) => {
    const progress = (event as CustomEvent<UploadProgress>).detail;
    const stages = { hashing: t("hashing"), checking: t("checkingFile"), uploading: t("uploading"), saving: t("savingLibrary"), synced: t("synced") };
    find("#migration-status").textContent =
      `${progress.book} · ${stages[progress.stage]}`;
    const bar = find<HTMLProgressElement>("#upload-progress");
    bar.hidden = false;
    if (progress.percentage === undefined) bar.removeAttribute("value");
    else bar.value = progress.percentage;
    find("#cancel-upload").hidden = false;
    void count();
  });
  window.addEventListener("autumn-migration-finished", () => {
    find("#cancel-upload").hidden = true;
    find("#upload-progress").hidden = true;
    void count();
    void quota();
  });
  window.addEventListener("online", () => void quota());
  window.addEventListener("autumn-cloud-storage-changed", () => void quota());
}
