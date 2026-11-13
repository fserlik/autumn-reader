import type { Book as EpubBook } from "epubjs";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { t } from "../i18n";
import type { ReaderPosition } from "../readers/history";

export type PageOverviewSource =
  | { format: "pdf"; document: PDFDocumentProxy; currentPage: number }
  | { format: "epub"; book: EpubBook; currentCfi: string; charactersPerPage: number };

export interface PageOverview {
  readonly opened: boolean;
  open(source: PageOverviewSource): Promise<void>;
  close(options?: { restoreFocus?: boolean }): void;
  reset(): void;
}

type QueueJob = () => Promise<void>;

function excerptFromRange(range: Range, limit = 520): string {
  const root = range.startContainer.ownerDocument?.body;
  if (!root) return "";
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("script,style,noscript,head") || !node.textContent?.trim()
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let found = false;
  let value = "";
  for (let node = walker.nextNode(); node && value.length < limit; node = walker.nextNode()) {
    if (!found && node !== range.startContainer) continue;
    found = true;
    const raw = node.textContent ?? "";
    value += `${value ? " " : ""}${node === range.startContainer ? raw.slice(range.startOffset) : raw}`;
  }
  return value.replace(/\s+/gu, " ").trim().slice(0, limit);
}

function pageLabel(page: number, total: number): string {
  return t("pageOf", { page, total });
}

