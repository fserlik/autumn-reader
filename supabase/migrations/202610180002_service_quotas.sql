begin;

create table if not exists private.service_quota_config (
  service text primary key check (service in ('deepl','amazon_polly_neural')),
  tier_limits_enabled boolean not null default true,
  global_monthly_units bigint check (global_monthly_units > 0),
  max_units_per_request integer not null check (max_units_per_request > 0),
  max_requests_per_day integer check (max_requests_per_day > 0),
  legacy_daily_units integer check (legacy_daily_units > 0),
  updated_at timestamptz not null default now()
);
insert into private.service_quota_config(
  service,tier_limits_enabled,global_monthly_units,max_units_per_request,max_requests_per_day,legacy_daily_units
) values
  ('deepl',true,250000,2000,60,20000),
  ('amazon_polly_neural',true,null,3000,6,null)
on conflict(service) do update set
  tier_limits_enabled=excluded.tier_limits_enabled,
  global_monthly_units=excluded.global_monthly_units,
  max_units_per_request=excluded.max_units_per_request,
  max_requests_per_day=excluded.max_requests_per_day,
  legacy_daily_units=excluded.legacy_daily_units,
  updated_at=now();
alter table private.service_quota_config enable row level security;
revoke all on private.service_quota_config from public,anon,authenticated;
grant select,insert,update,delete on private.service_quota_config to service_role;

create table if not exists private.translation_monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  requests integer not null default 0 check (requests >= 0),
  characters bigint not null default 0 check (characters >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,period_start)
);
alter table private.translation_monthly_usage enable row level security;
revoke all on private.translation_monthly_usage from public,anon,authenticated;
grant select,insert,update,delete on private.translation_monthly_usage to service_role;

alter table private.ai_speech_admin_alerts
  drop constraint if exists ai_speech_admin_alerts_kind_check;
alter table private.ai_speech_admin_alerts
  add constraint ai_speech_admin_alerts_kind_check
  check(kind in ('budget_80','budget_90','budget_100'));

insert into private.translation_monthly_usage(user_id,period_start,requests,characters)
select user_id,date_trunc('month',day::timestamp)::date,sum(requests),sum(characters)
from private.translation_usage group by user_id,date_trunc('month',day::timestamp)::date
on conflict(user_id,period_start) do update set
  requests=excluded.requests,characters=excluded.characters,updated_at=now();

create or replace function public.reserve_translation(p_user uuid,p_characters integer) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_today date:=(now() at time zone 'UTC')::date;
  v_month date:=date_trunc('month',now() at time zone 'UTC')::date;
  v_day private.translation_usage;
  v_monthly bigint; v_limit integer; v_global bigint; v_config private.service_quota_config;
begin
  select * into v_config from private.service_quota_config where service='deepl';
  if p_characters is null or p_characters not between 1 and v_config.max_units_per_request then
    raise exception 'text_too_long';
  end if;
  if not exists(select 1 from public.profiles where id=p_user) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(290009);
  select * into v_day from private.translation_usage where user_id=p_user and day=v_today;
  select coalesce(characters,0) into v_monthly from private.translation_monthly_usage
    where user_id=p_user and period_start=v_month;
  select translation_monthly_characters into v_limit from private.access_tiers
    where code=private.effective_access_tier(p_user);
  select coalesce(sum(characters),0) into v_global from private.translation_monthly_usage
    where period_start=v_month;
  if coalesce(v_day.requests,0)>=v_config.max_requests_per_day
    or (not v_config.tier_limits_enabled and coalesce(v_day.characters,0)+p_characters>v_config.legacy_daily_units)
    or (v_config.tier_limits_enabled and coalesce(v_monthly,0)+p_characters>v_limit)
    or (v_config.global_monthly_units is not null and v_global+p_characters>v_config.global_monthly_units)
  then raise exception 'translation_quota'; end if;
  insert into private.translation_usage(user_id,day,requests,characters)
  values(p_user,v_today,1,p_characters)
  on conflict(user_id,day) do update set
    requests=private.translation_usage.requests+1,
    characters=private.translation_usage.characters+p_characters;
  insert into private.translation_monthly_usage(user_id,period_start,requests,characters)
  values(p_user,v_month,1,p_characters)
  on conflict(user_id,period_start) do update set
    requests=private.translation_monthly_usage.requests+1,
    characters=private.translation_monthly_usage.characters+p_characters,
    updated_at=now();
