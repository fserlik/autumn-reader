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
import { accountIcon } from "./account-icons";
export function mountSync(
  parent: HTMLElement,
  reload: () => Promise<void>,
): void {
  const actions = parent.querySelector<HTMLElement>(".plan-actions")!;
  const feedback = parent.querySelector<HTMLElement>(".plan-sync-feedback")!;
  actions.insertAdjacentHTML("beforeend", `<button id="migrate-library" class="secondary-button plan-action" type="button">${accountIcon("sync")}<span>${t("syncAllLocal")}</span>${accountIcon("arrow")}</button>`);
  feedback.innerHTML = `<p id="server-pending" role="status"></p><p id="migration-count"></p>
    <progress id="upload-progress" max="100" hidden aria-label="${t("uploadProgress")}"></progress>
    <p id="cloud-sync-status" role="status" aria-live="polite"></p><p id="migration-status" role="status" aria-live="polite"></p>
    <div class="plan-sync-controls"><button id="sync-now" class="text-link" type="button" hidden>${t("retrySynchronization")}</button>
      <button id="cancel-upload" class="text-link" type="button" hidden>${t("cancel")}</button></div>`;
  const find = <T extends HTMLElement>(s: string) => parent.querySelector<T>(s)!;
  let controller: AbortController | undefined;
  let retrying = false;
  let lastFailure = "";
  const quota = async (): Promise<void> => {
    const owner = auth.state.ownerId;
    if (auth.state.status !== "authenticated" || !navigator.onLine) {
      find("#server-pending").textContent = "";
      return;
    }
    try {
      const limit = await library.quota();
      if (auth.state.ownerId !== owner) return;
      find("#server-pending").textContent = !limit.active_pending_uploads ? "" : t("serverPendingUploads", {
        count: limit.active_pending_uploads,
        usedMb: ((limit.reserved_bytes ?? 0) / 1048576).toFixed(1),
      });
    } catch (error: unknown) { if (auth.state.ownerId === owner) find("#server-pending").textContent = errorMessage(error); }
  };
  const count = async () => {
    const owner = auth.state.ownerId;
    const left = owner
      ? await migrationRemaining(owner, await listBooks(owner, true))
      : [];
    if (auth.state.ownerId !== owner) return;
    find("#migration-count").textContent = owner && left.length
      ? t("localBookCount", { count: left.length }) : "";
    find<HTMLButtonElement>("#migrate-library").disabled =
      auth.state.status !== "authenticated" ||
      migrationIsRunning() || retrying || !!controller ||
      !left.length;
    find<HTMLButtonElement>("#sync-now").disabled =
      auth.state.status !== "authenticated" || migrationIsRunning() || retrying || !!controller;
  };
  find("#migrate-library").addEventListener("click", () => {
    if (controller || retrying || migrationIsRunning()) return;
    const owner = auth.state.ownerId;
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
        if (auth.state.ownerId !== owner) return;
        find("#migration-status").textContent =
          `${t("migrationSummary", { done: result.done, failed: result.failed })}${result.failed && lastFailure ? ` ${lastFailure}` : ""}`;
        find<HTMLButtonElement>("#sync-now").hidden = result.failed === 0;
        await reload();
      })
      .catch((error: unknown) => {
        if (auth.state.ownerId === owner) { find("#migration-status").textContent = errorMessage(error); find<HTMLButtonElement>("#sync-now").hidden = false; }
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
    const owner = auth.state.ownerId;
    retrying = true; lastFailure = ""; void count();
    void retryApprovedMigrations()
      .then(async (result) => {
        if (auth.state.ownerId !== owner) return;
        if (result) {
          find("#migration-status").textContent =
            `${t("migrationSummary", { done: result.done, failed: result.failed })}${result.failed && lastFailure ? ` ${lastFailure}` : ""}`;
          find<HTMLButtonElement>("#sync-now").hidden = result.failed === 0;
        }
        await sync.flush(true);
        await reload();
      })
      .catch((error: unknown) => { if (auth.state.ownerId === owner) { find("#migration-status").textContent = errorMessage(error); find<HTMLButtonElement>("#sync-now").hidden = false; } })
      .finally(() => { retrying = false; void count(); void quota(); });
  });
  sync.subscribe((status) => {
    find("#cloud-sync-status").textContent = status.pending || status.syncing
      ? `${status.message} · ${t("pendingDataChanges", { count: status.pending })}` : "";
    if (status.pending) find<HTMLButtonElement>("#sync-now").hidden = false;
  });
  let owner: string | null | undefined;
  auth.subscribe((state) => {
    if (owner !== state.ownerId || state.status !== "authenticated") {
      controller?.abort();
      cancelMigration();
    }
    if (owner !== state.ownerId) {
      lastFailure = "";
      find("#migration-status").textContent = "";
      find("#migration-count").textContent = "";
      find("#cloud-sync-status").textContent = "";
      find("#server-pending").textContent = "";
      find<HTMLButtonElement>("#sync-now").hidden = true;
      find("#upload-progress").hidden = true;
      find("#cancel-upload").hidden = true;
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
    find<HTMLButtonElement>("#sync-now").hidden = false;
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
