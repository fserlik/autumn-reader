import "fake-indexeddb/auto";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { StoredBook } from "../../src/storage";

const users = vi.hoisted(() => ({ active: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }));
vi.mock("../../src/services/auth", () => ({ auth: {
  get state() { return { ownerId: users.active, status: "authenticated" }; },
  requireUser: () => users.active,
} }));

const a = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
let storage: typeof import("../../src/storage");
let identity: typeof import("../../src/services/books/identity");
let database: typeof import("../../src/services/local/database");
let queue: typeof import("../../src/services/sync/queue");
let merge: typeof import("../../src/services/books/merge");
let folders: typeof import("../../src/services/folders");
const book = (id: string, ownerId: string | undefined, bytes = "same epub"): StoredBook => ({
  id, ownerId, name: `${id}.epub`, format: "epub", data: new Blob([bytes]),
  addedAt: 1, lastOpenedAt: 0, page: 1, cfi: null, fontSize: 100,
});

beforeAll(async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { userAgent: "", onLine: false });
  storage = await import("../../src/storage");
  identity = await import("../../src/services/books/identity");
  database = await import("../../src/services/local/database");
  queue = await import("../../src/services/sync/queue");
  merge = await import("../../src/services/books/merge");
  folders = (await import("../../src/services/folders")).folders;
});
beforeEach(async () => {
  users.active = a;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("autumn-reader");
    req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });
});

test("A and B retain independent local books, progress, notes, highlights, favorites and custom metadata", async () => {
  const note = { id: "note-a", format: "epub" as const, cfi: "epubcfi(/6/2)",
    quote: "Selected text", text: "Private A note", color: "#326fca", createdAt: 1 };
  const ownA = { ...book("a-book", a), page: 80, percentage: .8, favorite: true,
    displayTitle: "A's title", customCover: true, cover: new Blob(["cover-a"]), notes: [note] };
  await storage.saveBook(ownA);
  users.active = b;
  expect(await storage.listBooks(b)).toEqual([]);
  expect(await storage.listBooks(a)).toEqual([]);
  await expect(storage.readBookData(ownA)).rejects.toThrow();
  await expect(storage.saveBook({ ...ownA, page: 1 })).rejects.toThrow();
  const ownB = { ...book("b-book", b), page: 10, percentage: .1, notes: [], favorite: false };
  await storage.saveBook(ownB);
  expect((await storage.listBooks(b)).map(item => item.id)).toEqual(["b-book"]);
  users.active = a;
  const restoredA = await storage.listBooks(a);
  expect(restoredA).toHaveLength(1);
  expect(restoredA[0]).toMatchObject({ id: "a-book", page: 80, favorite: true, displayTitle: "A's title", customCover: true });
  expect(restoredA[0].notes).toEqual([note]);
  expect(await restoredA[0].cover?.text()).toBe("cover-a");
  users.active = b;
  expect((await storage.listBooks(b))[0]).toMatchObject({ page: 10, favorite: false });
});

test("SHA-256 duplicate detection is per owner, including renamed files and edited metadata", async () => {
  expect((await identity.importUniqueBook(book("a-original", a))).imported).toBe(true);
  expect((await identity.importUniqueBook(book("a-renamed", a))).imported).toBe(false);
  users.active = b;
  expect((await identity.importUniqueBook(book("b-original", b))).imported).toBe(true);
  await storage.saveBook({ ...(await storage.listBooks(b))[0], displayTitle: "B's edition", author: "B" });
  expect((await identity.importUniqueBook(book("b-renamed", b))).imported).toBe(false);
  expect((await storage.listBooks(b)).map(item => item.id)).toEqual(["b-original"]);
  users.active = a;
  expect((await storage.listBooks(a)).map(item => item.id)).toEqual(["a-original"]);
});

