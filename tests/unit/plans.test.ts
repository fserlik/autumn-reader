import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, test } from "vitest";

const db = new PGlite();
const a = randomUUID();
const b = randomUUID();
const legacyStoreUser = randomUUID();
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
    "202610020001_account_plans.sql","202610020002_device_revocation.sql",
    "202610030001_microsoft_store_subscriptions.sql",
  ]) { try { await db.exec(migration(name)); } catch (error) { throw new Error(`Migration ${name}: ${JSON.stringify(error, Object.getOwnPropertyNames(error as object))}`); } }
  await db.query("insert into auth.users(id) values($1)",[legacyStoreUser]);
  await db.query(`insert into private.account_subscriptions(
    user_id,plan_code,status,billing_cycle,provider,external_subscription_id,expires_at
  ) values($1,'pro','active','annual','microsoft_store','legacy-store-sub',now()+interval '1 year')`,[legacyStoreUser]);
  try { await db.exec(migration("202610040001_provider_agnostic_billing.sql")); }
  catch (error) { throw new Error(`Migration 202610040001_provider_agnostic_billing.sql: ${JSON.stringify(error, Object.getOwnPropertyNames(error as object))}`); }
  try { await db.exec(migration("202610060001_lemonsqueezy_billing.sql")); }
  catch (error) { throw new Error(`Migration 202610060001_lemonsqueezy_billing.sql: ${JSON.stringify(error, Object.getOwnPropertyNames(error as object))}`); }
  try { await db.exec(migration("202610100001_premium_ai_speech.sql")); }
  catch (error) { throw new Error(`Migration 202610100001_premium_ai_speech.sql: ${JSON.stringify(error, Object.getOwnPropertyNames(error as object))}`); }
  try { await db.exec(migration("202610130001_reduce_paid_plan_storage.sql")); }
  catch (error) { throw new Error(`Migration 202610130001_reduce_paid_plan_storage.sql: ${JSON.stringify(error, Object.getOwnPropertyNames(error as object))}`); }
  for (const name of [
    "202610180001_premium_entitlements.sql",
    "202610180002_service_quotas.sql",
    "202610180003_provider_controls_billing_audit_and_r2_gc.sql",
  ]) {
    try { await db.exec(migration(name)); }
    catch (error) { throw new Error(`Migration ${name}: ${JSON.stringify(error, Object.getOwnPropertyNames(error as object))}`); }
  }
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

test("public catalog exposes only Free and Premium while historical rows remain internal", async () => {
  await addBooks(a,55,100);
  const catalog=(await db.query<{code:string;cloud_bytes:number;max_devices:number|null}>("select code,cloud_bytes,max_devices from private.plan_catalog order by cloud_bytes")).rows;
  expect(catalog.map(p=>[p.code,Number(p.cloud_bytes),p.max_devices])).toEqual([
    ["free",1073741824,2],["plus",5368709120,null],["pro",21474836480,null],["premium",26843545600,null],
  ]);
  expect((await db.query<{count:number}>("select count(*)::integer as count from public.user_books where user_id=$1 and deleted_at is null",[a])).rows[0].count).toBe(55);
  await asUser(a,async()=>{
    const device=randomUUID(); await db.query("select public.register_device($1,$2,'web','Catalog test')",[device,device]);
    const publicCatalog=(await db.query<{value:Array<{code:string;lifetime_usd_cents:number|null}>}>("select public.plan_catalog() as value")).rows[0].value;
    expect(publicCatalog.map(plan=>plan.code)).toEqual(["free","premium"]);
    expect(publicCatalog[1].lifetime_usd_cents).toBe(11999);
    const usage=(await db.query<{value:Record<string,number|string>}>("select public.library_quota() as value")).rows[0].value;
    expect(usage).toMatchObject({used_books:55,used_bytes:5500,max_bytes:1073741824,plan:"free"});
    expect(usage).not.toHaveProperty("max_books");
    const entitlements=(await db.query<{value:Record<string,unknown>}>("select public.get_user_entitlements() as value")).rows[0].value;
    expect(entitlements).toMatchObject({plan:"free",cloudStorageBytes:1073741824,maxDevices:2,sync:true,offline:true,notesAndHighlights:true});
    await expect(db.exec("update private.subscriptions set plan='pro'")).rejects.toThrow();
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
  await db.query("insert into private.subscriptions(user_id,provider,plan,status) values($1,'manual','plus','active')",[owner]);
  await addBooks(owner,34,32*1024*1024);
  const existing=(await db.query<{book_id:string}>("select book_id from public.user_books where user_id=$1 limit 1",[owner])).rows[0].book_id;
  await db.query("update private.subscriptions set status='expired',current_period_end=now()-interval '1 day' where user_id=$1",[owner]);
  await expect(prepare(owner,3001,100)).rejects.toThrow("storage_limit");
  expect((await db.query<{value:{file_size:number}}>("select public.authorize_book_download($1,$2) as value",[owner,existing])).rows[0].value.file_size).toBe(32*1024*1024);
  expect((await db.query<{count:number}>("select count(*)::integer as count from public.user_books where user_id=$1 and deleted_at is null",[owner])).rows[0].count).toBe(34);
});

test("Free allows two registered devices, denies a third, and a legacy paid right maps to unlimited Premium",async()=>{
  const first=randomUUID(),second=randomUUID(),third=randomUUID();
  await asUser(b,async()=>{
    const register=async(id:string,secret=id)=>(await db.query<{value:{allowed:boolean;active_devices:number}}>("select public.register_device($1,$2,'android','Test device') as value",[id,secret])).rows[0].value;
    expect((await register(first)).allowed).toBe(true);
    await expect(register(first,randomUUID())).rejects.toThrow("device_mismatch");
    expect((await register(second)).allowed).toBe(true);
    expect((await register(third)).allowed).toBe(false);
    expect((await db.query<{value:unknown[]}>("select public.account_devices() as value")).rows[0].value).toHaveLength(2);
    expect((await register(third)).allowed).toBe(false);
  });
  await db.query("insert into private.subscriptions(user_id,provider,plan,status) values($1,'manual','plus','active')",[b]);
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
    await expect(db.query("select * from private.subscriptions")).rejects.toThrow();
  });
});

