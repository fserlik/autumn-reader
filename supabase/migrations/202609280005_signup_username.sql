begin;
-- Signup stores the requested public username atomically with the auth user.
-- Accounts created before this migration (or by administrators without metadata) retain the fallback.
create or replace function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare requested text;
begin
  requested := lower(btrim(new.raw_user_meta_data->>'username'));
  if requested is null then
    requested := 'reader_'||left(replace(new.id::text,'-',''),23);
  elsif requested !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'invalid_username' using errcode='23514';
  end if;
  -- profiles.username UNIQUE is authoritative; a collision rolls back signup.
  insert into public.profiles(id,username,display_name) values(new.id,requested,requested);
  return new;
end $$;
revoke all on function private.new_profile() from public,anon,authenticated;
commit;
