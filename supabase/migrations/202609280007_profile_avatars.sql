-- Public profile pictures only. EPUB/PDF remain exclusively in the private R2 bucket.
-- One bounded object per account; no arbitrary paths, file types or bucket listing.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',true,524288,array['image/webp','image/png'])
on conflict(id) do update set public=true,file_size_limit=524288,allowed_mime_types=array['image/webp','image/png'];

-- Restrictive boundary also protects this bucket if another existing Storage policy
-- is accidentally broad. It does not change permissions for any other bucket.
create policy autumn_avatar_boundary on storage.objects as restrictive
for all to anon,authenticated using (
  bucket_id<>'avatars' or name=(select auth.uid())::text||'/avatar'
) with check (
  bucket_id<>'avatars' or name=(select auth.uid())::text||'/avatar'
);

create policy autumn_avatar_owner_select on storage.objects
for select to authenticated using (
  bucket_id='avatars' and name=(select auth.uid())::text||'/avatar'
);
create policy autumn_avatar_owner_insert on storage.objects
for insert to authenticated with check (
  bucket_id='avatars' and name=(select auth.uid())::text||'/avatar'
);
create policy autumn_avatar_owner_update on storage.objects
for update to authenticated using (
  bucket_id='avatars' and name=(select auth.uid())::text||'/avatar'
) with check (
  bucket_id='avatars' and name=(select auth.uid())::text||'/avatar'
);
-- Public object URLs serve photos; SELECT/list through the API remains owner-only.
-- No DELETE policy is needed by the current picker/editor.
