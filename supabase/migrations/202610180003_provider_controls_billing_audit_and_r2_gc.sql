begin;

-- Central provider controls remain backend-editable. Environment values passed
-- by Edge Functions are additional hard ceilings, never a way to raise these.
alter table private.service_quota_config
  add column if not exists monthly_budget_microusd bigint check(monthly_budget_microusd >= 0),
  add column if not exists lifetime_units bigint check(lifetime_units > 0),
  add column if not exists alert_percentages smallint[] not null default array[80,90,100]::smallint[];
alter table private.service_quota_config drop constraint if exists service_quota_alert_percentages_check;
alter table private.service_quota_config add constraint service_quota_alert_percentages_check
  check(alert_percentages <@ array[80,90,100]::smallint[]);

update private.service_quota_config set
  tier_limits_enabled=true,
  global_monthly_units=250000,
  monthly_budget_microusd=0,
  lifetime_units=1000000,
  alert_percentages=array[80,90,100]::smallint[],
  updated_at=now()
where service='deepl';

update private.service_quota_config set
  tier_limits_enabled=true,
  monthly_budget_microusd=10000000,
  alert_percentages=array[80,90,100]::smallint[],
  updated_at=now()
where service='amazon_polly_neural';

create or replace function public.effective_service_budget(
  p_service text,p_environment_microusd bigint
) returns bigint language plpgsql stable security definer set search_path='' as $$
declare v_database bigint;
begin
  if p_environment_microusd is null or p_environment_microusd<0 then
    raise exception 'invalid_budget';
  end if;
  select monthly_budget_microusd into v_database
  from private.service_quota_config where service=p_service;
  if v_database is null then raise exception 'service_not_configured'; end if;
  return least(v_database,p_environment_microusd);
end $$;
revoke all on function public.effective_service_budget(text,bigint) from public,anon,authenticated;
grant execute on function public.effective_service_budget(text,bigint) to service_role;

-- Only hashes, counts and provider trace IDs are retained. Source and translated
-- book text are deliberately absent from this ledger.
create table if not exists private.translation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key text not null check(request_key ~ '^[a-f0-9]{64}$'),
  characters integer not null check(characters between 1 and 2000),
  period_start date not null,
  status text not null check(status in ('reserved','succeeded','released','uncertain')),
  provider_counted boolean not null default false,
  provider_trace_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists translation_requests_user_period
  on private.translation_requests(user_id,period_start,status);
create index if not exists translation_requests_global_period
  on private.translation_requests(period_start,status);
create unique index if not exists translation_requests_inflight_unique
  on private.translation_requests(user_id,request_key) where status='reserved';
alter table private.translation_requests enable row level security;
revoke all on private.translation_requests from public,anon,authenticated;
grant select,insert,update,delete on private.translation_requests to service_role;

create table if not exists private.provider_usage_snapshots (
  service text primary key references private.service_quota_config(service),
  period_start timestamptz,
  period_end timestamptz,
  used_units bigint not null check(used_units >= 0),
  limit_units bigint not null check(limit_units > 0),
  fetched_at timestamptz not null,
  source text not null check(source in ('provider_api','manual')),
  updated_at timestamptz not null default now()
);
alter table private.provider_usage_snapshots enable row level security;
revoke all on private.provider_usage_snapshots from public,anon,authenticated;
grant select,insert,update,delete on private.provider_usage_snapshots to service_role;

create table if not exists private.service_consumption_alerts (
  id bigint generated always as identity primary key,
  service text not null references private.service_quota_config(service),
  period_start date not null,
  scope text not null check(scope in ('global','provider','lifetime','budget')),
  threshold smallint not null check(threshold in (80,90,100)),
  used_units bigint not null check(used_units >= 0),
  limit_units bigint not null check(limit_units > 0),
  created_at timestamptz not null default now(),
  unique(service,period_start,scope,threshold)
);
alter table private.service_consumption_alerts enable row level security;
revoke all on private.service_consumption_alerts from public,anon,authenticated;
grant select,insert,update,delete on private.service_consumption_alerts to service_role;

