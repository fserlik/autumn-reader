begin;

-- Operator-owned product configuration. No client can write entitlements.
create table private.plan_catalog (
  code text primary key check (code in ('free','plus','pro')),
  monthly_usd_cents integer not null check (monthly_usd_cents >= 0),
  annual_usd_cents integer check (annual_usd_cents >= 0),
  cloud_bytes bigint not null check (cloud_bytes > 0),
  max_devices integer check (max_devices > 0),
  advanced_themes boolean not null,
  advanced_stats boolean not null,
  translation_tier text not null check (translation_tier in ('very_limited','standard','high')),
  premium_tts_tier text not null check (premium_tts_tier in ('none','limited','full'))
);
insert into private.plan_catalog values
  ('free',0,null,1073741824,2,false,false,'very_limited','none'),
  ('plus',499,3999,26843545600,null,true,true,'standard','limited'),
  ('pro',999,7999,107374182400,null,true,true,'high','full');
alter table private.plan_catalog enable row level security;
revoke all on private.plan_catalog from public,anon,authenticated;
grant select,insert,update,delete on private.plan_catalog to service_role;

-- Billing integrations will write this table server-side only. An absent or
-- inactive row is Free; no existing user needs a destructive data migration.
create table private.account_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null references private.plan_catalog(code) check (plan_code <> 'free'),
  status text not null check (status in ('trialing','active','past_due','canceled','expired','pending')),
  billing_cycle text check (billing_cycle in ('monthly','annual')),
  provider text,
  external_subscription_id text,
  starts_at timestamptz not null default now(),
  renews_at timestamptz,
  expires_at timestamptz,
  grace_until timestamptz,
  updated_at timestamptz not null default now(),
  check ((provider is null and external_subscription_id is null) or
         (provider is not null and external_subscription_id is not null))
);
create unique index account_subscription_external on private.account_subscriptions(provider,external_subscription_id)
  where external_subscription_id is not null;
alter table private.account_subscriptions enable row level security;
revoke all on private.account_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on private.account_subscriptions to service_role;

create function private.effective_plan_code(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce((select s.plan_code from private.account_subscriptions s
    where s.user_id=p_user and (
      (s.status in ('active','trialing') and (s.expires_at is null or s.expires_at>now()))
      or (s.status='canceled' and s.expires_at>now())
      or (s.status='past_due' and s.grace_until>now())
    )), 'free')
$$;
revoke all on function private.effective_plan_code(uuid) from public,anon,authenticated;

create function public.plan_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by case p.code when 'free' then 0 when 'plus' then 1 else 2 end),'[]'::jsonb)
  from private.plan_catalog p where auth.uid() is not null
$$;
revoke all on function public.plan_catalog() from public,anon;
grant execute on function public.plan_catalog() to authenticated;

create table private.account_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  device_secret_hash text not null,
  session_id text not null,
  platform text not null check (platform in ('android','windows','linux','macos','web','other')),
  display_name text not null check (length(display_name) between 1 and 80),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id,device_id)
);
create index account_devices_active on private.account_devices(user_id) where revoked_at is null;
alter table private.account_devices enable row level security;
revoke all on private.account_devices from public,anon,authenticated;
grant select,insert,update,delete on private.account_devices to service_role;

-- The profile lock serializes concurrent first use from multiple devices.
create function public.register_device(p_device uuid,p_secret text,p_platform text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_session text:=auth.jwt()->>'session_id';
  v_limit integer; v_count integer; v_existing private.account_devices; v_secret_hash text;
begin
  if v_user is null or v_session is null or p_device is null or coalesce(p_secret !~ '^[0-9a-f-]{36}$',true)
    or coalesce(p_platform not in ('android','windows','linux','macos','web','other'),true)
    or coalesce(length(btrim(p_name)),0) not between 1 and 80 then raise exception 'invalid_device'; end if;
  v_secret_hash:=encode(sha256(convert_to(p_secret,'UTF8')),'hex');
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'forbidden'; end if;
  select max_devices into v_limit from private.plan_catalog where code=private.effective_plan_code(v_user);
  select * into v_existing from private.account_devices where user_id=v_user and device_id=p_device for update;
  select count(*) into v_count from private.account_devices where user_id=v_user and revoked_at is null;
  if v_existing.revoked_at is null and v_existing.device_id is not null then
    if v_existing.device_secret_hash<>v_secret_hash then raise exception 'device_mismatch' using errcode='42501'; end if;
    update private.account_devices set last_seen_at=now(),session_id=v_session,
      platform=p_platform,display_name=btrim(p_name)
      where user_id=v_user and device_id=p_device;
    return jsonb_build_object('allowed',v_limit is null or v_count<=v_limit,
      'active_devices',v_count,'max_devices',v_limit);
  end if;
  if v_limit is not null and v_count>=v_limit then
    return jsonb_build_object('allowed',false,'active_devices',v_count,'max_devices',v_limit);
  end if;
  insert into private.account_devices(user_id,device_id,device_secret_hash,session_id,platform,display_name)
    values(v_user,p_device,v_secret_hash,v_session,p_platform,btrim(p_name))
    on conflict(user_id,device_id) do update set revoked_at=null,last_seen_at=now(),
      device_secret_hash=excluded.device_secret_hash,session_id=excluded.session_id,
      platform=excluded.platform,display_name=excluded.display_name;
  return jsonb_build_object('allowed',true,'active_devices',v_count+1,'max_devices',v_limit);
end $$;
revoke all on function public.register_device(uuid,text,text,text) from public,anon;
grant execute on function public.register_device(uuid,text,text,text) to authenticated;

create function public.account_devices() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('device_id',d.device_id,'platform',d.platform,
    'display_name',d.display_name,'first_seen_at',d.first_seen_at,'last_seen_at',d.last_seen_at)
    order by d.last_seen_at desc),'[]'::jsonb)
  from private.account_devices d where d.user_id=auth.uid() and d.revoked_at is null
