begin;

-- Functional access is deliberately independent from the commercial product
-- that granted it. Both monthly and lifetime purchases resolve to Premium.
create table if not exists private.access_tiers (
  code text primary key check (code in ('free','premium')),
  cloud_bytes bigint not null check (cloud_bytes > 0),
  max_devices integer check (max_devices > 0),
  advanced_themes boolean not null,
  advanced_stats boolean not null,
  translation_monthly_characters integer not null check (translation_monthly_characters >= 0),
  cloud_tts_monthly_characters integer not null check (cloud_tts_monthly_characters >= 0),
  sync_enabled boolean not null default true,
  offline_enabled boolean not null default true,
  notes_and_highlights_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into private.access_tiers(
  code,cloud_bytes,max_devices,advanced_themes,advanced_stats,
  translation_monthly_characters,cloud_tts_monthly_characters
) values
  ('free',1073741824,2,false,false,2000,0),
  ('premium',26843545600,null,true,true,20000,25000)
on conflict(code) do update set
  cloud_bytes=excluded.cloud_bytes,
  max_devices=excluded.max_devices,
  advanced_themes=excluded.advanced_themes,
  advanced_stats=excluded.advanced_stats,
  translation_monthly_characters=excluded.translation_monthly_characters,
  cloud_tts_monthly_characters=excluded.cloud_tts_monthly_characters,
  sync_enabled=excluded.sync_enabled,
  offline_enabled=excluded.offline_enabled,
  notes_and_highlights_enabled=excluded.notes_and_highlights_enabled,
  updated_at=now();

alter table private.access_tiers enable row level security;
revoke all on private.access_tiers from public,anon,authenticated;
grant select,insert,update,delete on private.access_tiers to service_role;

create table if not exists private.commercial_offers (
  code text primary key check (code in ('premium_monthly','premium_lifetime')),
  tier_code text not null references private.access_tiers(code),
  purchase_type text not null check (purchase_type in ('monthly','lifetime')),
  price_usd_cents integer not null check (price_usd_cents >= 0),
  available boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Also makes a partially applied draft safe to rerun locally.
alter table private.commercial_offers drop constraint if exists commercial_offers_purchase_type_check;
update private.commercial_offers set purchase_type=case purchase_type
  when 'subscription' then 'monthly' when 'one_time' then 'lifetime' else purchase_type end;
alter table private.commercial_offers add constraint commercial_offers_purchase_type_check
  check (purchase_type in ('monthly','lifetime'));

insert into private.commercial_offers(code,tier_code,purchase_type,price_usd_cents) values
  ('premium_monthly','premium','monthly',599),
  ('premium_lifetime','premium','lifetime',11999)
on conflict(code) do update set
  tier_code=excluded.tier_code,
  purchase_type=excluded.purchase_type,
  price_usd_cents=excluded.price_usd_cents,
  available=excluded.available,
  updated_at=now();

alter table private.commercial_offers enable row level security;
revoke all on private.commercial_offers from public,anon,authenticated;
grant select,insert,update,delete on private.commercial_offers to service_role;

-- Keep the historical catalog for foreign keys and old transaction imports,
-- but add Premium so new subscriptions do not need an obsolete public name.
alter table private.plan_catalog drop constraint if exists plan_catalog_code_check;
alter table private.plan_catalog add constraint plan_catalog_code_check
  check (code in ('free','plus','pro','premium'));
alter table private.plan_catalog add column if not exists lifetime_usd_cents integer
  check (lifetime_usd_cents >= 0);

insert into private.plan_catalog(
  code,monthly_usd_cents,annual_usd_cents,cloud_bytes,max_devices,
  advanced_themes,advanced_stats,translation_tier,premium_tts_tier,
  sync_enabled,offline_enabled,notes_and_highlights_enabled,lifetime_usd_cents
) values(
  'premium',599,null,26843545600,null,true,true,'high','full',true,true,true,11999
)
on conflict(code) do update set
  monthly_usd_cents=excluded.monthly_usd_cents,
  annual_usd_cents=null,
  lifetime_usd_cents=excluded.lifetime_usd_cents,
  cloud_bytes=excluded.cloud_bytes,
  max_devices=excluded.max_devices,
  advanced_themes=excluded.advanced_themes,
  advanced_stats=excluded.advanced_stats,
  translation_tier=excluded.translation_tier,
  premium_tts_tier=excluded.premium_tts_tier,
  sync_enabled=excluded.sync_enabled,
  offline_enabled=excluded.offline_enabled,
  notes_and_highlights_enabled=excluded.notes_and_highlights_enabled;

alter table private.subscriptions drop constraint if exists subscriptions_user_unique;
alter table private.subscriptions drop constraint if exists subscriptions_plan_check;
alter table private.subscriptions add constraint subscriptions_plan_check
  check(plan in ('free','plus','pro','premium'));
alter table private.subscriptions drop constraint if exists subscriptions_billing_period_check;
alter table private.subscriptions add constraint subscriptions_billing_period_check
  check(billing_period in ('monthly','annual') or billing_period is null);
alter table private.subscriptions add column if not exists offer_code text
  references private.commercial_offers(code);

create table if not exists private.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_customer_id text not null,
  provider_order_id text not null,
  offer_code text not null references private.commercial_offers(code),
  status text not null check (status in ('paid','refunded','chargeback','fraudulent')),
  purchased_at timestamptz not null,
  provider_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,provider_order_id)
);
alter table private.purchases enable row level security;
revoke all on private.purchases from public,anon,authenticated;
grant select,insert,update,delete on private.purchases to service_role;

