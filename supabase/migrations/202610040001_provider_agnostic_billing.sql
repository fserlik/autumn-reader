begin;

-- Entitlements live in one operator-owned catalog. Billing providers only
-- select a plan; they never define product capabilities.
alter table private.plan_catalog
  add column sync_enabled boolean not null default true,
  add column offline_enabled boolean not null default true,
  add column notes_and_highlights_enabled boolean not null default true;

-- Keep legacy Store records for audit, but remove them from the operational
-- entitlement path. Microsoft Store is distribution-only from this migration.
create table private.legacy_billing_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  recorded_at timestamptz not null default now(),
  payload jsonb not null
);
alter table private.legacy_billing_records enable row level security;
revoke all on private.legacy_billing_records from public,anon,authenticated;
grant select,insert,update,delete on private.legacy_billing_records to service_role;

insert into private.legacy_billing_records(user_id,provider,payload)
select user_id,'microsoft_store',to_jsonb(s)
from private.account_subscriptions s where provider='microsoft_store';
delete from private.account_subscriptions where provider='microsoft_store';

drop function if exists public.sync_microsoft_store_subscription(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz);
drop function if exists public.expire_microsoft_store_subscription(uuid);

alter table private.account_subscriptions rename to subscriptions;
alter table private.subscriptions drop constraint account_subscriptions_pkey;
drop index if exists private.account_subscription_external;
alter table private.subscriptions
  rename column plan_code to plan;
alter table private.subscriptions
  rename column billing_cycle to billing_period;
alter table private.subscriptions
  rename column external_subscription_id to provider_subscription_id;
alter table private.subscriptions
  rename column starts_at to current_period_start;
alter table private.subscriptions
  rename column expires_at to current_period_end;

alter table private.subscriptions
  add column id uuid not null default gen_random_uuid(),
  add column provider_customer_id text,
  add column cancel_at_period_end boolean not null default false,
  add column created_at timestamptz not null default now(),
  add column provider_updated_at timestamptz not null default now();

-- Drop legacy constraints before normalizing existing rows.
-- Some existing rows become valid only under the new provider-agnostic rules.
alter table private.subscriptions
  drop constraint if exists account_subscriptions_status_check;
alter table private.subscriptions
  drop constraint if exists account_subscriptions_plan_code_check;
alter table private.subscriptions
  drop constraint if exists account_subscriptions_check;

update private.subscriptions
set provider=coalesce(provider,'manual'),
    status=case when status='pending' then 'expired' else status end,
    current_period_end=coalesce(renews_at,current_period_end),
    provider_updated_at=updated_at;

alter table private.subscriptions drop column renews_at;
alter table private.subscriptions alter column provider set not null;
alter table private.subscriptions add primary key(id);
alter table private.subscriptions
  add constraint subscriptions_user_unique unique(user_id),
  add constraint subscriptions_provider_check check(provider in ('paddle','google_play','apple','microsoft_store','manual')),
  add constraint subscriptions_plan_check check(plan in ('free','plus','pro')),
  add constraint subscriptions_status_check check(status in ('active','trialing','past_due','canceled','expired')),
  add constraint subscriptions_billing_period_check check(billing_period in ('monthly','annual') or billing_period is null),
  add constraint subscriptions_provider_identity_check check(
    (provider='manual') or
    (provider_customer_id is not null and provider_subscription_id is not null)
  );
create unique index subscriptions_provider_subscription_unique
  on private.subscriptions(provider,provider_subscription_id)
  where provider_subscription_id is not null;

create table private.billing_webhook_events (
  provider text not null check(provider in ('paddle','google_play','apple','microsoft_store','manual')),
  event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  processed_at timestamptz not null default now(),
  primary key(provider,event_id)
);
alter table private.billing_webhook_events enable row level security;
revoke all on private.billing_webhook_events from public,anon,authenticated;
grant select,insert,update,delete on private.billing_webhook_events to service_role;

create or replace function private.effective_plan_code(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce((select s.plan from private.subscriptions s
    where s.user_id=p_user and s.provider<>'microsoft_store' and (
      (s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end>now()))
      or (s.status='canceled' and s.current_period_end>now())
      or (s.status='past_due' and s.grace_until>now())
    )), 'free')