test("subscription state falls back to Free after expiration and maps valid legacy plans to Premium",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.query("insert into private.subscriptions(user_id,provider,plan,status) values($1,'manual','pro','active')",[owner]);
  const effective=async()=> (await db.query<{code:string}>("select private.effective_plan_code($1) as code",[owner])).rows[0].code;
  expect(await effective()).toBe("premium");
  await db.query("update private.subscriptions set status='canceled',current_period_end=now()+interval '1 day' where user_id=$1",[owner]);
  expect(await effective()).toBe("premium");
  await db.query("update private.subscriptions set current_period_end=now()-interval '1 day' where user_id=$1",[owner]);
  expect(await effective()).toBe("free");
  await db.query("update private.subscriptions set status='past_due',grace_until=now()+interval '1 day' where user_id=$1",[owner]);
  expect(await effective()).toBe("premium");
  await db.query("update private.subscriptions set grace_until=now()-interval '1 day' where user_id=$1",[owner]);
  expect(await effective()).toBe("free");
});
test("paid-to-Free downgrade pauses cloud access above two devices until the user chooses one to remove",async()=>{
  const owner=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()];
  await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.query("insert into private.subscriptions(user_id,provider,plan,status) values($1,'manual','plus','active')",[owner]);
  await asUser(owner,async()=>{
    for(const id of ids) expect((await db.query<{value:{allowed:boolean}}>(
      "select public.register_device($1,$2,'android','Test') as value",[id,id])).rows[0].value.allowed).toBe(true);
    expect((await db.query<{allowed:boolean}>("select public.device_session_allowed() as allowed")).rows[0].allowed).toBe(true);
    await db.exec("reset role");
    await db.query("update private.subscriptions set status='expired' where user_id=$1",[owner]);
    await db.exec("set role authenticated");
    expect((await db.query<{allowed:boolean}>("select public.device_session_allowed() as allowed")).rows[0].allowed).toBe(false);
    expect((await db.query<{value:{allowed:boolean}}>(
      "select public.register_device($1,$2,'android','Test') as value",[ids[0],ids[0]])).rows[0].value.allowed).toBe(false);
    expect((await db.query<{value:unknown[]}>("select public.account_devices() as value")).rows[0].value).toHaveLength(3);
    await db.query("select public.remove_account_device($1)",[ids[2]]);
    expect((await db.query<{allowed:boolean}>("select public.device_session_allowed() as allowed")).rows[0].allowed).toBe(false);
  });
  await asUser(owner,async()=>{
    expect((await db.query<{value:{allowed:boolean} }>(
      "select public.register_device($1,$2,'android','Test') as value",[ids[0],ids[0]])).rows[0].value.allowed).toBe(true);
    expect((await db.query<{allowed:boolean}>("select public.device_session_allowed() as allowed")).rows[0].allowed).toBe(true);
  });
});