create or replace function public.record_deepl_provider_usage(
  p_used bigint,p_limit bigint,p_period_start timestamptz default null,
  p_period_end timestamptz default null,p_fetched_at timestamptz default now()
) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_used is null or p_used<0 or p_limit is null or p_limit<1 or p_used>p_limit
    or p_fetched_at is null or p_fetched_at>now()+interval '5 minutes'
    or (p_period_start is not null and p_period_end is not null and p_period_end<=p_period_start)
  then raise exception 'invalid_provider_usage'; end if;
  insert into private.provider_usage_snapshots(service,period_start,period_end,used_units,limit_units,fetched_at,source)
  values('deepl',p_period_start,p_period_end,p_used,p_limit,p_fetched_at,'provider_api')
  on conflict(service) do update set
    period_start=excluded.period_start,period_end=excluded.period_end,
    used_units=excluded.used_units,limit_units=excluded.limit_units,
    fetched_at=excluded.fetched_at,source=excluded.source,updated_at=now()
  where private.provider_usage_snapshots.fetched_at<=excluded.fetched_at;
end $$;
revoke all on function public.record_deepl_provider_usage(bigint,bigint,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.record_deepl_provider_usage(bigint,bigint,timestamptz,timestamptz,timestamptz) to service_role;

create or replace function public.reserve_deepl_translation(
  p_user uuid,p_characters integer,p_request_key text,
  p_environment_global_limit bigint,p_lifetime_limit bigint,p_lifetime_used_baseline bigint
) returns text language plpgsql security definer set search_path='' as $$
declare
  v_month date:=date_trunc('month',now() at time zone 'UTC')::date;
  v_config private.service_quota_config; v_provider private.provider_usage_snapshots;
  v_user_limit bigint; v_user_used bigint; v_global_used bigint; v_lifetime_used bigint;
  v_provider_unreported bigint;
  v_global_limit bigint; v_lifetime_limit bigint; v_projected bigint; v_id uuid:=gen_random_uuid();
  v_threshold smallint;
begin
  select * into v_config from private.service_quota_config where service='deepl';
  if v_config.service is null or not v_config.tier_limits_enabled then raise exception 'translation_unavailable'; end if;
  if p_characters is null or p_characters not between 1 and v_config.max_units_per_request
    or p_request_key!~'^[a-f0-9]{64}$'
    or p_environment_global_limit is null or p_environment_global_limit<1
    or p_lifetime_limit is null or p_lifetime_limit<1
    or p_lifetime_used_baseline is null or p_lifetime_used_baseline<0
  then raise exception 'invalid_request'; end if;
  if not exists(select 1 from public.profiles where id=p_user) then raise exception 'forbidden'; end if;

  perform pg_advisory_xact_lock(290009);
  update private.translation_requests set status='uncertain',provider_counted=true,
    error_code=coalesce(error_code,'reservation_abandoned'),updated_at=now()
  where status='reserved' and updated_at<=now()-interval '2 minutes';
  if exists(select 1 from private.translation_requests
    where user_id=p_user and request_key=p_request_key and status='reserved')
  then raise exception 'translation_pending'; end if;

  select * into v_provider from private.provider_usage_snapshots where service='deepl';
  if v_provider.service is null or v_provider.fetched_at<now()-interval '15 minutes'
    then raise exception 'provider_usage_unverified'; end if;

  -- /v2/usage can lag behind requests made after the snapshot. Reserve those
  -- units as well so concurrent calls cannot spend the same provider balance.
  select coalesce(sum(characters),0) into v_provider_unreported
  from private.translation_requests
  where status in ('reserved','succeeded','uncertain') and updated_at>=v_provider.fetched_at;

  select translation_monthly_characters into v_user_limit from private.access_tiers
    where code=private.effective_access_tier(p_user);
  select coalesce((select characters from private.translation_monthly_usage
      where user_id=p_user and period_start=v_month),0)
    +coalesce(sum(r.characters) filter(where r.status in ('reserved','succeeded','uncertain')),0)
    into v_user_used from private.translation_requests r
    where r.user_id=p_user and r.period_start=v_month;
  select coalesce((select sum(characters) from private.translation_monthly_usage
      where period_start=v_month),0)
    +coalesce(sum(r.characters) filter(where r.status in ('reserved','succeeded','uncertain')),0)
    into v_global_used from private.translation_requests r where r.period_start=v_month;
  select coalesce(sum(characters) filter(where status in ('reserved','succeeded','uncertain')),0)
    into v_lifetime_used from private.translation_requests;

  v_global_limit:=least(v_config.global_monthly_units,p_environment_global_limit);
  v_lifetime_limit:=least(v_config.lifetime_units,p_lifetime_limit);
  if v_user_used+p_characters>v_user_limit then raise exception 'translation_quota'; end if;
  if v_global_used+p_characters>v_global_limit
    or v_provider.used_units+v_provider_unreported+p_characters>v_provider.limit_units
    or p_lifetime_used_baseline+v_lifetime_used+p_characters>v_lifetime_limit then
    if v_global_used+p_characters>v_global_limit then
      insert into private.service_consumption_alerts(service,period_start,scope,threshold,used_units,limit_units)
      values('deepl',v_month,'global',100,v_global_used,v_global_limit) on conflict do nothing;
    end if;
    if v_provider.used_units+v_provider_unreported+p_characters>v_provider.limit_units then
      insert into private.service_consumption_alerts(service,period_start,scope,threshold,used_units,limit_units)
      values('deepl',v_month,'provider',100,v_provider.used_units+v_provider_unreported,v_provider.limit_units) on conflict do nothing;
    end if;
    if p_lifetime_used_baseline+v_lifetime_used+p_characters>v_lifetime_limit then
      insert into private.service_consumption_alerts(service,period_start,scope,threshold,used_units,limit_units)
      values('deepl',date '1970-01-01','lifetime',100,p_lifetime_used_baseline+v_lifetime_used,v_lifetime_limit) on conflict do nothing;
    end if;
    return 'quota_exceeded';
  end if;

  insert into private.translation_requests(id,user_id,request_key,characters,period_start,status)
  values(v_id,p_user,p_request_key,p_characters,v_month,'reserved');

  foreach v_threshold in array v_config.alert_percentages loop
    if v_global_used+p_characters>=v_global_limit*v_threshold/100 then
      insert into private.service_consumption_alerts(service,period_start,scope,threshold,used_units,limit_units)
      values('deepl',v_month,'global',v_threshold,v_global_used+p_characters,v_global_limit) on conflict do nothing;
    end if;
    if v_provider.used_units+v_provider_unreported+p_characters>=v_provider.limit_units*v_threshold/100 then
      insert into private.service_consumption_alerts(service,period_start,scope,threshold,used_units,limit_units)
      values('deepl',v_month,'provider',v_threshold,v_provider.used_units+v_provider_unreported+p_characters,v_provider.limit_units) on conflict do nothing;
    end if;
    v_projected:=p_lifetime_used_baseline+v_lifetime_used+p_characters;
    if v_projected>=v_lifetime_limit*v_threshold/100 then
      insert into private.service_consumption_alerts(service,period_start,scope,threshold,used_units,limit_units)
      values('deepl',date '1970-01-01','lifetime',v_threshold,v_projected,v_lifetime_limit) on conflict do nothing;
    end if;
  end loop;
  return v_id::text;
end $$;
revoke all on function public.reserve_deepl_translation(uuid,integer,text,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.reserve_deepl_translation(uuid,integer,text,bigint,bigint,bigint) to service_role;

create or replace function public.finalize_deepl_translation(
  p_user uuid,p_id uuid,p_outcome text,p_error text default null,p_provider_trace_id text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_status text; v_counted boolean; v_changed integer;
begin
  if p_outcome not in ('succeeded','released','uncertain') then raise exception 'invalid_translation_outcome'; end if;
  v_status:=p_outcome; v_counted:=p_outcome in ('succeeded','uncertain');
  update private.translation_requests set status=v_status,provider_counted=v_counted,
    error_code=case when p_outcome='succeeded' then null else left(coalesce(p_error,'provider_failure'),80) end,
    provider_trace_id=case when p_provider_trace_id~'^[A-Za-z0-9._:-]{1,160}$' then p_provider_trace_id end,
    updated_at=now()
  where id=p_id and user_id=p_user and status='reserved';
  get diagnostics v_changed=row_count;
  return v_changed>0;
end $$;
revoke all on function public.finalize_deepl_translation(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finalize_deepl_translation(uuid,uuid,text,text,text) to service_role;

create or replace function public.translation_usage_for_user(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_start date:=date_trunc('month',now() at time zone 'UTC')::date;
  v_used bigint; v_limit bigint; v_global bigint; v_global_limit bigint; v_provider private.provider_usage_snapshots;
begin
  select coalesce((select characters from private.translation_monthly_usage where user_id=p_user and period_start=v_start),0)
    +coalesce(sum(characters) filter(where status in ('reserved','succeeded','uncertain')),0)
    into v_used from private.translation_requests where user_id=p_user and period_start=v_start;
  select translation_monthly_characters into v_limit from private.access_tiers
    where code=private.effective_access_tier(p_user);
  select coalesce((select sum(characters) from private.translation_monthly_usage where period_start=v_start),0)
    +coalesce(sum(characters) filter(where status in ('reserved','succeeded','uncertain')),0)
    into v_global from private.translation_requests where period_start=v_start;
  select global_monthly_units into v_global_limit from private.service_quota_config where service='deepl';
  select * into v_provider from private.provider_usage_snapshots where service='deepl';
  return jsonb_build_object(
    'plan',private.effective_access_tier(p_user),'includedCharacters',v_limit,
    'usedCharacters',v_used,'remainingCharacters',greatest(0,v_limit-v_used),
    'cycleStartsAt',(v_start::timestamp at time zone 'UTC'),
    'resetsAt',((v_start+interval '1 month')::timestamp at time zone 'UTC'),
    'serviceAvailable',v_global<v_global_limit and coalesce(v_provider.used_units<v_provider.limit_units,false)
      and coalesce(v_provider.fetched_at>=now()-interval '15 minutes',false),
    'globalLimitReached',v_global>=v_global_limit,
    'providerUsageVerified',v_provider.fetched_at>=now()-interval '15 minutes'
  );
end $$;

-- Auditable refund and dispute history. Partial refunds never mutate access.
alter table private.purchases add column if not exists dispute_status text not null default 'none';
alter table private.purchases drop constraint if exists purchases_dispute_status_check;
alter table private.purchases add constraint purchases_dispute_status_check
  check(dispute_status in ('none','open','won','lost'));

create table if not exists private.billing_adjustments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references private.purchases(id),
  provider text not null,
  provider_event_id text not null,
  adjustment_type text not null check(adjustment_type in ('partial_refund','full_refund')),
  amount_usd_cents integer check(amount_usd_cents>=0),
  total_usd_cents integer check(total_usd_cents>0),
  review_status text not null check(review_status in ('review_required','applied','resolved')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(provider,provider_event_id)
);
alter table private.billing_adjustments enable row level security;
revoke all on private.billing_adjustments from public,anon,authenticated;
grant select,insert,update,delete on private.billing_adjustments to service_role;

create table if not exists private.billing_disputes (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references private.purchases(id),
  provider text not null,
  provider_event_id text not null,
  outcome text not null check(outcome in ('opened','won','lost')),
  evidence_reference text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(provider,provider_event_id)
);
alter table private.billing_disputes enable row level security;
revoke all on private.billing_disputes from public,anon,authenticated;
grant select,insert,update,delete on private.billing_disputes to service_role;

create or replace function public.process_lifetime_order_v2(
  p_event_id text,p_event_type text,p_occurred_at timestamptz,
  p_user uuid default null,p_provider_customer_id text default null,
  p_provider_order_id text default null,p_status text default null,
  p_refund_kind text default null,p_refunded_amount_usd integer default null,
  p_total_usd integer default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_inserted integer; v_user uuid:=p_user; v_purchase uuid;
begin
  if coalesce(length(p_event_id),0) not between 3 and 200
    or p_event_type not in ('order_created','order_refunded') or p_occurred_at is null
    or coalesce(length(p_provider_customer_id),0) not between 1 and 200
    or coalesce(length(p_provider_order_id),0) not between 1 and 200
    or (p_event_type='order_created' and p_status<>'paid')
    or (p_event_type='order_refunded' and p_refund_kind not in ('partial','full'))
    or (p_event_type='order_refunded' and (p_refunded_amount_usd is null
      or p_total_usd is null or p_refunded_amount_usd<=0 or p_total_usd<=0
      or (p_refund_kind='partial' and p_refunded_amount_usd>=p_total_usd)
      or (p_refund_kind='full' and p_refunded_amount_usd<p_total_usd)))
  then raise exception 'invalid_lifetime_order'; end if;
  insert into private.billing_webhook_events(provider,event_id,event_type,occurred_at)
  values('lemonsqueezy',p_event_id,p_event_type,p_occurred_at) on conflict(provider,event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return false; end if;

  select id,user_id into v_purchase,v_user from private.purchases
  where provider='lemonsqueezy' and provider_order_id=p_provider_order_id;
  v_user:=coalesce(v_user,p_user);
  if v_user is null then raise exception 'invalid_lifetime_order'; end if;

  if p_event_type='order_created' then
    insert into private.purchases(user_id,provider,provider_customer_id,provider_order_id,offer_code,status,purchased_at,provider_updated_at)
    values(v_user,'lemonsqueezy',p_provider_customer_id,p_provider_order_id,'premium_lifetime','paid',p_occurred_at,p_occurred_at)
    on conflict(provider,provider_order_id) do update set
      provider_customer_id=excluded.provider_customer_id,provider_updated_at=excluded.provider_updated_at,updated_at=now()
    where private.purchases.provider_updated_at<=excluded.provider_updated_at;
    return true;
  end if;

  if v_purchase is null then raise exception 'unknown_purchase'; end if;
  insert into private.billing_adjustments(purchase_id,provider,provider_event_id,adjustment_type,
    amount_usd_cents,total_usd_cents,review_status,occurred_at)
  values(v_purchase,'lemonsqueezy',p_event_id,
    case when p_refund_kind='full' then 'full_refund' else 'partial_refund' end,
    p_refunded_amount_usd,p_total_usd,
    case when p_refund_kind='full' then 'applied' else 'review_required' end,p_occurred_at);
  if p_refund_kind='full' then
    update private.purchases set status='refunded',provider_updated_at=p_occurred_at,updated_at=now()
    where id=v_purchase and provider_updated_at<=p_occurred_at;
  end if;
  return true;
end $$;
revoke all on function public.process_lifetime_order_v2(text,text,timestamptz,uuid,text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.process_lifetime_order_v2(text,text,timestamptz,uuid,text,text,text,text,integer,integer) to service_role;

create or replace function public.record_purchase_dispute(
  p_provider text,p_provider_order_id text,p_event_id text,p_outcome text,
  p_occurred_at timestamptz,p_evidence_reference text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_purchase uuid; v_inserted integer;
begin
  if p_outcome not in ('opened','won','lost') or p_occurred_at is null
    or coalesce(length(p_event_id),0) not between 3 and 200
  then raise exception 'invalid_purchase_dispute'; end if;
  select id into v_purchase from private.purchases
    where provider=p_provider and provider_order_id=p_provider_order_id for update;
  if v_purchase is null then raise exception 'unknown_purchase'; end if;
  insert into private.billing_disputes(purchase_id,provider,provider_event_id,outcome,evidence_reference,occurred_at)
  values(v_purchase,p_provider,p_event_id,p_outcome,left(p_evidence_reference,300),p_occurred_at)
  on conflict(provider,provider_event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return false; end if;
  update private.purchases set
    dispute_status=case p_outcome when 'opened' then 'open' when 'won' then 'won' else 'lost' end,
    status=case when p_outcome='lost' then 'chargeback'
      when p_outcome='won' and status='chargeback' then 'paid' else status end,
    provider_updated_at=greatest(provider_updated_at,p_occurred_at),updated_at=now()
  where id=v_purchase and provider_updated_at<=p_occurred_at;
  return true;
end $$;
revoke all on function public.record_purchase_dispute(text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.record_purchase_dispute(text,text,text,text,timestamptz,text) to service_role;

-- Canonical R2 garbage collection starts as an auditable simulation. This
-- migration intentionally provides no physical-delete function.
create table if not exists private.r2_orphan_candidates (
  book_id uuid primary key references private.book_files(book_id) on delete cascade,
  r2_key text not null unique,
  file_size bigint not null check(file_size>0),
  status text not null check(status in ('candidate','protected')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  eligible_after timestamptz not null,
  last_active_references integer not null default 0,
  last_pending_uploads integer not null default 0
);
alter table private.r2_orphan_candidates enable row level security;
revoke all on private.r2_orphan_candidates from public,anon,authenticated;
grant select,insert,update,delete on private.r2_orphan_candidates to service_role;

create or replace function public.preview_r2_orphan_collection(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if p_limit not between 1 and 5000 then raise exception 'invalid_limit'; end if;
  perform pg_advisory_xact_lock(88224411);
  update private.r2_orphan_candidates c set status='protected',last_seen_at=now(),
    last_active_references=(select count(*) from public.user_books u where u.book_id=c.book_id and u.deleted_at is null),
    last_pending_uploads=(select count(*) from private.upload_intents i join private.book_files f
      on f.file_hash=i.file_hash and f.format=i.format where f.book_id=c.book_id and i.completed_at is null and i.expires_at>now())
  where exists(select 1 from public.user_books u where u.book_id=c.book_id and u.deleted_at is null)
     or exists(select 1 from private.upload_intents i join private.book_files f
       on f.file_hash=i.file_hash and f.format=i.format where f.book_id=c.book_id and i.completed_at is null and i.expires_at>now());

  insert into private.r2_orphan_candidates(book_id,r2_key,file_size,status,eligible_after,last_active_references,last_pending_uploads)
  select f.book_id,f.r2_key,f.file_size,'candidate',now()+interval '7 days',0,0
  from private.book_files f
  where not exists(select 1 from public.user_books u where u.book_id=f.book_id and u.deleted_at is null)
    and not exists(select 1 from private.upload_intents i where i.file_hash=f.file_hash and i.format=f.format
      and i.completed_at is null and i.expires_at>now())
  on conflict(book_id) do update set status='candidate',last_seen_at=now(),
    last_active_references=0,last_pending_uploads=0;

  select jsonb_build_object(
    'dryRun',true,'physicalDeletes',0,
    'candidateCount',count(*),'candidateBytes',coalesce(sum(file_size),0),
    'eligibleCount',count(*) filter(where eligible_after<=now()),
    'items',coalesce(jsonb_agg(jsonb_build_object('bookId',book_id,'r2Key',r2_key,
      'fileSize',file_size,'firstSeenAt',first_seen_at,'eligibleAfter',eligible_after)
      order by first_seen_at) filter(where rn<=p_limit),'[]'::jsonb)
  ) into v_result
  from (select c.*,row_number() over(order by first_seen_at) rn
    from private.r2_orphan_candidates c where status='candidate') q;
  return v_result;
end $$;
revoke all on function public.preview_r2_orphan_collection(integer) from public,anon,authenticated;
grant execute on function public.preview_r2_orphan_collection(integer) to service_role;

create or replace function public.provider_usage_summary() returns jsonb
language sql stable security definer set search_path='' as $$
  with month as (select date_trunc('month',now() at time zone 'UTC')::date d),
  deepl as (
    select coalesce((select sum(characters) from private.translation_monthly_usage where period_start=month.d),0)
      +coalesce((select sum(characters) from private.translation_requests where period_start=month.d
        and status in ('reserved','succeeded','uncertain')),0) used from month
  ), polly as (
    select coalesce(sum(estimated_cost_microusd),0) cost,coalesce(sum(characters),0) characters
    from private.ai_speech_generations
    where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
      and (provider_billed or status in ('reserved','generating','ready'))
  ), storage as (
    select coalesce(sum(f.file_size),0) known_bytes,
      coalesce(sum(f.file_size) filter(where exists(
        select 1 from public.user_books u where u.book_id=f.book_id and u.deleted_at is null
      )),0) referenced_bytes
    from private.book_files f
  )
  select jsonb_build_object(
    'periodStart',(select d from month),
    'deepl',jsonb_build_object('usedCharacters',deepl.used,
      'globalCharacterLimit',(select global_monthly_units from private.service_quota_config where service='deepl'),
      'providerSnapshot',(select to_jsonb(s) from private.provider_usage_snapshots s where service='deepl'),
      'budgetMicrousd',(select monthly_budget_microusd from private.service_quota_config where service='deepl')),
    'amazonPollyNeural',jsonb_build_object('usedCharacters',polly.characters,'estimatedCostMicrousd',polly.cost,
      'budgetMicrousd',(select monthly_budget_microusd from private.service_quota_config where service='amazon_polly_neural')),
    'r2',jsonb_build_object(
      'knownCanonicalBytes',storage.known_bytes,
      'referencedCanonicalBytes',storage.referenced_bytes,
      'orphanCandidateBytes',(select coalesce(sum(file_size),0) from private.r2_orphan_candidates where status='candidate'),
      'estimatedKnownStorageCostMicrousd',ceil(storage.known_bytes::numeric/1000000000*15000)::bigint,
      'estimateExcludesOperationsAndAudio',true
    ),
    'alerts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb)
      from private.service_consumption_alerts a where a.period_start>=(select d from month))
  ) from deepl,polly,storage
$$;
revoke all on function public.provider_usage_summary() from public,anon,authenticated;
grant execute on function public.provider_usage_summary() to service_role;

create or replace function public.service_usage_for_user(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_budget bigint; v_storage bigint; v_storage_limit bigint;
begin
  if not exists(select 1 from public.profiles where id=p_user) then raise exception 'forbidden'; end if;
  select monthly_budget_microusd into v_budget from private.service_quota_config where service='amazon_polly_neural';
  select coalesce(sum(f.file_size),0) into v_storage from public.user_books u
    join private.book_files f on f.book_id=u.book_id where u.user_id=p_user and u.deleted_at is null;
  select cloud_bytes into v_storage_limit from private.access_tiers where code=private.effective_access_tier(p_user);
  return jsonb_build_object(
    'plan',private.effective_access_tier(p_user),
    'storage',jsonb_build_object('usedBytes',v_storage,'limitBytes',v_storage_limit,'remainingBytes',greatest(0,v_storage_limit-v_storage)),
    'deepl',public.translation_usage_for_user(p_user),
    'amazonPollyNeural',private.ai_speech_usage_snapshot(p_user,v_budget)
  );
end $$;
revoke all on function public.service_usage_for_user(uuid) from public,anon,authenticated;
grant execute on function public.service_usage_for_user(uuid) to service_role;

commit;
