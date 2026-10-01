import { auth } from "../services/auth";
import { profiles } from "../services/profiles";
import { library } from "../services/books";
import { errorMessage } from "../services/errors";
import type { Profile } from "../services/types";
import { listBooks, type StoredBook } from "../storage";
import { t } from "../i18n";
import { createProfileEditor } from "./profile";
import { ownAvatar } from "../services/profiles/avatar";
import { mountOwnReviews, type ReviewComposer } from "./reviews";
import type { ReviewEntry } from "../services/reviews/personal";
import { readingStats } from "./book-presentation";

export interface ProfileUI {
  activate(): Promise<void>;
  deactivate(): void;
}

export function mountProfile(
  parent: HTMLElement,
  bookCard: (book: StoredBook) => HTMLElement,
  reviewBookVisual: (entry: ReviewEntry) => { cover: HTMLElement; title: string; author: string },
  onBooksChanged: (books: StoredBook[]) => void,
  reviewComposer: ReviewComposer,
  confirmReviewDelete: () => Promise<boolean>,
  viewLibrary: () => void,
): ProfileUI {
  parent.innerHTML = `
    <header class="profile-summary">
      <div class="profile-banner" aria-hidden="true"><span></span></div>
      <div class="profile-heading">
        <div class="profile-avatar"><span id="profile-initials" aria-hidden="true"></span><img id="profile-photo" alt="" hidden /></div>
        <div class="profile-identity"><h2 id="profile-name">${t("profile")}</h2><p id="profile-username"></p><p id="profile-description"></p></div>
        <button id="profile-edit" type="button" class="secondary-button">${t("editProfile")}</button>
      </div>
      <div class="profile-stats" aria-label="${t("profileStats")}">
        <div><strong id="profile-total">0</strong><span>${t("profileBooks")}</span></div>
        <div><strong id="profile-reading-count">0</strong><span>${t("statusReading")}</span></div>
        <div><strong id="profile-completed-count">0</strong><span>${t("profileCompleted")}</span></div>
        <div><strong id="profile-favorites-count">0</strong><span>${t("favorites")}</span></div>
      </div>
    </header>
    <p id="profile-message" class="profile-message" role="status" aria-live="polite"></p>
    <div id="profile-editor" hidden></div>
    <section class="profile-shelf" aria-labelledby="profile-favorites-heading">
      <div class="shelf-heading"><h2 id="profile-favorites-heading">${t("profileFavorites")}</h2><button class="text-link profile-view-all" type="button">${t("viewAll")} →</button></div>
      <div id="profile-favorites" class="book-grid profile-grid" role="region" aria-label="${t("profileFavorites")}" tabindex="0"></div>
      <button id="profile-favorites-more" type="button" class="secondary-button" hidden>${t("profileLoadMore")}</button>
    </section>
    <section id="profile-review-section" class="profile-shelf" aria-label="${t("profileReviews")}"></section>`;
  const find = <T extends HTMLElement>(selector: string): T => parent.querySelector<T>(selector)!;
  const photo = find<HTMLImageElement>("#profile-photo");
  const editor = find("#profile-editor");
  const edit = find<HTMLButtonElement>("#profile-edit");
  const ownReviews = mountOwnReviews(find("#profile-review-section"), reviewComposer, confirmReviewDelete, reviewBookVisual);
  find<HTMLButtonElement>(".profile-view-all").addEventListener("click", viewLibrary);
  const favoriteShelf = {
    offset: 0, hasMore: false, loading: false,
    grid: find("#profile-favorites"),
    more: find<HTMLButtonElement>("#profile-favorites-more"),
  };
  let active = false;
  let generation = 0;
  let collectionRevision = 0;
  let renderedOwner: string | null = null;
  let currentProfile: Profile | null = null;
  let localTimer: number | undefined;
  let photoSequence = 0;
  let photoUrl: string | undefined;
  const valid = (token: number, owner: string): boolean =>
    active && token === generation && owner === auth.state.ownerId;

  function identity(profile: Profile | null): void {
    const photoToken = ++photoSequence;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = undefined;
    currentProfile = profile;
    const name = profile?.display_name || profile?.username || t("profile");
    find("#profile-name").textContent = name;
    find("#profile-username").textContent = profile ? `@${profile.username}` : "";
    find("#profile-description").textContent = profile?.bio || t("profileNoDescription");
    find("#profile-initials").textContent = name.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
    photo.hidden = true;
    if (profile?.avatar_url?.startsWith("https://") && navigator.onLine) {
      photo.alt = `${t("profilePhoto")} · ${name}`;
      photo.referrerPolicy = "no-referrer";
      photo.src = profile.avatar_url;
      photo.hidden = false;
    } else photo.removeAttribute("src");
    if (profile) void ownAvatar(profile).then((blob) => {
      if (!blob || photoToken !== photoSequence || profile.id !== auth.state.ownerId) return;
      photoUrl = URL.createObjectURL(blob);
      photo.src = photoUrl; photo.hidden = false;
    }).catch(() => { /* Keep the remote image or initials when caching is unavailable. */ });
    edit.disabled = !profile || auth.state.status !== "authenticated" || !navigator.onLine;
  }
  photo.addEventListener("error", () => { photo.hidden = true; });

  async function collections(token: number, owner: string): Promise<void> {
    const revision = ++collectionRevision;
    const books = await listBooks(owner);
    if (!valid(token, owner) || revision !== collectionRevision) return;
    onBooksChanged(books);
    const stats = readingStats(books);
    find("#profile-total").textContent = String(stats.total);
    find("#profile-reading-count").textContent = String(stats.reading);
    find("#profile-completed-count").textContent = String(stats.completed);
    find("#profile-favorites-count").textContent = String(stats.favorites);
    const favorites = books.filter(book => book.favorite);
    favoriteShelf.grid.replaceChildren(...(favorites.length ? favorites.map(bookCard) : [emptyMessage(t("profileFavoritesEmpty"))]));
    favoriteShelf.more.hidden = !favoriteShelf.hasMore || !navigator.onLine || auth.state.status !== "authenticated";
    favoriteShelf.more.disabled = favoriteShelf.loading;
  }
  function emptyMessage(message: string): HTMLElement {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = message;
    return empty;
  }
  async function remotePage(token: number, owner: string): Promise<void> {
    if (favoriteShelf.loading || !navigator.onLine || auth.state.status !== "authenticated") return;
    favoriteShelf.loading = true;
    favoriteShelf.more.disabled = true;
    try {
      const result = await library.page(favoriteShelf.offset, "favorites");
      if (!valid(token, owner)) return;
      favoriteShelf.offset += result.books.length;
      favoriteShelf.hasMore = result.hasMore;
      await collections(token, owner);
    } catch (error: unknown) {
      if (valid(token, owner)) find("#profile-message").textContent = errorMessage(error);
    } finally {
      if (valid(token, owner)) { favoriteShelf.loading = false; favoriteShelf.more.disabled = false; }
    }
  }
  favoriteShelf.more.addEventListener("click", () => {
    const owner = auth.state.ownerId;
    if (owner) void remotePage(generation, owner);
  });

  edit.addEventListener("click", () => {
    if (!currentProfile || currentProfile.id !== auth.state.ownerId) return;
    if (!editor.hidden) {
      editor.hidden = true;
      edit.textContent = t("editProfile");
      edit.setAttribute("aria-expanded", "false");
      return;
    }
    const owner = currentProfile.id;
    const token = generation;
    editor.replaceChildren(createProfileEditor(currentProfile, async () => {
      const updated = await profiles.cachedOwn();
      if (!valid(token, owner)) return;
      identity(updated);
      editor.hidden = true;
      edit.textContent = t("editProfile");
      edit.setAttribute("aria-expanded", "false");
      find("#profile-message").textContent = t("profileSaved");
    }));
    editor.hidden = false;
    edit.textContent = t("closeProfileEditor");
    edit.setAttribute("aria-expanded", "true");
    editor.querySelector<HTMLInputElement>("input")?.focus();
  });
  edit.setAttribute("aria-controls", editor.id);
  edit.setAttribute("aria-expanded", "false");

  async function refresh(): Promise<void> {
    const owner = auth.state.ownerId;
    const token = ++generation;
    renderedOwner = owner;
    identity(null);
    editor.hidden = true;
    editor.replaceChildren();
    edit.textContent = t("editProfile");
    edit.setAttribute("aria-expanded", "false");
    find("#profile-message").textContent = "";
    favoriteShelf.offset = 0; favoriteShelf.hasMore = false; favoriteShelf.loading = false;
    favoriteShelf.more.hidden = true; favoriteShelf.grid.replaceChildren();
    if (!owner || !active) return;
    try {
      const cached = await profiles.cachedOwn();
      if (!valid(token, owner)) return;
      identity(cached);
      await collections(token, owner);
      if (!valid(token, owner)) return;
      if (!navigator.onLine || auth.state.status !== "authenticated") {
        find("#profile-message").textContent = t("profileOffline");
        return;
      }
      const own = await profiles.own();
      if (!valid(token, owner)) return;
      identity(own ?? cached);
      // Metadata only: private book files remain lazy.
      await remotePage(token, owner);
    } catch (error: unknown) {
      if (valid(token, owner)) find("#profile-message").textContent = errorMessage(error);
    }
  }
  auth.subscribe(state => {
    if (!active) return;
    if (state.ownerId !== renderedOwner) void refresh();
    else edit.disabled = !currentProfile || state.status !== "authenticated" || !navigator.onLine;
  });
  window.addEventListener("autumn-local-change", () => {
    if (!active) return;
    window.clearTimeout(localTimer);
    localTimer = window.setTimeout(() => {
      const owner = auth.state.ownerId;
      if (owner) void collections(generation, owner).catch((error: unknown) => {
        if (active && owner === auth.state.ownerId) find("#profile-message").textContent = errorMessage(error);
      });
    }, 150);
  });
  window.addEventListener("online", () => { if (active && editor.hidden) void refresh(); });
  window.addEventListener("offline", () => {
    if (!active) return;
    edit.disabled = true;
    favoriteShelf.more.hidden = true;
    find("#profile-message").textContent = t("profileOffline");
  });
  return {
    async activate() { active = true; await Promise.all([refresh(), ownReviews.activate()]); },
    deactivate() {
      active = false; ++generation; ++photoSequence;
      ownReviews.deactivate();
      window.clearTimeout(localTimer);
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = undefined;
    },
  };
}