test("valid Microsoft Store records map to Premium without changing their economics",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.query(`insert into private.subscriptions(
    user_id,provider,provider_customer_id,provider_subscription_id,plan,status,billing_period,current_period_end
  ) values($1,'microsoft_store','legacy-customer','legacy-subscription','pro','active','annual',now()+interval '1 year')`,[owner]);
  expect((await db.query<{code:string}>("select private.effective_plan_code($1) as code",[owner])).rows[0].code).toBe("premium");
});

test("migration preserves an archived valid Microsoft Store right as Premium",async()=>{
  expect((await db.query<{count:number}>("select count(*)::integer as count from private.legacy_billing_records where user_id=$1",[legacyStoreUser])).rows[0].count).toBe(1);
  expect((await db.query<{count:number}>("select count(*)::integer as count from private.subscriptions where user_id=$1",[legacyStoreUser])).rows[0].count).toBe(0);
  expect((await db.query<{code:string}>("select private.effective_plan_code($1) as code",[legacyStoreUser])).rows[0].code).toBe("premium");
});

test("billing webhooks are atomic, idempotent and ignore stale state",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  const event=(id:string,occurred:string,status:string,plan:string)=>db.query<{value:boolean}>(`
    select public.process_billing_event(
      'lemonsqueezy',$1,'subscription.updated',$2,$3,'ls_customer_test','ls_subscription_test',$4,'monthly',$5,
      $2,$2::timestamptz+interval '1 month',false
    ) as value`,[id,occurred,owner,plan,status]);
  await db.exec("set role service_role");
  try {
    const latest=new Date().toISOString();
    expect((await event("evt_latest",latest,"active","pro")).rows[0].value).toBe(true);
    expect((await event("evt_latest",latest,"active","plus")).rows[0].value).toBe(false);
    const stale=new Date(Date.parse(latest)-60_000).toISOString();
    expect((await event("evt_stale",stale,"canceled","plus")).rows[0].value).toBe(true);
    const row=(await db.query<{plan:string;status:string}>("select plan,status from private.subscriptions where user_id=$1",[owner])).rows[0];
    expect(row).toEqual({plan:"pro",status:"active"});
    expect((await db.query<{count:number}>("select count(*)::integer as count from private.billing_webhook_events where provider='lemonsqueezy'")).rows[0].count).toBeGreaterThanOrEqual(2);
  } finally { await db.exec("reset role"); }
});

test("lifetime and monthly grants coexist; refunding Lifetime preserves the subscription",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.exec("set role service_role");
  try {
    const purchased=new Date(Date.now()-60_000).toISOString();
    expect((await db.query<{value:boolean}>(`select public.process_lifetime_order(
      'order_created:life-1','order_created',$1,$2,'customer-life','order-life','paid'
    ) as value`,[purchased,owner])).rows[0].value).toBe(true);
    expect((await db.query<{value:boolean}>(`select public.process_lifetime_order(
      'order_created:life-1','order_created',$1,$2,'customer-life','order-life','paid'
    ) as value`,[purchased,owner])).rows[0].value).toBe(false);

    await db.query(`select public.process_billing_event(
      'lemonsqueezy','subscription_delayed','subscription_updated',now(),$1,
      'customer-life','subscription-monthly','premium','monthly','active',now(),now()+interval '1 month',false
    )`,[owner]);
    expect((await db.query<{count:number}>("select count(*)::integer count from private.access_grants where user_id=$1 and status='active'",[owner])).rows[0].count).toBe(2);
    await db.query(`select public.process_lifetime_order(
      'order_refunded:life-1','order_refunded',now(),$1,'customer-life','order-life','refunded'
    )`,[owner]);
    expect((await db.query<{count:number}>("select count(*)::integer count from private.access_grants where user_id=$1 and status='active'",[owner])).rows[0].count).toBe(1);
    await db.query(`select public.process_lifetime_order(
      'order_created:life-2','order_created',now(),$1,'customer-life','order-life-2','paid'
    )`,[owner]);
    expect((await db.query<{value:boolean}>("select public.revoke_purchase_access('lemonsqueezy','order-life-2','chargeback',now()) value")).rows[0].value).toBe(true);
    expect((await db.query<{value:boolean}>("select public.revoke_purchase_access('lemonsqueezy','order-life-2','chargeback',now()) value")).rows[0].value).toBe(false);
    expect((await db.query<{count:number}>("select count(*)::integer count from private.access_grants where user_id=$1 and status='active'",[owner])).rows[0].count).toBe(1);
    await db.exec("reset role");
    expect((await db.query<{code:string}>("select private.effective_plan_code($1) as code",[owner])).rows[0].code).toBe("premium");
  } finally { await db.exec("reset role"); }
});