$$;
revoke all on function public.account_devices() from public,anon;
grant execute on function public.account_devices() to authenticated;

create function public.remove_account_device(p_device uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_removed integer;
begin
  if v_user is null or p_device is null then raise exception 'forbidden'; end if;
  perform 1 from public.profiles where id=v_user for update;
  update private.account_devices set revoked_at=now() where user_id=v_user and device_id=p_device
    and revoked_at is null;
  get diagnostics v_removed=row_count;
  return jsonb_build_object('removed',v_removed>0);
end $$;
revoke all on function public.remove_account_device(uuid) from public,anon;
grant execute on function public.remove_account_device(uuid) to authenticated;

-- The Edge Function uses the user identity verified by Supabase Auth. A
-- claimed device must also be registered for that same account.
create function public.device_session_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.account_devices d where d.user_id=auth.uid()
    and d.session_id=auth.jwt()->>'session_id' and d.revoked_at is null)
    and exists(select 1 from private.plan_catalog p where p.code=private.effective_plan_code(auth.uid())
      and (p.max_devices is null or
        (select count(*) from private.account_devices d where d.user_id=auth.uid() and d.revoked_at is null)<=p.max_devices))
$$;
revoke all on function public.device_session_allowed() from public,anon;
grant execute on function public.device_session_allowed() to authenticated;

create function public.authorize_account_device(p_user uuid,p_session text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.account_devices d where d.user_id=p_user
    and d.session_id=p_session and d.revoked_at is null)
    and exists(select 1 from private.plan_catalog p where p.code=private.effective_plan_code(p_user)
      and (p.max_devices is null or
        (select count(*) from private.account_devices d where d.user_id=p_user and d.revoked_at is null)<=p.max_devices))
$$;
revoke all on function public.authorize_account_device(uuid,text) from public,anon,authenticated;
grant execute on function public.authorize_account_device(uuid,text) to service_role;

create function public.account_plan() returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(p) || jsonb_build_object('subscription_status',coalesce(s.status,'free'),
    'billing_cycle',s.billing_cycle,'starts_at',s.starts_at,'renews_at',s.renews_at,
    'expires_at',s.expires_at,'grace_until',s.grace_until,
    'active_devices',(select count(*) from private.account_devices d where d.user_id=auth.uid() and d.revoked_at is null))
  from private.plan_catalog p left join private.account_subscriptions s on s.user_id=auth.uid()
  where auth.uid() is not null and p.code=private.effective_plan_code(auth.uid())
$$;
revoke all on function public.account_plan() from public,anon;
grant execute on function public.account_plan() to authenticated;

-- Preserve informational book counts, but neither expose nor enforce a book cap.
create or replace function public.library_quota() returns jsonb
language sql security definer set search_path='' as $$
  select private.upload_quota_snapshot(auth.uid()) || jsonb_build_object(
    'max_bytes',p.cloud_bytes,'plan',p.code,'max_pending_uploads',3)
  from private.plan_catalog p where auth.uid() is not null and p.code=private.effective_plan_code(auth.uid())
$$;
revoke all on function public.library_quota() from public,anon;
grant execute on function public.library_quota() to authenticated;

