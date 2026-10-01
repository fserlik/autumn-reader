begin;
-- Operator configuration, never writable by clients. Local storage is not subject to these limits.
create table private.cloud_limits (
  singleton boolean primary key default true check(singleton),
  max_books integer not null check(max_books>0),
  max_bytes bigint not null check(max_bytes>0)
);
insert into private.cloud_limits(singleton,max_books,max_bytes) values(true,1000,1073741824);
alter table private.cloud_limits enable row level security;
revoke all on private.cloud_limits from public,anon,authenticated;
grant select,update on private.cloud_limits to service_role;

create function public.library_quota() returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('used_books',count(u.id),'max_books',l.max_books,
    'used_bytes',coalesce(sum(f.file_size),0),'max_bytes',l.max_bytes)
  from private.cloud_limits l
  left join public.user_books u on u.user_id=auth.uid() and u.deleted_at is null
  left join private.book_files f on f.book_id=u.book_id
  where l.singleton and auth.uid() is not null group by l.max_books,l.max_bytes
$$;
revoke all on function public.library_quota() from public,anon;
grant execute on function public.library_quota() to authenticated;

-- Enforce limits for every insertion/restoration, including sync and direct database requests.
create function private.enforce_library_quota() returns trigger language plpgsql security definer set search_path='' as $$
declare max_count integer; max_size bigint; used_count bigint; used_size bigint; added_size bigint;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op='UPDATE' and old.deleted_at is null then return new; end if;
  perform 1 from public.profiles where id=new.user_id for update;
  select max_books,max_bytes into max_count,max_size from private.cloud_limits where singleton;
  select count(*),coalesce(sum(f.file_size),0) into used_count,used_size
    from public.user_books u join private.book_files f on f.book_id=u.book_id
    where u.user_id=new.user_id and u.deleted_at is null and u.book_id<>new.book_id;
  select file_size into added_size from private.book_files where book_id=new.book_id;
  if used_count>=max_count or used_size+coalesce(added_size,0)>max_size then
    raise exception 'quota_exceeded';
  end if;
  return new;
end $$;
create trigger library_quota before insert or update of deleted_at on public.user_books
  for each row execute function private.enforce_library_quota();
revoke all on function private.enforce_library_quota() from public,anon,authenticated;

create or replace function public.reserve_book_upload(p_user uuid,p_hash text,p_format text,p_size bigint,p_title text,p_author text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid(); v_owned uuid; v_used bigint; v_pending bigint; v_existing jsonb; limits private.cloud_limits;
begin
  if p_hash !~ '^[a-f0-9]{64}$' or p_format not in ('pdf','epub') or p_size not between 1 and 33554432 then raise exception 'invalid_format'; end if;
  perform 1 from public.profiles where id=p_user for update;
  if not found then raise exception 'forbidden'; end if;
  select f.book_id into v_owned from private.book_files f join public.user_books u on u.book_id=f.book_id where f.file_hash=p_hash and f.format=p_format and u.user_id=p_user and u.deleted_at is null;
  if v_owned is not null then return jsonb_build_object('book_id',v_owned,'owned',true); end if;
  select to_jsonb(i) into v_existing from private.upload_intents i where user_id=p_user and file_hash=p_hash and format=p_format and file_size=p_size and completed_at is null and expires_at>now()+interval '5 minutes' order by created_at limit 1;
  if v_existing is not null then return v_existing; end if;
  select * into limits from private.cloud_limits where singleton;
  select coalesce(sum(f.file_size),0) into v_used from public.user_books u join private.book_files f on f.book_id=u.book_id where u.user_id=p_user and u.deleted_at is null;
  select coalesce(sum(file_size),0) into v_pending from private.upload_intents where user_id=p_user and completed_at is null and expires_at>now();
  if v_used+v_pending+p_size>limits.max_bytes
    or (select count(*) from private.upload_intents where user_id=p_user and completed_at is null and expires_at>now())>=3
    or (select count(*) from public.user_books where user_id=p_user and deleted_at is null)
       +(select count(*) from private.upload_intents where user_id=p_user and completed_at is null and expires_at>now())>=limits.max_books
    or (select count(*) from private.upload_intents where user_id=p_user and created_at>now()-interval '1 hour')>=60 then raise exception 'quota_exceeded'; end if;
  insert into private.upload_intents(id,user_id,file_hash,format,file_size,title,author,staging_key)
    values(v_id,p_user,p_hash,p_format,p_size,p_title,p_author,'staging/'||p_user::text||'/'||v_id::text);
  return (select to_jsonb(i) from private.upload_intents i where id=v_id);
end $$;
revoke all on function public.reserve_book_upload(uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.reserve_book_upload(uuid,text,text,bigint,text,text) to service_role;
commit;