test("verified lifecycle events renew, change plan, schedule cancellation and preserve payment-failure grace",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  const subscription=(id:string,occurred:string,plan:string,period:string,status:string,cancel=false)=>db.query<{value:boolean}>(`
    select public.process_billing_event(
      'lemonsqueezy',$1,'subscription.updated',$2,$3,'ls_customer_lifecycle','ls_subscription_lifecycle',$4,$5,$6,
      $2,$2::timestamptz+case when $5='annual' then interval '1 year' else interval '1 month' end,$7
    ) as value`,[id,occurred,owner,plan,period,status,cancel]);
  await db.exec("set role service_role");
  try {
    const created=new Date(Date.now()-180_000).toISOString();
    const upgraded=new Date(Date.now()-120_000).toISOString();
    const renewed=new Date(Date.now()-60_000).toISOString();
    expect((await subscription("evt_plus_created",created,"plus","monthly","active")).rows[0].value).toBe(true);
    expect((await subscription("evt_pro_upgrade",upgraded,"pro","annual","active")).rows[0].value).toBe(true);
    expect((await subscription("evt_pro_renewed",renewed,"pro","annual","active",true)).rows[0].value).toBe(true);
    let row=(await db.query<{plan:string;billing_period:string;status:string;cancel_at_period_end:boolean}>(
      "select plan,billing_period,status,cancel_at_period_end from private.subscriptions where user_id=$1",[owner])).rows[0];
    expect(row).toEqual({plan:"pro",billing_period:"annual",status:"active",cancel_at_period_end:true});

    expect((await db.query<{value:boolean}>(`
      select public.process_billing_event(
        'lemonsqueezy','evt_payment_failed','subscription_payment_failed',now(),null,null,'ls_subscription_lifecycle'
      ) as value`)).rows[0].value).toBe(true);
    row=(await db.query<{plan:string;billing_period:string;status:string;cancel_at_period_end:boolean}>(
      "select plan,billing_period,status,cancel_at_period_end from private.subscriptions where user_id=$1",[owner])).rows[0];
    expect(row.status).toBe("past_due");
    expect((await db.query<{active:boolean}>(
      "select grace_until>now() as active from private.subscriptions where user_id=$1",[owner])).rows[0].active).toBe(true);
  } finally { await db.exec("reset role"); }
});

test("authenticated clients cannot mutate subscriptions or call the billing writer",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await asUser(owner,async()=>{
    await expect(db.query(`select public.process_billing_event(
      'lemonsqueezy','evt_attack','subscription.updated',now(),$1,'ls_customer_attack','ls_subscription_attack','pro','annual','active',now(),now()+interval '1 year',false
    )`,[owner])).rejects.toThrow();
    await expect(db.query("insert into private.subscriptions(user_id,provider,plan,status) values($1,'manual','pro','active')",[owner])).rejects.toThrow();
  });
});

test("AI speech grants the same 25,000-character UTC allowance to every Premium source",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]); await addBooks(owner,1,100);
  const book=(await db.query<{book_id:string}>("select book_id from public.user_books where user_id=$1",[owner])).rows[0].book_id;
  await db.exec("set role service_role");
  try {
    await expect(db.query("select public.reserve_ai_speech($1,$2,$3,$3,'page-1','Lucia','es-ES',1,120,10,160,10000000,90)",[owner,book,"a".repeat(64)])).rejects.toThrow("subscription_required");
    await db.query(`insert into private.subscriptions(user_id,provider,plan,status,billing_period,current_period_start,current_period_end)
      values($1,'manual','plus','active','annual',now()-interval '2 months',now()+interval '10 months')`,[owner]);
    let usage=(await db.query<{value:{includedCharacters:number;remainingCharacters:number} }>("select public.ai_speech_usage_for_user($1,10000000) as value",[owner])).rows[0].value;
    expect(usage.includedCharacters).toBe(25000); expect(usage.remainingCharacters).toBe(25000);
    await db.query("update private.subscriptions set plan='pro' where user_id=$1",[owner]);
    usage=(await db.query<{value:{includedCharacters:number;remainingCharacters:number} }>("select public.ai_speech_usage_for_user($1,10000000) as value",[owner])).rows[0].value;
    expect(usage.includedCharacters).toBe(25000);
  } finally { await db.exec("reset role"); }
});

