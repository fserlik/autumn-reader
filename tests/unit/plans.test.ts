import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, test } from "vitest";

const db = new PGlite();
const a = randomUUID();
const b = randomUUID();
const migration = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`);
  for (const name of [
    "202609280001_cloud_schema.sql","202609280002_storage_backend.sql","202609280003_sync.sql",
    "202609280004_activity.sql","202609280005_signup_username.sql","202609280006_cloud_limits.sql",
  ]) { try { await db.exec(migration(name)); } catch (error) { throw new Error(`Migration ${name}: ${JSON.stringify(error, Object.getOwnPropertyNames(error as object))}`); } }
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select on storage.objects to anon;
    grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const name of [
    "202609280007_profile_avatars.sql","202609290008_library_folders.sql",
    "202609290009_translation_limits.sql","202609290010_review_catalog.sql",
    "202609290011_folder_note_colors.sql","202609300001_private_book_metadata.sql",
    "202609300002_upload_quota_retries.sql","202609300003_cloud_storage_management.sql",
    "202610010001_cloud_book_identities.sql","202610010002_profile_banner.sql",
    "202610020001_account_plans.sql",
  ]) { try { await db.exec(migration(name)); } catch (error) { throw new Error(`Migration ${name}: ${JSON.stringify(error, Object.getOwnPropertyNames(error as object))}`); } }
  await db.query("insert into auth.users(id) values($1),($2)",[a,b]);
}, 40000);
afterAll(async () => db.close());

async function asUser<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  const session = randomUUID();
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,session_id:session})]);
  try { return await fn(); }
  finally { await db.exec("reset role"); }
}
async function addBooks(owner: string, count: number, bytes: number): Promise<void> {
  const tag = `plan_${randomUUID().replaceAll("-","")}_`;
  await db.query("insert into public.books(title,format) select $1||n,'pdf' from generate_series(1,$2::integer) n",[tag,count]);
  await db.query(`insert into private.book_files(book_id,file_hash,format,file_size,r2_key)
    select id,lpad(replace(id::text,'-',''),64,'0'),'pdf',$2::bigint,
      'books/'||lpad(replace(id::text,'-',''),64,'0')||'.pdf' from public.books where title like $1||'%'`,[tag,bytes]);
  await db.query(`insert into public.user_books(user_id,book_id)
    select $2::uuid,id from public.books where title like $1||'%'`,[tag,owner]);
}
const hash = (n: number) => `a${n.toString(16).padStart(63,"0")}`;
async function prepare(owner: string, number: number, bytes: number) {
  return (await db.query<{value:{id:string}}>("select public.reserve_book_upload($1,$2,'pdf',$3,'Plan test','') as value",[owner,hash(number),bytes])).rows[0].value;
}

test("catalog defines Free, Plus and Pro centrally; existing accounts are Free without deleting books", async () => {
  await addBooks(a,55,100);
  const catalog=(await db.query<{code:string;cloud_bytes:number;max_devices:number|null}>("select code,cloud_bytes,max_devices from private.plan_catalog order by cloud_bytes")).rows;
  expect(catalog.map(p=>[p.code,Number(p.cloud_bytes),p.max_devices])).toEqual([
    ["free",1073741824,2],["plus",26843545600,null],["pro",107374182400,null],
  ]);
  expect((await db.query<{count:number}>("select count(*)::integer as count from public.user_books where user_id=$1 and deleted_at is null",[a])).rows[0].count).toBe(55);
  await asUser(a,async()=>{
    const usage=(await db.query<{value:Record<string,number|string>}>("select public.library_quota() as value")).rows[0].value;
    expect(usage).toMatchObject({used_books:55,used_bytes:5500,max_bytes:1073741824,plan:"free"});
    expect(usage).not.toHaveProperty("max_books");
    await expect(db.exec("update private.account_subscriptions set plan_code='pro'")).rejects.toThrow();
  });
});

test("Free reserves by bytes only; valid pending bytes count, expired bytes do not",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await addBooks(owner,51,20_000_000);
  const first=await prepare(owner,2001,30_000_000);
  await expect(prepare(owner,2002,30_000_000)).rejects.toThrow("storage_limit");
  await db.query("update private.upload_intents set expires_at=now()-interval '1 minute' where id=$1",[first.id]);
  await prepare(owner,2002,30_000_000);
});

test("downgrade preserves existing over-quota books and downloads but blocks new cloud uploads",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.query("insert into private.account_subscriptions(user_id,plan_code,status) values($1,'plus','active')",[owner]);
  await addBooks(owner,34,32*1024*1024);
  const existing=(await db.query<{book_id:string}>("select book_id from public.user_books where user_id=$1 limit 1",[owner])).rows[0].book_id;
  await db.query("update private.account_subscriptions set status='expired',expires_at=now()-interval '1 day' where user_id=$1",[owner]);
  await expect(prepare(owner,3001,100)).rejects.toThrow("storage_limit");
  expect((await db.query<{value:{file_size:number}}>("select public.authorize_book_download($1,$2) as value",[owner,existing])).rows[0].value.file_size).toBe(32*1024*1024);
  expect((await db.query<{count:number}>("select count(*)::integer as count from public.user_books where user_id=$1 and deleted_at is null",[owner])).rows[0].count).toBe(34);
});

test("Free allows two registered devices, denies a third, and Plus has no device cap",async()=>{
  const first=randomUUID(),second=randomUUID(),third=randomUUID();
  await asUser(b,async()=>{
    const register=async(id:string,secret=id)=>(await db.query<{value:{allowed:boolean;active_devices:number}}>("select public.register_device($1,$2,'android','Test device') as value",[id,secret])).rows[0].value;
    expect((await register(first)).allowed).toBe(true);
    await expect(register(first,randomUUID())).rejects.toThrow("device_mismatch");
    expect((await register(second)).allowed).toBe(true);
    expect((await register(third)).allowed).toBe(false);
    expect((await db.query<{value:unknown[]}>("select public.account_devices() as value")).rows[0].value).toHaveLength(2);
    await db.query("select public.remove_account_device($1)",[first]);
    expect((await register(third)).allowed).toBe(true);
  });
  await db.query("insert into private.account_subscriptions(user_id,plan_code,status) values($1,'plus','active')",[b]);
  await asUser(b,async()=>{
    for(let n=0;n<4;n++) expect((await db.query<{value:{allowed:boolean}}>("select public.register_device($1,$2,'web','Browser') as value",[randomUUID(),randomUUID()])).rows[0].value.allowed).toBe(true);
  });
});
test("cloud library RLS stays private until the signed-in installation registers",async()=>{
  await asUser(a,async()=>{
    const count=async()=>(await db.query<{count:number}>("select count(*)::integer as count from public.user_books where user_id=$1",[a])).rows[0].count;
    expect(await count()).toBe(0);
    const id=randomUUID(),secret=randomUUID();
    await db.query("select public.register_device($1,$2,'windows','Reader PC')",[id,secret]);
    expect(await count()).toBe(55);
    expect((await db.query("select * from public.cloud_book_identities()")).rows).toHaveLength(55);
    expect((await db.query("select * from public.cloud_storage_books(0,5,'recent')")).rows).toHaveLength(5);
    expect((await db.query<{value:unknown[]}>("select public.sync_changes('[]'::jsonb) as value")).rows[0].value).toEqual([]);
    await db.query("select public.remove_account_device($1)",[id]);
    expect(await count()).toBe(0);
    await expect(db.query("select * from private.account_subscriptions")).rejects.toThrow();
  });
});

test("subscription state falls back to Free after cancellation/expiration and keeps Pro during grace",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.query("insert into private.account_subscriptions(user_id,plan_code,status) values($1,'pro','active')",[owner]);
  const effective=async()=> (await db.query<{code:string}>("select private.effective_plan_code($1) as code",[owner])).rows[0].code;
  expect(await effective()).toBe("pro");
  await db.query("update private.account_subscriptions set status='canceled',expires_at=now()+interval '1 day' where user_id=$1",[owner]);
  expect(await effective()).toBe("pro");
  await db.query("update private.account_subscriptions set expires_at=now()-interval '1 day' where user_id=$1",[owner]);
  expect(await effective()).toBe("free");
  await db.query("update private.account_subscriptions set status='past_due',grace_until=now()+interval '1 day' where user_id=$1",[owner]);
  expect(await effective()).toBe("pro");
  await db.query("update private.account_subscriptions set grace_until=now()-interval '1 day' where user_id=$1",[owner]);
  expect(await effective()).toBe("free");
});
test("paid-to-Free downgrade pauses cloud access above two devices until the user chooses one to remove",async()=>{
  const owner=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()];
  await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.query("insert into private.account_subscriptions(user_id,plan_code,status) values($1,'plus','active')",[owner]);
  await asUser(owner,async()=>{
    for(const id of ids) expect((await db.query<{value:{allowed:boolean}}>(
      "select public.register_device($1,$2,'android','Test') as value",[id,id])).rows[0].value.allowed).toBe(true);
    expect((await db.query<{allowed:boolean}>("select public.device_session_allowed() as allowed")).rows[0].allowed).toBe(true);
    await db.exec("reset role");
    await db.query("update private.account_subscriptions set status='expired' where user_id=$1",[owner]);
    await db.exec("set role authenticated");
    expect((await db.query<{allowed:boolean}>("select public.device_session_allowed() as allowed")).rows[0].allowed).toBe(false);
    expect((await db.query<{value:{allowed:boolean}}>(
      "select public.register_device($1,$2,'android','Test') as value",[ids[0],ids[0]])).rows[0].value.allowed).toBe(false);
    expect((await db.query<{value:unknown[]}>("select public.account_devices() as value")).rows[0].value).toHaveLength(3);
    await db.query("select public.remove_account_device($1)",[ids[2]]);
    expect((await db.query<{allowed:boolean}>("select public.device_session_allowed() as allowed")).rows[0].allowed).toBe(true);
  });
});
