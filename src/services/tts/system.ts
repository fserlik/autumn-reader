import type { Language } from "../../i18n";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TtsSpeakRequest, TtsVoice } from "./types";

export function localDeviceVoices(synthesis: SpeechSynthesis): TtsVoice[] {
  const voices = synthesis.getVoices();
  const local = voices.filter(voice => voice.localService);
  return [...local].sort((left, right) => Number(right.default) - Number(left.default)
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

export function preferredVoice(voices: TtsVoice[], voiceUri: string, language: Language | string): TtsVoice | undefined {
  const stored = voices.find(voice => voice.voiceURI === voiceUri);
  if (stored) return stored;
  const code = language.slice(0, 2).toLocaleLowerCase();
  return voices.find(voice => voice.lang.toLocaleLowerCase().startsWith(code) && voice.default)
    ?? voices.find(voice => voice.lang.toLocaleLowerCase().startsWith(code))
    ?? voices.find(voice => voice.default)
    ?? voices[0];
}

export function usesNativeSystemTts(): boolean {
  return typeof navigator !== "undefined" && /\bAndroid\b/i.test(navigator.userAgent) && isTauri();
}

export async function nativeDeviceVoices(): Promise<TtsVoice[]> {
  const result = await invoke<{ voices?: TtsVoice[] }>("native_tts_voices");
  return Array.isArray(result.voices) ? result.voices : [];
}

export async function nativeSpeak(request: TtsSpeakRequest): Promise<"done" | "stopped"> {
  const result = await invoke<{ status?: string }>("native_tts_speak", {
    text: request.text, voiceUri: request.voiceUri, language: request.language, rate: request.rate, pitch: request.pitch ?? 1,
  });
  return result.status === "done" ? "done" : "stopped";
}

export async function nativePause(): Promise<void> { await invoke("native_tts_pause"); }
export async function nativeResume(): Promise<void> { await invoke("native_tts_resume"); }
export async function nativeStop(): Promise<void> { await invoke("native_tts_stop"); }
