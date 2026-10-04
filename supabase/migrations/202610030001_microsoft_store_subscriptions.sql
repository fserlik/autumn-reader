begin;

-- Only the service role used by the Microsoft Store verifier can change paid
-- access. The browser and native client never receive write access here.
create function public.sync_microsoft_store_subscription(
  p_user uuid,
  p_plan text,
  p_status text,
  p_cycle text,
  p_external text,
  p_starts timestamptz,
  p_expires timestamptz,
  p_grace timestamptz default null
) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_user is null or p_plan not in ('plus','pro')
    or p_status not in ('trialing','active','past_due')
    or p_cycle not in ('monthly','annual')
    or coalesce(length(p_external),0) not between 3 and 300
    or p_starts is null or p_expires is null then
    raise exception 'invalid_subscription';
  end if;
  if p_status='past_due' and (p_grace is null or p_grace<=now()) then
    raise exception 'invalid_subscription';
  end if;
  insert into private.account_subscriptions(
    user_id,plan_code,status,billing_cycle,provider,external_subscription_id,
    starts_at,renews_at,expires_at,grace_until,updated_at
  ) values(
    p_user,p_plan,p_status,p_cycle,'microsoft_store',p_external,
    p_starts,case when p_status in ('active','trialing') then p_expires else null end,
    p_expires,p_grace,now()
  ) on conflict(user_id) do update set
    plan_code=excluded.plan_code,status=excluded.status,billing_cycle=excluded.billing_cycle,
    provider=excluded.provider,external_subscription_id=excluded.external_subscription_id,
    starts_at=excluded.starts_at,renews_at=excluded.renews_at,
    expires_at=excluded.expires_at,grace_until=excluded.grace_until,updated_at=now();
end $$;
revoke all on function public.sync_microsoft_store_subscription(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_microsoft_store_subscription(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz) to service_role;

create function public.expire_microsoft_store_subscription(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update private.account_subscriptions set status='expired',renews_at=null,
    grace_until=null,updated_at=now()
  where user_id=p_user and provider='microsoft_store';
end $$;
revoke all on function public.expire_microsoft_store_subscription(uuid) from public,anon,authenticated;
grant execute on function public.expire_microsoft_store_subscription(uuid) to service_role;

commit;
