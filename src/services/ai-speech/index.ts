import { cloud } from "../client";
import { auth } from "../auth";
import { CloudError, requireOnline } from "../errors";
import { MAX_AI_SPEECH_CHARACTERS, normalizeSpeechText } from "../../../shared/ai-speech";

export interface AiSpeechVoice {
  id: string;
  name: string;
  language: string;
  gender: "female" | "male";
  proOnly: boolean;
}
export interface AiSpeechUsage {
  plan: "free" | "plus" | "pro";
  includedSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  cycleStartsAt: string;
  resetsAt: string;
  serviceAvailable: boolean;
  budgetPaused: boolean;
}
export interface AiSpeechAudio {
  audioUrl: string;
  cached: boolean;
  durationSeconds: number;
  expiresAt: string;
}
export interface BookAiSpeechPreferences { voiceId: string; language: string; }

const preferencePrefix = "autumn-ai-speech-book:";
function failure(error: unknown, data: unknown): Error {
  const code = data && typeof data === "object" && "code" in data ? String(data.code) : "provider_unavailable";
  if (["session_expired", "forbidden", "device_revoked", "not_configured"].includes(code))
    return new CloudError(code === "device_revoked" ? "device_revoked" : code === "session_expired" ? "session_expired" : code === "not_configured" ? "not_configured" : "forbidden");
  return new Error(code || (error instanceof Error ? error.message : "provider_unavailable"));
}
async function invoke<T>(body: Record<string, unknown>, allowPending = false): Promise<T> {
  requireOnline(); auth.requireUser();
  const { data, error } = await cloud().functions.invoke<T & { code?: string }>("ai-speech", { body });
  let payload: unknown = data;
  if (error && typeof error === "object" && "context" in error && (error as { context?: unknown }).context instanceof Response) {
    try { payload = await ((error as { context: Response }).context).clone().json(); } catch { /* Keep the generic provider error. */ }
  }
  if (error || !data || (data.code && !(allowPending && data.code === "generation_pending"))) throw failure(error, payload);
  return data;
}
export const aiSpeech = {
  voices: (): Promise<{ voices: AiSpeechVoice[]; tier: "limited" | "full" }> => invoke({ action: "voices" }),
  usage: (): Promise<AiSpeechUsage> => invoke({ action: "usage" }),
  async synthesize(input: { bookId: string; fragmentId: string; text: string; voiceId: string; language: string; rate: number }): Promise<AiSpeechAudio> {
    const text = normalizeSpeechText(input.text);
    if (!text || text.length > MAX_AI_SPEECH_CHARACTERS) throw new Error("text_too_long");
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await invoke<AiSpeechAudio & { code?: string; retryAfterMs?: number }>({ action: "synthesize", ...input, text }, true);
      if (result.code !== "generation_pending") return result;
      await new Promise(resolve => window.setTimeout(resolve, Math.max(250, Math.min(1500, result.retryAfterMs ?? 800))));
    }
    throw new Error("provider_unavailable");
  },
};

export function loadBookAiSpeechPreferences(ownerId: string, bookId: string): BookAiSpeechPreferences {
  const fallback = { voiceId: "Lucia", language: "es-ES" };
  try {
    const value = JSON.parse(localStorage.getItem(`${preferencePrefix}${ownerId}:${bookId}`) ?? "null") as Partial<BookAiSpeechPreferences> | null;
    return typeof value?.voiceId === "string" && typeof value.language === "string"
      ? { voiceId: value.voiceId, language: value.language } : fallback;
  } catch { return fallback; }
}
export function saveBookAiSpeechPreferences(ownerId: string, bookId: string, value: BookAiSpeechPreferences): void {
  localStorage.setItem(`${preferencePrefix}${ownerId}:${bookId}`, JSON.stringify(value));
}
