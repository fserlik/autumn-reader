import type { Language } from "../../i18n";

export type DictionarySource = "automatic" | "wiktionary" | "wikipedia";
type ResolvedDictionarySource = Exclude<DictionarySource, "automatic">;

export interface DictionarySense { partOfSpeech?: string; definition: string }
export interface DictionaryEntry {
  word: string;
  language: Language;
  senses: DictionarySense[];
  source: ResolvedDictionarySource;
  sourceUrl: string;
}
export interface DictionaryLookupOptions {
  definitionLanguage: Language;
  wordLanguage?: Language;
  source?: DictionarySource;
}
export interface DictionaryService {
  lookup(word: string, options: DictionaryLookupOptions): Promise<DictionaryEntry | null>;
}

type MediaWikiParsePayload = { error?: unknown; parse?: { text?: { "*"?: string } } };
type WikipediaSummary = { extract?: string; content_urls?: { desktop?: { page?: string } } };

const languageAliases: Record<Language, string[]> = {
  en: ["english", "inglés", "ingles", "inglese", "anglais"],
  es: ["spanish", "español", "espanol", "spagnolo", "espagnol"],
  it: ["italian", "italiano", "italien"],
  fr: ["french", "francés", "frances", "francese", "français", "francais"],
};
const excludedHeading = /etym|etim|pronon|pronunc|sillab|syllab|référ|referenc|note|anagram|voir aussi|see also|vocabulaire|deriv|dériv|sinon|synon|anton|traduc|translation|conjug|flexion|hyphen|related|compost|alter/i;

export class WikimediaDictionary implements DictionaryService {
  private readonly cache = new Map<string, DictionaryEntry | null>();
  constructor(private readonly fetcher: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)) {}

  async lookup(word: string, options: DictionaryLookupOptions): Promise<DictionaryEntry | null> {
    const normalized = normalizeWord(word);
    if (!normalized) return null;
    const source = options.source ?? "automatic";
    const key = `${source}:${options.definitionLanguage}:${options.wordLanguage ?? "auto"}:${normalized.toLocaleLowerCase(options.definitionLanguage)}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    let entry: DictionaryEntry | null = null;
    if (source === "wiktionary") entry = await this.lookupWiktionary(normalized, options);
    else if (source === "wikipedia") entry = await this.lookupWikipedia(normalized, options.definitionLanguage);
    else {
      let wiktionaryError: unknown;
      try { entry = await this.lookupWiktionary(normalized, options); }
      catch (error) { wiktionaryError = error; }
      if (!entry) {
        try { entry = await this.lookupWikipedia(normalized, options.definitionLanguage); }
        catch (error) { if (wiktionaryError) throw wiktionaryError; throw error; }
      }
    }
    this.cache.set(key, entry);
    return entry;
  }

  private async lookupWiktionary(word: string, options: DictionaryLookupOptions): Promise<DictionaryEntry | null> {
    const host = `${options.definitionLanguage}.wiktionary.org`;
    const query = new URLSearchParams({ action: "parse", page: word, prop: "text", format: "json", origin: "*" });
    const response = await this.fetcher(`https://${host}/w/api.php?${query}`, { headers: apiHeaders() });
    if (!response.ok) throw new Error(`Wiktionary HTTP ${response.status}`);
    const payload = await response.json() as MediaWikiParsePayload;
    const html = payload.parse?.text?.["*"];
    if (!html || payload.error) return null;
    const senses = wiktionarySenses(html, options.wordLanguage, options.definitionLanguage);
    return senses.length ? {
      word,
      language: options.definitionLanguage,
      senses,
      source: "wiktionary",
      sourceUrl: `https://${host}/wiki/${encodeURIComponent(word)}`,
    } : null;
  }

  private async lookupWikipedia(word: string, language: Language): Promise<DictionaryEntry | null> {
    const host = `${language}.wikipedia.org`;
    const response = await this.fetcher(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(word)}`, { headers: apiHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
    const payload = await response.json() as WikipediaSummary;
    const definition = cleanText(payload.extract ?? "");
    if (!definition) return null;
    return {
      word,
      language,
      senses: [{ definition }],
      source: "wikipedia",
      sourceUrl: payload.content_urls?.desktop?.page ?? `https://${host}/wiki/${encodeURIComponent(word)}`,
    };
  }
}

