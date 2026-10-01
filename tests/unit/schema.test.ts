import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, test } from "vitest";
const db = new PGlite();
const a = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202609280001_cloud_schema.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202609280002_storage_backend.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync("supabase/migrations/202609280003_sync.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/202609280004_activity.sql", "utf8"),
  );
  for (const name of ["202609280005_signup_username.sql", "202609280006_cloud_limits.sql"]) await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  // Storage service enforces bytes/MIME; exercise its object RLS with ordinary client roles.
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select on storage.objects to anon;
    grant select,insert,update,delete on storage.objects to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/202609280007_profile_avatars.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/202609290008_library_folders.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/202609290009_translation_limits.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/202609290010_review_catalog.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/202609290011_folder_note_colors.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/202609300001_private_book_metadata.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/202609300002_upload_quota_retries.sql","utf8"));
  await db.exec(readFileSync("supabase/migrations/202609300003_cloud_storage_management.sql","utf8"));
  await db.exec(`insert into auth.users(id) values('${a}'),('${b}');`);
}, 30000);
test("physical deduplication requires an independent authorized library relation", async () => {
  const hash = "a".repeat(64);
  const first = await db.query<{ intent: { id: string } }>(
    `select public.reserve_book_upload('${a}','${hash}','pdf',100,'Test','') as intent`,
  );
  const id = first.rows[0].intent.id;
  const done = await db.query<{ book: { book_id: string } }>(
    `select public.complete_book_upload('${a}','${id}') as book`,
  );
  const book = done.rows[0].book.book_id;
  expect(
    (
      await db.query<{ file: unknown }>(
        `select public.authorize_book_download('${b}','${book}') as file`,
      )
    ).rows[0].file,
  ).toBeNull();
  const second = await db.query<{ intent: { id: string; owned?: boolean } }>(
    `select public.reserve_book_upload('${b}','${hash}','pdf',100,'Test','') as intent`,
  );
  expect(second.rows[0].intent.owned).toBeUndefined();
  await db.exec(
    `select public.complete_book_upload('${b}','${second.rows[0].intent.id}')`,
  );
  expect(
    (await db.query(`select * from private.book_files`)).rows,
  ).toHaveLength(1);
  expect((await db.query(`select * from public.user_books`)).rows).toHaveLength(
    2,
  );
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${b}',false)`,
  );
  await expect(
    db.exec(`select public.authorize_book_download('${a}','${book}')`),
  ).rejects.toThrow();
  expect(
    (await db.query(`select * from public.user_books where user_id='${a}'`))
      .rows,
  ).toHaveLength(0);
  await db.exec("reset role");
});
test("sync enforces owner, LWW, separate notes and tombstones", async () => {
  const book = (
    await db.query<{ book_id: string }>(
      `select book_id from public.user_books where user_id='${a}' limit 1`,
    )
  ).rows[0].book_id;
  const sync = async (ops: unknown[]) =>
    (
      await db.query<{ result: { id: string; outcome: string }[] }>(
        "select public.sync_changes($1::jsonb) as result",
        [JSON.stringify(ops)],
      )
    ).rows[0].result;
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false)`,
  );
  const payload = {
    user_id: a,
    book_id: book,
    page: 17,
    cfi: null,
    percentage: 0.5,
    pdf_text_offset: 0.2,
    font_size: 110,
    updated_at: new Date(Date.now() - 2000).toISOString(),
  };
  expect(
    (await sync([{ id: "progress", entity: "progress", payload }]))[0].outcome,
  ).toBe("applied");
  expect(
    (
      await sync([
        {
          id: "older",
          entity: "progress",
          payload: {
            ...payload,
            page: 2,
            updated_at: new Date(Date.now() - 10000).toISOString(),
          },
        },
      ])
    )[0].outcome,
  ).toBe("superseded");
  expect(
    (
      await sync([
        { id: "fake", entity: "progress", payload: { ...payload, user_id: b } },
      ])
    )[0].outcome,
  ).toBe("forbidden");
  expect(
    (
      await db.query<{ page: number }>(
        "select page from public.reading_progress",
      )
    ).rows[0].page,
  ).toBe(17);
  const note = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: a,
    book_id: book,
    format: "pdf",
    page: 1,
    y: 0.2,
    cfi: null,
    quote: "Quote",
    content: "Note",
    color: "#cc5500",
    created_at: payload.updated_at,
    updated_at: payload.updated_at,
    deleted_at: null,
  };
  expect(
    (await sync([{ id: "note", entity: "note", payload: note }]))[0].outcome,
  ).toBe("applied");
  await sync([
    {
      id: "delete",
      entity: "note",
      payload: {
        ...note,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    },
  ]);
  expect(
    (await sync([{ id: "replay", entity: "note", payload: note }]))[0].outcome,
  ).toBe("superseded");
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${b}',false)`,
  );
  expect((await db.query("select * from public.notes")).rows).toHaveLength(0);
  expect(
    (
      await sync([
        {
          id: "steal",
          entity: "note",
          payload: {
            ...note,
            user_id: b,
            updated_at: new Date().toISOString(),
          },
        },
      ])
    )[0].outcome,
  ).toBe("forbidden");
  await db.exec("reset role");
});
test("social RLS: public reviews, only owner edits, private lists, likes and follows", async () => {
  const book = (
    await db.query<{ book_id: string }>(
      `select book_id from public.user_books where user_id='${a}' limit 1`,
    )
  ).rows[0].book_id;
  const review = "22222222-2222-4222-8222-222222222222",
    list = "33333333-3333-4333-8333-333333333333";
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);insert into public.reviews(id,user_id,book_id,rating,text) values('${review}','${a}','${book}',5,'Public review');insert into public.book_lists(id,user_id,title,visibility) values('${list}','${a}','Private list','private');insert into public.book_list_items(list_id,book_id) values('${list}','${book}');`,
  );
  await expect(
    db.exec(
      `insert into public.reviews(user_id,book_id,rating) values('${a}','${book}',2)`,
    ),
  ).rejects.toThrow();
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${b}',false);update public.reviews set text='hack' where id='${review}';delete from public.reviews where id='${review}';`,
  );
  expect(
    (
      await db.query<{ text: string }>(
        `select text from public.reviews where id='${review}'`,
      )
    ).rows[0].text,
  ).toBe("Public review");
  expect((await db.query("select * from public.book_lists")).rows).toHaveLength(
    0,
  );
  expect(
    (await db.query("select * from public.book_list_items")).rows,
  ).toHaveLength(0);
  await expect(
    db.exec(
      `insert into public.book_list_items(list_id,book_id) values('${list}','${book}')`,
    ),
  ).rejects.toThrow();
  await expect(
    db.exec(
      `insert into public.review_comments(review_id,user_id,content) values('${review}','${a}','Impersonation')`,
    ),
  ).rejects.toThrow();
  await db.exec(
    `insert into public.review_likes values('${review}','${b}',now());insert into public.follows(follower_id,following_id) values('${b}','${a}');`,
  );
  await expect(
    db.exec(`insert into public.review_likes values('${review}','${b}',now())`),
  ).rejects.toThrow();
  await expect(
    db.exec(
      `insert into public.follows(follower_id,following_id) values('${b}','${b}')`,
    ),
  ).rejects.toThrow();
  await expect(
    db.exec(
      `insert into public.follows(follower_id,following_id) values('${a}','${b}')`,
    ),
  ).rejects.toThrow();
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${a}',false);update public.book_lists set visibility='public' where id='${list}';insert into public.review_comments(id,review_id,user_id,content) values('44444444-4444-4444-8444-444444444444','${review}','${a}','Comment by A');`,
  );
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${b}',false);update public.review_comments set content='hack' where user_id='${a}';delete from public.review_comments where user_id='${a}';`,
  );
  expect(
    (
      await db.query<{ content: string }>(
        "select content from public.review_comments",
      )
    ).rows[0].content,
  ).toBe("Comment by A");
  expect(
    (await db.query("select * from public.book_list_items")).rows,
  ).toHaveLength(1);
  await db.exec("reset role;set role anon");
  expect((await db.query("select * from public.reviews")).rows).toHaveLength(1);
  expect(
    (await db.query("select * from public.book_list_items")).rows,
  ).toHaveLength(1);
  await db.exec("reset role");
});
test("feed derives public activity and excludes private lists even for their owner", async () => {
  const privateList = "55555555-5555-4555-8555-555555555555";
  const book = (
    await db.query<{ book_id: string }>(
      `select book_id from public.user_books where user_id='${a}' limit 1`,
    )
  ).rows[0].book_id;
  await db.exec(
    `insert into public.book_lists(id,user_id,title,visibility) values('${privateList}','${a}','Secret','private');insert into public.book_list_items(list_id,book_id) values('${privateList}','${book}');set role anon;`,
  );
  const feed = await db.query<{ id: string }>(
    "select * from public.social_feed()",
  );
  expect(feed.rows).toHaveLength(2);
  expect(feed.rows.some((r) => r.id.includes(privateList))).toBe(false);
  const paged = await db.query<{ id: string; created_at: string }>(
    "select * from public.social_feed(null,null,false,1)",
  );
  expect(paged.rows).toHaveLength(1);
  expect(
    (
      await db.query("select * from public.social_feed($1,$2,false,20)", [
        paged.rows[0].created_at,
        paged.rows[0].id,
      ])
    ).rows,
  ).toHaveLength(1);
  await db.exec("reset role");
});
test("signup persists a normalized unique username and rejects invalid metadata atomically", async () => {
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const other = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await db.exec(`reset role; insert into auth.users(id,raw_user_meta_data) values('${id}','{"username":" Autumn_User "}');`);
  try {
    expect((await db.query<{username:string; display_name:string}>(`select username,display_name from public.profiles where id='${id}'`)).rows[0]).toEqual({username:"autumn_user",display_name:"autumn_user"});
    await expect(db.exec(`insert into auth.users(id,raw_user_meta_data) values('${other}','{"username":"AUTUMN_USER"}')`)).rejects.toThrow();
    await expect(db.exec(`insert into auth.users(id,raw_user_meta_data) values('${other}','{"username":"invalid name"}')`)).rejects.toThrow("invalid_username");
    expect((await db.query(`select id from auth.users where id='${other}'`)).rows).toHaveLength(0);
  } finally { await db.exec(`reset role; delete from auth.users where id='${id}'`); }
});