test("unowned legacy rows remain hidden and durable until an explicit claim", async () => {
  const legacy = { ...book("unclaimed", undefined), page: 42, favorite: true,
    notes: [{ id: "old-note", format: "epub" as const, cfi: "epubcfi(/6/2)", quote: "Quote", text: "Keep", color: "#cc5500", createdAt: 1 }] };
  await database.localPut("books", legacy);
  expect(await storage.listBooks(a)).toEqual([]);
  users.active = b;
  expect(await storage.listBooks(b)).toEqual([]);
  expect(await storage.unclaimedBookCount()).toBe(1);
  users.active = a;
  expect(await storage.claimUnownedBooks(a)).toBe(1);
  expect((await storage.listBooks(a))[0]).toMatchObject({ id: "unclaimed", page: 42, favorite: true });
  expect((await storage.listBooks(a))[0].notes).toEqual(legacy.notes);
  users.active = b;
  expect(await storage.listBooks(b)).toEqual([]);
  expect((await database.localGet<StoredBook>("books", "unclaimed"))?.data.size).toBeGreaterThan(0);
});

test("historical sync and folder ownership evidence assigns only unambiguous rows", async () => {
  await database.localPut("books", book("from-sync", undefined));
  await database.localPut("books", book("from-folder", undefined));
  await database.localPut("books", book("conflicting", undefined));
  await database.localPut("migration_state", { id: `${a}:from-sync`, ownerId: a, localId: "from-sync", phase: "complete" });
  await database.localPut("folder_memberships", { id: `${b}:from-folder`, ownerId: b, bookLocalId: "from-folder", folderId: null });
  await database.localPut("migration_state", { id: `${a}:conflicting`, ownerId: a, localId: "conflicting" });
  await database.localPut("folder_memberships", { id: `${b}:conflicting`, ownerId: b, bookLocalId: "conflicting" });
  expect((await storage.listBooks(a, true)).map(item => item.id)).toEqual(["from-sync"]);
  users.active = b;
  expect((await storage.listBooks(b)).map(item => item.id)).toEqual(["from-folder"]);
  expect((await database.localGet<StoredBook>("books", "conflicting"))?.ownerId).toBeUndefined();
});

test("outbox stays with its owner and a late A merge cannot enter B's local library", async () => {
  const localA = { ...book("cloud-a", a), cloudId: "book-a", page: 80 };
  await storage.saveBook(localA);
  expect((await queue.queued(a)).some(op => op.ownerId === a)).toBe(true);
  const pendingMerge = merge.mergeRemoteBook({ ...localA, page: 10 });
  users.active = b;
  await expect(pendingMerge).rejects.toThrow();
  expect(await queue.queued(b)).toEqual([]);
  expect(await storage.listBooks(b)).toEqual([]);
  users.active = a;
  expect((await storage.listBooks(a))[0].page).toBe(80);
  expect((await queue.queued(a)).length).toBeGreaterThan(0);
});

test("folders, deletion and cloud cache rows reject another account", async () => {
  const ownA = book("private-a", a, "private content");
  await storage.saveBook(ownA);
  const folderA = await folders.create("A's folder");
  await folders.move(ownA, folderA.id);
  const remoteA = { ...book(`cloud-${a}-11111111-1111-4111-8111-111111111111`, a), cloudId: "11111111-1111-4111-8111-111111111111", page: 80 };
  await merge.mergeRemoteBook(remoteA);
  users.active = b;
  expect(await folders.snapshot()).toEqual({ folders: [], memberships: [] });
  await expect(folders.move(ownA, null)).rejects.toThrow();
  await expect(storage.deleteBook(ownA.id)).rejects.toThrow();
  await expect(merge.mergeRemoteBook(remoteA)).rejects.toThrow();
  expect(await storage.listBooks(b)).toEqual([]);
  users.active = a;
  expect((await storage.listBooks(a)).map(item => item.id)).toContain("private-a");
  expect((await folders.snapshot()).folders.map(item => item.name)).toEqual(["A's folder"]);
});
