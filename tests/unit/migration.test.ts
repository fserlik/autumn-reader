import "fake-indexeddb/auto";
import { test, expect, vi } from "vitest";
import {
  localAll,
  localGet,
  localPut,
} from "../../src/services/local/database";
import type { StoredBook } from "../../src/storage";
const owner = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
test("migration selects legacy and current-account local books, excluding other accounts and cloud books", async () => {
  const { migrationRemaining } = await import("../../src/services/sync/migration");
  const local: StoredBook = { id: "selection-legacy", name: "Book.pdf", format: "pdf", data: new Blob(["%PDF"]), addedAt: 1, lastOpenedAt: 0, page: 1, cfi: null, fontSize: 100 };
  const selected = await migrationRemaining(owner, [local, {...local,id:"selection-own",ownerId:owner}, {...local,id:"selection-other",ownerId:"other"}, {...local,id:"selection-cloud",ownerId:owner,cloudId:"cloud"}]);
  expect(selected.map(b => b.id)).toEqual(["selection-legacy","selection-own"]);
});
vi.mock("../../src/services/auth", () => ({
  auth: {
    state: {
      ownerId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      status: "authenticated",
    },
    requireUser: () => "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  },
}));
vi.mock("../../src/services/sync/index", () => ({
  sync: { flush: vi.fn().mockResolvedValue(undefined) },
}));
test("migration resumes at the failed book, retains original bytes and preserves reading data", async () => {
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { __TAURI_INTERNALS__: undefined }),
  );
  vi.stubGlobal(
    "CustomEvent",
    class extends Event {
      detail: unknown;
      constructor(type: string, options: { detail: unknown }) {
        super(type);
        this.detail = options.detail;
      }
    },
  );
  const storage = await import("../../src/services/storage");
  const migration = await import("../../src/services/sync/migration");
  const book = (id: string): StoredBook => ({
    id,
    name: `${id}.pdf`,
    format: "pdf",
    data: new Blob([id]),
    page: 17,
    cfi: null,
    fontSize: 140,
    pdfTextOffset: 0.4,
    favorite: true,
    addedAt: 100,
    lastOpenedAt: 200,
    notes: [
      {
        id: "old-note",
        format: "pdf",
        page: 17,
        y: 0.3,
        quote: "Text",
        text: "Note",
        color: "#cc5500",
        createdAt: 150,
      },
    ],
  });
  const originals = [book("first"), book("second")];
  for (const b of originals) await localPut("books", b);
  let fail = true;
  const upload = vi
    .spyOn(storage.bookStorage, "upload")
    .mockImplementation(async (book) => {
      if (book.id === "second" && fail) throw new Error("offline");
      return {
        bookId:
          book.id === "first"
            ? "11111111-1111-4111-8111-111111111111"
            : "22222222-2222-4222-8222-222222222222",
        hash: "a".repeat(64),
      };
    });
  expect(
    await migration.migrateLibrary(
      originals,
      new AbortController().signal,
      () => {},
    ),
  ).toEqual({ done: 1, failed: 1 });
  fail = false;
  expect(
    await migration.migrateLibrary(
      originals,
      new AbortController().signal,
      () => {},
    ),
  ).toEqual({ done: 1, failed: 0 });
  expect(
    upload.mock.calls.filter(([book]) => book.id === "first"),
  ).toHaveLength(1);
  const local = await localGet<StoredBook>("books", "first");
  expect(await local!.data.text()).toBe("first");
  const clone = (await localAll<StoredBook>("books")).find(
    (b) => b.ownerId === owner && b.migrationSources?.includes("first"),
  )!;
  expect(clone.favorite).toBe(true);
  expect(clone.page).toBe(17);
  expect(clone.pdfTextOffset).toBe(0.4);
  expect(clone.notes![0].text).toBe("Note");
  expect(await migration.migrationRemaining(owner, originals)).toHaveLength(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("manual retry resumes quota-failed uploads once while automatic resume waits", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("CustomEvent", class extends Event {
    detail: unknown;
    constructor(type: string, options: { detail: unknown }) { super(type); this.detail = options.detail; }
  });
  const id = "manual-quota-retry";
  const book: StoredBook = { id, name: "Retry.pdf", format: "pdf", data: new Blob(["%PDF-1.4\n%%EOF"]),
    addedAt: 1, lastOpenedAt: 0, page: 1, cfi: null, fontSize: 100 };
  await localPut("books", book);
  await localPut("migration_state", { id: `${owner}:${id}`, ownerId: owner, localId: id,
    phase: "error", errorCode: "book_limit", updatedAt: Date.now() });
  const storage = await import("../../src/services/storage");
  const migration = await import("../../src/services/sync/migration");
  const upload = vi.spyOn(storage.bookStorage,"upload").mockResolvedValue({ bookId: "33333333-3333-4333-8333-333333333333",
    hash: "c".repeat(64), format: "pdf" });
  expect(await migration.resumeApprovedMigrations()).toBe(false);
  expect(await migration.retryApprovedMigrations()).toEqual({done:1,failed:0});
  expect(await migration.retryApprovedMigrations()).toBeNull();
  expect(upload).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