test("avatar storage permits only the account's fixed object, without cross-account mutation or listing", async () => {
  const bucket = await db.query<{ public:boolean; file_size_limit:number; allowed_mime_types:string[] }>("select public,file_size_limit,allowed_mime_types from storage.buckets where id='avatars'");
  expect(bucket.rows[0]).toMatchObject({public:true,allowed_mime_types:["image/webp","image/png"]});
  expect(Number(bucket.rows[0].file_size_limit)).toBe(512*1024);
  await db.exec("create policy test_existing_avatar_rule on storage.objects for all to anon,authenticated using(bucket_id='avatars') with check(bucket_id='avatars')");
  try {
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${a}',false)`);
    await db.exec(`insert into storage.objects(bucket_id,name) values('avatars','${a}/avatar')`);
    await expect(db.exec(`insert into storage.objects(bucket_id,name) values('avatars','${a}/book.pdf')`)).rejects.toThrow();
    await expect(db.exec(`insert into storage.objects(bucket_id,name) values('avatars','${b}/avatar')`)).rejects.toThrow();
    await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(0);
    await db.exec(`update storage.objects set name='tampered' where name='${a}/avatar'; delete from storage.objects where name='${a}/avatar'`);
    await db.exec(`insert into storage.objects(bucket_id,name) values('avatars','${b}/avatar')`);
    await expect(db.exec(`update storage.objects set name='${a}/avatar' where name='${b}/avatar'`)).rejects.toThrow();
    await db.exec(`select set_config('request.jwt.claim.sub','${a}',false)`);
    expect((await db.query("select name from storage.objects")).rows).toEqual([{name:`${a}/avatar`}]);
    await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role anon");
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(0);
  } finally { await db.exec("reset role;drop policy test_existing_avatar_rule on storage.objects"); }
});