create table if not exists private.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier_code text not null references private.access_tiers(code),
  source_type text not null check (source_type in ('subscription','purchase','legacy','manual')),
  subscription_id uuid references private.subscriptions(id) on delete cascade,
  purchase_id uuid references private.purchases(id) on delete cascade,
  legacy_reference text,
  status text not null check (status in ('active','revoked','expired')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (source_type='subscription' and subscription_id is not null and purchase_id is null and legacy_reference is null) or
    (source_type='purchase' and purchase_id is not null and subscription_id is null and legacy_reference is null) or
    (source_type='legacy' and legacy_reference is not null and subscription_id is null and purchase_id is null) or
    (source_type='manual' and subscription_id is null and purchase_id is null)
  )
);
create unique index if not exists access_grants_subscription_unique
  on private.access_grants(subscription_id) where subscription_id is not null;
create unique index if not exists access_grants_purchase_unique
  on private.access_grants(purchase_id) where purchase_id is not null;
create unique index if not exists access_grants_legacy_unique
  on private.access_grants(legacy_reference) where legacy_reference is not null;
create index if not exists access_grants_user_active
  on private.access_grants(user_id,tier_code,valid_until) where status='active';
alter table private.access_grants enable row level security;
revoke all on private.access_grants from public,anon,authenticated;
grant select,insert,update,delete on private.access_grants to service_role;

create or replace function private.sync_subscription_grant()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_status text; v_until timestamptz;
begin
  if new.plan not in ('plus','pro','premium') then
    update private.access_grants set status='expired',valid_until=coalesce(valid_until,now()),updated_at=now()
    where subscription_id=new.id;
    return new;
  end if;
  v_status:=case
    when new.status in ('active','trialing') and (new.current_period_end is null or new.current_period_end>now()) then 'active'
    when new.status='canceled' and new.current_period_end>now() then 'active'
    when new.status='past_due' and new.grace_until>now() then 'active'
    else 'expired' end;
  v_until:=case when new.status='past_due' then new.grace_until else new.current_period_end end;
  insert into private.access_grants(user_id,tier_code,source_type,subscription_id,status,valid_from,valid_until)
  values(new.user_id,'premium','subscription',new.id,v_status,coalesce(new.current_period_start,new.created_at),v_until)
  on conflict(subscription_id) where subscription_id is not null do update set
    user_id=excluded.user_id,tier_code='premium',status=excluded.status,
    valid_from=excluded.valid_from,valid_until=excluded.valid_until,
    revocation_reason=null,updated_at=now();
  return new;