test("AI speech reservations are idempotent, atomic and release user quota after failure",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]); await addBooks(owner,1,100);
  const book=(await db.query<{book_id:string}>("select book_id from public.user_books where user_id=$1",[owner])).rows[0].book_id;
  await db.query(`insert into private.subscriptions(user_id,provider,plan,status,billing_period,current_period_start,current_period_end)
    values($1,'manual','plus','active','monthly',now(),now()+interval '1 month')`,[owner]);
  await db.exec("set role service_role");
  try {
    const key="b".repeat(64),args=[owner,book,key,"c".repeat(64),"page-1","Lucia","es-ES",1,3000,250,48000,10000000,90];
    const first=(await db.query<{value:{outcome:string;generationId:string} }>("select public.reserve_ai_speech($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as value",args)).rows[0].value;
    const repeat=(await db.query<{value:{outcome:string;generationId:string} }>("select public.reserve_ai_speech($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as value",args)).rows[0].value;
    expect(first.outcome).toBe("reserved"); expect(repeat).toEqual({outcome:"pending",generationId:first.generationId});
    expect((await db.query<{count:number}>("select count(*)::integer as count from private.ai_speech_generations where user_id=$1",[owner])).rows[0].count).toBe(1);
    await db.query("select public.fail_ai_speech($1,$2,'provider_unavailable',false)",[owner,first.generationId]);
    const usage=(await db.query<{value:{usedCharacters:number} }>("select public.ai_speech_usage_for_user($1,10000000) as value",[owner])).rows[0].value;
    expect(usage.usedCharacters).toBe(0);
  } finally { await db.exec("reset role"); }
});

test("AI speech global budget pauses new generation and clients cannot mutate accounting",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]); await addBooks(owner,1,100);
  const book=(await db.query<{book_id:string}>("select book_id from public.user_books where user_id=$1",[owner])).rows[0].book_id;
  await db.query(`insert into private.subscriptions(user_id,provider,plan,status,billing_period,current_period_start,current_period_end)
    values($1,'manual','pro','active','monthly',now(),now()+interval '1 month')`,[owner]);
  await db.exec("set role service_role");
  try {
    expect(Number((await db.query<{value:number}>(
      "select public.effective_service_budget('amazon_polly_neural',20000000) value"
    )).rows[0].value)).toBe(10000000);
    expect(Number((await db.query<{value:number}>(
      "select public.effective_service_budget('deepl',5000000) value"
    )).rows[0].value)).toBe(0);
    const first=(await db.query<{value:{generationId:string} }>("select public.reserve_ai_speech($1,$2,$3,$4,'page-1','Lucia','es-ES',1,10,1,100,100,90) as value",[owner,book,"d".repeat(64),"e".repeat(64)])).rows[0].value;
    await db.query("select public.mark_ai_speech_generating($1,$2)",[owner,first.generationId]);
    await db.query("select public.complete_ai_speech($1,$2,$3,null)",[owner,first.generationId,`ai-speech/${owner}/${book}/${"d".repeat(64)}.mp3`]);
    const blocked=(await db.query<{value:{outcome:string}}>(
      "select public.reserve_ai_speech($1,$2,$3,$4,'page-2','Lucia','es-ES',1,10,1,1,100,90) as value",
      [owner,book,"f".repeat(64),"1".repeat(64)])).rows[0].value;
    expect(blocked).toEqual({outcome:"budget_exhausted"});
    expect((await db.query<{count:number}>(
      "select count(*)::integer count from private.ai_speech_admin_alerts where kind='budget_100'"
    )).rows[0].count).toBeGreaterThan(0);
  } finally { await db.exec("reset role"); }
  await asUser(owner,async()=>{
    await expect(db.query("select * from private.ai_speech_generations")).rejects.toThrow();
    await expect(db.query("select public.fail_ai_speech($1,$2,'tamper',false)",[owner,randomUUID()])).rejects.toThrow();
  });
});