$$;
revoke all on function private.effective_plan_code(uuid) from public,anon,authenticated;

create function private.user_entitlements(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'plan',p.code,
    'cloudStorageBytes',p.cloud_bytes,
    'maxDevices',p.max_devices,
    'sync',p.sync_enabled,
    'offline',p.offline_enabled,
    'notesAndHighlights',p.notes_and_highlights_enabled,
    'advancedThemes',p.advanced_themes,
    'advancedStats',p.advanced_stats,
    'translationTier',p.translation_tier,
    'premiumTtsTier',p.premium_tts_tier,
    'subscriptionStatus',coalesce(s.status,'free'),
    'billingPeriod',s.billing_period,
    'currentPeriodStart',s.current_period_start,
    'currentPeriodEnd',s.current_period_end,
    'cancelAtPeriodEnd',coalesce(s.cancel_at_period_end,false),
    'provider',s.provider,
    'activeDevices',(select count(*) from private.account_devices d where d.user_id=p_user and d.revoked_at is null)
  )
  from private.plan_catalog p
  left join private.subscriptions s on s.user_id=p_user and s.provider<>'microsoft_store'
  where p.code=private.effective_plan_code(p_user)
$$;
revoke all on function private.user_entitlements(uuid) from public,anon,authenticated;

create function public.get_user_entitlements() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then return null; end if;
  if to_regclass('private.revoked_device_sessions') is not null and not public.device_session_allowed() then
    raise exception 'device_revoked' using errcode='42501';
  end if;
  return private.user_entitlements(auth.uid());
end
$$;
revoke all on function public.get_user_entitlements() from public,anon;
grant execute on function public.get_user_entitlements() to authenticated;

-- Compatibility for older clients. New clients use get_user_entitlements().
create or replace function public.account_plan() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then return null; end if;
  if to_regclass('private.revoked_device_sessions') is not null and not public.device_session_allowed() then
    raise exception 'device_revoked' using errcode='42501';
  end if;
  return (select to_jsonb(p) || jsonb_build_object(
    'subscription_status',coalesce(s.status,'free'),
    'billing_cycle',s.billing_period,
    'starts_at',s.current_period_start,
    'renews_at',case when not coalesce(s.cancel_at_period_end,false) then s.current_period_end end,
    'expires_at',s.current_period_end,
    'grace_until',s.grace_until,
    'active_devices',(select count(*) from private.account_devices d where d.user_id=auth.uid() and d.revoked_at is null))
  from private.plan_catalog p left join private.subscriptions s on s.user_id=auth.uid() and s.provider<>'microsoft_store'
  where p.code=private.effective_plan_code(auth.uid()));
end
$$;