test("cloud count is server controlled: pending reservations and restored relations cannot exceed it", async () => {
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await db.exec(`reset role; insert into auth.users(id) values('${id}'); update private.cloud_limits set max_books=1;`);
  try {
    const intent = (await db.query<{value:{id:string}}>(`select public.reserve_book_upload('${id}','${"c".repeat(64)}','pdf',100,'One','') as value`)).rows[0].value.id;
    await expect(db.exec(`select public.reserve_book_upload('${id}','${"d".repeat(64)}','pdf',100,'Two','')`)).rejects.toThrow("book_limit");
    const first = (await db.query<{value:{book_id:string}}>(`select public.complete_book_upload('${id}','${intent}') as value`)).rows[0].value.book_id;
    await expect(db.exec(`select public.reserve_book_upload('${id}','${"d".repeat(64)}','pdf',100,'Two','')`)).rejects.toThrow("book_limit");
    await db.exec(`update public.user_books set deleted_at=now() where user_id='${id}' and book_id='${first}'`);
    const next = (await db.query<{value:{id:string}}>(`select public.reserve_book_upload('${id}','${"d".repeat(64)}','pdf',100,'Two','') as value`)).rows[0].value.id;
    await db.exec(`select public.complete_book_upload('${id}','${next}')`);
    await expect(db.exec(`update public.user_books set deleted_at=null where user_id='${id}' and book_id='${first}'`)).rejects.toThrow("book_limit");
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`);
    const quota = (await db.query<{value:{used_books:number;max_books:number}}>(`select public.library_quota() as value`)).rows[0].value;
    expect(quota.used_books).toBe(1); expect(quota.max_books).toBe(1);
    await expect(db.exec(`update private.cloud_limits set max_books=9999`)).rejects.toThrow();
  } finally { await db.exec(`reset role; update private.cloud_limits set max_books=1000; delete from auth.users where id='${id}'`); }
});

test("folders are private, synchronized with independent LWW, and deletion never removes books", async () => {
  const fid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await db.exec("reset role");
  const book = (await db.query<{book_id:string}>(`select book_id from public.user_books where user_id='${a}' limit 1`)).rows[0].book_id;
  const stamp = new Date().toISOString();
  const rpc = (entity:string, payload:object) => `select public.sync_changes('${JSON.stringify([{id:"test",entity,payload}])}'::jsonb) as result`;
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${a}',false)`);
  expect((await db.query<{result:{outcome:string}[]}>(rpc("folder",{id:fid,user_id:a,name:"Private",updated_at:stamp}))).rows[0].result[0].outcome).toBe("applied");
  expect((await db.query<{result:{outcome:string}[]}>(rpc("folder_book",{user_id:a,book_id:book,folder_id:fid,updated_at:stamp}))).rows[0].result[0].outcome).toBe("applied");
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
  expect((await db.query("select * from public.library_folders")).rows).toHaveLength(0);
  expect((await db.query("select * from public.library_folder_books")).rows).toHaveLength(0);
  expect((await db.query<{result:{outcome:string}[]}>(rpc("folder",{id:fid,user_id:b,name:"Stolen",updated_at:stamp}))).rows[0].result[0].outcome).toBe("forbidden");
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false)`);
  const later = new Date(Date.parse(stamp)+1000).toISOString();
  await db.exec(rpc("folder",{id:fid,user_id:a,name:"Renamed",updated_at:later,deleted_at:later}));
  expect((await db.query<{folder_id:string|null}>("select folder_id from public.library_folder_books")).rows[0].folder_id).toBeNull();
  expect((await db.query(`select * from public.user_books where book_id='${book}'`)).rows).toHaveLength(1);
  expect((await db.query<{result:{outcome:string}[]}>(rpc("folder_book",{user_id:a,book_id:book,folder_id:fid,updated_at:later}))).rows[0].result[0].outcome).toBe("superseded");
  await expect(db.exec(`insert into public.library_folders(id,user_id,name,updated_at) values(gen_random_uuid(),'${b}','Hack',now())`)).rejects.toThrow();
  await expect(db.exec(`select private.sync_book_changes('[]')`)).rejects.toThrow();
  await db.exec("reset role; set role anon"); expect((await db.query("select * from public.library_folders").catch(() => ({rows:[]}))).rows).toHaveLength(0);
  await db.exec("reset role");
});

test("private book metadata and cover paths stay with the owner, not the shared binary", async () => {
  const book = (await db.query<{book_id:string}>(`select book_id from public.user_books where user_id='${a}' limit 1`)).rows[0].book_id;
  const original = (await db.query<{title:string}>("select title from public.books where id=$1",[book])).rows[0].title;
  const path = `${a}/${book}/11111111-1111-4111-8111-111111111111.webp`;
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${a}',false)`);
  const op = (owner:string,target:string,id:string,cover:string|null) => ({id,entity:"book_metadata",payload:{user_id:owner,book_id:target,title:"My edition",author:"Local author",cover_path:cover,updated_at:new Date().toISOString()}});
  const result = await db.query<{outcomes:{id:string;outcome:string}[]}>("select public.sync_changes($1::jsonb) as outcomes",[JSON.stringify([op(a,book,"own",path)])]);
  expect(result.rows[0].outcomes[0].outcome).toBe("applied");
  expect((await db.query<{display_title:string;cover_path:string}>("select display_title,cover_path from public.user_books where user_id=$1 and book_id=$2",[a,book])).rows[0]).toMatchObject({display_title:"My edition",cover_path:path});
  expect((await db.query<{title:string}>("select title from public.books where id=$1",[book])).rows[0].title).toBe(original);
  await db.exec(`insert into storage.objects(bucket_id,name) values('book-covers','${path}')`);
  await expect(db.exec(`insert into storage.objects(bucket_id,name) values('book-covers','${b}/${book}/22222222-2222-4222-8222-222222222222.webp')`)).rejects.toThrow();
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
  expect((await db.query("select name from storage.objects where bucket_id='book-covers'")).rows).toHaveLength(0);
  const forged = await db.query<{outcomes:{id:string;outcome:string}[]}>("select public.sync_changes($1::jsonb) as outcomes",[JSON.stringify([op(a,book,"forged",null)])]);
  expect(forged.rows[0].outcomes[0].outcome).toBe("forbidden");
  await db.exec("reset role");
});
test("folder and note colours accept RGB, sync privately, reject invalid input and preserve legacy folder colour", async () => {
  const fid = "edededed-eded-4ded-8ded-edededededed";
  const stamp = new Date(Date.now() - 10000).toISOString();
  const rpc = async (entity: string, payload: object) => (await db.query<{result:{outcome:string}[]}>(
    "select public.sync_changes($1::jsonb) as result",[JSON.stringify([{id:"colour",entity,payload}])])).rows[0].result[0].outcome;
  const book = (await db.query<{book_id:string}>(`select book_id from public.user_books where user_id='${a}' limit 1`)).rows[0].book_id;
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${a}',false)`);
  expect(await rpc("folder",{id:fid,user_id:a,name:"Colours",color:"#63b8ff",updated_at:stamp})).toBe("applied");
  expect((await db.query<{color:string}>(`select color from public.library_folders where id='${fid}'`)).rows[0].color).toBe("#63b8ff");
  // An older client that still sends no colour must not clear the user's choice.
  expect(await rpc("folder",{id:fid,user_id:a,name:"Older client",updated_at:new Date(Date.parse(stamp)+1000).toISOString()})).toBe("applied");
  expect((await db.query<{color:string}>(`select color from public.library_folders where id='${fid}'`)).rows[0].color).toBe("#63b8ff");
  expect(await rpc("folder",{id:fid,user_id:a,name:"Invalid",color:"red;",updated_at:new Date(Date.parse(stamp)+2000).toISOString()})).toBe("invalid");
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
  expect((await db.query(`select * from public.library_folders where id='${fid}'`)).rows).toHaveLength(0);
  expect(await rpc("folder",{id:fid,user_id:b,name:"Stolen",color:"#0000ff",updated_at:new Date(Date.parse(stamp)+3000).toISOString()})).toBe("forbidden");
  await db.exec(`select set_config('request.jwt.claim.sub','${a}',false)`);
  const note = {id:"cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",user_id:a,book_id:book,format:"pdf",page:1,y:.1,cfi:null,quote:"Quote",content:"Note",color:"#4b75dd",created_at:stamp,updated_at:stamp,deleted_at:null};
  expect(await rpc("note",note)).toBe("applied");
  expect((await db.query<{color:string}>(`select color from public.notes where id='${note.id}'`)).rows[0].color).toBe("#4b75dd");
  expect(await rpc("note",{...note,color:"not a colour",updated_at:new Date(Date.parse(stamp)+1000).toISOString()})).toBe("invalid");
  await db.exec("reset role");
});
test("translation reservations enforce character/request budgets, contain no fragments and are server-only",async()=>{
  await db.exec("reset role;set role authenticated");
  await expect(db.exec(`select public.reserve_translation('${a}',20)`)).rejects.toThrow();
  await expect(db.exec("select * from private.translation_usage")).rejects.toThrow();
  await db.exec("reset role;set role service_role");
  await expect(db.exec(`select public.reserve_translation('${a}',2001)`)).rejects.toThrow("text_too_long");
  for(let i=0;i<10;i++)await db.exec(`select public.reserve_translation('${a}',2000)`);
  await expect(db.exec(`select public.reserve_translation('${a}',1)`)).rejects.toThrow("translation_quota");
  for(let i=0;i<60;i++)await db.exec(`select public.reserve_translation('${b}',1)`);
  await expect(db.exec(`select public.reserve_translation('${b}',1)`)).rejects.toThrow("translation_quota");
  await db.exec("reset role");
  expect((await db.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='private' and table_name='translation_usage'")).rows.map(row=>row.column_name)).toEqual(["user_id","day","requests","characters"]);
});
test("local review catalog is idempotent, public, owner protected and never authorizes a file", async () => {
  const id = "abababab-abab-4bab-8bab-abababababab";
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${a}',false)`);
  const publish = async (rating:number,title="Local title") => (await db.query<{result:{review:{id:string;user_id:string;rating:number};book:{title:string}}}>(
    "select public.publish_book_review($1,$2,'Author','epub',$3,'My public comment') as result",[id,title,rating])).rows[0].result;
  const first=await publish(4);expect(first.review.user_id).toBe(a);
  const updated=await publish(5,"Cannot replace metadata");expect(updated.review.id).toBe(first.review.id);expect(updated.book.title).toBe("Local title");
  expect((await db.query("select * from public.user_books where book_id=$1",[id])).rows).toHaveLength(0);
  await expect(db.exec("select * from private.review_catalog_books")).rejects.toThrow();
  await db.exec(`select set_config('request.jwt.claim.sub','${b}',false)`);
  expect((await db.query("select * from public.reviews where id=$1",[first.review.id])).rows).toHaveLength(1);
  await db.query("update public.reviews set rating=1,text='Hijacked' where id=$1",[first.review.id]);
  await db.query("delete from public.reviews where id=$1",[first.review.id]);
  expect((await db.query<{rating:number}>("select rating from public.reviews where id=$1",[first.review.id])).rows[0].rating).toBe(5);
  await expect(db.exec(`insert into public.reviews(user_id,book_id,rating) values('${a}','${id}',1)`)).rejects.toThrow();
  await expect(db.exec(`update public.books set title='Hijacked' where id='${id}'`)).rejects.toThrow();
  await expect(publish(0)).rejects.toThrow();
  const other=await publish(2);expect(other.review.user_id).toBe(b);expect(other.review.id).not.toBe(first.review.id);
  await db.exec("reset role");
  expect((await db.query("select * from private.book_files where book_id=$1",[id])).rows).toHaveLength(0);
  for(const owner of [a,b])expect((await db.query<{file:unknown}>("select public.authorize_book_download($1,$2) as file",[owner,id])).rows[0].file).toBeNull();
  await db.exec("set role anon");await expect(publish(3)).rejects.toThrow();await db.exec("reset role");
});
test("catalog abuse limit remains effective after deleting reviews and rejects creation atomically",async()=>{
  await db.exec(`insert into public.books(id,title,format) select ('edededed-eded-4ded-8ded-'||lpad(i::text,12,'0'))::uuid,'Receipt '||i,'pdf' from generate_series(1,100) i;
    insert into private.review_catalog_books(book_id,user_id) select id,'${a}' from public.books where title like 'Receipt %';
    set role authenticated;select set_config('request.jwt.claim.sub','${a}',false)`);
  const id="dededede-dede-4ede-8ede-dededededede";
  await expect(db.query("select public.publish_book_review($1,'Over limit','','pdf',4,'Text')",[id])).rejects.toThrow("100 libros");
  expect((await db.query("select id from public.books where id=$1",[id])).rows).toHaveLength(0);
  await db.exec("reset role");
});
afterAll(async () => {
  await db.close();
});
test("cloud removal frees only the owner's logical quota and preserves dependent reading/social data", async () => {
  const id="abababab-abab-4aba-8aba-abababababab";
  const note="cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
  const intent="efefefef-efef-4efe-8efe-efefefefefef";
  const hash="e".repeat(64);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);
    insert into public.books(id,title,author,format) values('${id}','Shared PDF','Writer','pdf');
    insert into private.book_files(book_id,file_hash,format,file_size,r2_key) values('${id}','${hash}','pdf',4096,'books/${hash}.pdf');
    insert into public.user_books(user_id,book_id) values('${a}','${id}'),('${b}','${id}');
    insert into public.reading_progress(user_id,book_id,page,percentage) values('${a}','${id}',23,0.4);
    insert into public.notes(id,user_id,book_id,format,page,y,quote,content,color)
      values('${note}','${a}','${id}','pdf',23,0.2,'Passage','My note','#cc5500');
    insert into public.reviews(user_id,book_id,rating,text) values('${a}','${id}',5,'Public opinion');
    insert into private.upload_intents(id,user_id,file_hash,format,file_size,title,staging_key)
      values('${intent}','${a}','${hash}','pdf',4096,'Shared PDF','staging/${a}/${intent}');`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${a}',false);`);
  const before=(await db.query<{usage:{used_books:number;used_bytes:number}}>("select public.library_quota() as usage")).rows[0].usage;
  expect((await db.query<{book_id:string}>("select book_id from public.cloud_storage_books(0,50,'size') where book_id=$1",[id])).rows).toHaveLength(1);
  await expect(db.query("select public.remove_cloud_book($1,$2)",[b,id])).rejects.toThrow();
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  const removed=(await db.query<{result:{remaining_references:number;removed:boolean;cancelled_staging_keys:string[];usage:{used_bytes:number;used_books:number}}}>("select public.remove_cloud_book($1,$2) as result",[a,id])).rows[0].result;
  expect(removed).toMatchObject({remaining_references:1,removed:true});
  expect(removed.cancelled_staging_keys).toEqual([`staging/${a}/${intent}`]);
  await expect(db.query("select public.complete_book_upload($1,$2)",[a,intent])).rejects.toThrow();
  expect(removed.usage.used_bytes).toBe(before.used_bytes-4096);
  expect(removed.usage.used_books).toBe(before.used_books-1);
  expect((await db.query("select public.authorize_book_download($1,$2) as file",[a,id])).rows[0].file).toBeNull();
  expect((await db.query("select public.authorize_book_download($1,$2) as file",[b,id])).rows[0].file).not.toBeNull();
  for(const table of ["reading_progress","notes","reviews"])
    expect((await db.query(`select book_id from public.${table} where book_id=$1`,[id])).rows).not.toHaveLength(0);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${a}',false);`);
  expect((await db.query("select book_id from public.cloud_storage_books(0,50,'recent') where book_id=$1",[id])).rows).toHaveLength(0);
  const future=new Date(Date.now()+1000).toISOString();
  await db.query("select public.sync_changes($1::jsonb)",[JSON.stringify([{id:"stale",entity:"user_book",payload:{user_id:a,book_id:id,favorite:false,status:"reading",last_opened_at:null,deleted_at:null,updated_at:future}}])]);
  expect((await db.query<{deleted_at:string|null}>("select deleted_at from public.user_books where user_id=$1 and book_id=$2",[a,id])).rows[0].deleted_at).not.toBeNull();
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  const orphan=(await db.query<{result:{remaining_references:number}}>("select public.remove_cloud_book($1,$2) as result",[b,id])).rows[0].result;
  expect(orphan.remaining_references).toBe(0);
  expect((await db.query("select book_id from private.book_files where book_id=$1",[id])).rows).toHaveLength(1);
  await db.exec(`insert into private.upload_intents(id,user_id,file_hash,format,file_size,title,staging_key)
    values('${intent}','${a}','${hash}','pdf',4096,'Shared PDF','staging/${a}/${intent}');`);
  expect((await db.query<{result:{book_id:string} }>("select public.complete_book_upload($1,$2) as result",[a,intent])).rows[0].result.book_id).toBe(id);
  expect((await db.query("select book_id from public.reading_progress where user_id=$1 and book_id=$2",[a,id])).rows).toHaveLength(1);
});
test("profile creation and RLS: public read, owner edit, no impersonation", async () => {
  await db.exec(`set role anon`);
  expect((await db.query("select * from public.profiles")).rows).toHaveLength(
    2,
  );
  await expect(
    db.exec(`update public.profiles set bio='hack'`),
  ).rejects.toThrow();
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${b}',false); update public.profiles set bio='B' where id='${b}'; update public.profiles set bio='hack' where id='${a}';`,
  );
  expect(
    (
      await db.query<{ bio: string }>(
        `select bio from public.profiles where id='${a}'`,
      )
    ).rows[0].bio,
  ).toBe("");
  await expect(
    db.exec(`update public.profiles set id='${a}' where id='${b}'`),
  ).rejects.toThrow();
  await expect(db.exec(`select * from private.book_files`)).rejects.toThrow();
  await expect(
    db.exec(
      `insert into public.user_books(user_id,book_id) values('${b}',gen_random_uuid())`,
    ),
  ).rejects.toThrow();
  await db.exec("reset role");
});