test("DeepL enforces Free quota atomically against fresh provider and lifetime ceilings",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.exec("set role service_role");
  try {
    await db.query("select public.record_deepl_provider_usage(0,500000,null,null,now())");
    const id=(await db.query<{value:string}>(
      "select public.reserve_deepl_translation($1,1000,$2,250000,1000000,0) value",
      [owner,"2".repeat(64)])).rows[0].value;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const usage=(await db.query<{value:{plan:string;includedCharacters:number;usedCharacters:number;remainingCharacters:number;providerUsageVerified:boolean}}>(
      "select public.translation_usage_for_user($1) value",[owner])).rows[0].value;
    expect(usage).toMatchObject({plan:"free",includedCharacters:2000,usedCharacters:1000,remainingCharacters:1000,providerUsageVerified:true});
    await expect(db.query(
      "select public.reserve_deepl_translation($1,1001,$2,250000,1000000,0)",
      [owner,"3".repeat(64)])).rejects.toThrow("translation_quota");
    expect((await db.query<{enabled:boolean}>("select tier_limits_enabled enabled from private.service_quota_config where service='deepl'")).rows[0].enabled).toBe(true);
    expect((await db.query<{value:boolean}>(
      "select public.finalize_deepl_translation($1,$2,'succeeded',null,'trace-1') value",
      [owner,id])).rows[0].value).toBe(true);
  } finally { await db.exec("reset role"); }
  await asUser(owner,async()=>{
    await expect(db.query("update private.service_quota_config set tier_limits_enabled=true where service='deepl'")).rejects.toThrow();
  });
});

test("DeepL blocks conservatively when provider usage is stale or lifetime capacity is exhausted",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.exec("set role service_role");
  try {
    await db.query("select public.record_deepl_provider_usage(499999,500000,null,null,now())");
    const providerBlocked=(await db.query<{value:string}>(
      "select public.reserve_deepl_translation($1,2,$2,250000,1000000,0) value",
      [owner,"4".repeat(64)])).rows[0].value;
    expect(providerBlocked).toBe("quota_exceeded");
    await db.query("select public.record_deepl_provider_usage(0,500000,null,null,now())");
    const lifetimeBlocked=(await db.query<{value:string}>(
      "select public.reserve_deepl_translation($1,2,$2,250000,1000000,999999) value",
      [owner,"5".repeat(64)])).rows[0].value;
    expect(lifetimeBlocked).toBe("quota_exceeded");
    await db.query("update private.provider_usage_snapshots set fetched_at=now()-interval '16 minutes' where service='deepl'");
    await expect(db.query(
      "select public.reserve_deepl_translation($1,1,$2,250000,1000000,0)",
      [owner,"6".repeat(64)])).rejects.toThrow("provider_usage_unverified");
    expect((await db.query<{count:number}>(
      "select count(*)::integer count from private.service_consumption_alerts where service='deepl' and threshold=100"
    )).rows[0].count).toBeGreaterThanOrEqual(2);
  } finally { await db.exec("reset role"); }
});

test("Lifetime partial refunds are review-only; full refunds revoke only that purchase",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.query(`insert into private.subscriptions(user_id,provider,provider_subscription_id,plan,status,billing_period,current_period_end)
    values($1,'manual','other-valid-right','premium','active','monthly',now()+interval '1 month')`,[owner]);
  await db.exec("set role service_role");
  try {
    const created=new Date(Date.now()-120000).toISOString();
    expect((await db.query<{value:boolean}>(`select public.process_lifetime_order_v2(
      'life-v2-create','order_created',$1,$2,'customer-v2','order-v2','paid',null,null,null) value`,
      [created,owner])).rows[0].value).toBe(true);
    expect((await db.query<{value:boolean}>(`select public.process_lifetime_order_v2(
      'life-v2-partial','order_refunded',now(),null,'customer-v2','order-v2','refunded','partial',2000,11999) value`
    )).rows[0].value).toBe(true);
    let purchase=(await db.query<{status:string}>(
      "select status from private.purchases where provider_order_id='order-v2'"
    )).rows[0];
    expect(purchase.status).toBe("paid");
    expect((await db.query<{review_status:string}>(
      "select review_status from private.billing_adjustments where provider_event_id='life-v2-partial'"
    )).rows[0].review_status).toBe("review_required");
    expect((await db.query<{value:boolean}>(`select public.process_lifetime_order_v2(
      'life-v2-full','order_refunded',now(),null,'customer-v2','order-v2','refunded','full',11999,11999) value`
    )).rows[0].value).toBe(true);
    purchase=(await db.query<{status:string}>(
      "select status from private.purchases where provider_order_id='order-v2'"
    )).rows[0];
    expect(purchase.status).toBe("refunded");
    expect((await db.query<{count:number}>(
      "select count(*)::integer count from private.access_grants where user_id=$1 and status='active'",
      [owner])).rows[0].count).toBe(1);
    expect((await db.query<{value:boolean}>(`select public.process_lifetime_order_v2(
      'life-v2-full','order_refunded',now(),null,'customer-v2','order-v2','refunded','full',11999,11999) value`
    )).rows[0].value).toBe(false);
  } finally { await db.exec("reset role"); }
});

