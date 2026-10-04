import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const user = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const pc = "11111111-1111-4111-8111-111111111111";
const phone = "22222222-2222-4222-8222-222222222222";
const third = "33333333-3333-4333-8333-333333333333";
const session = (n: number) => `99999999-9999-4999-8999-${String(n).padStart(12,"0")}`;

test("revoked device sessions cannot re-register or use cloud RPCs, but a new sign-in and device-limit recovery work", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated;
      grant select on storage.objects to anon;
      grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const file of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));
    await db.exec(`insert into auth.users(id) values('${user}'); set role authenticated;
      select set_config('request.jwt.claim.sub','${user}',false);`);
    const asSession = async (id: string) => {
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({session_id:id})]);
    };
    const register = async (device: string) => (await db.query<{result:{allowed:boolean;active_devices:number}}>(
      "select public.register_device($1::uuid,$2,'windows','Autumn Reader') as result",[device,device],
    )).rows[0].result;
    await asSession(session(1));
    expect((await register(pc)).allowed).toBe(true);
    await asSession(session(2));
    expect((await register(phone)).allowed).toBe(true);
    expect((await db.query<{result:{removed:boolean} }>("select public.remove_account_device($1::uuid) as result",[pc])).rows[0].result.removed).toBe(true);
    await asSession(session(1));
    await expect(register(pc)).rejects.toThrow(/device_revoked/);
    expect((await db.query<{allowed:boolean}>("select public.device_session_allowed() as allowed")).rows[0].allowed).toBe(false);
    await expect(db.query("select public.cloud_book_identities()")).rejects.toThrow();
    await expect(db.query("select public.library_quota()")).rejects.toThrow(/device_revoked/);
    await asSession(session(3));
    expect((await register(pc)).allowed).toBe(true);
    await asSession(session(1));
    await expect(register(pc)).rejects.toThrow(/device_revoked/);
    await asSession(session(4));
    expect((await register(third)).allowed).toBe(false);
    const list = await db.query<{devices:Array<{device_id:string}>}>("select public.account_devices() as devices");
    expect(list.rows[0].devices).toHaveLength(2);
    await db.query("select public.remove_account_device($1::uuid)",[phone]);
    expect((await register(third)).allowed).toBe(true);
    await db.exec("reset role");
    expect((await db.query<{count:number}>("select count(*)::integer as count from private.revoked_device_sessions")).rows[0].count).toBe(2);
    expect((await db.query<{allowed:boolean}>("select public.authorize_account_device($1::uuid,$2) as allowed",[user,session(1)])).rows[0].allowed).toBe(false);
  } finally { await db.close(); }
}, 45_000);
