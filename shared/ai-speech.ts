export const MAX_AI_SPEECH_CHARACTERS = 3000;
export const MIN_AI_SPEECH_RATE = 0.5;
export const MAX_AI_SPEECH_RATE = 2;

export type AiSpeechAction = "voices" | "usage" | "synthesize";

export interface AiSpeechRequest {
  action: AiSpeechAction;
  bookId?: string;
  fragmentId?: string;
  text?: string;
  voiceId?: string;
  language?: string;
  rate?: number;
}

export function normalizeSpeechText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Match rendered speech against its source while ignoring layout-only punctuation spacing. */
export function speechTextValidationKey(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

/** Split speech without reconstructing sentences or changing their punctuation. */
export function splitSpeechText(value: string, preferredCharacters: number, maximumCharacters: number): string[] {
  const text = normalizeSpeechText(value);
  const maximum = Math.max(1, Math.floor(maximumCharacters));
  const preferred = Math.max(1, Math.min(maximum, Math.floor(preferredCharacters)));
  if (!text) return [];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maximum) {
    const candidate = remaining.slice(0, preferred + 1);
    let boundary = 0;
    for (const match of candidate.matchAll(/[.!?…]+(?:["'”’»)}\]]+)?(?=\s|$)/gu))
      boundary = (match.index ?? 0) + match[0].length;
    if (boundary < preferred / 2) boundary = remaining.lastIndexOf(" ", maximum);
    if (boundary < 1) boundary = maximum;
    const chunk = remaining.slice(0, boundary).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function validateAiSpeechRequest(value: unknown): AiSpeechRequest {
  if (!value || typeof value !== "object") throw new Error("invalid_request");
  const input = value as Record<string, unknown>;
  if (!(["voices", "usage", "synthesize"] as const).includes(input.action as AiSpeechAction))
    throw new Error("invalid_request");
  if (input.action !== "synthesize") return { action: input.action as "voices" | "usage" };
  const text = typeof input.text === "string" ? normalizeSpeechText(input.text) : "";
  if (!/^[a-f0-9-]{36}$/i.test(String(input.bookId ?? "")) ||
      typeof input.fragmentId !== "string" || !/^[a-zA-Z0-9:._-]{1,240}$/.test(input.fragmentId) ||
      !text || text.length > MAX_AI_SPEECH_CHARACTERS ||
      typeof input.voiceId !== "string" || !/^[A-Za-z]{2,40}$/.test(input.voiceId) ||
      typeof input.language !== "string" || !/^[a-z]{2,3}-[A-Z]{2}$/.test(input.language) ||
      typeof input.rate !== "number" || !Number.isFinite(input.rate) ||
      input.rate < MIN_AI_SPEECH_RATE || input.rate > MAX_AI_SPEECH_RATE)
    throw new Error(text.length > MAX_AI_SPEECH_CHARACTERS ? "text_too_long" : "invalid_request");
  return { action: "synthesize", bookId: String(input.bookId), fragmentId: input.fragmentId,
    text, voiceId: input.voiceId, language: input.language, rate: Math.round(input.rate * 10) / 10 };
}

/** Conservative fallback because SynthesizeSpeech does not return audio duration. */
export function estimateSpeechSeconds(characters: number, rate: number): number {
  return Math.max(1, Math.ceil(characters / 12 / rate));
}