function normalizeWord(word: string): string {
  const normalized = word.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  return !normalized || normalized.length > 80 || normalized.includes(" ") ? "" : normalized;
}

function apiHeaders(): HeadersInit {
  return { "Api-User-Agent": "AutumnReader/0.4.1 (https://autumnreader.lat/)" };
}

function wiktionarySenses(html: string, preferred: Language | undefined, definitionLanguage: Language): DictionarySense[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const root = document.querySelector(".mw-parser-output") ?? document.body;
  const children = Array.from(root.children);
  const starts = children.flatMap((node, index) => node.matches(".mw-heading2") || node.matches("h2") ? [index] : []);
  const sections = starts.map((start, index) => {
    const end = starts[index + 1] ?? children.length;
    const heading = children[start].matches("h2") ? children[start] : children[start].querySelector("h2");
    return { language: headingLanguage(heading), nodes: children.slice(start + 1, end) };
  });
  if (!sections.length) sections.push({ language: undefined, nodes: children });

  const ordered = [...sections].sort((left, right) => sectionRank(left.language, preferred, definitionLanguage) - sectionRank(right.language, preferred, definitionLanguage));
  for (const section of ordered) {
    const senses = sectionSenses(document, section.nodes);
    if (senses.length) return senses.slice(0, 8);
  }
  return [];
}

function headingLanguage(heading: Element | null): Language | undefined {
  if (!heading) return undefined;
  for (const code of Object.keys(languageAliases) as Language[]) {
    if (heading.querySelector(`[id="${code}"]`)) return code;
  }
  const label = plainKey(heading.textContent ?? "");
  return (Object.keys(languageAliases) as Language[]).find(code => languageAliases[code].some(alias => label.includes(plainKey(alias))));
}

function sectionRank(section: Language | undefined, preferred: Language | undefined, definitionLanguage: Language): number {
  if (preferred && section === preferred) return 0;
  if (section === definitionLanguage) return 1;
  if (section === "en") return 2;
  return 3;
}

function sectionSenses(document: Document, nodes: Element[]): DictionarySense[] {
  const holder = document.createElement("section");
  nodes.forEach(node => holder.append(node.cloneNode(true)));
  const senses: DictionarySense[] = [];
  let partOfSpeech: string | undefined;
  for (const node of holder.querySelectorAll("h3,h4,ol,dl")) {
    if (node.matches("h3,h4")) {
      partOfSpeech = cleanHeading(node);
      continue;
    }
    if (node.parentElement?.closest("ol,dl")) continue;
    if (partOfSpeech && excludedHeading.test(plainKey(partOfSpeech))) continue;
    const definitions = node.matches("ol") ? Array.from(node.children).filter(child => child.matches("li"))
      : Array.from(node.children).filter(child => child.matches("dd"));
    for (const item of definitions) {
      const definition = senseText(item);
      if (definition && !senses.some(sense => sense.definition === definition)) senses.push({ partOfSpeech, definition });
    }
  }
  return senses;
}

function cleanHeading(node: Element): string | undefined {
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll(".mw-editsection,sup,.reference").forEach(child => child.remove());
  const heading = cleanText(clone.textContent ?? "");
  return heading || undefined;
}

function senseText(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll("ul,ol,dl,table,figure,sup,.reference,.mw-editsection,.example,.citation").forEach(child => child.remove());
  return cleanText(clone.textContent ?? "").replace(/^\d+[.)]?\s*/u, "");
}

function cleanText(value: string): string {
  return value.replace(/\[[^\]]{0,40}\]/g, "").replace(/\s+/g, " ").trim();
}

function plainKey(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

export const dictionaryService: DictionaryService = new WikimediaDictionary();