end $$;
revoke all on function public.reserve_translation(uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_translation(uuid,integer) to service_role;

create or replace function public.translation_usage_for_user(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_start date:=date_trunc('month',now() at time zone 'UTC')::date;
  v_used bigint; v_limit integer; v_enabled boolean;
begin
  select coalesce(characters,0) into v_used from private.translation_monthly_usage
    where user_id=p_user and period_start=v_start;
  select t.translation_monthly_characters into v_limit from private.access_tiers t
    where t.code=private.effective_access_tier(p_user);
  select tier_limits_enabled into v_enabled from private.service_quota_config where service='deepl';
  return jsonb_build_object(
    'plan',private.effective_access_tier(p_user),'includedCharacters',v_limit,
    'usedCharacters',coalesce(v_used,0),'remainingCharacters',greatest(0,v_limit-coalesce(v_used,0)),
    'cycleStartsAt',(v_start::timestamp at time zone 'UTC'),
    'resetsAt',((v_start+interval '1 month')::timestamp at time zone 'UTC'),
    'tierLimitActive',coalesce(v_enabled,false)
  );
end $$;
revoke all on function public.translation_usage_for_user(uuid) from public,anon,authenticated;
grant execute on function public.translation_usage_for_user(uuid) to service_role;

create function private.ai_speech_character_cycle(p_user uuid)
returns table(plan text,cycle_start timestamptz,cycle_end timestamptz,allowance_characters integer)
language sql stable security definer set search_path='' as $$
  select t.code,
    (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),
    ((date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC'),
    t.cloud_tts_monthly_characters
  from private.access_tiers t where t.code=private.effective_access_tier(p_user)
$$;
revoke all on function private.ai_speech_character_cycle(uuid) from public,anon,authenticated;

create or replace function private.ai_speech_usage_snapshot(p_user uuid,p_budget_microusd bigint default 10000000)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c record; v_used bigint; v_budget_used bigint;
begin
  select * into c from private.ai_speech_character_cycle(p_user);
  select coalesce(sum(characters),0) into v_used from private.ai_speech_generations g
    where g.user_id=p_user and g.created_at>=c.cycle_start and g.created_at<c.cycle_end
      and g.status in ('reserved','generating','ready');
  select coalesce(sum(estimated_cost_microusd),0) into v_budget_used from private.ai_speech_generations g
    where g.created_at>=c.cycle_start and g.created_at<c.cycle_end
      and (g.provider_billed or g.status in ('reserved','generating','ready'));
  return jsonb_build_object(
    'plan',c.plan,'includedCharacters',c.allowance_characters,'usedCharacters',v_used,
    'remainingCharacters',greatest(0,c.allowance_characters-v_used),
    'cycleStartsAt',c.cycle_start,'resetsAt',c.cycle_end,
    'serviceAvailable',c.allowance_characters>0 and v_budget_used<p_budget_microusd,
    'budgetPaused',v_budget_used>=p_budget_microusd
  );
end $$;
revoke all on function private.ai_speech_usage_snapshot(uuid,bigint) from public,anon,authenticated;

create or replace function public.reserve_ai_speech(
  p_user uuid,p_book uuid,p_request_key text,p_fragment_hash text,p_fragment_id text,p_voice text,p_language text,
  p_rate numeric,p_characters integer,p_estimated_seconds integer,p_cost_microusd bigint,
  p_budget_microusd bigint,p_retention_days integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c record; existing private.ai_speech_generations; v_used bigint; v_active integer; v_recent integer; v_budget_used bigint; v_id uuid:=gen_random_uuid();
begin
  if p_request_key!~'^[a-f0-9]{64}$' or p_fragment_hash!~'^[a-f0-9]{64}$' or length(p_fragment_id) not between 1 and 240
    or p_voice!~'^[A-Za-z]{2,40}$' or p_language!~'^[a-z]{2,3}-[A-Z]{2}$' or p_rate not between 0.5 and 2.0
    or p_characters not between 1 and 3000 or p_estimated_seconds not between 1 and 1800
    or p_cost_microusd not between 0 and 1000000 or p_budget_microusd not between 1 and 1000000000
    or p_retention_days not between 1 and 365 then raise exception 'invalid_request'; end if;
  perform 1 from public.profiles where id=p_user for update;
  if not found then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.user_books u where u.user_id=p_user and u.book_id=p_book and u.deleted_at is null)
    then raise exception 'forbidden'; end if;
  select * into c from private.ai_speech_character_cycle(p_user);
  if c.allowance_characters=0 then raise exception 'subscription_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_request_key,0));
  delete from private.ai_speech_generations where user_id=p_user and request_key=p_request_key and expires_at<=now();
  select * into existing from private.ai_speech_generations where user_id=p_user and request_key=p_request_key for update;
  if existing.id is not null and existing.status='ready' then
    return jsonb_build_object('outcome','cached','generationId',existing.id,'audioKey',existing.audio_key,
      'durationSeconds',coalesce(existing.actual_seconds,existing.estimated_seconds),'expiresAt',existing.expires_at);
  end if;
  if existing.id is not null and existing.status in ('reserved','generating') and existing.updated_at>now()-interval '2 minutes' then
    return jsonb_build_object('outcome','pending','generationId',existing.id);
  end if;
  select count(*) into v_active from private.ai_speech_generations g where g.user_id=p_user
    and g.status in ('reserved','generating') and g.updated_at>now()-interval '2 minutes';
  if v_active>=2 then raise exception 'generation_limit'; end if;
  select count(*) into v_recent from private.ai_speech_generations g where g.user_id=p_user and g.created_at>now()-interval '1 minute';
  if v_recent>=6 then raise exception 'rate_limited'; end if;
  select coalesce(sum(characters),0) into v_used from private.ai_speech_generations g
    where g.user_id=p_user and g.created_at>=c.cycle_start and g.created_at<c.cycle_end
      and g.status in ('reserved','generating','ready');
  if v_used+p_characters>c.allowance_characters then raise exception 'ai_speech_quota'; end if;
  perform pg_advisory_xact_lock(741852963);
  select coalesce(sum(estimated_cost_microusd),0) into v_budget_used from private.ai_speech_generations g
    where g.created_at>=c.cycle_start and g.created_at<c.cycle_end
      and (g.provider_billed or g.status in ('reserved','generating','ready'));
  if v_budget_used+p_cost_microusd>p_budget_microusd then
    insert into private.ai_speech_admin_alerts(budget_month,kind,spent_microusd,budget_microusd)
    values((c.cycle_start at time zone 'UTC')::date,'budget_100',v_budget_used,p_budget_microusd) on conflict do nothing;
    return jsonb_build_object('outcome','budget_exhausted');
  end if;
  if v_budget_used+p_cost_microusd>=p_budget_microusd*8/10 then
    insert into private.ai_speech_admin_alerts(budget_month,kind,spent_microusd,budget_microusd)
    values((c.cycle_start at time zone 'UTC')::date,'budget_80',v_budget_used+p_cost_microusd,p_budget_microusd) on conflict do nothing;
  end if;
  if v_budget_used+p_cost_microusd>=p_budget_microusd*9/10 then
    insert into private.ai_speech_admin_alerts(budget_month,kind,spent_microusd,budget_microusd)
    values((c.cycle_start at time zone 'UTC')::date,'budget_90',v_budget_used+p_cost_microusd,p_budget_microusd) on conflict do nothing;
  end if;
  if v_budget_used+p_cost_microusd>=p_budget_microusd then
    insert into private.ai_speech_admin_alerts(budget_month,kind,spent_microusd,budget_microusd)
    values((c.cycle_start at time zone 'UTC')::date,'budget_100',v_budget_used+p_cost_microusd,p_budget_microusd) on conflict do nothing;
  end if;
  if existing.id is not null then
    update private.ai_speech_generations set status='reserved',error_code=null,provider_billed=false,attempts=attempts+1,
      estimated_seconds=p_estimated_seconds,characters=p_characters,estimated_cost_microusd=p_cost_microusd,
      updated_at=now(),expires_at=now()+make_interval(days=>p_retention_days) where id=existing.id returning id into v_id;
  else
    insert into private.ai_speech_generations(id,user_id,book_id,request_key,fragment_hash,fragment_id,voice_id,language_code,rate,
      characters,estimated_seconds,estimated_cost_microusd,status,expires_at)
    values(v_id,p_user,p_book,p_request_key,p_fragment_hash,p_fragment_id,p_voice,p_language,p_rate,p_characters,p_estimated_seconds,
      p_cost_microusd,'reserved',now()+make_interval(days=>p_retention_days));
  end if;
  return jsonb_build_object('outcome','reserved','generationId',v_id,'durationSeconds',p_estimated_seconds);
end $$;
revoke all on function public.reserve_ai_speech(uuid,uuid,text,text,text,text,text,numeric,integer,integer,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.reserve_ai_speech(uuid,uuid,text,text,text,text,text,numeric,integer,integer,bigint,bigint,integer) to service_role;

create or replace function public.ai_speech_usage_for_user(p_user uuid,p_budget_microusd bigint) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.ai_speech_usage_snapshot(p_user,p_budget_microusd)
$$;
revoke all on function public.ai_speech_usage_for_user(uuid,bigint) from public,anon,authenticated;
grant execute on function public.ai_speech_usage_for_user(uuid,bigint) to service_role;

commit;
