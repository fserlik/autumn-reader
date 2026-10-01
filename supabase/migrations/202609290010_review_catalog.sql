begin;

-- Catalog metadata does not grant file access or create a cloud library relation.
create table private.review_catalog_books (
  book_id uuid primary key references public.books(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.review_catalog_books enable row level security;
revoke all on private.review_catalog_books from public, anon, authenticated;
create index review_catalog_owner_date on private.review_catalog_books(user_id,created_at);

create function public.publish_book_review(
  p_book_id uuid, p_title text, p_author text, p_format text, p_rating integer, p_text text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_review public.reviews;
begin
  if v_user is null then raise exception 'Inicia sesión para publicar una reseña.'; end if;
  if p_book_id is null or p_rating is null or p_rating not between 1 and 5
    or p_text is null or char_length(p_text)>10000 then
    raise exception 'La reseña requiere 1–5 estrellas y un comentario de hasta 10000 caracteres.';
  end if;
  -- Serialize catalog creation by account and retain receipts even after review deletion.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':review-catalog',0));
  if not exists(select 1 from public.books where id=p_book_id) then
    if p_title is null or char_length(pg_catalog.btrim(p_title)) not between 1 and 500
      or p_author is null or char_length(p_author)>300 or p_format is null or p_format not in ('epub','pdf') then
      raise exception 'Revisa el título, autor y formato del libro.';
    end if;
    if (select count(*) from private.review_catalog_books where user_id=v_user and created_at>now()-interval '24 hours')>=100 then
      raise exception 'Alcanzaste el límite de 100 libros nuevos reseñados en 24 horas. Tu borrador se conserva.';
    end if;
    insert into public.books(id,title,author,format) values(p_book_id,pg_catalog.btrim(p_title),p_author,p_format)
      on conflict(id) do nothing;
    if found then
      insert into private.review_catalog_books(book_id,user_id) values(p_book_id,v_user);
    end if;
  end if;
  -- Never change existing catalog metadata, file authorization or another account's review.
  insert into public.reviews(user_id,book_id,rating,text) values(v_user,p_book_id,p_rating,p_text)
    on conflict(user_id,book_id) do update set rating=excluded.rating,text=excluded.text
    returning * into v_review;
  return pg_catalog.jsonb_build_object('review',pg_catalog.to_jsonb(v_review),'book',(select pg_catalog.to_jsonb(b) from public.books b where b.id=p_book_id));
end;
$$;
revoke all on function public.publish_book_review(uuid,text,text,text,integer,text) from public,anon;
grant execute on function public.publish_book_review(uuid,text,text,text,integer,text) to authenticated;

commit;