end $$;
revoke all on function private.sync_subscription_grant() from public,anon,authenticated;
drop trigger if exists subscriptions_sync_access_grant on private.subscriptions;
create trigger subscriptions_sync_access_grant
after insert or update on private.subscriptions
for each row execute function private.sync_subscription_grant();

insert into private.access_grants(user_id,tier_code,source_type,subscription_id,status,valid_from,valid_until)
select s.user_id,'premium','subscription',s.id,
  case
    when s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end>now()) then 'active'
    when s.status='canceled' and s.current_period_end>now() then 'active'
    when s.status='past_due' and s.grace_until>now() then 'active'
    else 'expired' end,
  coalesce(s.current_period_start,s.created_at),
  case when s.status='past_due' then s.grace_until else s.current_period_end end
from private.subscriptions s
where s.plan in ('plus','pro','premium')
on conflict(subscription_id) where subscription_id is not null do nothing;

-- Restore still-valid historical Store rights as grants without recreating or
-- mutating the archived billing rows. Invalid/malformed records remain audit-only.
insert into private.access_grants(user_id,tier_code,source_type,legacy_reference,status,valid_from,valid_until)
select l.user_id,'premium','legacy','microsoft_store:'||l.id::text,
  case
    when l.payload->>'status' in ('active','trialing') and
      coalesce(nullif(l.payload->>'expires_at','')::timestamptz,'infinity'::timestamptz)>now() then 'active'
    when l.payload->>'status'='canceled' and nullif(l.payload->>'expires_at','')::timestamptz>now() then 'active'
    when l.payload->>'status'='past_due' and nullif(l.payload->>'grace_until','')::timestamptz>now() then 'active'
    else 'expired' end,
  coalesce(nullif(l.payload->>'starts_at','')::timestamptz,l.recorded_at),
  case when l.payload->>'status'='past_due'
    then nullif(l.payload->>'grace_until','')::timestamptz
    else nullif(l.payload->>'expires_at','')::timestamptz end
from private.legacy_billing_records l
where l.provider='microsoft_store' and l.user_id is not null
on conflict(legacy_reference) where legacy_reference is not null do nothing;

create or replace function private.sync_purchase_grant()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.access_grants(
    user_id,tier_code,source_type,purchase_id,status,valid_from,valid_until,revocation_reason
  ) values(
    new.user_id,'premium','purchase',new.id,
    case when new.status='paid' then 'active' else 'revoked' end,
    new.purchased_at,null,
    case when new.status='paid' then null else new.status end
  ) on conflict(purchase_id) where purchase_id is not null do update set
    user_id=excluded.user_id,tier_code='premium',status=excluded.status,
    valid_until=null,revocation_reason=excluded.revocation_reason,updated_at=now();
  return new;
end $$;
revoke all on function private.sync_purchase_grant() from public,anon,authenticated;
drop trigger if exists purchases_sync_access_grant on private.purchases;
create trigger purchases_sync_access_grant
after insert or update on private.purchases
for each row execute function private.sync_purchase_grant();

