import "fake-indexeddb/auto";
import { test, expect, vi } from "vitest";
import {
  operationsForBook,
  type SyncOperation,
} from "../../src/services/sync/operations";
import { localAll, localPut } from "../../src/services/local/database";
import { queued, settleOperation } from "../../src/services/sync/queue";
import {
  noteCloudId,
  toCloudNote,
  toLocalNote,
  fromCloudBook,
} from "../../src/services/books/models";
import { mergeRemoteBook } from "../../src/services/books/merge";
import type { StoredBook } from "../../src/storage";
vi.mock("../../src/services/auth", () => ({ auth: { state: { ownerId: "owner", status: "authenticated" }, requireUser: () => "owner" } }));
const base = (): StoredBook => ({
  id: "cached",
  ownerId: "owner",
  cloudId: "book",
  name: "File.pdf",
  format: "pdf",
  data: new Blob(["cached"]),
  page: 1,
  cfi: null,
  fontSize: 100,
  addedAt: 1,
  lastOpenedAt: 0,
  notes: [],
});
test("queue coalesces edits per entity and preserves newer in-flight changes", async () => {
  const previous = base(),
    book = { ...base(), page: 2 };
  const op = operationsForBook(book, previous, 1000)[0];
  await localPut("pending_sync_operations", op);
  const latest = { ...op, version: "new", payload: { ...op.payload, page: 3 } };
  await localPut("pending_sync_operations", latest);
  await settleOperation(op);
  expect((await queued("owner"))[0].payload.page).toBe(3);
  await settleOperation(latest, "network");
  expect((await queued("owner"))[0].attempts).toBe(1);
  await settleOperation(latest);
  expect(await queued("owner")).toHaveLength(0);
});

test("display metadata queues independently from progress and preserves offline edits", async () => {
  const previous = { ...base(), author: "Original", fileHash: "a".repeat(64) };
  const edited = { ...previous, displayTitle: "My title", author: "My author", customCover: true,
    coverPath: "owner/book/11111111-1111-4111-8111-111111111111.webp",
    cover: new Blob(["webp"], { type: "image/webp" }) };
  const operations = operationsForBook(edited, previous, Date.now());
  expect(operations.map(op => op.entity)).toEqual(["book_metadata"]);
  expect(operations[0].payload).toMatchObject({ title: "My title", author: "My author", cover_path: edited.coverPath });
  expect(edited.fileHash).toBe(previous.fileHash);
  expect(await edited.data.text()).toBe(await previous.data.text());
  await localPut("books", edited);
  await localPut("pending_sync_operations", operations[0]);
  const merged = await mergeRemoteBook({ ...previous, data: new Blob(), metadataUpdatedAt: 1 });
  expect(merged.displayTitle).toBe("My title");
  expect(merged.author).toBe("My author");
  expect(merged.coverPath).toBe(edited.coverPath);
  expect(await merged.cover?.text()).toBe("webp");
  await settleOperation(operations[0]);
});
test("reattaching a formerly local cloud copy queues retained progress and notes again", () => {
  const previous = { ...base(), cloudId: undefined, page: 27, percentage: 0.5,
    notes: [{id:"saved-note",format:"pdf" as const,page:27,y:0.3,quote:"Quote",text:"Note",color:"#cc5500",createdAt:10}] };
  const reattached = { ...previous, cloudId: "book" };
  const operations = operationsForBook(reattached, previous, Date.now());
  expect(operations.map(op => op.entity)).toContain("progress");
  expect(operations.map(op => op.entity)).toContain("note");
  expect(operations.find(op => op.entity === "progress")?.payload.page).toBe(27);
});
test("notes are independent operations; deletion does not replace unrelated notes", () => {
  const note = {
    id: "legacy-note",
    format: "pdf" as const,
    page: 3,
    y: 0.4,
    quote: "Selected",
    text: "Original",
    color: "#cc5500",
    createdAt: 10,
  };
  const previous = { ...base(), notes: [note, { ...note, id: "other" }] };
  const changed = { ...previous, notes: [{ ...note, text: "Edited" }] };
  const operations = operationsForBook(changed, previous, 100);
  expect(operations.map((o) => o.entity)).toEqual(["note", "note"]);
  expect(operations[0].payload.content).toBe("Edited");
  expect(operations[1].payload.deleted_at).not.toBeNull();
  expect(noteCloudId("owner", "book", note)).not.toBe(
    noteCloudId("different", "book", note),
  );
  expect(toLocalNote(toCloudNote(previous, note, 100)).page).toBe(3);
});
test("remote apply preserves offline edits and blobs atomically", async () => {
  const book = { ...base(), page: 17 };
  await localPut("books", book);
  const op = operationsForBook(book, base(), Date.now())[0];
  await localPut("pending_sync_operations", op);
  const applied = await mergeRemoteBook({
    ...base(),
    data: new Blob(),
    page: 2,
  });
  expect(applied.page).toBe(17);
  expect(await applied.data.text()).toBe("cached");
  await settleOperation(op);
});
test("local save and outbox survive reload without HTTP and isolate accounts", async () => {
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { __TAURI_INTERNALS__: undefined }),
  );
  const { saveBook, listBooks, cacheBookCover } = await import("../../src/storage");
  const book = { ...base(), id: "atomic" };
  await saveBook(book);
  book.page = 29;
  await saveBook(book);
  expect(
    (await queued("owner")).filter((o) => o.entity === "progress"),
  ).toHaveLength(1);
  expect(
    (await queued("owner")).find((o) => o.entity === "progress")?.payload.page,
  ).toBe(29);
  expect(await listBooks("different")).toHaveLength(0);
  const pendingBeforeCover = await queued("owner");
  await cacheBookCover(book.id, new Blob(["optimized cover"], { type: "image/webp" }));
  const afterCover = (await listBooks("owner"))[0];
  expect(afterCover.page).toBe(29);
  expect(await afterCover.cover?.text()).toBe("optimized cover");
  expect(await queued("owner")).toEqual(pendingBeforeCover);
  expect(
    (await localAll<SyncOperation>("pending_sync_operations")).length,
  ).toBeGreaterThan(0);
  vi.unstubAllGlobals();
});
test("cloud metadata creates lazy placeholders with reader preferences", () => {
  const time = new Date().toISOString();
  const book = fromCloudBook(
    {
      id: "cloud",
      title: "Title",
      author: "Author",
      format: "epub",
      cover_url: null,
      created_at: time,
    },
    {
      id: "relation",
      user_id: "user",
      book_id: "cloud",
      added_at: time,
      last_opened_at: null,
      favorite: true,
      status: "reading",
      updated_at: time,
      deleted_at: null,
      display_title: null,
      display_author: null,
      cover_path: null,
      metadata_updated_at: time,
    },
    {
      user_id: "user",
      book_id: "cloud",
      page: 1,
      cfi: "epubcfi(/6/2)",
      percentage: 0.5,
      pdf_text_offset: 0,
      font_size: 130,
      updated_at: time,
    },
  );
  expect(book.data.size).toBe(0);
  expect(book.cfi).toBe("epubcfi(/6/2)");
  expect(book.fontSize).toBe(130);
  expect(book.favorite).toBe(true);
});
