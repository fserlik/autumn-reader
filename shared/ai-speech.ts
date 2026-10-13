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
