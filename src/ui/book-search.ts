import type { BookSearch, SearchResult } from "../readers/search";
import { t } from "../i18n";
export interface SearchUI { setSource(source?: BookSearch): void; open(): void; close(): void; readonly opened: boolean }
export function mountBookSearch(parent: HTMLElement, jump: (result: SearchResult, source: BookSearch,signal?:AbortSignal) => Promise<void>, closed: () => void): SearchUI {
  parent.innerHTML = `<div class="reader-panel-header"><label for="book-search-input">${t("searchInBook")}</label><button id="book-search-close" class="text-link" type="button" aria-label="${t("closeSearch")}">${t("close")}</button></div><input id="book-search-input" type="search" maxlength="200" placeholder="${t("wordOrPhrase")}" autocomplete="off" /><p id="book-search-status" role="status" aria-live="polite"></p><div class="search-navigation"><button id="search-previous" type="button" class="secondary-button">${t("previous")}</button><span id="search-index"></span><button id="search-next" type="button" class="secondary-button">${t("next")}</button></div><ol id="book-search-results"></ol>`;
  const input = parent.querySelector<HTMLInputElement>("input")!, status = parent.querySelector<HTMLElement>("#book-search-status")!, index = parent.querySelector<HTMLElement>("#search-index")!, list = parent.querySelector<HTMLOListElement>("ol")!;
  const previous = parent.querySelector<HTMLButtonElement>("#search-previous")!, next = parent.querySelector<HTMLButtonElement>("#search-next")!;
  let source: BookSearch | undefined, results: SearchResult[] = [], selected = -1, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, revision = 0;
  let jumping = false;
  const render = (): void => {
    previous.disabled = next.disabled = !results.length || jumping;
    index.textContent = results.length ? t("resultIndex", { current: selected + 1, total: results.length }) : "";
    const start = Math.max(0, Math.floor(Math.max(0, selected) / 20) * 20);
    list.start = start + 1;
    list.replaceChildren(...results.slice(start, start + 20).map((result, offset) => {
      const li = document.createElement("li"), button = document.createElement("button"); button.type = "button"; button.textContent = result.excerpt;
      if (start + offset === selected) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => void go(start + offset)); li.append(button); return li;
    }));
  };
  const go = async (position: number): Promise<void> => {
    if (!source || !results.length || jumping) return;
    selected = (position + results.length) % results.length; jumping = true; render();
    try { await jump(results[selected], source,controller?.signal); } catch (error: unknown) { if(!(error instanceof DOMException&&error.name==="AbortError"))status.textContent = error instanceof Error ? error.message : t("resultOpenFailed"); }
    finally { jumping = false; render(); }
  };
  const search = async (): Promise<void> => {
    if (!source) return; const local = ++revision; controller?.abort(); controller = new AbortController();
    results = []; selected = -1; render();
    if (!input.value.trim()) { status.textContent = t("searchPrompt"); return; }
    status.textContent = t("searching");
    try {
      const response = await source.search(input.value, controller.signal, (done, total) => { if (local === revision) status.textContent = t("searchProgress", { done, total }); });
      if (local !== revision) return;
      results = response.results; status.textContent = !response.hasText ? t("noSearchableText") : t("searchResults", { count: `${results.length}${response.limited ? "+" : ""}` });
      render(); if (results.length) await go(0);
    } catch (error: unknown) { if (local === revision && !(error instanceof DOMException && error.name === "AbortError")) status.textContent = t("searchFailed"); }
  };
  input.addEventListener("input", () => { clearTimeout(timer); controller?.abort(); ++revision; timer = setTimeout(() => void search(), 300); });
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); if (results.length) void go(selected + (event.shiftKey ? -1 : 1)); else { clearTimeout(timer); void search(); } } });
  previous.addEventListener("click", () => void go(selected - 1)); next.addEventListener("click", () => void go(selected + 1));
  const ui: SearchUI = {
    get opened() { return !parent.hidden; },
    setSource(value) { ++revision; controller?.abort(); clearTimeout(timer); source?.dispose(); source = value; results = []; selected = -1; input.value = ""; status.textContent = ""; render(); },
    open() { const toolbar = parent.parentElement!.querySelector<HTMLElement>(".reader-toolbar")!; parent.style.top = `${toolbar.offsetTop + toolbar.offsetHeight + 8}px`; parent.hidden = false; input.focus(); },
    close() { if(parent.hidden)return;++revision; controller?.abort(); clearTimeout(timer); parent.hidden = true; closed(); },
  };
  parent.querySelector("#book-search-close")!.addEventListener("click", () => ui.close()); render(); return ui;
}
