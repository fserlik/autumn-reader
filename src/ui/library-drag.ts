import type { StoredBook } from "../storage";
import { t } from "../i18n";

/** Desktop pointer drag keeps touch/Android scrolling and reader gestures intact. */
export function mountLibraryDrag(
  list: HTMLElement,
  bookById: (id: string) => StoredBook | undefined,
  move: (book: StoredBook, folderId: string) => Promise<void>,
  report: (message: string) => void,
): void {
  let active: { book: StoredBook; card: HTMLElement; startX: number; startY: number; preview?: HTMLElement; target?: HTMLElement; frame?: number; x: number; y: number } | undefined;
  let suppressClick = false;
  const place = (): void => {
    if (!active?.preview) return;
    active.preview.style.left = `${active.x + 12}px`;
    active.preview.style.top = `${active.y + 10}px`;
    active.frame = undefined;
  };
  const targetAt = (x: number, y: number): HTMLElement | undefined => {
    const tile = document.elementFromPoint(x, y)?.closest<HTMLElement>(".folder-tile[data-folder-id]");
    return tile && !tile.hidden ? tile : undefined;
  };
  const finish = (cancelled: boolean): void => {
    const drag = active;
    if (!drag) return;
    active = undefined;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey);
    drag.card.classList.remove("is-dragging");
    drag.target?.classList.remove("drop-target");
    if (!drag.preview) return;
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 80);
    drag.preview.classList.add("is-finishing");
    if (cancelled || !drag.target?.dataset.folderId) {
      const cover = drag.card.querySelector(".book-cover")?.getBoundingClientRect();
      if (cover) { drag.preview.style.left = `${cover.left}px`; drag.preview.style.top = `${cover.top}px`; }
      drag.preview.classList.add("is-cancelled");
    } else {
      const id = drag.target.dataset.folderId;
      const name = drag.target.querySelector(".folder-title")?.textContent ?? "";
      drag.preview.classList.add("is-dropped");
      void move(drag.book, id).then(() => {
        const tile = [...document.querySelectorAll<HTMLElement>(".folder-tile[data-folder-id]")].find(item => item.dataset.folderId === id);
        tile?.classList.add("drop-confirmed");
        if (tile) window.setTimeout(() => tile.classList.remove("drop-confirmed"), 550);
        report(t("folderMoved", { name }));
      }).catch((error: unknown) => report(error instanceof Error ? error.message : t("moveBookFailed")));
    }
    window.setTimeout(() => drag.preview?.remove(), 190);
  };
  function onMove(event: PointerEvent): void {
    const drag = active;
    if (!drag || event.pointerId !== pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.preview && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 7) {
      const preview = document.createElement("div"); preview.className = "book-drag-preview";
      const cover = drag.card.querySelector(".book-cover")?.cloneNode(true);
      if (cover) preview.append(cover);
      document.body.append(preview); drag.preview = preview; drag.card.classList.add("is-dragging");
      place();
      requestAnimationFrame(() => preview.classList.add("is-active"));
    }
    if (!drag.preview) return;
    event.preventDefault();
    if (!drag.frame) drag.frame = requestAnimationFrame(place);
    const tile = targetAt(drag.x, drag.y);
    if (tile !== drag.target) { drag.target?.classList.remove("drop-target"); drag.target = tile; tile?.classList.add("drop-target"); }
  }
  function onUp(event: PointerEvent): void { if (event.pointerId === pointerId) finish(false); }
  function onCancel(): void { finish(true); }
  function onKey(event: KeyboardEvent): void { if (event.key === "Escape") finish(true); }
  let pointerId = -1;
  list.addEventListener("dragstart", event => { if ((event.target as Element).closest(".library-book-card")) event.preventDefault(); });
  list.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" || !matchMedia("(pointer: fine)").matches || event.button !== 0) return;
    if ((event.target as Element).closest("select, .book-menu, .book-title, .book-status, .book-folder")) return;
    const card = (event.target as Element).closest<HTMLElement>(".library-book-card[data-book-id]");
    const book = card?.dataset.bookId ? bookById(card.dataset.bookId) : undefined;
    if (!card || !book) return;
    pointerId = event.pointerId;
    active = { book, card, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
  });
  list.addEventListener("click", event => {
    if (!suppressClick) return;
    event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
  }, true);
}
