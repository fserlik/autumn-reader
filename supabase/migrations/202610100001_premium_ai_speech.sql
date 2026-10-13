begin;

create table private.ai_speech_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  request_key text not null,
  fragment_hash text not null,
  fragment_id text not null,
  provider text not null default 'amazon_polly' check(provider='amazon_polly'),
  voice_id text not null,
  language_code text not null,
  rate numeric(3,1) not null check(rate between 0.5 and 2.0),
  characters integer not null check(characters between 1 and 3000),
  estimated_seconds integer not null check(estimated_seconds>0),
  actual_seconds integer check(actual_seconds>0),
  estimated_cost_microusd bigint not null check(estimated_cost_microusd>=0),
  status text not null check(status in ('reserved','generating','ready','failed')),
  audio_key text,
  provider_billed boolean not null default false,
  error_code text,
  attempts smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(user_id,request_key),
  check((status='ready' and audio_key is not null) or status<>'ready')
);
create index ai_speech_user_cycle on private.ai_speech_generations(user_id,created_at);
create index ai_speech_retention on private.ai_speech_generations(expires_at) where status='ready';
alter table private.ai_speech_generations enable row level security;
revoke all on private.ai_speech_generations from public,anon,authenticated;
grant select,insert,update,delete on private.ai_speech_generations to service_role;

create table private.ai_speech_admin_alerts (
  id bigint generated always as identity primary key,
  budget_month date not null,
  kind text not null check(kind in ('budget_80','budget_100')),
  spent_microusd bigint not null,
  budget_microusd bigint not null,
  created_at timestamptz not null default now(),
  unique(budget_month,kind)
);
alter table private.ai_speech_admin_alerts enable row level security;
revoke all on private.ai_speech_admin_alerts from public,anon,authenticated;
grant select,insert,update,delete on private.ai_speech_admin_alerts to service_role;

create function private.ai_speech_cycle(p_user uuid)
returns table(plan text,cycle_start timestamptz,cycle_end timestamptz,allowance_seconds integer)
language plpgsql stable security definer set search_path='' as $$
declare v_plan text; v_anchor timestamptz; v_subscription_end timestamptz; v_months integer;
begin
  v_plan:=private.effective_plan_code(p_user);
  if v_plan='free' then
    return query select v_plan,date_trunc('month',now()),date_trunc('month',now())+interval '1 month',0;
    return;
  end if;
  select coalesce(s.current_period_start,date_trunc('month',now())),s.current_period_end
    into v_anchor,v_subscription_end from private.subscriptions s where s.user_id=p_user;
  v_anchor:=coalesce(v_anchor,date_trunc('month',now()));
  v_months:=greatest(0,(extract(year from age(now(),v_anchor))::integer*12)+extract(month from age(now(),v_anchor))::integer);
  cycle_start:=v_anchor+make_interval(months=>v_months);
  if cycle_start>now() then cycle_start:=v_anchor+make_interval(months=>greatest(0,v_months-1)); end if;
  cycle_end:=cycle_start+interval '1 month';
  if v_subscription_end is not null then cycle_end:=least(cycle_end,v_subscription_end); end if;
  plan:=v_plan; allowance_seconds:=case v_plan when 'plus' then 3600 when 'pro' then 10800 else 0 end;
  return next;
end $$;
revoke all on function private.ai_speech_cycle(uuid) from public,anon,authenticated;

create function private.ai_speech_usage_snapshot(p_user uuid,p_budget_microusd bigint default 10000000)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c record; v_used bigint; v_budget_used bigint;
begin
  select * into c from private.ai_speech_cycle(p_user);
  select coalesce(sum(coalesce(actual_seconds,estimated_seconds)),0) into v_used
    from private.ai_speech_generations g where g.user_id=p_user and g.created_at>=c.cycle_start and g.created_at<c.cycle_end
      and g.status in ('reserved','generating','ready');
  select coalesce(sum(estimated_cost_microusd),0) into v_budget_used from private.ai_speech_generations g
    where g.created_at>=date_trunc('month',now()) and g.created_at<date_trunc('month',now())+interval '1 month'
      and (g.provider_billed or g.status in ('reserved','generating','ready'));
  return jsonb_build_object('plan',c.plan,'includedSeconds',c.allowance_seconds,'usedSeconds',v_used,
    'remainingSeconds',greatest(0,c.allowance_seconds-v_used),'cycleStartsAt',c.cycle_start,'resetsAt',c.cycle_end,
    'serviceAvailable',c.allowance_seconds>0 and v_budget_used<p_budget_microusd,'budgetPaused',v_budget_used>=p_budget_microusd);
