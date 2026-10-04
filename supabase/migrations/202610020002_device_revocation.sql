-- Revocation is bound to the Supabase Auth session, not just the installation ID.
-- A token refresh keeps the same session_id and cannot revive a revoked device.
-- A deliberate new sign-in obtains a new session_id and may register again.
create table private.revoked_device_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  revoked_at timestamptz not null default now(),
  primary key(user_id,session_id)
);
alter table private.revoked_device_sessions enable row level security;
revoke all on private.revoked_device_sessions from public,anon,authenticated;
grant select,insert on private.revoked_device_sessions to service_role;
insert into private.revoked_device_sessions(user_id,session_id,revoked_at)
  select user_id,session_id,revoked_at from private.account_devices where revoked_at is not null
  on conflict do nothing;

create function private.device_session_revoked() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.revoked_device_sessions r
    where r.user_id=auth.uid() and r.session_id=auth.jwt()->>'session_id')
$$;
revoke all on function private.device_session_revoked() from public,anon,authenticated;

create or replace function public.device_session_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select not private.device_session_revoked()
    and exists(select 1 from private.account_devices d where d.user_id=auth.uid()
      and d.session_id=auth.jwt()->>'session_id' and d.revoked_at is null)
    and exists(select 1 from private.plan_catalog p where p.code=private.effective_plan_code(auth.uid())
      and (p.max_devices is null or
        (select count(*) from private.account_devices d where d.user_id=auth.uid() and d.revoked_at is null)<=p.max_devices))
$$;

create or replace function public.authorize_account_device(p_user uuid,p_session text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from private.revoked_device_sessions r
      where r.user_id=p_user and r.session_id=p_session)
    and exists(select 1 from private.account_devices d where d.user_id=p_user
      and d.session_id=p_session and d.revoked_at is null)
    and exists(select 1 from private.plan_catalog p where p.code=private.effective_plan_code(p_user)
      and (p.max_devices is null or
        (select count(*) from private.account_devices d where d.user_id=p_user and d.revoked_at is null)<=p.max_devices))
$$;

create or replace function public.register_device(p_device uuid,p_secret text,p_platform text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_session text:=auth.jwt()->>'session_id';
  v_limit integer; v_count integer; v_existing private.account_devices; v_secret_hash text;
begin
  if v_user is null or v_session is null or p_device is null or coalesce(p_secret !~ '^[0-9a-f-]{36}$',true)
    or coalesce(p_platform not in ('android','windows','linux','macos','web','other'),true)
    or coalesce(length(btrim(p_name)),0) not between 1 and 80 then raise exception 'invalid_device'; end if;
  if private.device_session_revoked() then raise exception 'device_revoked' using errcode='42501'; end if;
  v_secret_hash:=encode(sha256(convert_to(p_secret,'UTF8')),'hex');
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'forbidden'; end if;
  select max_devices into v_limit from private.plan_catalog where code=private.effective_plan_code(v_user);
  select * into v_existing from private.account_devices where user_id=v_user and device_id=p_device for update;
  select count(*) into v_count from private.account_devices where user_id=v_user and revoked_at is null;
  if v_existing.device_id is not null then
    if v_existing.device_secret_hash<>v_secret_hash then raise exception 'device_mismatch' using errcode='42501'; end if;
    if v_existing.revoked_at is not null and v_existing.session_id=v_session then
      raise exception 'device_revoked' using errcode='42501';
    end if;
    if v_existing.revoked_at is null then
      update private.account_devices set last_seen_at=now(),session_id=v_session,
        platform=p_platform,display_name=btrim(p_name)
        where user_id=v_user and device_id=p_device;
      return jsonb_build_object('allowed',v_limit is null or v_count<=v_limit,
        'active_devices',v_count,'max_devices',v_limit);
    end if;
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

-- Registry operations and account usage must not remain available through a
-- still-valid JWT after this device has been revoked.
create or replace function public.account_devices() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or auth.jwt()->>'session_id' is null or private.device_session_revoked() then
    raise exception 'device_revoked' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('device_id',d.device_id,'platform',d.platform,
    'display_name',d.display_name,'first_seen_at',d.first_seen_at,'last_seen_at',d.last_seen_at)
    order by d.last_seen_at desc),'[]'::jsonb)
    from private.account_devices d where d.user_id=auth.uid() and d.revoked_at is null);
end $$;

