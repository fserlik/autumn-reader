import type { Language } from "../../i18n";
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface TtsVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface TtsSpeakRequest {
  text: string;
  voiceUri: string;
  language: string;
  rate: number;
}

export interface TtsPreferences {
  voiceUri: string;
  rate: number;
}

const preferenceKey = "autumn-tts-preferences";
export const defaultTtsPreferences: TtsPreferences = { voiceUri: "", rate: 1 };

export function loadTtsPreferences(): TtsPreferences {
  if (typeof localStorage === "undefined") return { ...defaultTtsPreferences };
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) ?? "null") as Partial<TtsPreferences> | null;
    return {
      voiceUri: typeof stored?.voiceUri === "string" ? stored.voiceUri : "",
      rate: validRate(stored?.rate) ? stored.rate : defaultTtsPreferences.rate,
    };
  } catch { return { ...defaultTtsPreferences }; }
}

export function saveTtsPreferences(value: TtsPreferences): TtsPreferences {
  const saved = { voiceUri: value.voiceUri, rate: validRate(value.rate) ? value.rate : defaultTtsPreferences.rate };
  if (typeof localStorage !== "undefined") localStorage.setItem(preferenceKey, JSON.stringify(saved));
  return saved;
}

export function localDeviceVoices(synthesis: SpeechSynthesis): TtsVoice[] {
  const voices = synthesis.getVoices();
  const local = voices.filter(voice => voice.localService);
  return [...(local.length ? local : voices)].sort((left, right) => Number(right.default) - Number(left.default)
    || left.lang.localeCompare(right.lang) || left.name.localeCompare(right.name));
}

export async function refreshDeviceVoices(synthesis: SpeechSynthesis, timeout = 900): Promise<TtsVoice[]> {
  const immediate = localDeviceVoices(synthesis);
  if (immediate.length) return immediate;
  return new Promise(resolve => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      synthesis.removeEventListener("voiceschanged", finish);
      window.clearTimeout(timer);
      resolve(localDeviceVoices(synthesis));
    };
    const timer = window.setTimeout(finish, timeout);
    synthesis.addEventListener("voiceschanged", finish, { once: true });
  });
}

export function preferredVoice(voices: TtsVoice[], preferences: TtsPreferences, language: Language | string): TtsVoice | undefined {
  const stored = voices.find(voice => voice.voiceURI === preferences.voiceUri);
  if (stored) return stored;
  const code = language.slice(0, 2).toLocaleLowerCase();
  return voices.find(voice => voice.lang.toLocaleLowerCase().startsWith(code) && voice.default)
    ?? voices.find(voice => voice.lang.toLocaleLowerCase().startsWith(code))
    ?? voices.find(voice => voice.default)
    ?? voices[0];
}

function validRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= .5 && value <= 2;
}

export function usesNativeTts(): boolean {
  return typeof navigator !== "undefined" && /\bAndroid\b/i.test(navigator.userAgent) && isTauri();
}

export async function nativeDeviceVoices(): Promise<TtsVoice[]> {
  const result = await invoke<{ voices?: TtsVoice[] }>("native_tts_voices");
  return Array.isArray(result.voices) ? result.voices : [];
}

export async function nativeSpeak(request: TtsSpeakRequest): Promise<"done" | "stopped"> {
  const result = await invoke<{ status?: string }>("native_tts_speak", {
    text: request.text,
    voiceUri: request.voiceUri,
    language: request.language,
    rate: request.rate,
  });
  return result.status === "done" ? "done" : "stopped";
}

export async function nativePause(): Promise<void> {
  await invoke("native_tts_pause");
}

export async function nativeResume(): Promise<void> {
  await invoke("native_tts_resume");
}

export async function nativeStop(): Promise<void> {
  await invoke("native_tts_stop");
}
