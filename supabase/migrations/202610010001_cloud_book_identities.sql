begin;

-- The hash is private file metadata. Expose it only for files in the
-- authenticated user's active library, so clients can reconcile cached bytes
-- before considering an R2 download or a new upload.
create function public.cloud_book_identities()
returns table(book_id uuid, file_hash text, format text, file_size bigint)
language sql stable security definer set search_path='' as $$
  select f.book_id, f.file_hash, f.format, f.file_size
  from public.user_books u
  join private.book_files f on f.book_id=u.book_id
  where u.user_id=auth.uid() and u.deleted_at is null
$$;
revoke all on function public.cloud_book_identities() from public,anon;
grant execute on function public.cloud_book_identities() to authenticated;

commit;
