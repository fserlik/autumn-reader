import { auth } from "../services/auth";
import { personalReviews, type ReviewDraft, type ReviewEntry } from "../services/reviews/personal";
import { errorMessage } from "../services/errors";
import type { StoredBook } from "../storage";
import type { Book } from "../services/types";
import { t } from "../i18n";

export interface ReviewComposer {
  openBook(book: StoredBook): Promise<void>;
  openEntry(entry: ReviewEntry): Promise<void>;
  openCatalog(book: Book): Promise<void>;
  openDraft(draft: ReviewDraft): void;
  close(): void;
}
export function mountReviewComposer(parent: HTMLElement, notify: (message: string) => void): ReviewComposer {
  const dialog = document.createElement("dialog");
  dialog.id = "review-dialog"; dialog.className = "review-dialog"; dialog.setAttribute("aria-labelledby", "review-heading");
  dialog.innerHTML = `<form id="review-form" class="review-form">
    <header><h2 id="review-heading">${t("ownReview")}</h2><button id="review-close" class="note-close" type="button" aria-label="${t("closeReview")}">×</button></header>
    <p class="review-privacy">${t("reviewPrivacy")}</p>
    <label>${t("reviewBookTitle")}<input id="review-title" maxlength="500" required /></label>
    <label>${t("reviewAuthor")}<input id="review-author" maxlength="300" /></label>
    <fieldset class="review-stars"><legend>${t("reviewRating")}</legend><div class="review-star-options">${[1,2,3,4,5].map(value => `<label class="review-star"><input type="radio" name="rating" value="${value}" required aria-label="${t(value === 1 ? "starOne" : "starMany", { count: value })}" /><span aria-hidden="true">★</span></label>`).join("")}</div><output id="review-rating-label">${t("chooseStars")}</output></fieldset>
    <label>${t("optionalComment")}<textarea id="review-text" rows="5" maxlength="10000" placeholder="${t("commentPlaceholder")}"></textarea></label>
    <p id="review-status" role="status" aria-live="polite"></p>
    <div class="cloud-actions"><button id="review-draft-save" class="secondary-button" type="button">${t("saveDraft")}</button><button id="review-publish" class="primary-button" type="submit">${t("publishReview")}</button></div>
  </form>`;
  parent.append(dialog);
  const find = <T extends HTMLElement>(selector: string): T => dialog.querySelector<T>(selector)!;
  const form = find<HTMLFormElement>("form"), title = find<HTMLInputElement>("#review-title"), author = find<HTMLInputElement>("#review-author"), text = find<HTMLTextAreaElement>("#review-text");
  const status = find("#review-status");
  let current: ReviewDraft | undefined, saving = false, timer: number | undefined, sequence = 0;
  const rating = (): number => Number(form.querySelector<HTMLInputElement>('input[name="rating"]:checked')?.value ?? 0);
  function stars(): void {
    form.querySelectorAll<HTMLLabelElement>(".review-star").forEach((star, index) => star.classList.toggle("is-filled", index < rating()));
    find("#review-rating-label").textContent = rating() ? t("ratingOutOfFive", { count: rating() }) : t("chooseStars");
  }
  function capture(): ReviewDraft | undefined {
    if (!current || current.ownerId !== auth.state.ownerId) return;
    current = { ...current, title: title.value, author: author.value, text: text.value, rating: rating(), updatedAt: Date.now() };
    return current;
  }
  async function save(): Promise<void> {
    window.clearTimeout(timer);
    const draft = capture();
    if (draft) await personalReviews.saveDraft(draft);
  }
  const ui: ReviewComposer = {
    async openBook(book) {
      const token = ++sequence;
      try { const draft = await personalReviews.forBook(book); if (token === sequence && draft.ownerId === auth.state.ownerId) ui.openDraft(draft); }
      catch (error: unknown) { notify(errorMessage(error)); }
    },
    async openEntry(entry) { const token = ++sequence; try { const draft = await personalReviews.forEntry(entry); if (token === sequence) ui.openDraft(draft); } catch(error:unknown) { notify(errorMessage(error)); } },
    async openCatalog(book) { const token = ++sequence; try { const draft = await personalReviews.forCatalog(book); if (token === sequence) ui.openDraft(draft); } catch(error:unknown) { notify(errorMessage(error)); } },
    openDraft(draft) {
      if (draft.ownerId !== auth.state.ownerId) return;
      current = { ...draft }; title.value = draft.title; author.value = draft.author; text.value = draft.text;
      title.readOnly = author.readOnly = draft.catalogExists;
      form.querySelectorAll<HTMLInputElement>('input[name="rating"]').forEach(input => { input.checked = Number(input.value) === draft.rating; });
      stars(); status.textContent = navigator.onLine ? "" : t("reviewOffline");
      if (!dialog.open) dialog.showModal();
      form.querySelector<HTMLInputElement>('input[name="rating"]:checked')?.focus();
    },
    close() {
      ++sequence;
      if (dialog.open) { void save().then(() => window.dispatchEvent(new Event("autumn-review-draft-change"))).catch(error => notify(errorMessage(error))); dialog.close(); }
    },
  };
  form.addEventListener("input", () => {
    if (!current || saving) return;
    current.dirty = true; stars();
    window.clearTimeout(timer); timer = window.setTimeout(() => { void save().catch(error => { status.textContent = errorMessage(error); }); }, 250);
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (saving) return;
    saving = true; window.clearTimeout(timer);
    const draft = capture(); if (!draft) { saving = false; return; }
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>("input,button,textarea").forEach(control => { control.disabled = true; });
    status.textContent = t("publishingReview");
    void personalReviews.publish(draft).then(() => {
      if (draft.ownerId !== auth.state.ownerId) return;
      current = draft; dialog.close(); notify(t("publishedReview"));
    }).catch((error:unknown) => { status.textContent = errorMessage(error); }).finally(() => {
      saving = false;
      form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>("input,button,textarea").forEach(control => { control.disabled = false; });
    });
  });
  find("#review-draft-save").addEventListener("click", () => { if (!current) return; current.dirty = true; void save().then(() => { status.textContent = t("draftSaved"); window.dispatchEvent(new Event("autumn-review-draft-change")); }).catch(error => { status.textContent = errorMessage(error); }); });
  find("#review-close").addEventListener("click", () => ui.close());
  dialog.addEventListener("cancel", event => { event.preventDefault(); if (!saving) ui.close(); });
  document.addEventListener("visibilitychange", () => { if (dialog.open && document.hidden) void save().catch(() => {}); });
  window.addEventListener("pagehide", () => { if (dialog.open) void save().catch(() => {}); });
  auth.subscribe(state => { if (current && state.ownerId !== current.ownerId) { ++sequence; window.clearTimeout(timer); dialog.close(); current = undefined; } });
  return ui;
}

