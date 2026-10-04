import "fake-indexeddb/auto";
import { beforeAll, expect, test, vi } from "vitest";
import type { StoredBook } from "../../src/storage";

const owner = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
vi.mock("../../src/services/auth", () => ({ auth: { state: { ownerId: owner, status: "authenticated" }, requireUser: () => owner } }));
let identity: typeof import("../../src/services/books/identity");
let storage: typeof import("../../src/storage");
let database: typeof import("../../src/services/local/database");
beforeAll(async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { userAgent: "", onLine: false });
  identity = await import("../../src/services/books/identity");
  storage = await import("../../src/storage");
  database = await import("../../src/services/local/database");
});
const book = (id: string, name: string, bytes: string): StoredBook => ({ id, name, format: "epub", data: new Blob([bytes]),
  ownerId: owner, addedAt: 1, lastOpenedAt: 0, favorite: false, page: 1, cfi: null, fontSize: 100 });

test("content hash, not filename, is the local import identity", async () => {
  const first = book("identity-first", "Dune.epub", "first edition");
  expect((await identity.importUniqueBook(first)).imported).toBe(true);
  expect((await identity.importUniqueBook(book("identity-copy", "Dune (1).epub", "first edition"))).imported).toBe(false);
  expect((await identity.importUniqueBook(book("identity-other", "Dune.epub", "different edition"))).imported).toBe(true);
  const visible = (await storage.listBooks(owner)).filter(item => item.id.startsWith("identity-"));
  expect(visible).toHaveLength(2);
  expect(visible[0].fileHash).toMatch(/^[a-f0-9]{64}$/);
});

test("historical duplicate rows reconcile without deleting bytes, notes or newer reading state", async () => {
  const source = { ...book("legacy-source", "Renamed.epub", "same old file"),
    progressUpdatedAt: 500, userUpdatedAt: 500, favorite: true, page: 42,
    notes: [{ id: "old-note", format: "epub" as const, cfi: "epubcfi(/6/2)", quote: "text", text: "Remember", color: "#cc5500", createdAt: 200 }] };
  const target = { ...book("legacy-target", "Original.epub", "same old file"),
    lastOpenedAt: 100, progressUpdatedAt: 100, userUpdatedAt: 100,
    notes: [{ id: "new-note", format: "epub" as const, cfi: "epubcfi(/6/4)", quote: "other", text: "Keep", color: "#cc5500", createdAt: 300 }] };
  await database.localPut("books", source); await database.localPut("books", target);
  await identity.reconcileLocalLibrary(owner);
  const visible = (await storage.listBooks(owner)).filter(item => item.id.startsWith("legacy-"));
  expect(visible).toHaveLength(1);
  expect(visible[0]).toMatchObject({ id: "legacy-target", page: 42, favorite: true });
  expect(visible[0].notes?.map(note => note.text).sort()).toEqual(["Keep", "Remember"]);
  expect((await database.localGet<StoredBook>("books", "legacy-source"))?.data.size).toBeGreaterThan(0);
  expect(await database.localGet("migration_state", `${owner}:legacy-source`)).toMatchObject({ phase: "complete" });
  await identity.reconcileLocalLibrary(owner);
  expect((await storage.listBooks(owner)).filter(item => item.id.startsWith("legacy-"))).toHaveLength(1);
});

test("a ten-file batch imports seven and leaves three existing hashes untouched", async () => {
  const prior = [0,1,2].map(i => book(`prior-${i}`, `prior-${i}.epub`, `prior-${i}`));
  for (const item of prior) await identity.importUniqueBook(item);
  const batch = [...prior.map((item,i) => book(`duplicate-${i}`, `renamed-${i}.epub`, `prior-${i}`)),
    ...Array.from({length:7},(_,i)=>book(`new-${i}`,`new-${i}.epub`,`new-${i}`))];
  const results = [];
  for (const item of batch) results.push(await identity.importUniqueBook(item));
  expect(results.filter(result => result.imported)).toHaveLength(7);
  expect((await storage.listBooks(owner)).filter(item => /^(prior-|new-)/.test(item.id))).toHaveLength(10);
});

test("editing display metadata and custom cover never changes binary identity", async () => {
  const original = book("edited-identity", "Book.epub", "unchanged bytes");
  await identity.importUniqueBook(original);
  const hash = original.fileHash;
  await storage.saveBook({ ...original, displayTitle:"Personal title", author:"Personal author",
    customCover:true, cover:new Blob(["cover"],{type:"image/png"}), metadataUpdatedAt:Date.now() });
  const duplicate = await identity.importUniqueBook(book("edited-copy", "Renamed.epub", "unchanged bytes"));
  expect(duplicate.imported).toBe(false);
  expect(duplicate.book.fileHash).toBe(hash);
  expect((await storage.listBooks(owner)).filter(item=>item.fileHash===hash)).toHaveLength(1);
});
