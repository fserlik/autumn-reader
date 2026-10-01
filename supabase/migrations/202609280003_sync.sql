begin;
create function public.sync_changes(operations jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op jsonb; p jsonb; uid uuid:=auth.uid(); bid uuid; nid uuid; stamp timestamptz; changed integer; results jsonb:='[]'; outcome text;
begin
  if uid is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if jsonb_typeof(operations)<>'array' or jsonb_array_length(operations)>100 or octet_length(operations::text)>1048576 then raise exception 'invalid batch'; end if;
  for op in select value from jsonb_array_elements(operations) loop
    outcome:='applied';
    begin
      p:=op->'payload';bid:=(p->>'book_id')::uuid;stamp:=(p->>'updated_at')::timestamptz;
      if (p->>'user_id')::uuid is distinct from uid or stamp is null then raise exception 'forbidden' using errcode='42501'; end if;
      if stamp>now()+interval '5 minutes' then raise exception 'clock_conflict'; end if;
      perform 1 from public.user_books where user_id=uid and book_id=bid for update;
      if not found then raise exception 'forbidden' using errcode='42501'; end if;
      if op->>'entity'<>'user_book' and exists(select 1 from public.user_books where user_id=uid and book_id=bid and deleted_at is not null) then raise exception 'forbidden' using errcode='42501'; end if;
      if op->>'entity'='progress' then
        insert into public.reading_progress(user_id,book_id,page,cfi,percentage,pdf_text_offset,font_size,updated_at)
        values(uid,bid,(p->>'page')::integer,p->>'cfi',(p->>'percentage')::double precision,(p->>'pdf_text_offset')::double precision,(p->>'font_size')::integer,stamp)
        on conflict(user_id,book_id) do update set page=excluded.page,cfi=excluded.cfi,percentage=excluded.percentage,pdf_text_offset=excluded.pdf_text_offset,font_size=excluded.font_size,updated_at=excluded.updated_at
          where excluded.updated_at>reading_progress.updated_at;
      elsif op->>'entity'='user_book' then
        update public.user_books set favorite=(p->>'favorite')::boolean,status=p->>'status',last_opened_at=(p->>'last_opened_at')::timestamptz,deleted_at=(p->>'deleted_at')::timestamptz,updated_at=stamp
          where user_id=uid and book_id=bid and stamp>updated_at;
      elsif op->>'entity'='note' then
        nid:=(p->>'id')::uuid;
        if exists(select 1 from public.notes where id=nid and (user_id<>uid or book_id<>bid)) then raise exception 'forbidden' using errcode='42501'; end if;
        insert into public.notes(id,user_id,book_id,format,page,y,cfi,quote,content,color,created_at,updated_at,deleted_at)
        values(nid,uid,bid,p->>'format',(p->>'page')::integer,(p->>'y')::double precision,p->>'cfi',p->>'quote',p->>'content',p->>'color',(p->>'created_at')::timestamptz,stamp,(p->>'deleted_at')::timestamptz)
        on conflict(id) do update set quote=excluded.quote,content=excluded.content,color=excluded.color,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at
          where notes.user_id=uid and notes.book_id=bid and excluded.updated_at>notes.updated_at;
      else raise exception 'invalid entity'; end if;
      get diagnostics changed=row_count;
      if changed=0 then outcome:='superseded'; end if;
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