create or replace function private.effective_access_tier(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
  select case when exists(
    select 1 from private.access_grants g
    where g.user_id=p_user and g.tier_code='premium' and g.status='active'
      and (g.valid_until is null or g.valid_until>now())
  ) then 'premium' else 'free' end
$$;
revoke all on function private.effective_access_tier(uuid) from public,anon,authenticated;

-- Compatibility name for storage/device functions created by older migrations.
create or replace function private.effective_plan_code(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
  select private.effective_access_tier(p_user)
$$;
revoke all on function private.effective_plan_code(uuid) from public,anon,authenticated;

create or replace function private.user_entitlements(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with selected_grant as (
    select g.*,s.status subscription_status,s.billing_period,s.current_period_start,
      s.current_period_end,s.cancel_at_period_end,s.provider
    from private.access_grants g
    left join private.subscriptions s on s.id=g.subscription_id
    where g.user_id=p_user and g.status='active' and (g.valid_until is null or g.valid_until>now())
    order by case g.source_type when 'purchase' then 0 when 'subscription' then 1 else 2 end,
      g.valid_until desc nulls first limit 1
  )
  select jsonb_build_object(
    'plan',t.code,'cloudStorageBytes',t.cloud_bytes,'maxDevices',t.max_devices,
    'sync',t.sync_enabled,'offline',t.offline_enabled,
    'notesAndHighlights',t.notes_and_highlights_enabled,
    'advancedThemes',t.advanced_themes,'advancedStats',t.advanced_stats,
    'translationMonthlyCharacters',t.translation_monthly_characters,
    'cloudTtsMonthlyCharacters',t.cloud_tts_monthly_characters,
    'subscriptionStatus',coalesce(g.subscription_status,case when g.source_type='purchase' then 'active' when g.source_type is not null then 'legacy' else 'free' end),
    'billingPeriod',case when g.source_type='purchase' then 'lifetime' else g.billing_period end,
    'purchaseType',case
      when g.source_type='purchase' then 'lifetime'
      when g.source_type='legacy' then 'legacy'
      when g.source_type='subscription' and g.billing_period='monthly' and
        exists(select 1 from private.subscriptions sx where sx.id=g.subscription_id and sx.plan='premium') then 'monthly'
      when g.source_type is not null then 'legacy'
      else null end,
    'accessSource',coalesce(g.source_type,'free'),
    'currentPeriodStart',coalesce(g.current_period_start,g.valid_from),
    'currentPeriodEnd',g.valid_until,
    'cancelAtPeriodEnd',coalesce(g.cancel_at_period_end,false),
    'provider',g.provider,
    'activeDevices',(select count(*) from private.account_devices d where d.user_id=p_user and d.revoked_at is null)
  )
  from private.access_tiers t
  left join selected_grant g on true
  where t.code=private.effective_access_tier(p_user)
$$;
revoke all on function private.user_entitlements(uuid) from public,anon,authenticated;

create or replace function public.plan_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null then null else jsonb_build_array(
    jsonb_build_object(
      'code','free','monthly_usd_cents',0,'lifetime_usd_cents',null,
      'cloud_bytes',f.cloud_bytes,'max_devices',f.max_devices,
      'advanced_themes',f.advanced_themes,'advanced_stats',f.advanced_stats,
      'translation_monthly_characters',f.translation_monthly_characters,
      'cloud_tts_monthly_characters',f.cloud_tts_monthly_characters,
      'sync_enabled',f.sync_enabled,'offline_enabled',f.offline_enabled,
      'notes_and_highlights_enabled',f.notes_and_highlights_enabled
    ),
    jsonb_build_object(
      'code','premium','monthly_usd_cents',m.price_usd_cents,
      'lifetime_usd_cents',l.price_usd_cents,
      'cloud_bytes',p.cloud_bytes,'max_devices',p.max_devices,
      'advanced_themes',p.advanced_themes,'advanced_stats',p.advanced_stats,
      'translation_monthly_characters',p.translation_monthly_characters,
      'cloud_tts_monthly_characters',p.cloud_tts_monthly_characters,
      'sync_enabled',p.sync_enabled,'offline_enabled',p.offline_enabled,
      'notes_and_highlights_enabled',p.notes_and_highlights_enabled
    )
  ) end
  from private.access_tiers f
  join private.access_tiers p on p.code='premium'
  join private.commercial_offers m on m.code='premium_monthly' and m.available
  join private.commercial_offers l on l.code='premium_lifetime' and l.available
  where f.code='free'
$$;
revoke all on function public.plan_catalog() from public,anon;
grant execute on function public.plan_catalog() to authenticated;

create or replace function public.get_user_entitlements() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then return null; end if;
  if to_regclass('private.revoked_device_sessions') is not null and not public.device_session_allowed() then
    raise exception 'device_revoked' using errcode='42501';
  end if;
  return private.user_entitlements(auth.uid());
end $$;
revoke all on function public.get_user_entitlements() from public,anon;
grant execute on function public.get_user_entitlements() to authenticated;

create or replace function private.cloud_storage_limit(p_user uuid) returns bigint
language sql stable security definer set search_path='' as $$
  select cloud_bytes from private.access_tiers where code=private.effective_access_tier(p_user)
$$;
revoke all on function private.cloud_storage_limit(uuid) from public,anon,authenticated;

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
  select max_devices into v_limit from private.access_tiers where code=private.effective_access_tier(v_user);
  select * into v_existing from private.account_devices where user_id=v_user and device_id=p_device for update;
  select count(*) into v_count from private.account_devices where user_id=v_user and revoked_at is null;
  if v_existing.device_id is not null then
    if v_existing.device_secret_hash<>v_secret_hash then raise exception 'device_mismatch' using errcode='42501'; end if;
    if v_existing.revoked_at is not null and v_existing.session_id=v_session then
      raise exception 'device_revoked' using errcode='42501';
    end if;
    if v_existing.revoked_at is null then
      update private.account_devices set last_seen_at=now(),session_id=v_session,
        platform=p_platform,display_name=btrim(p_name) where user_id=v_user and device_id=p_device;
      return jsonb_build_object('allowed',v_limit is null or v_count<=v_limit,'active_devices',v_count,'max_devices',v_limit);
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

create or replace function public.device_session_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select not private.device_session_revoked()
    and exists(select 1 from private.account_devices d where d.user_id=auth.uid()
    and d.session_id=auth.jwt()->>'session_id' and d.revoked_at is null)
    and exists(select 1 from private.access_tiers t where t.code=private.effective_access_tier(auth.uid())
      and (t.max_devices is null or
        (select count(*) from private.account_devices d where d.user_id=auth.uid() and d.revoked_at is null)<=t.max_devices))
$$;

create or replace function public.authorize_account_device(p_user uuid,p_session text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from private.revoked_device_sessions r where r.user_id=p_user and r.session_id=p_session)
    and exists(select 1 from private.account_devices d where d.user_id=p_user
    and d.session_id=p_session and d.revoked_at is null)
    and exists(select 1 from private.access_tiers t where t.code=private.effective_access_tier(p_user)
      and (t.max_devices is null or
        (select count(*) from private.account_devices d where d.user_id=p_user and d.revoked_at is null)<=t.max_devices))
$$;

create or replace function public.library_quota() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then return null; end if;
  if to_regclass('private.revoked_device_sessions') is not null and not public.device_session_allowed() then
    raise exception 'device_revoked' using errcode='42501';
  end if;
  return (select private.upload_quota_snapshot(auth.uid()) || jsonb_build_object(
    'max_bytes',private.cloud_storage_limit(auth.uid()),
    'plan',private.effective_access_tier(auth.uid()),'max_pending_uploads',3));
end $$;

-- Compatibility response for clients that have not moved to
-- get_user_entitlements yet. It is derived from the same access-tier source.
create or replace function public.account_plan() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  if auth.uid() is null then return null; end if;
  if not public.device_session_allowed() then
    raise exception 'device_revoked' using errcode='42501';
  end if;
  v:=private.user_entitlements(auth.uid());
  return jsonb_build_object(
    'code',v->>'plan','monthly_usd_cents',case when v->>'plan'='premium' then 599 else 0 end,
    'annual_usd_cents',null,'lifetime_usd_cents',case when v->>'plan'='premium' then 11999 else null end,
    'cloud_bytes',(v->>'cloudStorageBytes')::bigint,'max_devices',(v->>'maxDevices')::integer,
    'advanced_themes',(v->>'advancedThemes')::boolean,'advanced_stats',(v->>'advancedStats')::boolean,
    'translation_monthly_characters',(v->>'translationMonthlyCharacters')::integer,
    'cloud_tts_monthly_characters',(v->>'cloudTtsMonthlyCharacters')::integer,
    'sync_enabled',(v->>'sync')::boolean,'offline_enabled',(v->>'offline')::boolean,
    'notes_and_highlights_enabled',(v->>'notesAndHighlights')::boolean,
    'subscription_status',v->>'subscriptionStatus','billing_cycle',v->>'billingPeriod',
    'starts_at',v->>'currentPeriodStart','renews_at',case when (v->>'cancelAtPeriodEnd')::boolean then null else v->>'currentPeriodEnd' end,
    'expires_at',v->>'currentPeriodEnd','grace_until',null,
    'active_devices',(v->>'activeDevices')::integer
  );
end $$;

create or replace function public.billing_customer(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('provider',q.provider,'customerId',q.customer_id,'subscriptionId',q.external_id)
  from (
    select s.provider,s.provider_customer_id customer_id,s.provider_subscription_id external_id,0 priority,s.updated_at
    from private.subscriptions s where s.user_id=p_user and s.provider in ('lemonsqueezy','paddle')
    union all
    select p.provider,p.provider_customer_id,p.provider_order_id,1,p.updated_at
    from private.purchases p where p.user_id=p_user and p.provider='lemonsqueezy'
  ) q order by q.priority,q.updated_at desc limit 1
$$;
revoke all on function public.billing_customer(uuid) from public,anon,authenticated;
grant execute on function public.billing_customer(uuid) to service_role;

-- Webhook event insertion and entitlement mutation happen in one transaction.
-- Existing Plus/Pro identifiers remain accepted only for historical events and
-- all three paid identifiers grant the same Premium tier.
create or replace function public.process_billing_event(
  p_provider text,p_event_id text,p_event_type text,p_occurred_at timestamptz,
  p_user uuid default null,p_provider_customer_id text default null,
  p_provider_subscription_id text default null,p_plan text default null,
  p_billing_period text default null,p_status text default null,
  p_current_period_start timestamptz default null,p_current_period_end timestamptz default null,
  p_cancel_at_period_end boolean default false
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_inserted integer; v_user uuid:=p_user;
begin
  if p_provider not in ('paddle','lemonsqueezy','google_play','apple','microsoft_store','manual')
    or coalesce(length(p_event_id),0) not between 3 and 200
    or coalesce(length(p_event_type),0) not between 3 and 120 or p_occurred_at is null
  then raise exception 'invalid_billing_event'; end if;
  insert into private.billing_webhook_events(provider,event_id,event_type,occurred_at)
  values(p_provider,p_event_id,p_event_type,p_occurred_at) on conflict(provider,event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return false; end if;

  if p_event_type in ('transaction.payment_failed','subscription_payment_failed') then
    update private.subscriptions set status='past_due',
      grace_until=greatest(coalesce(current_period_end,now()),now()+interval '3 days'),
      updated_at=now(),provider_updated_at=p_occurred_at
    where provider=p_provider and provider_subscription_id=p_provider_subscription_id
      and provider_updated_at<=p_occurred_at and status not in ('canceled','expired');
    return true;
  end if;
  if p_event_type not like 'subscription.%' and p_event_type not like 'subscription_%' then return true; end if;
  if v_user is null and p_provider_subscription_id is not null then
    select user_id into v_user from private.subscriptions
    where provider=p_provider and provider_subscription_id=p_provider_subscription_id;
  end if;
  if v_user is null or p_plan not in ('plus','pro','premium')
    or p_billing_period not in ('monthly','annual')
    or p_status not in ('active','trialing','past_due','canceled','expired')
    or coalesce(length(p_provider_customer_id),0) not between 1 and 200
    or coalesce(length(p_provider_subscription_id),0) not between 1 and 200
  then raise exception 'invalid_subscription_event'; end if;

  insert into private.subscriptions(
    user_id,provider,provider_customer_id,provider_subscription_id,plan,offer_code,billing_period,status,
    current_period_start,current_period_end,cancel_at_period_end,grace_until,provider_updated_at,updated_at
  ) values(
    v_user,p_provider,p_provider_customer_id,p_provider_subscription_id,p_plan,
    case when p_plan='premium' and p_billing_period='monthly' then 'premium_monthly' end,
    p_billing_period,p_status,p_current_period_start,p_current_period_end,p_cancel_at_period_end,
    case when p_status='past_due' then greatest(coalesce(p_current_period_end,now()),now()+interval '3 days') end,
    p_occurred_at,now()
  ) on conflict(provider,provider_subscription_id) where provider_subscription_id is not null do update set
    user_id=excluded.user_id,provider_customer_id=excluded.provider_customer_id,
    plan=excluded.plan,offer_code=excluded.offer_code,billing_period=excluded.billing_period,
    status=excluded.status,current_period_start=excluded.current_period_start,
    current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,
    grace_until=excluded.grace_until,provider_updated_at=excluded.provider_updated_at,updated_at=now()
  where private.subscriptions.provider_updated_at<=excluded.provider_updated_at;
  return true;
end $$;
revoke all on function public.process_billing_event(text,text,text,timestamptz,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.process_billing_event(text,text,text,timestamptz,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) to service_role;

create or replace function public.process_lifetime_order(
  p_event_id text,p_event_type text,p_occurred_at timestamptz,
  p_user uuid default null,p_provider_customer_id text default null,
  p_provider_order_id text default null,p_status text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_inserted integer; v_user uuid:=p_user;
begin
  if coalesce(length(p_event_id),0) not between 3 and 200
    or p_event_type not in ('order_created','order_refunded') or p_occurred_at is null
    or p_status not in ('paid','refunded')
    or coalesce(length(p_provider_customer_id),0) not between 1 and 200
    or coalesce(length(p_provider_order_id),0) not between 1 and 200
  then raise exception 'invalid_lifetime_order'; end if;
  insert into private.billing_webhook_events(provider,event_id,event_type,occurred_at)
  values('lemonsqueezy',p_event_id,p_event_type,p_occurred_at)
  on conflict(provider,event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return false; end if;
  if v_user is null then
    select user_id into v_user from private.purchases
    where provider='lemonsqueezy' and provider_order_id=p_provider_order_id;
  end if;
  if v_user is null then raise exception 'invalid_lifetime_order'; end if;
  insert into private.purchases(
    user_id,provider,provider_customer_id,provider_order_id,offer_code,status,purchased_at,provider_updated_at
  ) values(
    v_user,'lemonsqueezy',p_provider_customer_id,p_provider_order_id,'premium_lifetime',p_status,p_occurred_at,p_occurred_at
  ) on conflict(provider,provider_order_id) do update set
    provider_customer_id=excluded.provider_customer_id,status=excluded.status,
    provider_updated_at=excluded.provider_updated_at,updated_at=now()
  where private.purchases.provider_updated_at<=excluded.provider_updated_at;
  return true;
end $$;
revoke all on function public.process_lifetime_order(text,text,timestamptz,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.process_lifetime_order(text,text,timestamptz,uuid,text,text,text) to service_role;

-- Lemon Squeezy has no dedicated chargeback webhook. An operator can call this
-- service-role-only RPC after a chargeback or fraud decision is confirmed.
create or replace function public.revoke_purchase_access(
  p_provider text,p_provider_order_id text,p_reason text,p_occurred_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_changed integer;
begin
  if p_reason not in ('chargeback','fraudulent') or p_occurred_at is null then
    raise exception 'invalid_purchase_revocation'; end if;
  update private.purchases set status=p_reason,provider_updated_at=p_occurred_at,updated_at=now()
  where provider=p_provider and provider_order_id=p_provider_order_id
    and provider_updated_at<=p_occurred_at and status='paid';
  get diagnostics v_changed=row_count;
  return v_changed>0;
end $$;
revoke all on function public.revoke_purchase_access(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.revoke_purchase_access(text,text,text,timestamptz) to service_role;

commit;
