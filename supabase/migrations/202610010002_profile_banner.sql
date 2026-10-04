begin;

alter table public.profiles add column if not exists banner_url text
  check (banner_url is null or (banner_url like 'https://%' and length(banner_url) <= 2000));
grant update(banner_url) on public.profiles to authenticated;

-- Reuse the public profile-image bucket. Only the two fixed paths owned by the
-- authenticated user can be written; no arbitrary object names become writable.
update storage.buckets set file_size_limit = 1048576 where id = 'avatars';
drop policy if exists autumn_avatar_boundary on storage.objects;
create policy autumn_avatar_boundary on storage.objects as restrictive
for all to anon,authenticated using (
  bucket_id <> 'avatars' or name in ((select auth.uid())::text || '/avatar', (select auth.uid())::text || '/banner')
) with check (
  bucket_id <> 'avatars' or name in ((select auth.uid())::text || '/avatar', (select auth.uid())::text || '/banner')
);
drop policy if exists autumn_avatar_owner_select on storage.objects;
drop policy if exists autumn_avatar_owner_insert on storage.objects;
drop policy if exists autumn_avatar_owner_update on storage.objects;
create policy autumn_avatar_owner_select on storage.objects for select to authenticated
using (bucket_id = 'avatars' and name in ((select auth.uid())::text || '/avatar', (select auth.uid())::text || '/banner'));
create policy autumn_avatar_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and name in ((select auth.uid())::text || '/avatar', (select auth.uid())::text || '/banner'));
create policy autumn_avatar_owner_update on storage.objects for update to authenticated
using (bucket_id = 'avatars' and name in ((select auth.uid())::text || '/avatar', (select auth.uid())::text || '/banner'))
with check (bucket_id = 'avatars' and name in ((select auth.uid())::text || '/avatar', (select auth.uid())::text || '/banner'));

commit;
