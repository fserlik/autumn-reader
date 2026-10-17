import type { BookTtsPreferences, TtsEngineId, TtsGlobalPreferences } from "./types";

const globalKey = "autumn-tts-preferences-v2";
const legacyKey = "autumn-tts-preferences";

export const defaultTtsPreferences: TtsGlobalPreferences = { engine: "system", voices: { system: "", piper: "", kokoro: "" } };
export const defaultBookTtsPreferences: BookTtsPreferences = { rate: 1, pitch: 1, voiceId: "" };

function validEngine(value: unknown): value is TtsEngineId { return value === "system" || value === "piper" || value === "kokoro"; }
function validRate(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= .5 && value <= 2; }
function validPitch(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= .5 && value <= 2; }

export function loadTtsPreferences(): TtsGlobalPreferences {
  if (typeof localStorage === "undefined") return structuredClone(defaultTtsPreferences);
  try {
    const stored = JSON.parse(localStorage.getItem(globalKey) ?? "null") as Partial<TtsGlobalPreferences> | null;
    const legacy = JSON.parse(localStorage.getItem(legacyKey) ?? "null") as { voiceUri?: unknown } | null;
    return {
      engine: validEngine(stored?.engine) ? stored.engine : "system",
      voices: {
        system: typeof stored?.voices?.system === "string" ? stored.voices.system : typeof legacy?.voiceUri === "string" ? legacy.voiceUri : "",
        piper: typeof stored?.voices?.piper === "string" ? stored.voices.piper : "",
        kokoro: typeof stored?.voices?.kokoro === "string" ? stored.voices.kokoro : "",
      },
    };
  } catch { return structuredClone(defaultTtsPreferences); }
}

export function saveTtsPreferences(value: TtsGlobalPreferences): TtsGlobalPreferences {
  const saved: TtsGlobalPreferences = {
    engine: validEngine(value.engine) ? value.engine : "system",
    voices: {
      system: typeof value.voices.system === "string" ? value.voices.system : "",
      piper: typeof value.voices.piper === "string" ? value.voices.piper : "",
      kokoro: typeof value.voices.kokoro === "string" ? value.voices.kokoro : "",
    },
  };
  if (typeof localStorage !== "undefined") localStorage.setItem(globalKey, JSON.stringify(saved));
  return saved;
}

function bookKey(ownerId: string, bookId: string): string { return `autumn-tts-book:${ownerId}:${bookId}`; }

export function loadBookTtsPreferences(ownerId: string, bookId: string): BookTtsPreferences {
  if (typeof localStorage === "undefined") return { ...defaultBookTtsPreferences };
  try {
    const stored = JSON.parse(localStorage.getItem(bookKey(ownerId, bookId)) ?? "null") as Partial<BookTtsPreferences> | null;
    const legacy = JSON.parse(localStorage.getItem(legacyKey) ?? "null") as { rate?: unknown } | null;
    return {
      rate: validRate(stored?.rate) ? stored.rate : validRate(legacy?.rate) ? legacy.rate : 1,
      pitch: validPitch(stored?.pitch) ? stored.pitch : 1,
      voiceId: typeof stored?.voiceId === "string" ? stored.voiceId : "",
    };
  } catch { return { ...defaultBookTtsPreferences }; }
}

export function saveBookTtsPreferences(ownerId: string, bookId: string, value: BookTtsPreferences): BookTtsPreferences {
  const saved = { rate: validRate(value.rate) ? value.rate : 1, pitch: validPitch(value.pitch) ? value.pitch : 1, voiceId: typeof value.voiceId === "string" ? value.voiceId : "" };
  if (typeof localStorage !== "undefined") localStorage.setItem(bookKey(ownerId, bookId), JSON.stringify(saved));
  return saved;
}
