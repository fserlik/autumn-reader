import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { hashBlob } from "../../src/services/storage/hash";
import { localAll, openDatabase } from "../../src/services/local/database";
import { validHash, validateBookFile } from "../../shared/book-file";
test("SHA-256 known vectors, chunked large input and cancellation", async () => {
  expect(await hashBlob(new Blob(["abc"]))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(await hashBlob(new Blob())).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  const large = new Blob([new Uint8Array(2 * 1024 * 1024 + 7)]);
  const native = Buffer.from(
    await crypto.subtle.digest("SHA-256", await large.arrayBuffer()),
  ).toString("hex");
  expect(await hashBlob(large)).toBe(native);
  await expect(hashBlob(large, AbortSignal.abort())).rejects.toMatchObject({
    code: "cancelled",
  });
});
test("file validation rejects MIME/extension spoofing, truncation and invalid hashes", () => {
  expect(
    validateBookFile(new TextEncoder().encode("%PDF-1.4\nbody\n%%EOF"), "pdf"),
  ).toBe(true);
  expect(
    validateBookFile(new TextEncoder().encode("%PDF-1.4\nbody"), "pdf"),
  ).toBe(false);
  expect(validateBookFile(new TextEncoder().encode("<script>"), "epub")).toBe(
    false,
  );
  expect(validHash("../secret")).toBe(false);
});
test("additive v1 upgrade keeps legacy Blob, progress, favorites and notes", async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("autumn-reader", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("books", { keyPath: "id" });
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("books", "readwrite");
      tx.objectStore("books").put({
        id: "legacy",
        data: new Blob(["existing"]),
        favorite: true,
        page: 17,
        notes: [{ id: "note" }],
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
    req.onerror = () => reject(req.error);
  });
  const db = await openDatabase();
  expect([...db.objectStoreNames]).toContain("pending_sync_operations");
  expect(db.version).toBe(4);
  expect([...db.transaction("books").objectStore("books").indexNames]).toEqual(["by_owner", "by_owner_hash"]);
  expect([...db.objectStoreNames]).toContain("library_folders");
  expect([...db.objectStoreNames]).toContain("folder_memberships");
  db.close();
  const books = await localAll<{
    data: Blob;
    favorite: boolean;
    page: number;
    notes: unknown[];
  }>("books");
  expect(await books[0].data.text()).toBe("existing");
  expect(books[0].favorite).toBe(true);
  expect(books[0].page).toBe(17);
  expect(books[0].notes).toHaveLength(1);
});

test("v2 to v4 keeps cloud cache, pending sync and migration checkpoints", async () => {
  // Only fake-indexeddb's isolated in-memory database is reset to create a v2 fixture.
  await new Promise<void>((resolve, reject) => { const req=indexedDB.deleteDatabase("autumn-reader");req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error); });
  await new Promise<void>((resolve, reject) => {
    const req=indexedDB.open("autumn-reader",2);
    req.onupgradeneeded=()=>{for(const name of ["books","pending_sync_operations","migration_state","cloud_state"])req.result.createObjectStore(name,{keyPath:"id"});};
    req.onsuccess=()=>{
      const db=req.result,tx=db.transaction([...db.objectStoreNames],"readwrite");
      tx.objectStore("books").put({id:"cloud-existing",data:new Blob(["cached-book"]),ownerId:"owner",cloudId:"book",page:187,favorite:true,notes:[{id:"note"}]});
      tx.objectStore("pending_sync_operations").put({id:"pending",version:"in-flight",payload:{page:187}});
      tx.objectStore("migration_state").put({id:"checkpoint",phase:"uploaded",bookId:"book"});
      tx.objectStore("cloud_state").put({id:"metadata",revision:12});
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };req.onerror=()=>reject(req.error);
  });
  const db=await openDatabase();expect(db.version).toBe(4);db.close();
  const books=await localAll<{data:Blob;page:number;favorite:boolean;notes:unknown[]}>("books");
  expect(await books[0].data.text()).toBe("cached-book");expect(books[0]).toMatchObject({page:187,favorite:true});expect(books[0].notes).toHaveLength(1);
  expect(await localAll("pending_sync_operations")).toEqual([{id:"pending",version:"in-flight",payload:{page:187}}]);
  expect(await localAll("migration_state")).toEqual([{id:"checkpoint",phase:"uploaded",bookId:"book"}]);
  expect(await localAll("cloud_state")).toEqual([{id:"metadata",revision:12}]);
  expect(await localAll("library_folders")).toEqual([]);expect(await localAll("folder_memberships")).toEqual([]);
});
