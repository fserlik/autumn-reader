begin;

-- Allow Lemon Squeezy as a billing provider.
alter table private.subscriptions
  drop constraint if exists subscriptions_provider_check;

alter table private.subscriptions
  add constraint subscriptions_provider_check
  check(provider in (
    'paddle',
    'lemonsqueezy',
    'google_play',
    'apple',
    'microsoft_store',
    'manual'
  ));

alter table private.billing_webhook_events
  drop constraint if exists billing_webhook_events_provider_check;

alter table private.billing_webhook_events
  add constraint billing_webhook_events_provider_check
  check(provider in (
    'paddle',
    'lemonsqueezy',
    'google_play',
    'apple',
    'microsoft_store',
    'manual'
  ));

-- Return the billing identity for the current supported web billing provider.
create or replace function public.billing_customer(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'provider', s.provider,
    'customerId', s.provider_customer_id,
    'subscriptionId', s.provider_subscription_id
  )
  from private.subscriptions s
  where s.user_id = p_user
    and s.provider in ('lemonsqueezy', 'paddle')
  order by
    case when s.provider = 'lemonsqueezy' then 0 else 1 end
  limit 1
$$;

revoke all on function public.billing_customer(uuid)
  from public, anon, authenticated;

grant execute on function public.billing_customer(uuid)
  to service_role;


-- Same provider-agnostic billing processor, now accepting Lemon Squeezy.
create or replace function public.process_billing_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_user uuid default null,
  p_provider_customer_id text default null,
  p_provider_subscription_id text default null,
  p_plan text default null,
  p_billing_period text default null,
  p_status text default null,
  p_current_period_start timestamptz default null,
  p_current_period_end timestamptz default null,
  p_cancel_at_period_end boolean default false
) returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_inserted integer;
  v_user uuid := p_user;
begin
  if p_provider not in (
    'paddle',
    'lemonsqueezy',
    'google_play',
    'apple',
    'microsoft_store',
    'manual'
  )
    or coalesce(length(p_event_id), 0) not between 3 and 200
    or coalesce(length(p_event_type), 0) not between 3 and 120
    or p_occurred_at is null
  then
    raise exception 'invalid_billing_event';
  end if;

  insert into private.billing_webhook_events(
    provider,
    event_id,
    event_type,
    occurred_at
  )
  values(
    p_provider,
    p_event_id,
    p_event_type,
    p_occurred_at
  )
  on conflict(provider, event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return false;
  end if;

  -- Keep compatibility with Paddle and normalize Lemon Squeezy failures
  -- to the same internal behavior.
  if p_event_type in (
    'transaction.payment_failed',
    'subscription_payment_failed'
  ) then

    update private.subscriptions
    set
      status = 'past_due',
      grace_until = greatest(
        coalesce(current_period_end, now()),
        now() + interval '3 days'
      ),
      updated_at = now(),
      provider_updated_at = p_occurred_at
    where provider = p_provider
      and provider_subscription_id = p_provider_subscription_id
      and provider_updated_at <= p_occurred_at
      and status not in ('canceled', 'expired');

    return true;
  end if;

  if p_event_type not like 'subscription.%'
     and p_event_type not like 'subscription_%'
  then
    return true;
  end if;

  if v_user is null and p_provider_subscription_id is not null then
    select user_id
      into v_user
    from private.subscriptions
    where provider = p_provider
      and provider_subscription_id = p_provider_subscription_id;
  end if;

  if v_user is null
    or p_plan not in ('plus', 'pro')
    or p_billing_period not in ('monthly', 'annual')
    or p_status not in ('active', 'trialing', 'past_due', 'canceled', 'expired')
    or coalesce(length(p_provider_customer_id), 0) not between 3 and 200
    or coalesce(length(p_provider_subscription_id), 0) not between 3 and 200
  then
    raise exception 'invalid_subscription_event';
  end if;

  insert into private.subscriptions(
    user_id,
    provider,
    provider_customer_id,
    provider_subscription_id,
    plan,
    billing_period,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    grace_until,
    provider_updated_at,
    updated_at
  )
  values(
    v_user,
    p_provider,
    p_provider_customer_id,
    p_provider_subscription_id,
    p_plan,
    p_billing_period,
    p_status,
    p_current_period_start,
    p_current_period_end,
    p_cancel_at_period_end,
    case
      when p_status = 'past_due'
      then greatest(
        coalesce(p_current_period_end, now()),
        now() + interval '3 days'
      )
    end,
    p_occurred_at,
    now()
  )
  on conflict(user_id) do update set
    provider = excluded.provider,
    provider_customer_id = excluded.provider_customer_id,
    provider_subscription_id = excluded.provider_subscription_id,
    plan = excluded.plan,
    billing_period = excluded.billing_period,
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    grace_until = excluded.grace_until,
    provider_updated_at = excluded.provider_updated_at,
    updated_at = now()
  where private.subscriptions.provider_updated_at
        <= excluded.provider_updated_at;

  return true;
end
$$;

revoke all on function public.process_billing_event(
  text,
  text,
  text,
  timestamptz,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  boolean
) from public, anon, authenticated;

grant execute on function public.process_billing_event(
  text,
  text,
  text,
  timestamptz,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  boolean
) to service_role;

commit;