create function public.billing_customer(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('provider',s.provider,'customerId',s.provider_customer_id,'subscriptionId',s.provider_subscription_id)
  from private.subscriptions s where s.user_id=p_user and s.provider='paddle'
$$;
revoke all on function public.billing_customer(uuid) from public,anon,authenticated;
grant execute on function public.billing_customer(uuid) to service_role;

-- Signature verification and payload normalization happen in the Edge
-- Function. This RPC makes deduplication and the subscription mutation one
-- database transaction and ignores stale, out-of-order provider events.
create function public.process_billing_event(
  p_provider text,p_event_id text,p_event_type text,p_occurred_at timestamptz,
  p_user uuid default null,p_provider_customer_id text default null,
  p_provider_subscription_id text default null,p_plan text default null,
  p_billing_period text default null,p_status text default null,
  p_current_period_start timestamptz default null,p_current_period_end timestamptz default null,
  p_cancel_at_period_end boolean default false
) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_inserted integer; v_user uuid:=p_user;
begin
  if p_provider not in ('paddle','google_play','apple','microsoft_store','manual')
    or coalesce(length(p_event_id),0) not between 3 and 200
    or coalesce(length(p_event_type),0) not between 3 and 120
    or p_occurred_at is null then raise exception 'invalid_billing_event'; end if;
  insert into private.billing_webhook_events(provider,event_id,event_type,occurred_at)
  values(p_provider,p_event_id,p_event_type,p_occurred_at)
  on conflict(provider,event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return false; end if;

  if p_event_type='transaction.payment_failed' then
    update private.subscriptions set status='past_due',
      grace_until=greatest(coalesce(current_period_end,now()),now()+interval '3 days'),
      updated_at=now(),provider_updated_at=p_occurred_at
    where provider=p_provider and provider_subscription_id=p_provider_subscription_id
      and provider_updated_at<=p_occurred_at and status not in ('canceled','expired');
    return true;
  end if;
  if p_event_type not like 'subscription.%' then return true; end if;
  if v_user is null and p_provider_subscription_id is not null then
    select user_id into v_user from private.subscriptions
      where provider=p_provider and provider_subscription_id=p_provider_subscription_id;
  end if;
  if v_user is null or p_plan not in ('plus','pro')
    or p_billing_period not in ('monthly','annual')
    or p_status not in ('active','trialing','past_due','canceled','expired')
    or coalesce(length(p_provider_customer_id),0) not between 3 and 200
    or coalesce(length(p_provider_subscription_id),0) not between 3 and 200 then
    raise exception 'invalid_subscription_event';
  end if;
  insert into private.subscriptions(
    user_id,provider,provider_customer_id,provider_subscription_id,plan,billing_period,status,
    current_period_start,current_period_end,cancel_at_period_end,grace_until,provider_updated_at,updated_at
  ) values(
    v_user,p_provider,p_provider_customer_id,p_provider_subscription_id,p_plan,p_billing_period,p_status,
    p_current_period_start,p_current_period_end,p_cancel_at_period_end,
    case when p_status='past_due' then greatest(coalesce(p_current_period_end,now()),now()+interval '3 days') end,
    p_occurred_at,now()
  ) on conflict(user_id) do update set
    provider=excluded.provider,provider_customer_id=excluded.provider_customer_id,
    provider_subscription_id=excluded.provider_subscription_id,plan=excluded.plan,
    billing_period=excluded.billing_period,status=excluded.status,
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,grace_until=excluded.grace_until,
    provider_updated_at=excluded.provider_updated_at,updated_at=now()
  where private.subscriptions.provider_updated_at<=excluded.provider_updated_at;
  return true;
end $$;
revoke all on function public.process_billing_event(text,text,text,timestamptz,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.process_billing_event(text,text,text,timestamptz,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) to service_role;

create function private.cloud_storage_limit(p_user uuid) returns bigint
language sql stable security definer set search_path='' as $$
  select (private.user_entitlements(p_user)->>'cloudStorageBytes')::bigint
$$;
revoke all on function private.cloud_storage_limit(uuid) from public,anon,authenticated;

create or replace function public.library_quota() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then return null; end if;
  if to_regclass('private.revoked_device_sessions') is not null and not public.device_session_allowed() then
    raise exception 'device_revoked' using errcode='42501';
  end if;
  return (select private.upload_quota_snapshot(auth.uid()) || jsonb_build_object(
    'max_bytes',private.cloud_storage_limit(auth.uid()),
    'plan',private.effective_plan_code(auth.uid()),'max_pending_uploads',3)
  );
end
$$;

-- Quota functions keep their existing concurrency locks and now consume the
-- centralized entitlement instead of reading provider/plan state directly.
create or replace function private.enforce_library_quota() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_limit bigint; v_used bigint; v_added bigint;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op='UPDATE' and old.deleted_at is null then return new; end if;
  perform 1 from public.profiles where id=new.user_id for update;
  v_limit:=private.cloud_storage_limit(new.user_id);
  select coalesce(sum(f.file_size),0) into v_used
    from public.user_books u join private.book_files f on f.book_id=u.book_id
    where u.user_id=new.user_id and u.deleted_at is null and u.book_id<>new.book_id;
  select file_size into v_added from private.book_files where book_id=new.book_id;
  if v_used+coalesce(v_added,0)>v_limit then raise exception 'storage_limit'; end if;
  return new;
end $$;

commit;
