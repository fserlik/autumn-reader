begin;
-- Usage counters only. Selected text and translations are never stored here.
create table private.translation_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null, requests integer not null default 0, characters integer not null default 0,
  primary key(user_id,day), check(requests>=0 and characters>=0)
);
create index translation_usage_day on private.translation_usage(day);
alter table private.translation_usage enable row level security;
revoke all on private.translation_usage from public,anon,authenticated;
grant select on private.translation_usage to service_role;
create function public.reserve_translation(p_user uuid,p_characters integer) returns void
language plpgsql security definer set search_path='' as $$
declare used private.translation_usage; today date:=(now() at time zone 'UTC')::date;
begin
  if p_characters is null or p_characters not between 1 and 2000 then raise exception 'text_too_long'; end if;
  if not exists(select 1 from public.profiles where id=p_user) then raise exception 'forbidden'; end if;
  -- Global monthly budget and per-account limits cannot be bypassed by parallel requests.
  perform pg_advisory_xact_lock(290009);
  select * into used from private.translation_usage where user_id=p_user and day=today;
  if coalesce(used.requests,0)>=60 or coalesce(used.characters,0)+p_characters>20000
    or (select coalesce(sum(characters),0) from private.translation_usage where day>=date_trunc('month',today::timestamp)::date)+p_characters>250000 then raise exception 'translation_quota'; end if;
  insert into private.translation_usage(user_id,day,requests,characters) values(p_user,today,1,p_characters)
  on conflict(user_id,day) do update set requests=translation_usage.requests+1,characters=translation_usage.characters+p_characters;
end $$;
revoke all on function public.reserve_translation(uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_translation(uuid,integer) to service_role;
commit;
