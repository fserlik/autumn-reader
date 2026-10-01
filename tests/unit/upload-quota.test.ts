import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test } from "vitest";

const db = new PGlite();
const mb = 1024 * 1024;
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  for (const migration of [
    "202609280001_cloud_schema.sql", "202609280002_storage_backend.sql",
    "202609280006_cloud_limits.sql", "202609300002_upload_quota_retries.sql",
  ]) await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec(`update private.cloud_limits set max_books=50,max_bytes=1073741824`);
});
afterAll(async () => db.close());

const hash = (number: number) => `a${number.toString(16).padStart(63, "0")}`;
async function account(): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [id]);
  return id;
}
async function confirmed(owner: string, count: number, bytes = mb): Promise<void> {
  const tag = `quota_${owner.replaceAll("-", "")}_`;
  await db.query("insert into public.books(title,format) select $1 || n,'pdf' from generate_series(1,$2::integer) n", [tag, count]);
  await db.query(`insert into private.book_files(book_id,file_hash,format,file_size,r2_key)
    select id,lpad(replace(id::text,'-',''),64,'0'),'pdf',$2::bigint,
      'books/'||lpad(replace(id::text,'-',''),64,'0')||'.pdf'
    from public.books where title like $1 || '%'`, [tag, bytes]);
  await db.query(`insert into public.user_books(user_id,book_id)
    select $2::uuid,id from public.books where title like $1 || '%'`, [tag, owner]);
}
async function prepare(owner: string, number: number, bytes = mb): Promise<{ id: string; owned?: boolean }> {
  const result = await db.query<{ intent: { id: string; owned?: boolean } }>(
    "select public.reserve_book_upload($1,$2,'pdf',$3,'Quota test','') as intent", [owner, hash(number), bytes],
  );
  return result.rows[0].intent;
}
async function quota(owner: string): Promise<Record<string, number>> {
  await db.exec(`set role authenticated`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  try {
    const result = await db.query<{ value: Record<string, number> }>("select public.library_quota() as value");
    return result.rows[0].value;
  } finally { await db.exec("reset role"); }
}
async function oldIntents(owner: string, count: number, expired: boolean, bytes = mb, duplicate = false): Promise<void> {
  await db.query(`insert into private.upload_intents(user_id,file_hash,format,file_size,title,staging_key,created_at,expires_at)
    select $1::uuid,case when $5::boolean then $2 else 'b'||lpad(to_hex(n),63,'0') end,
      'pdf',$3::bigint,'Prior attempt','staging/'||$1::text||'/'||gen_random_uuid()::text,
      now()-interval '10 minutes',case when $4::boolean then now()-interval '1 minute' else now()+interval '10 minutes' end
    from generate_series(1,$6::integer) n`, [owner, hash(9000), bytes, expired, duplicate, count]);
}

test("14 confirmed, no reservations and 17 new books reach 31 of 50", async () => {
  const owner = await account(), existingSize=Math.round(19.3*mb/14);
  await confirmed(owner, 14, existingSize);
  expect(await quota(owner)).toMatchObject({used_books:14,active_pending_uploads:0,max_books:50,used_bytes:14*existingSize});
  for (let n=1;n<=17;n++) {
    const intent = await prepare(owner,n);
    await db.query("select public.complete_book_upload($1,$2)",[owner,intent.id]);
  }
  expect(await quota(owner)).toMatchObject({used_books:31,active_pending_uploads:0,used_bytes:14*existingSize+17*mb});
});
test("49 confirmed admits one book, then rejects the 51st for book quota", async () => {
  const owner = await account(); await confirmed(owner,49);
  const intent=await prepare(owner,101);
  await db.query("select public.complete_book_upload($1,$2)",[owner,intent.id]);
  expect((await quota(owner)).used_books).toBe(50);
  await expect(prepare(owner,102)).rejects.toThrow("book_limit");
});
test("49 confirmed plus one active reservation protects the final slot", async () => {
  const owner=await account(); await confirmed(owner,49);
  await prepare(owner,201);
  await expect(prepare(owner,202)).rejects.toThrow("book_limit");
  expect(await quota(owner)).toMatchObject({used_books:49,active_pending_uploads:1});
});
test("14 confirmed and 36 distinct valid reservations protect book quota", async () => {
  const owner=await account(); await confirmed(owner,14); await oldIntents(owner,36,false);
  expect((await quota(owner)).active_pending_uploads).toBe(36);
  await expect(prepare(owner,301)).rejects.toThrow("book_limit");
});
test("36 expired reservations count neither as books nor pending bytes", async () => {
  const owner=await account(); await confirmed(owner,14); await oldIntents(owner,36,true);
  expect(await quota(owner)).toMatchObject({used_books:14,active_pending_uploads:0,reserved_bytes:0,expired_reservations:36});
  await prepare(owner,401);
  expect((await quota(owner)).active_pending_uploads).toBe(1);
});
test("cleanup removes only long-expired unfinished intents", async () => {
  const owner=await account(); await oldIntents(owner,1,true);
  await db.query("update private.upload_intents set expires_at=now()-interval '2 days' where user_id=$1",[owner]);
  const active=await prepare(owner,450);
  expect((await db.query<{n:number}>("select count(*)::integer as n from private.upload_intents where user_id=$1",[owner])).rows[0].n).toBe(1);
  expect((await quota(owner)).active_pending_uploads).toBe(1);
  expect((await prepare(owner,450)).id).toBe(active.id);
});
test("ten near-expiry retries of one file reuse its intent and staging key", async () => {
  const owner=await account(); await confirmed(owner,14);
  const first=await prepare(owner,501);
  await db.query("update private.upload_intents set expires_at=now()+interval '2 minutes' where id=$1",[first.id]);
  for(let i=0;i<10;i++) expect((await prepare(owner,501)).id).toBe(first.id);
  expect(await quota(owner)).toMatchObject({active_pending_uploads:1,reserved_bytes:mb,recent_unique_uploads:1});
  expect((await db.query<{n:number}>("select count(*)::integer as n from private.upload_intents where user_id=$1",[owner])).rows[0].n).toBe(1);
});
test("an expired intent is reused only after checking current book quota", async () => {
  const owner=await account(); await confirmed(owner,49);
  const expired=await prepare(owner,551);
  await db.query("update private.upload_intents set expires_at=now()-interval '1 minute' where id=$1",[expired.id]);
  await prepare(owner,552);
  await expect(prepare(owner,551)).rejects.toThrow("book_limit");
  expect(await quota(owner)).toMatchObject({used_books:49,active_pending_uploads:1,expired_reservations:1});
  await db.query("update private.upload_intents set expires_at=now()-interval '1 minute' where user_id=$1 and file_hash=$2",[owner,hash(552)]);
  expect((await prepare(owner,551)).id).toBe(expired.id);
  expect((await quota(owner)).active_pending_uploads).toBe(1);
});
test("failed staging PUT followed by retry does not allocate another slot", async () => {
  const owner=await account(); const first=await prepare(owner,601);
  // No complete call: the upload failed. The next prepare must reuse it.
  const retry=await prepare(owner,601);
  expect(retry.id).toBe(first.id);
  await prepare(owner,602);
  expect((await quota(owner)).active_pending_uploads).toBe(2);
});
test("successful commit stops counting its reservation", async () => {
  const owner=await account(); const intent=await prepare(owner,701);
  expect((await quota(owner)).active_pending_uploads).toBe(1);
  const first=await db.query<{value:{book_id:string} }>("select public.complete_book_upload($1,$2) as value",[owner,intent.id]);
  const second=await db.query<{value:{book_id:string} }>("select public.complete_book_upload($1,$2) as value",[owner,intent.id]);
  expect(second.rows[0].value.book_id).toBe(first.rows[0].value.book_id);
  expect(await quota(owner)).toMatchObject({used_books:1,active_pending_uploads:0,reserved_bytes:0});
});
test("old duplicate and completed attempts do not multiply quota or hourly rate", async () => {
  const owner=await account(); await confirmed(owner,14);
  await oldIntents(owner,65,true,mb,true);
  expect(await quota(owner)).toMatchObject({used_books:14,active_pending_uploads:0,recent_unique_uploads:1,expired_reservations:65});
  await prepare(owner,801);
});
test("confirmed and active bytes are distinct; expired 32 MB reservations cannot fill storage", async () => {
  const owner=await account(); await confirmed(owner,14,1400000); await oldIntents(owner,36,true,32*mb);
  expect(await quota(owner)).toMatchObject({used_books:14,used_bytes:19600000,reserved_bytes:0});
  await prepare(owner,901,mb);
});
test("storage quota includes a valid reservation but excludes an expired one", async () => {
  const owner=await account(); await db.exec(`update private.cloud_limits set max_bytes=${2*mb}`);
  try {
    const first=await prepare(owner,950,Math.round(1.5*mb));
    await expect(prepare(owner,951,Math.round(.75*mb))).rejects.toThrow("storage_limit");
    await db.query("update private.upload_intents set expires_at=now()-interval '1 minute' where id=$1",[first.id]);
    await prepare(owner,951,Math.round(.75*mb));
    expect((await quota(owner)).reserved_bytes).toBe(Math.round(.75*mb));
  } finally { await db.exec(`update private.cloud_limits set max_bytes=1073741824`); }
});
test("three distinct active uploads return a pending-specific error", async () => {
  const owner=await account(); await oldIntents(owner,3,false);
  await expect(prepare(owner,1001)).rejects.toThrow("pending_upload_limit");
  expect((await quota(owner)).active_pending_uploads).toBe(3);
});
test("the separate 60-distinct-file hourly guard reports its own reason", async () => {
  const owner=await account(); await oldIntents(owner,60,true);
  await expect(prepare(owner,1101)).rejects.toThrow("upload_rate_limited");
  expect(await quota(owner)).toMatchObject({active_pending_uploads:0,recent_unique_uploads:60});
});
test("two different devices racing for the final slot cannot both reserve", async () => {
  const owner=await account(); await confirmed(owner,49);
  const outcomes=await Promise.allSettled([prepare(owner,1201),prepare(owner,1202)]);
  expect(outcomes.filter((result)=>result.status==="fulfilled")).toHaveLength(1);
  expect(outcomes.filter((result)=>result.status==="rejected")).toHaveLength(1);
  expect((await quota(owner)).active_pending_uploads).toBe(1);
});