create or replace function private.enforce_library_quota() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_limit bigint; v_used bigint; v_added bigint;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op='UPDATE' and old.deleted_at is null then return new; end if;
  perform 1 from public.profiles where id=new.user_id for update;
  select cloud_bytes into v_limit from private.plan_catalog where code=private.effective_plan_code(new.user_id);
  select coalesce(sum(f.file_size),0) into v_used
    from public.user_books u join private.book_files f on f.book_id=u.book_id
    where u.user_id=new.user_id and u.deleted_at is null and u.book_id<>new.book_id;
  select file_size into v_added from private.book_files where book_id=new.book_id;
  if v_used+coalesce(v_added,0)>v_limit then raise exception 'storage_limit'; end if;
  return new;
end $$;
revoke all on function private.enforce_library_quota() from public,anon,authenticated;

create or replace function public.reserve_book_upload(
  p_user uuid,p_hash text,p_format text,p_size bigint,p_title text,p_author text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid(); v_owned uuid; v_existing private.upload_intents;
  usage jsonb; decision_details jsonb; v_limit bigint; v_recent_same boolean;
  v_new_reserved_bytes bigint;
begin
  if p_hash !~ '^[a-f0-9]{64}$' or p_format not in ('pdf','epub')
    or p_size not between 1 and 33554432 or length(btrim(p_title)) not between 1 and 500
    or length(p_author)>300 then raise exception 'invalid_format'; end if;
  perform 1 from public.profiles where id=p_user for update;
  if not found then raise exception 'forbidden'; end if;
  delete from private.upload_intents where user_id=p_user and completed_at is null
    and expires_at<now()-interval '1 day';
  select f.book_id into v_owned from private.book_files f join public.user_books u on u.book_id=f.book_id
    where f.file_hash=p_hash and f.format=p_format and u.user_id=p_user and u.deleted_at is null;
  if v_owned is not null then return jsonb_build_object('book_id',v_owned,'owned',true); end if;
  select * into v_existing from private.upload_intents i
    where i.user_id=p_user and i.file_hash=p_hash and i.format=p_format
      and i.file_size=p_size and i.completed_at is null
    order by (i.expires_at>now()) desc,i.created_at desc limit 1 for update;
  select cloud_bytes into v_limit from private.plan_catalog where code=private.effective_plan_code(p_user);
  usage:=private.upload_quota_snapshot(p_user);
  decision_details:=usage||jsonb_build_object('requested_bytes',p_size,
    'max_bytes',v_limit,'max_pending_uploads',3);
  -- A retry has already reserved its bytes, but a downgrade may make the
  -- account over quota. Do not allocate additional storage in that case.
  v_new_reserved_bytes:=p_size;
  if v_existing.id is not null and v_existing.expires_at>now() then v_new_reserved_bytes:=0; end if;
  if (usage->>'used_bytes')::bigint+(usage->>'reserved_bytes')::bigint+v_new_reserved_bytes>v_limit
    then raise exception 'storage_limit' using detail=decision_details::text; end if;
  if v_existing.id is not null and v_existing.expires_at>now() then
    update private.upload_intents set expires_at=greatest(expires_at,now()+interval '15 minutes'),
      last_prepared_at=now() where id=v_existing.id returning * into v_existing;
    return to_jsonb(v_existing);
  end if;
  if (usage->>'active_pending_uploads')::bigint>=3
    then raise exception 'pending_upload_limit' using detail=decision_details::text; end if;
  select exists(select 1 from private.upload_intents where user_id=p_user
    and file_hash=p_hash and format=p_format and file_size=p_size
    and coalesce(last_prepared_at,created_at)>now()-interval '1 hour') into v_recent_same;
  if (usage->>'recent_unique_uploads')::bigint>=60 and not v_recent_same
    then raise exception 'upload_rate_limited' using detail=decision_details::text; end if;
  if v_existing.id is not null then
    update private.upload_intents set expires_at=now()+interval '15 minutes',last_prepared_at=now()
      where id=v_existing.id returning * into v_existing;
  else
    insert into private.upload_intents(id,user_id,file_hash,format,file_size,title,author,staging_key)
      values(v_id,p_user,p_hash,p_format,p_size,p_title,p_author,'staging/'||p_user::text||'/'||v_id::text)
      returning * into v_existing;
  end if;
  return to_jsonb(v_existing);
end $$;
revoke all on function public.reserve_book_upload(uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.reserve_book_upload(uuid,text,text,bigint,text,text) to service_role;

create or replace function public.remove_cloud_book(p_user uuid,p_book uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare relation public.user_books; file private.book_files; remaining bigint;
  cancelled jsonb; usage jsonb; v_limit bigint;
begin
  perform 1 from public.profiles where id=p_user for update;
  if not found then raise exception 'forbidden'; end if;
  select * into relation from public.user_books where user_id=p_user and book_id=p_book for update;
  if not found then raise exception 'forbidden'; end if;
  select * into file from private.book_files where book_id=p_book;
  if not found then raise exception 'forbidden'; end if;
  if relation.deleted_at is null then
    update public.user_books set deleted_at=now(),updated_at=now()
      where user_id=p_user and book_id=p_book;
  end if;
  with removed as (delete from private.upload_intents
    where user_id=p_user and file_hash=file.file_hash and format=file.format
      and completed_at is null returning staging_key)
    select coalesce(jsonb_agg(staging_key),'[]'::jsonb) into cancelled from removed;
  select count(*) into remaining from public.user_books where book_id=p_book and deleted_at is null;
  usage:=private.upload_quota_snapshot(p_user);
  select cloud_bytes into v_limit from private.plan_catalog where code=private.effective_plan_code(p_user);
  return jsonb_build_object('removed',relation.deleted_at is null,'remaining_references',remaining,
    'cancelled_staging_keys',cancelled,'usage',usage||jsonb_build_object('max_bytes',v_limit));
end $$;
revoke all on function public.remove_cloud_book(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_cloud_book(uuid,uuid) to service_role;

-- Security-definer sync/list RPCs bypass table RLS, so guard them explicitly.
alter function public.sync_changes(jsonb) rename to sync_changes_before_devices;
alter function public.sync_changes_before_devices(jsonb) set schema private;
revoke all on function private.sync_changes_before_devices(jsonb) from public,anon,authenticated;
create function public.sync_changes(operations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.device_session_allowed() then raise exception 'device_limit' using errcode='42501'; end if;
  return private.sync_changes_before_devices(operations);
end $$;
revoke all on function public.sync_changes(jsonb) from public,anon;
grant execute on function public.sync_changes(jsonb) to authenticated;

alter function public.cloud_book_identities() rename to cloud_book_identities_before_devices;
alter function public.cloud_book_identities_before_devices() set schema private;
revoke all on function private.cloud_book_identities_before_devices() from public,anon,authenticated;
create function public.cloud_book_identities() returns table(book_id uuid,file_hash text,format text,file_size bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.device_session_allowed() then raise exception 'device_limit' using errcode='42501'; end if;
  return query select * from private.cloud_book_identities_before_devices();
end $$;
revoke all on function public.cloud_book_identities() from public,anon;
grant execute on function public.cloud_book_identities() to authenticated;

alter function public.cloud_storage_books(integer,integer,text) rename to cloud_storage_books_before_devices;
alter function public.cloud_storage_books_before_devices(integer,integer,text) set schema private;
revoke all on function private.cloud_storage_books_before_devices(integer,integer,text) from public,anon,authenticated;
create function public.cloud_storage_books(p_offset integer default 0,p_limit integer default 50,p_sort text default 'recent')
returns table(book_id uuid,title text,author text,file_size bigint,cover_path text,added_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.device_session_allowed() then raise exception 'device_limit' using errcode='42501'; end if;
  return query select * from private.cloud_storage_books_before_devices(p_offset,p_limit,p_sort);
end $$;
revoke all on function public.cloud_storage_books(integer,integer,text) from public,anon;
grant execute on function public.cloud_storage_books(integer,integer,text) to authenticated;

-- RLS still protects direct Data API requests, including older clients.
alter policy library_read on public.user_books using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy library_update on public.user_books using ((select auth.uid())=user_id and (select public.device_session_allowed()))
  with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy library_delete on public.user_books using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy progress_read on public.reading_progress using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy progress_insert on public.reading_progress with check ((select auth.uid())=user_id and (select public.device_session_allowed())
  and exists(select 1 from public.user_books u where u.user_id=reading_progress.user_id and u.book_id=reading_progress.book_id and u.deleted_at is null));
alter policy progress_update on public.reading_progress using ((select auth.uid())=user_id and (select public.device_session_allowed()))
  with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy progress_delete on public.reading_progress using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy notes_read on public.notes using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy notes_insert on public.notes with check ((select auth.uid())=user_id and (select public.device_session_allowed())
  and exists(select 1 from public.user_books u where u.user_id=notes.user_id and u.book_id=notes.book_id and u.deleted_at is null));
alter policy notes_update on public.notes using ((select auth.uid())=user_id and (select public.device_session_allowed()))
  with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy notes_delete on public.notes using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy folders_owner on public.library_folders using ((select auth.uid())=user_id and (select public.device_session_allowed()))
  with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy folder_books_owner on public.library_folder_books using ((select auth.uid())=user_id and (select public.device_session_allowed()))
  with check ((select auth.uid())=user_id and (select public.device_session_allowed()));

-- All runtime quota decisions now use plan_catalog.cloud_bytes.
drop table private.cloud_limits;
commit;