test("Disputes are idempotent and losing then winning restores only the affected Lifetime right",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await db.exec("set role service_role");
  try {
    const opened=new Date(Date.now()-120000).toISOString();
    const lost=new Date(Date.now()-60000).toISOString();
    const won=new Date().toISOString();
    await db.query(`select public.process_lifetime_order_v2(
      'dispute-create','order_created',$2,$1,'customer-dispute','order-dispute','paid',null,null,null)`,[owner,opened]);
    expect((await db.query<{value:boolean}>(`select public.record_purchase_dispute(
      'lemonsqueezy','order-dispute','dispute-open','opened',$1,'case-123') value`,[opened])).rows[0].value).toBe(true);
    expect((await db.query<{value:boolean}>(`select public.record_purchase_dispute(
      'lemonsqueezy','order-dispute','dispute-lost','lost',$1,'decision-456') value`,[lost])).rows[0].value).toBe(true);
    expect((await db.query<{count:number}>(
      "select count(*)::integer count from private.access_grants where user_id=$1 and status='active'",
      [owner])).rows[0].count).toBe(0);
    expect((await db.query<{value:boolean}>(`select public.record_purchase_dispute(
      'lemonsqueezy','order-dispute','dispute-won','won',$1,'decision-789') value`,[won])).rows[0].value).toBe(true);
    expect((await db.query<{count:number}>(
      "select count(*)::integer count from private.access_grants where user_id=$1 and status='active'",
      [owner])).rows[0].count).toBe(1);
    expect((await db.query<{value:boolean}>(`select public.record_purchase_dispute(
      'lemonsqueezy','order-dispute','dispute-won','won',$1,'decision-789') value`,[won])).rows[0].value).toBe(false);
    expect((await db.query<{value:boolean}>(`select public.record_purchase_dispute(
      'lemonsqueezy','order-dispute','dispute-stale-loss','lost',$1,'old-decision') value`,[lost])).rows[0].value).toBe(true);
    expect((await db.query<{status:string;dispute_status:string}>(
      "select status,dispute_status from private.purchases where provider_order_id='order-dispute'"
    )).rows[0]).toEqual({status:"paid",dispute_status:"won"});
  } finally { await db.exec("reset role"); }
});

test("R2 orphan collection remains a dry run and excludes active references",async()=>{
  const owner=randomUUID(); await db.query("insert into auth.users(id) values($1)",[owner]);
  await addBooks(owner,2,321);
  const books=(await db.query<{book_id:string}>("select book_id from public.user_books where user_id=$1 order by book_id",[owner])).rows;
  await db.query("update public.user_books set deleted_at=now() where user_id=$1 and book_id=$2",[owner,books[0].book_id]);
  await db.exec("set role service_role");
  try {
    const preview=(await db.query<{value:{dryRun:boolean;physicalDeletes:number;items:Array<{bookId:string}>}}>(
      "select public.preview_r2_orphan_collection(500) value"
    )).rows[0].value;
    expect(preview.dryRun).toBe(true);
    expect(preview.physicalDeletes).toBe(0);
    expect(preview.items.some(item=>item.bookId===books[0].book_id)).toBe(true);
    expect(preview.items.some(item=>item.bookId===books[1].book_id)).toBe(false);
    expect((await db.query<{count:number}>("select count(*)::integer count from private.book_files where book_id=$1",[books[0].book_id])).rows[0].count).toBe(1);
  } finally { await db.exec("reset role"); }
});
