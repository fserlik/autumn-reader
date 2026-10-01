begin;

-- A user's logical usage, not the physical bytes of the deduplicated R2 bucket.
-- Only the authenticated owner can list these private file sizes.
create function public.cloud_storage_books(p_offset integer default 0, p_limit integer default 50, p_sort text default 'recent')
returns table(book_id uuid, title text, author text, file_size bigint, cover_path text, added_at timestamptz)
language sql stable security definer set search_path='' as $$
  select u.book_id, coalesce(u.display_title,b.title), coalesce(u.display_author,b.author),
    f.file_size,u.cover_path,u.added_at
  from public.user_books u
  join public.books b on b.id=u.book_id
  join private.book_files f on f.book_id=u.book_id
  where u.user_id=auth.uid() and u.deleted_at is null
  order by case when p_sort='size' then f.file_size end desc,
    case when p_sort='title' then lower(coalesce(u.display_title,b.title)) end asc,
    u.added_at desc,u.book_id
  limit least(greatest(coalesce(p_limit,50),1),50)
  offset greatest(coalesce(p_offset,0),0)
$$;
revoke all on function public.cloud_storage_books(integer,integer,text) from public,anon;
grant execute on function public.cloud_storage_books(integer,integer,text) to authenticated;

-- Only book-storage calls this RPC with a user ID derived from getUser(JWT).
-- Keep the relation as a tombstone: notes, progress, folders and public reviews
-- reference the book and must survive removal of the private cloud file.
create function public.remove_cloud_book(p_user uuid,p_book uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare relation public.user_books; file private.book_files; remaining bigint;
  cancelled jsonb; usage jsonb; limits private.cloud_limits;
begin
  perform 1 from public.profiles where id=p_user for update;
  if not found then raise exception 'forbidden'; end if;
  select * into relation from public.user_books
    where user_id=p_user and book_id=p_book for update;
  if not found then raise exception 'forbidden'; end if;
  select * into file from private.book_files where book_id=p_book;
  if not found then raise exception 'forbidden'; end if;
  if relation.deleted_at is null then
    update public.user_books set deleted_at=now(),updated_at=now()
      where user_id=p_user and book_id=p_book;
  end if;
  -- A retry for these bytes can no longer reserve a slot or complete after
  -- this transaction. Staging objects are removed best-effort by the handler
  -- and by the existing staging/ lifecycle rule.
  with removed as (
    delete from private.upload_intents
    where user_id=p_user and file_hash=file.file_hash and format=file.format
      and completed_at is null returning staging_key
  ) select coalesce(jsonb_agg(staging_key),'[]'::jsonb) into cancelled from removed;
  select count(*) into remaining from public.user_books
    where book_id=p_book and deleted_at is null;
  usage:=private.upload_quota_snapshot(p_user);
  select * into limits from private.cloud_limits where singleton;
  return jsonb_build_object('removed',relation.deleted_at is null,
    'remaining_references',remaining,'cancelled_staging_keys',cancelled,
    'usage',usage||jsonb_build_object('max_books',limits.max_books,'max_bytes',limits.max_bytes));
end $$;
revoke all on function public.remove_cloud_book(uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_cloud_book(uuid,uuid) to service_role;

-- A delayed outbox operation on another device must not resurrect a removed
-- relation. Only a verified book-storage upload/commit may restore it.
create function private.prevent_client_book_restore() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.deleted_at is not null and new.deleted_at is null and auth.uid() is not null then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return new;
end $$;
create trigger prevent_client_book_restore before update of deleted_at on public.user_books
  for each row execute function private.prevent_client_book_restore();
revoke all on function private.prevent_client_book_restore() from public,anon,authenticated;

commit;