export function mountOwnReviews(parent: HTMLElement, composer: ReviewComposer, confirm: () => Promise<boolean>, bookVisual: (entry: ReviewEntry) => { cover: HTMLElement; title: string; author: string }): { activate(): Promise<void>; deactivate(): void } {
  parent.innerHTML = `<div class="shelf-heading"><h2>${t("profileReviews")}</h2></div><div id="profile-reviews"></div><p id="profile-reviews-status" class="profile-message" role="status" aria-live="polite"></p><button id="profile-reviews-more" class="secondary-button" type="button" hidden>${t("loadMoreReviews")}</button><div id="profile-review-drafts"></div>`;
  const list = parent.querySelector<HTMLElement>("#profile-reviews")!, drafts = parent.querySelector<HTMLElement>("#profile-review-drafts")!, status = parent.querySelector<HTMLElement>("#profile-reviews-status")!, more = parent.querySelector<HTMLButtonElement>("#profile-reviews-more")!;
  let active = false, token = 0, owner: string | null = null, entries: ReviewEntry[] = [], offset = 0, busy = false;
  const valid = (revision: number): boolean => active && revision === token && owner === auth.state.ownerId;
  function draw(): void {
    list.replaceChildren(...entries.map(entry => {
      const card = document.createElement("article"); card.className = "profile-review";
      const visual = bookVisual(entry);
      const title = document.createElement("h3"); title.textContent = visual.title;
      const cover = document.createElement("div"); cover.className = "profile-review-cover"; cover.setAttribute("aria-hidden", "true"); cover.append(visual.cover);
      const body = document.createElement("div"); body.className = "profile-review-body";
      const author = document.createElement("p"); author.className = "profile-review-author"; author.textContent = visual.author;
      const stars = document.createElement("p"); stars.className = "review-score"; stars.textContent = `${"★".repeat(entry.review.rating)}${"☆".repeat(5-entry.review.rating)} · ${entry.review.rating}/5`; stars.setAttribute("aria-label", t("ratingOutOfFive", { count: entry.review.rating }));
      const comment = document.createElement("p"); comment.className = "review-comment"; comment.textContent = entry.review.text || t("noComment");
      const actions = document.createElement("div"); actions.className = "cloud-actions";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "text-link"; edit.textContent = t("editReview"); edit.addEventListener("click", () => { void composer.openEntry(entry); });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-link"; remove.textContent = t("deleteReview");
      remove.addEventListener("click", () => { remove.disabled = true; void confirm().then(async yes => { if (yes) await personalReviews.remove(entry); }).catch(error => { status.textContent = errorMessage(error); }).finally(() => { remove.disabled = false; }); });
      if (entry.review.user_id === auth.state.ownerId) actions.append(edit, remove);
      body.append(title, author, stars, comment, actions); card.append(cover, body); return card;
    }));
    if (!entries.length) { const empty = document.createElement("p"); empty.className = "profile-empty"; empty.textContent = t("profileReviewsEmpty"); list.append(empty); }
  }
  async function loadDrafts(revision: number): Promise<void> {
    const rows = await personalReviews.drafts(); if (!valid(revision)) return;
    drafts.replaceChildren();
    if (rows.length) { const heading = document.createElement("h3"); heading.textContent = t("localDrafts"); drafts.append(heading); }
    for (const row of rows) { const button = document.createElement("button"); button.className = "secondary-button review-draft-item"; button.type = "button"; button.textContent = `${row.title} · ${row.rating ? `${row.rating}/5` : t("noStars")} · ${t("continueDraft")}`; button.addEventListener("click", () => composer.openDraft(row)); drafts.append(button); }
  }
  async function page(revision: number): Promise<void> {
    if (busy || !navigator.onLine || auth.state.status !== "authenticated") return;
    busy = true; more.disabled = true;
    try {
      const rows = await personalReviews.page(offset); if (!valid(revision)) return;
      const combined = new Map([...entries, ...rows].map(entry => [entry.review.id, entry])); entries = [...combined.values()]; offset += rows.length;
      more.hidden = rows.length < personalReviews.pageSize; draw(); status.textContent = "";
    } catch(error:unknown) { if(valid(revision)) status.textContent = errorMessage(error); }
    finally { if(valid(revision)) { busy = false; more.disabled = false; } }
  }
  async function refresh(): Promise<void> {
    const revision = ++token; owner = auth.state.ownerId; entries = []; offset = 0; busy = false; more.hidden = true; list.replaceChildren(); drafts.replaceChildren(); status.textContent = "";
    if (!owner || !active) return;
    const saved = await personalReviews.cached(); if (!valid(revision)) return; entries = saved; draw(); await loadDrafts(revision);
    if (!valid(revision)) return;
    if (!navigator.onLine || auth.state.status !== "authenticated") { status.textContent = t("offlineReviewCache"); return; }
    // Replace cached items with the first authoritative page, retaining cache if the request fails.
    const cached = entries; entries = [];
    await page(revision); if(valid(revision) && !entries.length && status.textContent) { entries = cached; draw(); }
  }
  more.addEventListener("click", () => { void page(token); });
  const reload = (): void => { if (active) void refresh().catch(error => { status.textContent = errorMessage(error); }); };
  window.addEventListener("autumn-reviews-change", reload); window.addEventListener("online", reload);
  window.addEventListener("autumn-book-metadata-change", () => { if (active) draw(); });
  window.addEventListener("autumn-review-draft-change", () => { if(active) void loadDrafts(token).catch(error => { status.textContent = errorMessage(error); }); });
  auth.subscribe(state => { if (active && state.ownerId !== owner) reload(); });
  return { async activate() { active = true; await refresh(); }, deactivate() { active = false; ++token; } };
}