export function mountPageOverview(
  panel: HTMLElement,
  options: {
    trigger: HTMLButtonElement;
    onSelect(position: ReaderPosition): Promise<void>;
    onStateChange(open: boolean): void;
  },
): PageOverview {
  let sourceKey = "";
  let generation = 0;
  let observer: IntersectionObserver | undefined;
  let running = 0;
  const queue: QueueJob[] = [];
  const epubLocations = new WeakMap<EpubBook, { charactersPerPage: number; promise: Promise<string[]> }>();

  const pump = (): void => {
    while (running < 2 && queue.length) {
      const job = queue.shift()!;
      running += 1;
      void job().finally(() => { running -= 1; pump(); });
    }
  };
  const enqueue = (job: QueueJob): void => { queue.push(job); pump(); };

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    options.trigger.setAttribute("aria-pressed", String(open));
    options.onStateChange(open);
  };

  const close = ({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void => {
    if (panel.hidden) return;
    setOpen(false);
    if (restoreFocus) options.trigger.focus({ preventScroll: true });
  };

  const reset = (): void => {
    generation += 1;
    observer?.disconnect();
    observer = undefined;
    queue.length = 0;
    sourceKey = "";
    panel.replaceChildren();
    setOpen(false);
  };

  const begin = (): { heading: HTMLElement; status: HTMLElement; grid: HTMLElement } => {
    panel.replaceChildren();
    const header = document.createElement("header");
    header.className = "page-overview-header";
    const copy = document.createElement("div");
    const heading = document.createElement("h2");
    heading.id = "page-overview-title";
    heading.textContent = t("pageOverview");
    const help = document.createElement("p");
    help.textContent = t("pageOverviewHelp");
    copy.append(heading, help);
    const back = document.createElement("button");
    back.type = "button";
    back.className = "page-overview-close";
    back.textContent = t("closePageOverview");
    back.addEventListener("click", () => close());
    header.append(copy, back);
    const status = document.createElement("p");
    status.className = "page-overview-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = t("pageOverviewLoading");
    const grid = document.createElement("div");
    grid.className = "page-overview-grid";
    panel.append(header, status, grid);
    panel.setAttribute("aria-labelledby", heading.id);
    panel.tabIndex = -1;
    panel.setAttribute("aria-busy", "true");
    panel.scrollTop = 0;
    panel.focus({ preventScroll: true });
    return { heading, status, grid };
  };

  const finish = (status: HTMLElement, count: number): void => {
    panel.removeAttribute("aria-busy");
    status.textContent = t("pageOverviewCount", { count });
  };

  const select = async (position: ReaderPosition): Promise<void> => {
    close({ restoreFocus: false });
    await options.onSelect(position);
  };

  const makeButton = (page: number, total: number, current: boolean): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-overview-item";
    button.dataset.page = String(page);
    button.setAttribute("aria-label", t("openPageFromOverview", { page }));
    if (current) button.setAttribute("aria-current", "page");
    const paper = document.createElement("span");
    paper.className = "page-overview-paper";
    const number = document.createElement("span");
    number.className = "page-overview-number";
    number.textContent = pageLabel(page, total);
    button.append(paper, number);
    return button;
  };

  const revealCurrent = (): void => {
    window.requestAnimationFrame(() => {
      panel.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "center" });
    });
  };

  const renderPdf = async (pdf: Extract<PageOverviewSource, { format: "pdf" }>, token: number): Promise<void> => {
    const { status, grid } = begin();
    const total = pdf.document.numPages;
    observer?.disconnect();
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const button = entry.target as HTMLButtonElement;
        observer?.unobserve(button);
        const pageNumber = Number(button.dataset.page);
        enqueue(async () => {
          if (token !== generation || panel.hidden) return;
          try {
            const page = await pdf.document.getPage(pageNumber);
            if (token !== generation) return;
            const natural = page.getViewport({ scale: 1 });
            const width = Math.max(96, Math.min(180, button.clientWidth - 12));
            const scale = width / natural.width;
            const viewport = page.getViewport({ scale });
            const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
            canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
            canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
            const context = canvas.getContext("2d");
            if (!context) return;
            await page.render({ canvas, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] }).promise;
            if (token !== generation) return;
            button.querySelector(".page-overview-paper")?.replaceChildren(canvas);
            button.classList.add("is-ready");
          } catch { button.classList.add("is-unavailable"); }
        });
      }
    }, { root: panel, rootMargin: "240px 0px" });
    const fragment = document.createDocumentFragment();
    for (let page = 1; page <= total; page += 1) {
      const button = makeButton(page, total, page === pdf.currentPage);
      button.addEventListener("click", () => void select({ format: "pdf", page, offset: 0, scrollTop: 0, scrollLeft: 0 }));
      fragment.append(button);
      observer.observe(button);
    }
    grid.append(fragment);
    finish(status, total);
    revealCurrent();
  };

  const unloadRangeDocument = (book: EpubBook, range: Range): void => {
    const last = book.spine.last()?.index ?? -1;
    for (let index = 0; index <= last; index += 1) {
      const section = book.spine.get(index);
      if (section?.document === range.startContainer.ownerDocument) { section.unload(); return; }
    }
  };

  const locationsFor = (book: EpubBook, charactersPerPage: number): Promise<string[]> => {
    const cached = epubLocations.get(book);
    if (cached?.charactersPerPage === charactersPerPage) return cached.promise;
    const promise = (async () => {
      if (cached) await cached.promise.catch(() => []);
      book.locations.load("[]");
      return book.locations.generate(charactersPerPage);
    })();
    epubLocations.set(book, { charactersPerPage, promise });
    return promise;
  };

  const renderEpub = async (epub: Extract<PageOverviewSource, { format: "epub" }>, token: number): Promise<void> => {
    const { status, grid } = begin();
    const locations = await locationsFor(epub.book, epub.charactersPerPage);
    if (token !== generation || panel.hidden) return;
    const total = Math.max(1, locations.length);
    let current = 0;
    try { current = Math.max(0, epub.book.locations.locationFromCfi(epub.currentCfi) as unknown as number); }
    catch { current = 0; }
    observer?.disconnect();
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const button = entry.target as HTMLButtonElement;
        observer?.unobserve(button);
        const index = Number(button.dataset.page) - 1;
        const cfi = locations[index];
        enqueue(async () => {
          if (!cfi || token !== generation || panel.hidden) return;
          try {
            const range = await epub.book.getRange(cfi);
            const excerpt = excerptFromRange(range);
            unloadRangeDocument(epub.book, range);
            if (token !== generation || !excerpt) return;
            const prose = document.createElement("span");
            prose.className = "page-overview-prose";
            prose.textContent = excerpt;
            button.querySelector(".page-overview-paper")?.replaceChildren(prose);
            button.classList.add("is-ready");
          } catch { button.classList.add("is-unavailable"); }
        });
      }
    }, { root: panel, rootMargin: "240px 0px" });
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < total; index += 1) {
      const page = index + 1;
      const cfi = locations[index] ?? epub.currentCfi;
      const button = makeButton(page, total, index === current);
      button.addEventListener("click", () => void select({ format: "epub", cfi, label: pageLabel(page, total) }));
      fragment.append(button);
      observer.observe(button);
    }
    grid.append(fragment);
    finish(status, total);
    revealCurrent();
  };

  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  });

  return {
    get opened() { return !panel.hidden; },
    async open(next): Promise<void> {
      setOpen(true);
      const nextKey = next.format === "pdf"
        ? `pdf:${next.document.fingerprints?.[0] ?? "book"}:${next.document.numPages}`
        : `epub:${next.book.key()}:${next.charactersPerPage}`;
      if (nextKey === sourceKey && panel.childElementCount) {
        panel.focus({ preventScroll: true });
        panel.querySelectorAll("[aria-current]").forEach(element => element.removeAttribute("aria-current"));
        let current = next.format === "pdf" ? next.currentPage : 1;
        if (next.format === "epub") {
          try { current = Math.max(0, next.book.locations.locationFromCfi(next.currentCfi) as unknown as number) + 1; }
          catch { current = 1; }
        }
        panel.querySelector<HTMLElement>(`[data-page="${current}"]`)?.setAttribute("aria-current", "page");
        revealCurrent();
        return;
      }
      sourceKey = nextKey;
      const token = ++generation;
      try {
        if (next.format === "pdf") await renderPdf(next, token);
        else await renderEpub(next, token);
      } catch {
        if (token !== generation) return;
        const status = panel.querySelector<HTMLElement>(".page-overview-status");
        if (status) status.textContent = t("pageOverviewFailed");
        panel.removeAttribute("aria-busy");
      }
    },
    close,
    reset,
  };
}
