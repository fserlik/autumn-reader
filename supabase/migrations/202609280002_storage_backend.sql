begin;
-- Privileged API: only service_role may invoke. Identity is verified by the Edge handler.
create function public.reserve_book_upload(p_user uuid,p_hash text,p_format text,p_size bigint,p_title text,p_author text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid(); v_owned uuid; v_used bigint; v_pending bigint; v_existing jsonb;
begin
  if p_hash !~ '^[a-f0-9]{64}$' or p_format not in ('pdf','epub') or p_size not between 1 and 33554432 then raise exception 'invalid_format'; end if;
  perform 1 from public.profiles where id=p_user for update;
  if not found then raise exception 'forbidden'; end if;
  select f.book_id into v_owned from private.book_files f join public.user_books u on u.book_id=f.book_id where f.file_hash=p_hash and f.format=p_format and u.user_id=p_user and u.deleted_at is null;
  if v_owned is not null then return jsonb_build_object('book_id',v_owned,'owned',true); end if;
  select to_jsonb(i) into v_existing from private.upload_intents i where user_id=p_user and file_hash=p_hash and format=p_format and file_size=p_size and completed_at is null and expires_at>now()+interval '5 minutes' order by created_at limit 1;
  if v_existing is not null then return v_existing; end if;
  select coalesce(sum(f.file_size),0) into v_used from public.user_books u join private.book_files f on f.book_id=u.book_id where u.user_id=p_user and u.deleted_at is null;
  select coalesce(sum(file_size),0) into v_pending from private.upload_intents where user_id=p_user and completed_at is null and expires_at>now();
  if v_used+v_pending+p_size>1073741824 or (select count(*) from private.upload_intents where user_id=p_user and completed_at is null and expires_at>now())>=3
    or (select count(*) from public.user_books where user_id=p_user and deleted_at is null)>=1000
    or (select count(*) from private.upload_intents where user_id=p_user and created_at>now()-interval '1 hour')>=60 then raise exception 'quota_exceeded'; end if;
  insert into private.upload_intents(id,user_id,file_hash,format,file_size,title,author,staging_key)
    values(v_id,p_user,p_hash,p_format,p_size,p_title,p_author,'staging/'||p_user::text||'/'||v_id::text);
  return (select to_jsonb(i) from private.upload_intents i where id=v_id);
end $$;
create function public.get_upload_intent(p_user uuid,p_id uuid) returns jsonb language sql security definer set search_path='' as $$
select to_jsonb(i) from private.upload_intents i where id=p_id and user_id=p_user and (expires_at>now() or completed_at is not null)
$$;
create function public.complete_book_upload(p_user uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.upload_intents; v_book uuid;
begin
  select * into i from private.upload_intents where id=p_id and user_id=p_user for update;
  if not found or (i.expires_at<now() and i.completed_at is null) then raise exception 'forbidden'; end if;
  if i.completed_at is not null then return jsonb_build_object('book_id',i.book_id); end if;
  -- Serialize metadata creation for the same content, independently of user and concurrent upload.
  perform pg_advisory_xact_lock(hashtextextended(i.file_hash||i.format,0));
  select book_id into v_book from private.book_files where file_hash=i.file_hash and format=i.format;
  if v_book is null then
    insert into public.books(title,author,format) values(i.title,i.author,i.format) returning id into v_book;
    insert into private.book_files(book_id,file_hash,format,file_size,r2_key) values(v_book,i.file_hash,i.format,i.file_size,'books/'||i.file_hash||'.'||i.format);
  end if;
  insert into public.user_books(user_id,book_id) values(p_user,v_book) on conflict(user_id,book_id) do update set deleted_at=null,updated_at=now();
  update private.upload_intents set book_id=v_book,completed_at=now() where id=p_id;
  return jsonb_build_object('book_id',v_book);
end $$;
create function public.authorize_book_download(p_user uuid,p_book uuid) returns jsonb language sql security definer set search_path='' as $$
select to_jsonb(f) from private.book_files f join public.user_books u on u.book_id=f.book_id where f.book_id=p_book and u.user_id=p_user and u.deleted_at is null
$$;
revoke all on function public.reserve_book_upload(uuid,text,text,bigint,text,text),public.get_upload_intent(uuid,uuid),public.complete_book_upload(uuid,uuid),public.authorize_book_download(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_book_upload(uuid,text,text,bigint,text,text),public.get_upload_intent(uuid,uuid),public.complete_book_upload(uuid,uuid),public.authorize_book_download(uuid,uuid) to service_role;
commit;
