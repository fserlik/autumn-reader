import { expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import type {LibraryFolder,FolderMembership,Review,Book} from "../../src/services/types";
export const a = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  bookId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const timestamp = new Date(Date.now() - 10000).toISOString();
export async function epubFixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    "OEBPS/content.opf",
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">fixture</dc:identifier><dc:title>Cloud EPUB</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  );
  zip.file(
    "OEBPS/chapter.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Cloud chapter</h1>${Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i}: autumn reading, with words for a complete book and positions to save offline.</p>`).join("")}</body></html>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body></html>',
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}
export async function mockCloud(page: Page, emptyLibrary = false) {
  const reviewRows = new Map<string,Review>();
  const catalog = new Map<string,Book>([[bookId,{id:bookId,title:"Cloud EPUB",author:"Author",cover_url:null,format:"epub",created_at:timestamp}]]);
  let reviewFailure = false, reviewSequence = 0;
  const matches = (actual: string, filter: string | null): boolean => !filter || (filter.startsWith("eq.") ? actual===filter.slice(3) : filter.startsWith("in.(") ? filter.slice(4,-1).split(",").includes(actual) : true);
  const bytes = await epubFixture();
  const hash = await import("node:crypto").then(({ createHash }) =>
    createHash("sha256").update(bytes).digest("hex"),
  );
  // Simulate Tauri's bundled assets independently of the external network's offline state.
  await page.route("http://127.0.0.1:1420/**", async (route) => {
    await route.fulfill({ response: await route.fetch() });
  });
  let current = a;
  let downloads = 0;
  let syncCount = 0;
  let uploads = 0;
  let prepareFailures = 0;
  let quotaOverride: {used_books:number;max_books:number;used_bytes:number;max_bytes:number;active_pending_uploads:number;reserved_bytes:number} | undefined;
  let cloudRemoved = false;
  let removeRequests = 0;
  let passwordFailure: "current" | "weak" | null = null;
  const passwordUpdates: { hasCurrent: boolean; hasNew: boolean }[] = [];
  const verifyTypes: string[] = [];
  const verifyRequests: Record<string, unknown>[] = [];
  let registeredUsername = "";
  let avatarBytes: Buffer | undefined;
  let avatarType = "image/webp";
  let avatarFailure = false;
  const avatarUploads: { path: string; contentType: string; size: number }[] = [];
  const coverUploads: { path: string; contentType: string; size: number }[] = [];
  const privateCovers = new Map<string, Buffer>();
  let bookMetadata: { display_title:string|null; display_author:string|null; cover_path:string|null; metadata_updated_at:string } = { display_title:null, display_author:null, cover_path:null, metadata_updated_at:timestamp };
  let progress = {
    user_id: a,
    book_id: bookId,
    page: 1,
    cfi: null,
    percentage: 0,
    pdf_text_offset: 0,
    font_size: 100,
    updated_at: timestamp,
  };
  let stalled = false;
  const user = (id: string) => ({
    id,
    email: id === a ? "a@example.org" : "b@example.org",
    aud: "authenticated",
    role: "authenticated",
    created_at: timestamp,
  });
  let bookFavorite = false;
  let bookStatus: "unread" | "reading" | "finished" = "unread";
  let profileOnly = false;
  const libraryQueries: string[] = [];
  const folderRows=new Map<string,LibraryFolder>(),folderMembers=new Map<string,FolderMembership>();
  const people = new Map([a, b].map(id => [id, {
    id, username: id === a ? "reader_a" : "reader_b", display_name: "Reader",
    avatar_url: null as string | null, bio: "", created_at: timestamp, updated_at: timestamp,
  }]));
  await page.route("https://autumn-test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (req.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
      return;
    }
    const profile = people.get(current)!;
    if (url.pathname.startsWith("/storage/v1/object/")) {
      if (url.pathname.includes("/book-covers/")) {
        const path = url.pathname.split("/book-covers/")[1];
        if (req.method() === "POST") {
          const body = req.postDataBuffer() ?? Buffer.alloc(0);
          privateCovers.set(path, body); coverUploads.push({ path, contentType:req.headers()["content-type"] ?? "", size:body.length });
          await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({Key:`book-covers/${path}`,Id:"cover-id"})});
        } else await route.fulfill({status:privateCovers.has(path)?200:404,contentType:"image/webp",body:privateCovers.get(path) ?? Buffer.alloc(0)});
        return;
      }
      const path = url.pathname.split("/avatars/")[1];
      if (req.method() === "POST") {
        const body = req.postDataBuffer() ?? Buffer.alloc(0);
        if (avatarFailure) {
          await route.fulfill({status:503, contentType:"application/json", body:JSON.stringify({statusCode:"503",error:"Unavailable",message:"Storage unavailable"})});
          return;
        }
        avatarBytes = body;
        avatarType = req.headers()["content-type"] ?? "image/webp";
        avatarUploads.push({path,contentType:req.headers()["content-type"] ?? "",size:body.length});
        await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({Key:`avatars/${path}`,Id:"avatar-id"})});
      } else await route.fulfill({status: avatarBytes ? 200 : 404, contentType:avatarType, body:avatarBytes ?? Buffer.alloc(0)});
      return;
    }
    let data: unknown = [];
    if (url.pathname.includes("/auth/v1/token")) {
      if (passwordFailure === "current") {
        await route.fulfill({status:400,contentType:"application/json",headers:{"Access-Control-Allow-Origin":"*","X-Supabase-Api-Version":"2024-01-01"},body:JSON.stringify({code:"invalid_credentials",error_code:"invalid_credentials",msg:"Invalid login credentials"})});
        return;
      }
      const payload = req.postDataJSON() as { email: string };
      current = payload.email.startsWith("b") ? b : a;
      const token = [
        { alg: "HS256", typ: "JWT" },
        {
          sub: current,
          role: "authenticated",
          aud: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        "signature",
      ]
        .map((x) =>
          typeof x === "string"
            ? x
            : Buffer.from(JSON.stringify(x)).toString("base64url"),
        )
        .join(".");
      data = {
        access_token: token,
        refresh_token: "test-refresh",
        token_type: "bearer",
        expires_in: 3600,
        user: user(current),
      };
    } else if (url.pathname.includes("/auth/v1/signup")) {
      registeredUsername = (req.postDataJSON() as { data: { username: string } }).data.username;
      data = { user: user(current) };
    }
    else if (url.pathname.includes("/auth/v1/recover")) data = {};
    else if (url.pathname.includes("/auth/v1/verify")) {
      const payload = req.postDataJSON() as Record<string, unknown>;
      verifyRequests.push(payload);
      verifyTypes.push(String(payload.type));
      const token = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url") + "." + Buffer.from(JSON.stringify({sub: current, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now()/1000)+3600})).toString("base64url") + ".signature";
      data = { access_token: token, refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, user: user(current) };
    }
    else if (url.pathname.includes("/auth/v1/logout")) data = {};
    else if (url.pathname.includes("/auth/v1/user")) {
      if (req.method() === "PUT") {
        const payload = req.postDataJSON() as Record<string,unknown>;
        passwordUpdates.push({hasCurrent:typeof payload.current_password==="string",hasNew:typeof payload.password==="string"});
        if (passwordFailure) {
          const code=passwordFailure==="current"?"invalid_credentials":"weak_password";
          await route.fulfill({status:400,contentType:"application/json",headers:{"Access-Control-Allow-Origin":"*","X-Supabase-Api-Version":"2024-01-01"},body:JSON.stringify({code,error_code:code,msg:"Rejected"})});
          return;
        }
      }
      data = user(current);
    }
    else if (url.pathname.endsWith("/profiles")) {
      if (req.method() === "PATCH") Object.assign(profile, req.postDataJSON());
      data = [...people.values()].filter(person=>matches(person.id,url.searchParams.get("id"))&&matches(person.username,url.searchParams.get("username")));
    }
    else if(url.pathname.endsWith("/rpc/publish_book_review")){
      if(reviewFailure){await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({message:"Reseñas temporalmente inaccesibles"})});return;}
      const body=req.postDataJSON() as {p_book_id:string;p_title:string;p_author:string;p_format:"pdf"|"epub";p_rating:number;p_text:string};
      if(!catalog.has(body.p_book_id))catalog.set(body.p_book_id,{id:body.p_book_id,title:body.p_title,author:body.p_author,format:body.p_format,cover_url:null,created_at:new Date().toISOString()});
      const old=[...reviewRows.values()].find(row=>row.user_id===current&&row.book_id===body.p_book_id);
      const row:Review=old?{...old,rating:body.p_rating,text:body.p_text,updated_at:new Date().toISOString()}:{id:`99999999-9999-4999-8999-${String(++reviewSequence).padStart(12,"0")}`,user_id:current,book_id:body.p_book_id,rating:body.p_rating,text:body.p_text,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      reviewRows.set(row.id,row);data={review:row,book:catalog.get(row.book_id)};
    }
    else if(url.pathname.endsWith("/reviews")){
      const rows=[...reviewRows.values()].filter(row=>matches(row.id,url.searchParams.get("id"))&&matches(row.user_id,url.searchParams.get("user_id"))&&matches(row.book_id,url.searchParams.get("book_id"))).sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
      if(req.method()==="DELETE"||req.method()==="PATCH")for(const row of rows)if(row.user_id===current){if(req.method()==="DELETE")reviewRows.delete(row.id);else Object.assign(row,req.postDataJSON());}
      const offset=Number(url.searchParams.get("offset")??0),limit=Number(url.searchParams.get("limit")??20);data=rows.slice(offset,offset+limit);
    }
    else if(url.pathname.endsWith("/library_folders"))data=[...folderRows.values()].filter(row=>row.user_id===current);
    else if(url.pathname.endsWith("/library_folder_books"))data=[...folderMembers.values()].filter(row=>row.user_id===current);
    else if (url.pathname.endsWith("/user_books")) {
      libraryQueries.push(url.search);
      const favoriteMatches = !url.searchParams.has("favorite") || url.searchParams.get("favorite") === `eq.${bookFavorite}`;
      const statusMatches = !url.searchParams.has("status") || url.searchParams.get("status") === `eq.${bookStatus}`;
      const include = !profileOnly || url.searchParams.has("favorite") || url.searchParams.has("status");
      data =
        current === a && !emptyLibrary && favoriteMatches && statusMatches && include && (!cloudRemoved || !url.searchParams.has("deleted_at"))
          ? [
              {
                id: "dddddddd-dddd-4ddd-dddd-dddddddddddd",
                user_id: a,
                book_id: bookId,
                added_at: timestamp,
                last_opened_at: null,
                favorite: bookFavorite,
                status: bookStatus,
                updated_at: timestamp,
                deleted_at: cloudRemoved ? new Date().toISOString() : null,
                ...bookMetadata,
              },
            ]
          : [];
    } else if (url.pathname.endsWith("/rpc/cloud_storage_books"))
      data = current === a && !emptyLibrary && !cloudRemoved ? [{book_id:bookId,title:bookMetadata.display_title??"Cloud EPUB",author:bookMetadata.display_author??"Author",file_size:bytes.length,cover_path:bookMetadata.cover_path,added_at:timestamp}] : [];
    else if (url.pathname.endsWith("/books"))
      data = [...catalog.values()].filter(book=>matches(book.id,url.searchParams.get("id")));
    else if (url.pathname.endsWith("/reading_progress")) {
      if (stalled) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      data = [progress];
    } else if (url.pathname.endsWith("/rpc/sync_changes")) {
      syncCount++;
      const ops = (
        req.postDataJSON() as {
          operations: {
            id: string;
            entity: string;
            payload: typeof progress;
          }[];
        }
      ).operations;
      for (const op of ops) if (op.entity === "progress") progress = op.payload;
      for(const op of ops){
        if(op.entity==="folder"){
          const folder=op.payload as unknown as LibraryFolder;folderRows.set(folder.id,folder);
          if(folder.deleted_at)for(const member of folderMembers.values())if(member.user_id===current&&member.folder_id===folder.id){member.folder_id=null;member.updated_at=folder.updated_at;}
        }else if(op.entity==="folder_book"){const member=op.payload as unknown as FolderMembership;folderMembers.set(`${member.user_id}:${member.book_id}`,member);}
        else if(op.entity==="book_metadata"){
          const metadata=op.payload as unknown as {title:string;author:string;cover_path:string|null;updated_at:string};
          bookMetadata={display_title:metadata.title,display_author:metadata.author,cover_path:metadata.cover_path,metadata_updated_at:metadata.updated_at};
        }
      }
      data = ops.map((o) => ({ id: o.id, outcome: "applied" }));
    } else if (url.pathname.includes("/functions/v1/book-storage")) {
      const action = req.postDataJSON() as { action: string };
      if (action.action === "remove") {
        removeRequests++;
        cloudRemoved = true;
        const base = quotaOverride ?? {used_books:1,max_books:1,used_bytes:bytes.length,max_bytes:1073741824,active_pending_uploads:0,reserved_bytes:0};
        quotaOverride = {...base,used_books:Math.max(0,base.used_books-1),used_bytes:Math.max(0,base.used_bytes-bytes.length)};
        data = {removed:true,usage:quotaOverride};
      } else {
      if (action.action !== "download") uploads++;
      if (action.action === "prepare" && prepareFailures>0) {
        prepareFailures--;
        await route.fulfill({status:429,contentType:"application/json",body:JSON.stringify({code:"pending_upload_limit"}),headers:{"Access-Control-Allow-Origin":"*"}});
        return;
      }
      if (action.action === "prepare" && cloudRemoved) {
        cloudRemoved = false;
        if (quotaOverride) quotaOverride = {...quotaOverride,used_books:quotaOverride.used_books+1,used_bytes:quotaOverride.used_bytes+bytes.length};
      }
      data =
        action.action === "download"
          ? {
              url: "https://files-test.r2.cloudflarestorage.com/books/book.epub",
              hash,
              size: bytes.length,
              format: "epub",
            }
          : { bookId };
      }
    } else if (url.pathname.endsWith("/rpc/library_quota")) data = quotaOverride ?? { used_books: emptyLibrary || cloudRemoved ? 0 : 1, max_books: 1, used_bytes: cloudRemoved ? 0 : bytes.length, max_bytes: 1073741824,active_pending_uploads:0,reserved_bytes:0 };
    else if (url.pathname.endsWith("/rpc/social_feed")) data = [];
    if (
      req.headers().accept?.includes("application/vnd.pgrst.object+json") &&
      Array.isArray(data)
    )
      data = data[0] ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Range": Array.isArray(data)
          ? `0-${Math.max(0, data.length - 1)}/${data.length}`
          : "*",
      },
    });
  });
  await page.route(
    "https://files-test.r2.cloudflarestorage.com/**",
    async (route) => {
      downloads++;
      await route.fulfill({
        status: 200,
        contentType: "application/epub+zip",
        body: bytes,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    },
  );
  return {
    reviewRows,catalog,
    set reviewFailure(value:boolean){reviewFailure=value;},
    folderRows,folderMembers,
    avatarUploads,
    coverUploads,
    privateCovers,
    get bookMetadata() { return bookMetadata; },
    set avatarFailure(value: boolean) { avatarFailure = value; },
    libraryQueries,
    setBookState(state: { favorite: boolean; status: "unread" | "reading" | "finished"; profileOnly?: boolean }) {
      bookFavorite = state.favorite; bookStatus = state.status; profileOnly = state.profileOnly ?? false;
    },
    setProgress(percentage: number) { progress.percentage = percentage; },
    get uploads() { return uploads; },
    get removeRequests() { return removeRequests; },
    passwordUpdates,
    set passwordFailure(value: "current" | "weak" | null) { passwordFailure = value; },
    set prepareFailures(value:number) { prepareFailures = value; },
    setQuota(value:{used_books:number;max_books:number;used_bytes:number;max_bytes:number;active_pending_uploads:number;reserved_bytes:number}) { quotaOverride=value; },
    get registeredUsername() { return registeredUsername; },
    verifyTypes,
    verifyRequests,
    get downloads() {
      return downloads;
    },
    get syncCount() {
      return syncCount;
    },
    set stalled(value: boolean) {
      stalled = value;
    },
  };
}
export async function multiChapterFixture():Promise<Buffer>{
  const zip=await JSZip.loadAsync(await epubFixture());
  const opf=await zip.file("OEBPS/content.opf")!.async("string");
  zip.file("OEBPS/content.opf",opf.replace("</manifest>",'<item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest>').replace('<itemref idref="chapter"/>','<itemref idref="chapter"/><itemref idref="chapter2"/>'));
  const chapter=await zip.file("OEBPS/chapter.xhtml")!.async("string");zip.file("OEBPS/chapter.xhtml",chapter.replace("<body>",'<body><p><a href="chapter2.xhtml#target">Consultar segundo capítulo</a></p><p>Freedom <em>across</em> chapters.</p>'));
  zip.file("OEBPS/chapter2.xhtml",'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Second</title></head><body><h1>Second chapter</h1><p id="target">Second chapter with freedom across chapters.</p>'+Array.from({length:35},(_,i)=>`<p>Second paragraph ${i}, more readable text for navigation.</p>`).join("")+'</body></html>');
  zip.file("OEBPS/nav.xhtml",'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">First chapter</a></li><li><a href="chapter2.xhtml">Second chapter</a></li></ol></nav></body></html>');
  return zip.generateAsync({type:"nodebuffer",compression:"STORE"});
}
export async function login(page: Page, email = "a@example.org") {
  await expect(page.locator("#auth-entry")).toBeVisible();
  await page.locator('#account-form [name="email"]').fill(email);
  await page.locator('#account-form [name="password"]').fill("test-password");
  await page.locator('#account-form button[type="submit"]').click();
  await expect(page.locator("#auth-entry")).toBeHidden();
  await expect(page.locator(".shell")).toBeVisible();
  await page.locator('.nav-button[data-view="library"]').click();
}