end $$;
revoke all on function private.ai_speech_usage_snapshot(uuid,bigint) from public,anon,authenticated;

create function public.reserve_ai_speech(
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
  select * into c from private.ai_speech_cycle(p_user);
  if c.allowance_seconds=0 then raise exception 'subscription_required'; end if;
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
  select coalesce(sum(coalesce(actual_seconds,estimated_seconds)),0) into v_used from private.ai_speech_generations g
    where g.user_id=p_user and g.created_at>=c.cycle_start and g.created_at<c.cycle_end and g.status in ('reserved','generating','ready');
  if v_used+p_estimated_seconds>c.allowance_seconds then raise exception 'ai_speech_quota'; end if;
  perform pg_advisory_xact_lock(741852963);
  select coalesce(sum(estimated_cost_microusd),0) into v_budget_used from private.ai_speech_generations g
    where g.created_at>=date_trunc('month',now()) and g.created_at<date_trunc('month',now())+interval '1 month'
      and (g.provider_billed or g.status in ('reserved','generating','ready'));
  if v_budget_used+p_cost_microusd>p_budget_microusd then
    insert into private.ai_speech_admin_alerts(budget_month,kind,spent_microusd,budget_microusd)
      values(date_trunc('month',now())::date,'budget_100',v_budget_used,p_budget_microusd) on conflict do nothing;
    raise exception 'global_budget';
  end if;
  if v_budget_used+p_cost_microusd>=p_budget_microusd*8/10 then
    insert into private.ai_speech_admin_alerts(budget_month,kind,spent_microusd,budget_microusd)
      values(date_trunc('month',now())::date,'budget_80',v_budget_used+p_cost_microusd,p_budget_microusd) on conflict do nothing;
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

create function public.mark_ai_speech_generating(p_user uuid,p_id uuid) returns boolean
language sql security definer set search_path='' as $$
  update private.ai_speech_generations set status='generating',updated_at=now()
    where id=p_id and user_id=p_user and status='reserved' returning true
$$;
revoke all on function public.mark_ai_speech_generating(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_ai_speech_generating(uuid,uuid) to service_role;

create function public.complete_ai_speech(p_user uuid,p_id uuid,p_audio_key text,p_actual_seconds integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g private.ai_speech_generations;
begin
  if p_audio_key!~('^ai-speech/'||p_user::text||'/[a-f0-9-]+/[a-f0-9]{64}\.mp3$') then raise exception 'forbidden'; end if;
  update private.ai_speech_generations set status='ready',audio_key=p_audio_key,provider_billed=true,
    actual_seconds=case when p_actual_seconds between 1 and 1800 then p_actual_seconds else null end,updated_at=now()
    where id=p_id and user_id=p_user and status='generating' returning * into g;
  if g.id is null then raise exception 'generation_conflict'; end if;
  return jsonb_build_object('generationId',g.id,'audioKey',g.audio_key,'durationSeconds',coalesce(g.actual_seconds,g.estimated_seconds),'expiresAt',g.expires_at);
end $$;
revoke all on function public.complete_ai_speech(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.complete_ai_speech(uuid,uuid,text,integer) to service_role;

create function public.fail_ai_speech(p_user uuid,p_id uuid,p_error text,p_provider_billed boolean default false) returns boolean
language sql security definer set search_path='' as $$
  update private.ai_speech_generations set status='failed',error_code=left(p_error,80),provider_billed=p_provider_billed,updated_at=now()
    where id=p_id and user_id=p_user and status in ('reserved','generating') returning true
$$;
revoke all on function public.fail_ai_speech(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.fail_ai_speech(uuid,uuid,text,boolean) to service_role;

create function public.ai_speech_usage_for_user(p_user uuid,p_budget_microusd bigint) returns jsonb
language sql stable security definer set search_path='' as $$ select private.ai_speech_usage_snapshot(p_user,p_budget_microusd) $$;
revoke all on function public.ai_speech_usage_for_user(uuid,bigint) from public,anon,authenticated;
grant execute on function public.ai_speech_usage_for_user(uuid,bigint) to service_role;

commit;