create or replace function public.remove_account_device(p_device uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_removed integer; v_session text;
begin
  if v_user is null or p_device is null or auth.jwt()->>'session_id' is null or private.device_session_revoked() then
    raise exception 'device_revoked' using errcode='42501';
  end if;
  perform 1 from public.profiles where id=v_user for update;
  update private.account_devices set revoked_at=now() where user_id=v_user and device_id=p_device
    and revoked_at is null returning session_id into v_session;
  get diagnostics v_removed=row_count;
  if v_removed>0 then
    insert into private.revoked_device_sessions(user_id,session_id) values(v_user,v_session)
      on conflict do nothing;
  end if;
  return jsonb_build_object('removed',v_removed>0);
end $$;

create or replace function public.account_plan() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.device_session_allowed() then raise exception 'device_revoked' using errcode='42501'; end if;
  return (select to_jsonb(p) || jsonb_build_object('subscription_status',coalesce(s.status,'free'),
    'billing_cycle',s.billing_cycle,'starts_at',s.starts_at,'renews_at',s.renews_at,
    'expires_at',s.expires_at,'grace_until',s.grace_until,
    'active_devices',(select count(*) from private.account_devices d where d.user_id=auth.uid() and d.revoked_at is null))
    from private.plan_catalog p left join private.account_subscriptions s on s.user_id=auth.uid()
    where p.code=private.effective_plan_code(auth.uid()));
end $$;

create or replace function public.library_quota() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.device_session_allowed() then raise exception 'device_revoked' using errcode='42501'; end if;
  return (select private.upload_quota_snapshot(auth.uid()) || jsonb_build_object(
    'max_bytes',p.cloud_bytes,'plan',p.code,'max_pending_uploads',3)
    from private.plan_catalog p where p.code=private.effective_plan_code(auth.uid()));
end $$;

-- Existing social writes remain available as public reads, but a revoked
-- authenticated device must not mutate account-owned rows through Data API.
alter policy profiles_update on public.profiles using ((select auth.uid())=id and (select public.device_session_allowed()))
  with check ((select auth.uid())=id and (select public.device_session_allowed()));
alter policy reviews_insert on public.reviews with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy reviews_update on public.reviews using ((select auth.uid())=user_id and (select public.device_session_allowed()))
  with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy reviews_delete on public.reviews using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy likes_insert on public.review_likes with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy likes_delete on public.review_likes using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy comments_insert on public.review_comments with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy comments_update on public.review_comments using ((select auth.uid())=user_id and (select public.device_session_allowed()))
  with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy comments_delete on public.review_comments using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy follows_insert on public.follows with check ((select auth.uid())=follower_id and (select public.device_session_allowed()));
alter policy follows_delete on public.follows using ((select auth.uid())=follower_id and (select public.device_session_allowed()));
alter policy lists_insert on public.book_lists with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy lists_update on public.book_lists using ((select auth.uid())=user_id and (select public.device_session_allowed()))
  with check ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy lists_delete on public.book_lists using ((select auth.uid())=user_id and (select public.device_session_allowed()));
alter policy items_insert on public.book_list_items with check ((select public.device_session_allowed()) and exists(
  select 1 from public.book_lists l where l.id=list_id and l.user_id=(select auth.uid())));
alter policy items_delete on public.book_list_items using ((select public.device_session_allowed()) and exists(
  select 1 from public.book_lists l where l.id=list_id and l.user_id=(select auth.uid())));

-- This RPC is SECURITY DEFINER and writes reviews/catalog rows, bypassing RLS.
alter function public.publish_book_review(uuid,text,text,text,integer,text) rename to publish_book_review_before_devices;
alter function public.publish_book_review_before_devices(uuid,text,text,text,integer,text) set schema private;
revoke all on function private.publish_book_review_before_devices(uuid,text,text,text,integer,text) from public,anon,authenticated;
create function public.publish_book_review(
  p_book_id uuid,p_title text,p_author text,p_format text,p_rating integer,p_text text
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.device_session_allowed() then raise exception 'device_revoked' using errcode='42501'; end if;
  return private.publish_book_review_before_devices(p_book_id,p_title,p_author,p_format,p_rating,p_text);
end $$;
revoke all on function public.publish_book_review(uuid,text,text,text,integer,text) from public,anon;
grant execute on function public.publish_book_review(uuid,text,text,text,integer,text) to authenticated;
