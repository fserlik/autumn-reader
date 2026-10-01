begin;
-- Plain queries, no event log. security invoker keeps private lists protected by RLS.
create function public.social_feed(p_before timestamptz default null,p_cursor text default null,p_following boolean default false,p_limit integer default 20)
returns table(id text,kind text,user_id uuid,book_id uuid,title text,username text,display_name text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
  with activity as (
    select 'review:'||r.id::text id,'review'::text kind,r.user_id,r.book_id,b.title,p.username,p.display_name,r.created_at
      from public.reviews r join public.books b on b.id=r.book_id join public.profiles p on p.id=r.user_id
    union all
    select 'list:'||i.list_id::text||':'||i.book_id::text,'list_item',l.user_id,i.book_id,b.title,p.username,p.display_name,i.added_at
      from public.book_list_items i join public.book_lists l on l.id=i.list_id join public.books b on b.id=i.book_id join public.profiles p on p.id=l.user_id where l.visibility='public'
  ) select a.* from activity a
    where (not p_following or a.user_id=auth.uid() or exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=a.user_id))
      and (p_before is null or a.created_at<p_before or (a.created_at=p_before and a.id<coalesce(p_cursor,'')))
    order by a.created_at desc,a.id desc limit least(greatest(p_limit,1),50)
$$;
revoke all on function public.social_feed(timestamptz,text,boolean,integer) from public;
grant execute on function public.social_feed(timestamptz,text,boolean,integer) to anon,authenticated;
create index reviews_feed on public.reviews(created_at desc,id);
create index lists_visibility on public.book_lists(visibility,id);
commit;
