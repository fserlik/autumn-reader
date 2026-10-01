begin;
-- Private organization, separate from public/social book_lists. Tombstones allow
-- an offline device to observe deletions without deleting any library/file row.
create table public.library_folders (
  id uuid primary key, user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check(length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null,
  deleted_at timestamptz, unique(user_id,id)
);
create table public.library_folder_books (
  user_id uuid not null, book_id uuid not null, folder_id uuid, updated_at timestamptz not null,
  primary key(user_id,book_id),
  foreign key(user_id,book_id) references public.user_books(user_id,book_id) on delete cascade,
  foreign key(user_id,folder_id) references public.library_folders(user_id,id)
);
create index library_folders_owner on public.library_folders(user_id,updated_at,id);
create index library_folder_books_folder on public.library_folder_books(user_id,folder_id,book_id);
alter table public.library_folders enable row level security;
alter table public.library_folder_books enable row level security;
revoke all on public.library_folders,public.library_folder_books from public,anon,authenticated;
grant select on public.library_folders,public.library_folder_books to authenticated;
grant all on public.library_folders,public.library_folder_books to service_role;
create policy folders_owner on public.library_folders for all to authenticated
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy folder_books_owner on public.library_folder_books for all to authenticated
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
-- All client mutations use the same timestamp/conflict rules through the outbox RPC.
-- Keep the deployed book sync logic intact, under a non-exposed schema.
alter function public.sync_changes(jsonb) rename to sync_book_changes;
alter function public.sync_book_changes(jsonb) set schema private;
revoke all on function private.sync_book_changes(jsonb) from public,anon,authenticated;
create function public.sync_changes(operations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op jsonb; p jsonb; uid uuid:=auth.uid(); fid uuid; bid uuid; stamp timestamptz;
  changed integer; outcome text; results jsonb:='[]'; old_stamp timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if operations is null or jsonb_typeof(operations)<>'array' or jsonb_array_length(operations)>100 or octet_length(operations::text)>1048576 then raise exception 'invalid batch'; end if;
  for op in select value from jsonb_array_elements(operations) loop
    if op->>'entity' not in ('folder','folder_book') then
      results:=results||private.sync_book_changes(jsonb_build_array(op));
      continue;
    end if;
    outcome:='applied';
    begin
      p:=op->'payload'; stamp:=(p->>'updated_at')::timestamptz;
      if (p->>'user_id')::uuid is distinct from uid or stamp is null then raise exception 'forbidden' using errcode='42501'; end if;
      if stamp>now()+interval '5 minutes' then raise exception 'clock_conflict'; end if;
      -- Serialize own folder/membership operations, including deletion vs late moves.
      perform 1 from public.profiles where id=uid for update;
      if op->>'entity'='folder' then
        fid:=(p->>'id')::uuid;
        if exists(select 1 from public.library_folders where id=fid and user_id<>uid) then raise exception 'forbidden' using errcode='42501'; end if;
        select updated_at into old_stamp from public.library_folders where id=fid;
        if old_stamp is not null and old_stamp>=stamp then outcome:='superseded';
        else
          insert into public.library_folders(id,user_id,name,created_at,updated_at,deleted_at)
          values(fid,uid,btrim(p->>'name'),coalesce((p->>'created_at')::timestamptz,stamp),stamp,(p->>'deleted_at')::timestamptz)
          on conflict(id) do update set name=excluded.name,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
          if p->>'deleted_at' is not null then
            update public.library_folder_books set folder_id=null,updated_at=greatest(updated_at,stamp) where user_id=uid and folder_id=fid;
          end if;
        end if;
      else
        bid:=(p->>'book_id')::uuid; fid:=(p->>'folder_id')::uuid;
        if not exists(select 1 from public.user_books where user_id=uid and book_id=bid and deleted_at is null) then raise exception 'forbidden' using errcode='42501'; end if;
        if fid is not null then
          if not exists(select 1 from public.library_folders where user_id=uid and id=fid) then raise exception 'forbidden' using errcode='42501'; end if;
          if exists(select 1 from public.library_folders where user_id=uid and id=fid and deleted_at is not null) then
            outcome:='superseded';
          end if;
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
