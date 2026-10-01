import { auth } from "../services/auth";
import { t } from "../i18n";
import { cloudConfigured } from "../services/client";
import { profiles } from "../services/profiles";
import { reviews, SOCIAL_PAGE_SIZE } from "../services/reviews";
import { social } from "../services/social";
import { errorMessage } from "../services/errors";
import type { BookList, Profile, Review } from "../services/types";
import { createProfileEditor } from "./profile";
import { personalReviews } from "../services/reviews/personal";
import type { ReviewComposer } from "./reviews";
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(
  text: string,
  action: () => Promise<void> | void,
): HTMLButtonElement {
  const node = element("button", text, "secondary-button");
  node.type = "button";
  node.addEventListener("click", () => {
    node.disabled = true;
    Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        node.parentElement?.append(
          element("p", errorMessage(error), "cloud-error"),
        );
      })
      .finally(() => {
        node.disabled = false;
      });
  });
  return node;
}
function link(text: string, route: string): HTMLAnchorElement {
  const node = element("a", text, "text-link");
  node.href = `#${route}`;
  return node;
}
function textarea(value = "", max = 5000): HTMLTextAreaElement {
  const node = element("textarea");
  node.value = value;
  node.maxLength = max;
  node.rows = 4;
  node.required = true;
  return node;
}
function labeled(text: string, input: HTMLElement): HTMLLabelElement {
  const label = element("label", text);
  label.append(input);
  return label;
}
export interface DetailsUI {
  openBook(id: string): void;
  openProfile(username: string): void;
  refresh(): Promise<void>;
}
export function mountDetails(
  parent: HTMLElement,
  show: () => void,
  composer: ReviewComposer,
): DetailsUI {
  let sequence = 0;
  let currentRoute = "/profile";
  const heading = element("h2", t("profile"));
  const body = element("div");
  parent.append(heading, body);
  const error = (err: unknown) =>
    body.append(element("p", errorMessage(err), "cloud-error"));
  async function reviewCards(
    rows: Review[],
    target: HTMLElement,
  ): Promise<void> {
    const [people, books] = await Promise.all([social.people(rows.map((r) => r.user_id)), social.books(rows.map(row => row.book_id))]);
    for (const review of rows) {
      const card = element("article", undefined, "cloud-panel social-card");
      const person = people.find((p) => p.id === review.user_id);
      const book = books.find(item => item.id === review.book_id);
      if (book) card.append(link(book.title, `/books/${book.id}`));
      card.append(
        person
          ? link(
              person.display_name || `@${person.username}`,
              `/@${person.username}`,
            )
          : element("span", t("readerLabel")),
        element(
          "p",
          `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`,
        ),
        element("p", review.text),
      );
      const actions = element("div", undefined, "cloud-actions");
      const likes = await reviews.likes(review.id);
      const like = button(
        `${likes.liked ? "♥" : "♡"} ${likes.count}`,
        async () => {
          await reviews.like(review.id, !likes.liked);
          likes.liked = !likes.liked;
          likes.count += likes.liked ? 1 : -1;
          like.textContent = `${likes.liked ? "♥" : "♡"} ${likes.count}`;
        },
      );
      actions.append(like);
      const comments = element("div");
      let commentOffset = 0;
      const more = button(t("comments"), async () => {
        const rows = await reviews.comments(review.id, commentOffset);
        const users = await social.people(rows.map((c) => c.user_id));
        for (const comment of rows) {
          const item = element("article", undefined, "social-comment");
          const user = users.find((u) => u.id === comment.user_id);
          if (user)
            item.append(link(`@${user.username}`, `/@${user.username}`));
          item.append(element("p", comment.content));
          if (comment.user_id === auth.state.ownerId) {
            const edit = textarea(comment.content);
            item.append(
              edit,
              button(t("saveComment"), async () => {
                await reviews.comment(review.id, edit.value, comment.id);
                await render(currentRoute);
              }),
              button(t("deleteComment"), async () => {
                await reviews.removeComment(comment.id);
                await render(currentRoute);
              }),
            );
          }
          comments.append(item);
        }
        commentOffset += rows.length;
        more.textContent = t("moreComments");
        more.hidden = rows.length < SOCIAL_PAGE_SIZE;
      });
      actions.append(more);
      card.append(actions, comments);
      if (auth.state.status === "authenticated") {
        const form = element("form", undefined, "cloud-form"),
          input = textarea();
        form.append(
          labeled(t("addComment"), input),
          button(t("publishComment"), async () => {
            await reviews.comment(review.id, input.value);
            input.value = "";
            await render(currentRoute);
          }),
        );
        card.append(form);
      }
      if (review.user_id === auth.state.ownerId && book) {
        const form = element("div", undefined, "cloud-actions");
        form.append(
          button(t("editReview"), () => composer.openEntry({ review, book })),
          button(t("deleteReview"), async () => {
            await personalReviews.remove({ review, book });
            await render(currentRoute);
          }),
        );
        card.append(form);
      }
      target.append(card);
    }
  }
  function pagedReviews(
    filter: { bookId?: string; userId?: string },
    target: HTMLElement,
  ): void {
    let offset = 0;
    const items = element("div");
    const more = button(t("loadReviews"), async () => {
      const rows = await reviews.page(filter, offset);
      await reviewCards(rows, items);
      offset += rows.length;
      more.hidden = rows.length < SOCIAL_PAGE_SIZE;
      if (!offset) items.append(element("p", t("noReviews")));
    });
    target.append(items, more);
    more.click();
  }
  function listForm(owner: string, list?: BookList): HTMLElement {
    const form = element("div", undefined, "cloud-form"),
      title = element("input"),
      description = textarea(list?.description ?? "", 2000),
      visibility = element("select");
    title.maxLength = 150;
    title.required = true;
    title.value = list?.title ?? "";
    description.required = false;
    visibility.add(new Option(t("privateList"), "private"));
    visibility.add(new Option(t("publicList"), "public"));
    visibility.value = list?.visibility ?? "private";
    form.append(
      labeled(t("listTitle"), title),
      labeled(t("listDescription"), description),
      labeled(t("listVisibility"), visibility),
      button(list ? t("saveList") : t("createList"), async () => {
        if (!title.reportValidity()) return;
        await social.saveList(
          {
            title: title.value.trim(),
            description: description.value,
            visibility: visibility.value === "public" ? "public" : "private",
          },
          list?.id,
        );
        await render(
          list
            ? `/lists/${list.id}`
            : `/@${(await social.people([owner]))[0].username}`,
        );
      }),
    );
    return form;
  }
  async function renderProfile(username: string, token: number): Promise<void> {
    const profile = await profiles.get(username);
    if (token !== sequence) return;
    if (!profile) {
      body.append(element("p", t("profileMissing")));
      return;
    }
    heading.textContent = profile.display_name || `@${profile.username}`;
    body.append(
      element("p", `/@${profile.username}`),
      element("p", profile.bio),
    );
    if (profile.avatar_url) {
      const avatar = element("a", t("viewAvatar"), "text-link");
      avatar.href = profile.avatar_url;
      avatar.target = "_blank";
      avatar.rel = "noopener noreferrer";
      body.append(avatar);
    }
    if (profile.id === auth.state.ownerId && auth.state.status === "authenticated") {
      body.append(createProfileEditor(profile, async (username) => {
        location.hash = `/@${username}`;
        await render(`/@${username}`);
      }, "public-profile-form"));
    }
    if (
      auth.state.status === "authenticated" &&
      profile.id !== auth.state.ownerId
    ) {
      let following = await social.following(profile.id);
      if (token !== sequence) return;
      const follow = button(
        following ? t("unfollow") : t("follow"),
        async () => {
          await social.follow(profile.id, !following);
          following = !following;
          follow.textContent = following ? t("unfollow") : t("follow");
        },
      );
      body.append(follow);
    }
    for (const direction of ["followers", "following"] as const) {
      const container = element("div");
      let offset = 0;
      const more = button(
        direction === "followers" ? t("followers") : t("following"),
        async () => {
          const rows = await social.follows(profile.id, direction, offset);
          rows.forEach((person: Profile) =>
            container.append(
              link(`@${person.username}`, `/@${person.username}`),
            ),
          );
          offset += rows.length;
          more.textContent = t("loadMore");
          more.hidden = rows.length < SOCIAL_PAGE_SIZE;
        },
      );
      body.append(more, container);
    }
    body.append(element("h3", t("lists")));
    const lists = element("div");
    let offset = 0;
    const more = button(t("loadLists"), async () => {
      const rows = await social.lists(profile.id, offset);
      rows.forEach((list) =>
        lists.append(
          link(`${list.title} · ${t(list.visibility === "public" ? "publicList" : "privateList")}`, `/lists/${list.id}`),
        ),
      );
      offset += rows.length;
      more.hidden = rows.length < SOCIAL_PAGE_SIZE;
    });
    body.append(lists, more);
    more.click();
    if (profile.id === auth.state.ownerId) body.append(listForm(profile.id));
    body.append(element("h3", t("reviews")));
    pagedReviews({ userId: profile.id }, body);
  }
  async function renderBook(id: string, token: number): Promise<void> {
    const book = await social.book(id);
    if (token !== sequence) return;
    if (!book) {
      body.append(element("p", t("bookMissing")));
      return;
    }
    heading.textContent = book.title;
    body.append(
      element("p", `${book.author} · ${book.format.toUpperCase()}`),
      element(
        "p",
        t("bookPublicHelp"),
      ),
    );
    if (auth.state.status === "authenticated") {
      const own = (
        await reviews.page({ bookId: id, userId: auth.requireUser() })
      )[0];
      if (token !== sequence) return;
      if (!own) {
        body.append(button(t("writeReview"), () => composer.openCatalog(book)));
      }
      const lists = element("select");
      lists.add(new Option(t("chooseList"), ""));
      let offset = 0;
      const more = button(t("loadMyLists"), async () => {
        const rows = await social.lists(auth.requireUser(), offset);
        for (const row of rows)
          lists.add(new Option(`${row.title} (${t(row.visibility === "public" ? "publicList" : "privateList")})`, row.id));
        offset += rows.length;
        more.hidden = rows.length < SOCIAL_PAGE_SIZE;
      });
      const actions = element("div", undefined, "cloud-actions");
      actions.append(
        lists,
        more,
        button(t("addToList"), async () => {
          if (!lists.value) return;
          await social.addBook(lists.value, id);
          body.append(element("p", t("addedToList")));
        }),
      );
      body.append(actions);
      more.click();
    }
    pagedReviews({ bookId: id }, body);
  }
  async function renderList(id: string, token: number): Promise<void> {
    const list = await social.list(id);
    if (token !== sequence) return;
    if (!list) {
      body.append(element("p", t("listMissing")));
      return;
    }
    heading.textContent = list.title;
    body.append(element("p", `${t(list.visibility === "public" ? "publicList" : "privateList")} · ${list.description}`));
    if (list.user_id === auth.state.ownerId)
      body.append(
        listForm(list.user_id, list),
        button(t("deleteList"), async () => {
          await social.removeList(id);
          location.hash = "/profile";
        }),
      );
    const items = element("div");
    let offset = 0;
    const more = button(t("loadBooks"), async () => {
      const rows = await social.items(id, offset);
      const books = await social.books(rows.map((r) => r.book_id));
      for (const book of books) {
        const item = element("div", undefined, "cloud-actions");
        item.append(link(book.title, `/books/${book.id}`));
        if (list.user_id === auth.state.ownerId)
          item.append(
            button(t("removeFromList"), async () => {
              await social.removeBook(id, book.id);
              await render(currentRoute);
            }),
          );
        items.append(item);
      }
      offset += rows.length;
      more.hidden = rows.length < SOCIAL_PAGE_SIZE;
    });
    body.append(items, more);
    more.click();
  }
  async function render(route: string): Promise<void> {
    currentRoute = route;
    const token = ++sequence;
    body.replaceChildren();
    heading.textContent = t("profile");
    if (!cloudConfigured) {
      body.append(
        element(
          "p",
          t("cloudProfilesMissing"),
        ),
      );
      return;
    }
    try {
      if (route.startsWith("/@"))
        await renderProfile(route.slice(2).toLowerCase(), token);
      else if (route.startsWith("/books/"))
        await renderBook(route.slice(7), token);
      else if (route.startsWith("/lists/"))
        await renderList(route.slice(7), token);
      else { location.hash = "/profile"; }
    } catch (err: unknown) {
      if (token === sequence) error(err);
    }
  }
  function route(): void {
    const path = location.hash.slice(1) || location.pathname;
    if (/^\/(?:@|books\/|lists\/)/.test(path)) {
      show();
      void render(path);
    }
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("autumn-reviews-change", () => { if (!parent.hidden) void render(currentRoute); });
  route();
  let renderedOwner: string | null | undefined;
  auth.subscribe((state) => {
    if (renderedOwner !== state.ownerId) {
      renderedOwner = state.ownerId;
      ++sequence;
      body.replaceChildren();
      if (!parent.hidden) void render(currentRoute);
    }
  });
  return {
    openBook(id) {
      location.hash = `/books/${id}`;
      show();
      void render(`/books/${id}`);
    },
    openProfile(username) {
      location.hash = `/@${username}`;
      show();
      void render(`/@${username}`);
    },
    refresh: () => render(location.hash.slice(1) || "/profile"),
  };
}
