begin;

-- Binary identity remains in private.book_files/public.books. Display metadata
-- belongs to the owner so deduplicated books cannot be renamed for everyone.
alter table public.user_books
  add column display_title text check (display_title is null or length(display_title) between 1 and 500),
  add column display_author text check (display_author is null or length(display_author) <= 300),
  add column cover_path text,
  add column metadata_updated_at timestamptz not null default 'epoch'::timestamptz,
  add constraint user_book_cover_owner check (
    cover_path is null or (
      cover_path like user_id::text || '/' || book_id::text || '/%'
      and cover_path ~ '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    )
  );

-- Private, optimized cover images only. EPUB/PDF stay exclusively in R2.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('book-covers','book-covers',false,524288,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=524288,allowed_mime_types=array['image/webp'];

create policy autumn_book_cover_anonymous_boundary on storage.objects as restrictive
for all to anon using (bucket_id<>'book-covers') with check (bucket_id<>'book-covers');
create policy autumn_book_cover_boundary on storage.objects as restrictive
for all to authenticated using (
  bucket_id<>'book-covers' or (
    name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
    and split_part(name,'/',1)=(select auth.uid())::text
    and exists(select 1 from public.user_books u
      where u.user_id=(select auth.uid()) and u.book_id::text=split_part(name,'/',2) and u.deleted_at is null)
  )
) with check (
  bucket_id<>'book-covers' or (
    name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
    and split_part(name,'/',1)=(select auth.uid())::text
    and exists(select 1 from public.user_books u
      where u.user_id=(select auth.uid()) and u.book_id::text=split_part(name,'/',2) and u.deleted_at is null)
  )
);
create policy autumn_book_cover_select on storage.objects for select to authenticated
  using (bucket_id='book-covers' and split_part(name,'/',1)=(select auth.uid())::text);
create policy autumn_book_cover_insert on storage.objects for insert to authenticated
  with check (bucket_id='book-covers' and split_part(name,'/',1)=(select auth.uid())::text);
create policy autumn_book_cover_delete on storage.objects for delete to authenticated
  using (bucket_id='book-covers' and split_part(name,'/',1)=(select auth.uid())::text);

create or replace function public.sync_changes(operations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op jsonb; p jsonb; uid uuid:=auth.uid(); fid uuid; bid uuid; stamp timestamptz;
  changed integer; outcome text; results jsonb:='[]'; old_stamp timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if operations is null or jsonb_typeof(operations)<>'array' or jsonb_array_length(operations)>100 or octet_length(operations::text)>1048576 then raise exception 'invalid batch'; end if;
  for op in select value from jsonb_array_elements(operations) loop
    if op->>'entity' not in ('folder','folder_book','book_metadata') then
      results:=results||private.sync_book_changes(jsonb_build_array(op));
      continue;
    end if;
    outcome:='applied';
    begin
      p:=op->'payload'; stamp:=(p->>'updated_at')::timestamptz;
      if (p->>'user_id')::uuid is distinct from uid or stamp is null then raise exception 'forbidden' using errcode='42501'; end if;
      if stamp>now()+interval '5 minutes' then raise exception 'clock_conflict'; end if;
      perform 1 from public.profiles where id=uid for update;
      if op->>'entity'='book_metadata' then
        bid:=(p->>'book_id')::uuid;
        if not exists(select 1 from public.user_books where user_id=uid and book_id=bid and deleted_at is null) then raise exception 'forbidden' using errcode='42501'; end if;
        if p->>'title' is null or length(btrim(p->>'title')) not between 1 and 500 or length(coalesce(p->>'author',''))>300 then raise exception 'invalid metadata'; end if;
        if p->>'cover_path' is not null and (p->>'cover_path' not like uid::text||'/'||bid::text||'/%') then raise exception 'forbidden' using errcode='42501'; end if;
        update public.user_books set display_title=btrim(p->>'title'),display_author=btrim(coalesce(p->>'author','')),
          cover_path=p->>'cover_path',metadata_updated_at=stamp
          where user_id=uid and book_id=bid and metadata_updated_at<stamp;
        get diagnostics changed=row_count;
        if changed=0 then outcome:='superseded'; end if;
      elsif op->>'entity'='folder' then
        fid:=(p->>'id')::uuid;
        if exists(select 1 from public.library_folders where id=fid and user_id<>uid) then raise exception 'forbidden' using errcode='42501'; end if;
        select updated_at into old_stamp from public.library_folders where id=fid;
        if old_stamp is not null and old_stamp>=stamp then outcome:='superseded';
        else
          insert into public.library_folders(id,user_id,name,color,created_at,updated_at,deleted_at)
          values(fid,uid,btrim(p->>'name'),p->>'color',coalesce((p->>'created_at')::timestamptz,stamp),stamp,(p->>'deleted_at')::timestamptz)
          on conflict(id) do update set name=excluded.name,
            color=case when p ? 'color' then excluded.color else library_folders.color end,
            updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
          if p->>'deleted_at' is not null then
            update public.library_folder_books set folder_id=null,updated_at=greatest(updated_at,stamp) where user_id=uid and folder_id=fid;
          end if;
        end if;
      else
        bid:=(p->>'book_id')::uuid; fid:=(p->>'folder_id')::uuid;
        if not exists(select 1 from public.user_books where user_id=uid and book_id=bid and deleted_at is null) then raise exception 'forbidden' using errcode='42501'; end if;
        if fid is not null then
          if not exists(select 1 from public.library_folders where user_id=uid and id=fid) then raise exception 'forbidden' using errcode='42501'; end if;
          if exists(select 1 from public.library_folders where user_id=uid and id=fid and deleted_at is not null) then outcome:='superseded'; end if;
        end if;
        if outcome='applied' then
          insert into public.library_folder_books(user_id,book_id,folder_id,updated_at) values(uid,bid,fid,stamp)
          on conflict(user_id,book_id) do update set folder_id=excluded.folder_id,updated_at=excluded.updated_at
            where excluded.updated_at>library_folder_books.updated_at;
          get diagnostics changed=row_count;
          if changed=0 then outcome:='superseded'; end if;
        end if;
      end if;
    exception when insufficient_privilege then outcome:='forbidden';
      when others then outcome:=case when sqlerrm='clock_conflict' then 'clock_conflict' else 'invalid' end;
    end;
    results:=results||jsonb_build_array(jsonb_build_object('id',op->>'id','outcome',outcome));
  end loop;
  return results;
end $$;
revoke all on function public.sync_changes(jsonb) from public,anon;
grant execute on function public.sync_changes(jsonb) to authenticated;

commit;
