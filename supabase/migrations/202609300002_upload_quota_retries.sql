begin;

-- Keep original creation time for audit, while measuring retries separately.
-- Existing rows fall back to created_at rather than all appearing new today.
alter table private.upload_intents add column last_prepared_at timestamptz;
alter table private.upload_intents alter column last_prepared_at set default now();
create index uploads_unfinished_file on private.upload_intents(user_id,file_hash,format,file_size)
  where completed_at is null;

-- These are three different quantities: confirmed library relations, active
-- logical reservations, and distinct new files attempted during the hour.
-- An unfinished retry for the same bytes is one logical reservation.
create function private.upload_quota_snapshot(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with confirmed as (
    select count(*)::bigint as books, coalesce(sum(f.file_size),0)::bigint as bytes
    from public.user_books u left join private.book_files f on f.book_id=u.book_id
    where u.user_id=p_user and u.deleted_at is null
  ), active_files as (
    select distinct i.file_hash,i.format,i.file_size
    from private.upload_intents i
    where i.user_id=p_user and i.completed_at is null and i.expires_at>now()
      and not exists (
        select 1 from public.user_books u join private.book_files f on f.book_id=u.book_id
        where u.user_id=p_user and u.deleted_at is null
          and f.file_hash=i.file_hash and f.format=i.format
      )
  ), pending as (
    select count(*)::bigint as uploads,coalesce(sum(file_size),0)::bigint as bytes from active_files
  ), recent as (
    select count(*)::bigint as uploads from (
      select distinct file_hash,format,file_size from private.upload_intents
      where user_id=p_user and coalesce(last_prepared_at,created_at)>now()-interval '1 hour'
    ) r
  ), expired as (
    select count(*)::bigint as uploads from private.upload_intents
    where user_id=p_user and completed_at is null and expires_at<=now()
  )
  select jsonb_build_object(
    'used_books',confirmed.books,'used_bytes',confirmed.bytes,
    'active_pending_uploads',pending.uploads,'reserved_bytes',pending.bytes,
    'recent_unique_uploads',recent.uploads,'expired_reservations',expired.uploads
  ) from confirmed,pending,recent,expired
$$;
revoke all on function private.upload_quota_snapshot(uuid) from public,anon,authenticated;

create or replace function public.library_quota() returns jsonb
language sql security definer set search_path='' as $$
  select private.upload_quota_snapshot(auth.uid()) || jsonb_build_object(
    'max_books',l.max_books,'max_bytes',l.max_bytes,'max_pending_uploads',3
  ) from private.cloud_limits l where l.singleton and auth.uid() is not null
$$;
revoke all on function public.library_quota() from public,anon;
grant execute on function public.library_quota() to authenticated;

-- Preserve the trigger's final, serialized defense even if another device
-- reaches commit after a reservation expires. Report the actual dimension.
create or replace function private.enforce_library_quota() returns trigger
language plpgsql security definer set search_path='' as $$
declare limits private.cloud_limits; used_count bigint; used_size bigint; added_size bigint;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op='UPDATE' and old.deleted_at is null then return new; end if;
  perform 1 from public.profiles where id=new.user_id for update;
  select * into limits from private.cloud_limits where singleton;
  select count(*),coalesce(sum(f.file_size),0) into used_count,used_size
    from public.user_books u left join private.book_files f on f.book_id=u.book_id
    where u.user_id=new.user_id and u.deleted_at is null and u.book_id<>new.book_id;
  select file_size into added_size from private.book_files where book_id=new.book_id;
  if used_count>=limits.max_books then raise exception 'book_limit'; end if;
  if used_size+coalesce(added_size,0)>limits.max_bytes then raise exception 'storage_limit'; end if;
  return new;
end $$;
revoke all on function private.enforce_library_quota() from public,anon,authenticated;

create or replace function public.reserve_book_upload(
  p_user uuid,p_hash text,p_format text,p_size bigint,p_title text,p_author text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid(); v_owned uuid; v_existing private.upload_intents;
  usage jsonb; decision_details jsonb; limits private.cloud_limits; v_recent_same boolean;
begin
  if p_hash !~ '^[a-f0-9]{64}$' or p_format not in ('pdf','epub')
    or p_size not between 1 and 33554432 or length(btrim(p_title)) not between 1 and 500
    or length(p_author)>300 then raise exception 'invalid_format'; end if;
  -- This row lock serializes prepares, commits and quota-trigger inserts for
  -- one account, including requests from different devices.
  perform 1 from public.profiles where id=p_user for update;
  if not found then raise exception 'forbidden'; end if;
  delete from private.upload_intents where user_id=p_user and completed_at is null
    and expires_at<now()-interval '1 day';
  select f.book_id into v_owned from private.book_files f
    join public.user_books u on u.book_id=f.book_id
    where f.file_hash=p_hash and f.format=p_format and u.user_id=p_user and u.deleted_at is null;
  if v_owned is not null then return jsonb_build_object('book_id',v_owned,'owned',true); end if;

  -- Reuse even close to expiry: extend this intent instead of allocating a
  -- second staging key/slot. A previous failed PUT can be retried safely.
  select * into v_existing from private.upload_intents i
    where i.user_id=p_user and i.file_hash=p_hash and i.format=p_format
      and i.file_size=p_size and i.completed_at is null
    order by (i.expires_at>now()) desc,i.created_at desc limit 1 for update;
  if found and v_existing.expires_at>now() then
    update private.upload_intents set expires_at=greatest(expires_at,now()+interval '15 minutes'),
      last_prepared_at=now()
      where id=v_existing.id returning * into v_existing;
    return to_jsonb(v_existing);
  end if;

  select * into limits from private.cloud_limits where singleton;
  usage:=private.upload_quota_snapshot(p_user);
  decision_details:=usage||jsonb_build_object('requested_bytes',p_size,
    'max_books',limits.max_books,'max_bytes',limits.max_bytes,'max_pending_uploads',3);
  if (usage->>'used_books')::bigint+(usage->>'active_pending_uploads')::bigint>=limits.max_books
    then raise exception 'book_limit' using detail=decision_details::text; end if;
  if (usage->>'used_bytes')::bigint+(usage->>'reserved_bytes')::bigint+p_size>limits.max_bytes
    then raise exception 'storage_limit' using detail=decision_details::text; end if;
  if (usage->>'active_pending_uploads')::bigint>=3
    then raise exception 'pending_upload_limit' using detail=decision_details::text; end if;
  select exists(select 1 from private.upload_intents where user_id=p_user
    and file_hash=p_hash and format=p_format and file_size=p_size
    and coalesce(last_prepared_at,created_at)>now()-interval '1 hour') into v_recent_same;
  if (usage->>'recent_unique_uploads')::bigint>=60 and not v_recent_same
    then raise exception 'upload_rate_limited' using detail=decision_details::text; end if;
  if v_existing.id is not null then
    update private.upload_intents set expires_at=now()+interval '15 minutes',last_prepared_at=now()
      where id=v_existing.id returning * into v_existing;
  else
    insert into private.upload_intents(id,user_id,file_hash,format,file_size,title,author,staging_key)
      values(v_id,p_user,p_hash,p_format,p_size,p_title,p_author,'staging/'||p_user::text||'/'||v_id::text)
      returning * into v_existing;
  end if;
  return to_jsonb(v_existing);
end $$;
revoke all on function public.reserve_book_upload(uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.reserve_book_upload(uuid,text,text,bigint,text,text) to service_role;

-- Match reserve's lock order (profile, then intent). The previous completion
-- locked the intent first, which could deadlock against a concurrent retry.
create or replace function public.complete_book_upload(p_user uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.upload_intents; v_book uuid;
begin
  perform 1 from public.profiles where id=p_user for update;
  if not found then raise exception 'forbidden'; end if;
  select * into i from private.upload_intents where id=p_id and user_id=p_user for update;
  if not found or (i.expires_at<now() and i.completed_at is null) then raise exception 'forbidden'; end if;
  if i.completed_at is not null then return jsonb_build_object('book_id',i.book_id); end if;
  perform pg_advisory_xact_lock(hashtextextended(i.file_hash||i.format,0));
  select book_id into v_book from private.book_files where file_hash=i.file_hash and format=i.format;
  if v_book is null then
    insert into public.books(title,author,format) values(i.title,i.author,i.format) returning id into v_book;
    insert into private.book_files(book_id,file_hash,format,file_size,r2_key)
      values(v_book,i.file_hash,i.format,i.file_size,'books/'||i.file_hash||'.'||i.format);
  end if;
  insert into public.user_books(user_id,book_id) values(p_user,v_book)
    on conflict(user_id,book_id) do update set deleted_at=null,updated_at=now();
  update private.upload_intents set book_id=v_book,completed_at=now() where id=p_id;
  return jsonb_build_object('book_id',v_book);
end $$;
revoke all on function public.complete_book_upload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_book_upload(uuid,uuid) to service_role;

-- Only already-expired, unfinished checkpoints can be removed. Active
-- uploads and completed idempotency records are untouched; the R2 lifecycle
-- rule for staging/ handles the matching orphaned objects.
delete from private.upload_intents where completed_at is null and expires_at<now()-interval '1 day';

commit;
