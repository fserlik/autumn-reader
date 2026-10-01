begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null default '' check (length(display_name) <= 100),
  avatar_url text check (avatar_url is null or (avatar_url like 'https://%' and length(avatar_url) <= 2000)),
  bio text not null default '' check (length(bio) <= 2000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 500),
  author text not null default '' check (length(author) <= 300),
  cover_url text check (cover_url is null or (cover_url like 'https://%' and length(cover_url) <= 2000)),
  format text not null check (format in ('epub','pdf')), created_at timestamptz not null default now()
);
create table private.book_files (
  book_id uuid primary key references public.books(id) on delete cascade,
  file_hash text not null check (file_hash ~ '^[a-f0-9]{64}$'),
  format text not null check (format in ('epub','pdf')),
  file_size bigint not null check (file_size between 1 and 33554432),
  r2_key text not null unique,
  unique(file_hash,format), check (r2_key = 'books/' || file_hash || '.' || format)
);
create table public.user_books (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.books(id), added_at timestamptz not null default now(),
  last_opened_at timestamptz, favorite boolean not null default false,
  status text not null default 'unread' check (status in ('unread','reading','finished')),
  updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique(user_id, book_id)
);
create table public.reading_progress (
  user_id uuid not null, book_id uuid not null,
  page integer not null default 1 check (page >= 1), cfi text check (cfi is null or length(cfi) <= 2000),
  percentage double precision not null default 0 check (percentage between 0 and 1),
  pdf_text_offset double precision not null default 0 check (pdf_text_offset between 0 and 1),
  font_size integer not null default 100 check (font_size between 70 and 180),
  updated_at timestamptz not null default now(), primary key(user_id,book_id),
  foreign key(user_id,book_id) references public.user_books(user_id,book_id) on delete cascade
);
create table public.notes (
  id uuid primary key, user_id uuid not null, book_id uuid not null,
  format text not null check (format in ('epub','pdf')), page integer, y double precision, cfi text,
  quote text not null check (length(quote) between 1 and 500), content text not null check (length(content) between 1 and 5000),
  color text not null check (color in ('#cc5500','#8b0000','#996515','#808000','#b7410e','#800020')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  foreign key(user_id,book_id) references public.user_books(user_id,book_id) on delete cascade,
  check ((format='pdf' and page is not null and y is not null and page >= 1 and y between 0 and 1 and cfi is null) or
    (format='epub' and page is null and y is null and cfi is not null and cfi like 'epubcfi(%' and length(cfi) <= 2000))
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.books(id), rating smallint not null check (rating between 1 and 5),
  text text not null default '' check (length(text) <= 10000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,book_id)
);
create table public.review_likes (
  review_id uuid references public.reviews(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(review_id,user_id)
);
create table public.review_comments (
  id uuid primary key default gen_random_uuid(), review_id uuid not null references public.reviews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(content) between 1 and 5000), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.follows (
  follower_id uuid references public.profiles(id) on delete cascade, following_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(follower_id,following_id), check (follower_id <> following_id)
);
create table public.book_lists (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 150), description text not null default '' check (length(description) <= 2000),
  visibility text not null default 'private' check (visibility in ('public','private')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.book_list_items (
  list_id uuid references public.book_lists(id) on delete cascade, book_id uuid references public.books(id),
  added_at timestamptz not null default now(), primary key(list_id,book_id)
);
create table private.upload_intents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  file_hash text not null check (file_hash ~ '^[a-f0-9]{64}$'), format text not null check (format in ('epub','pdf')),
  file_size bigint not null check (file_size between 1 and 33554432), title text not null check (length(title) between 1 and 500),
  author text not null default '' check (length(author) <= 300), staging_key text not null unique,
  book_id uuid references public.books(id), created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'), completed_at timestamptz
);

create index user_books_owner_recent on public.user_books(user_id,added_at desc,id);
create index user_books_owner_updates on public.user_books(user_id,updated_at);
create index reviews_book_recent on public.reviews(book_id,created_at desc,id);
create index reviews_owner_recent on public.reviews(user_id,created_at desc,id);
create index follows_following on public.follows(following_id,created_at desc,follower_id);
create index follows_follower on public.follows(follower_id,created_at desc,following_id);
create index notes_owner_book on public.notes(user_id,book_id,updated_at);
create index comments_review on public.review_comments(review_id,created_at,id);
create index lists_owner on public.book_lists(user_id,created_at desc,id);
create index list_items_recent on public.book_list_items(added_at desc,list_id,book_id);
create index uploads_owner on private.upload_intents(user_id,expires_at);
-- reading_progress PK and book_files UNIQUE already cover owner/book and hash/format.

alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.user_books enable row level security;
alter table public.reading_progress enable row level security;
alter table public.notes enable row level security;
alter table public.reviews enable row level security;
alter table public.review_likes enable row level security;
alter table public.review_comments enable row level security;
alter table public.follows enable row level security;
alter table public.book_lists enable row level security;
alter table public.book_list_items enable row level security;
alter table private.book_files enable row level security;
alter table private.upload_intents enable row level security;

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on public.profiles,public.books,public.user_books,public.reading_progress,public.notes,public.reviews,public.review_likes,public.review_comments,public.follows,public.book_lists,public.book_list_items from anon,authenticated;
grant select on public.profiles,public.books,public.reviews,public.review_likes,public.review_comments,public.follows,public.book_lists,public.book_list_items to anon,authenticated;
grant select on public.user_books,public.reading_progress,public.notes to authenticated;
grant update(username,display_name,avatar_url,bio) on public.profiles to authenticated;
grant insert,delete on public.reviews,public.review_comments,public.review_likes,public.follows,public.book_lists,public.book_list_items to authenticated;
grant update(rating,text) on public.reviews to authenticated;
grant update(content) on public.review_comments to authenticated;
grant update(title,description,visibility) on public.book_lists to authenticated;
grant all on all tables in schema private to service_role;
grant usage on schema private to service_role;
grant all on public.profiles,public.books,public.user_books,public.reading_progress,public.notes,public.reviews,public.review_likes,public.review_comments,public.follows,public.book_lists,public.book_list_items to service_role;

create policy profiles_read on public.profiles for select to anon,authenticated using(true);
create policy profiles_update on public.profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
create policy books_read on public.books for select to anon,authenticated using(true);
create policy library_read on public.user_books for select to authenticated using((select auth.uid())=user_id);
create policy library_update on public.user_books for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy library_delete on public.user_books for delete to authenticated using((select auth.uid())=user_id);
-- No client INSERT policy on books/user_books/book_files: possession must be validated by backend.
create policy progress_read on public.reading_progress for select to authenticated using((select auth.uid())=user_id);
create policy progress_insert on public.reading_progress for insert to authenticated with check((select auth.uid())=user_id and exists(select 1 from public.user_books u where u.user_id=reading_progress.user_id and u.book_id=reading_progress.book_id and u.deleted_at is null));
create policy progress_update on public.reading_progress for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy progress_delete on public.reading_progress for delete to authenticated using((select auth.uid())=user_id);
create policy notes_read on public.notes for select to authenticated using((select auth.uid())=user_id);
create policy notes_insert on public.notes for insert to authenticated with check((select auth.uid())=user_id and exists(select 1 from public.user_books u where u.user_id=notes.user_id and u.book_id=notes.book_id and u.deleted_at is null));
create policy notes_update on public.notes for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy notes_delete on public.notes for delete to authenticated using((select auth.uid())=user_id);
create policy reviews_read on public.reviews for select to anon,authenticated using(true);
create policy reviews_insert on public.reviews for insert to authenticated with check((select auth.uid())=user_id);
create policy reviews_update on public.reviews for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy reviews_delete on public.reviews for delete to authenticated using((select auth.uid())=user_id);
create policy likes_read on public.review_likes for select to anon,authenticated using(true);
create policy likes_insert on public.review_likes for insert to authenticated with check((select auth.uid())=user_id);
create policy likes_delete on public.review_likes for delete to authenticated using((select auth.uid())=user_id);
create policy comments_read on public.review_comments for select to anon,authenticated using(true);
create policy comments_insert on public.review_comments for insert to authenticated with check((select auth.uid())=user_id);
create policy comments_update on public.review_comments for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy comments_delete on public.review_comments for delete to authenticated using((select auth.uid())=user_id);
create policy follows_read on public.follows for select to anon,authenticated using(true);
create policy follows_insert on public.follows for insert to authenticated with check((select auth.uid())=follower_id);
create policy follows_delete on public.follows for delete to authenticated using((select auth.uid())=follower_id);
create policy lists_read on public.book_lists for select to anon,authenticated using(visibility='public' or (select auth.uid())=user_id);
create policy lists_insert on public.book_lists for insert to authenticated with check((select auth.uid())=user_id);
create policy lists_update on public.book_lists for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy lists_delete on public.book_lists for delete to authenticated using((select auth.uid())=user_id);
create policy items_read on public.book_list_items for select to anon,authenticated using(exists(select 1 from public.book_lists l where l.id=list_id and (l.visibility='public' or l.user_id=(select auth.uid()))));
create policy items_insert on public.book_list_items for insert to authenticated with check(exists(select 1 from public.book_lists l where l.id=list_id and l.user_id=(select auth.uid())));
create policy items_delete on public.book_list_items for delete to authenticated using(exists(select 1 from public.book_lists l where l.id=list_id and l.user_id=(select auth.uid())));

create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end $$;
create trigger profiles_timestamp before update on public.profiles for each row execute function private.touch_updated_at();
create trigger reviews_timestamp before update on public.reviews for each row execute function private.touch_updated_at();
create trigger comments_timestamp before update on public.review_comments for each row execute function private.touch_updated_at();
create trigger lists_timestamp before update on public.book_lists for each row execute function private.touch_updated_at();
-- username length: reader_ + 23 hex characters, UUID prefix collisions are negligible and constrained.
create function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id,username) values(new.id,'reader_'||left(replace(new.id::text,'-',''),23)); return new; end $$;
create trigger create_profile after insert on auth.users for each row execute function private.new_profile();
insert into public.profiles(id,username) select id,'reader_'||left(replace(id::text,'-',''),23) from auth.users on conflict(id) do nothing;
revoke all on all functions in schema private from public,anon,authenticated;
commit;
