import { cancelLocalSynthesis, importedVoices, runtimeStatus, synthesizeLocal, supportsLocalNeuralTts } from "./native";
import {
  localDeviceVoices,
  nativeDeviceVoices,
  nativeSpeak,
  nativeStop,
  refreshDeviceVoices,
  usesNativeSystemTts,
} from "./system";
import type { CatalogVoice, SynthesizedAudio, TtsEngine, TtsEngineId, TtsSpeakRequest, TtsVoice } from "./types";

class SystemTtsEngine implements TtsEngine {
  readonly id = "system" as const;
  readonly capabilities = { rate: true, pitch: true, downloadableVoices: false, wordBoundaries: true };

  async detectAvailability(): Promise<boolean> {
    return usesNativeSystemTts() || (typeof window !== "undefined" && "speechSynthesis" in window);
  }

  async voices(): Promise<TtsVoice[]> {
    if (usesNativeSystemTts()) return nativeDeviceVoices();
    if (typeof window === "undefined" || !window.speechSynthesis) return [];
    return refreshDeviceVoices(window.speechSynthesis);
  }

  async initialize(): Promise<void> { /* The operating system owns this engine's lifecycle. */ }

  async dispose(): Promise<void> { await this.cancel(); }

  async synthesize(request: TtsSpeakRequest & { voiceId: string }): Promise<void> {
    if (usesNativeSystemTts()) {
      await nativeSpeak({ ...request, voiceUri: request.voiceId || request.voiceUri });
      return;
    }
    if (typeof window === "undefined" || !window.speechSynthesis) throw new Error("TTS_ENGINE_UNAVAILABLE");
    const voice = localDeviceVoices(window.speechSynthesis).find(item => item.voiceURI === request.voiceId || item.voiceURI === request.voiceUri);
    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(request.text);
      utterance.voice = voice ?? null;
      utterance.lang = voice?.lang ?? request.language;
      utterance.rate = request.rate;
      utterance.pitch = request.pitch ?? 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => reject(new Error("TTS_SYNTHESIS_FAILED"));
      window.speechSynthesis.speak(utterance);
    });
  }

  async cancel(): Promise<void> {
    if (usesNativeSystemTts()) await nativeStop();
    else if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }
}

class SherpaTtsEngine implements TtsEngine {
  readonly capabilities = { rate: true, pitch: false, downloadableVoices: false, wordBoundaries: false };
  constructor(readonly id: "piper" | "kokoro") {}

  async detectAvailability(): Promise<boolean> {
    if (!supportsLocalNeuralTts()) return false;
    const runtime = await runtimeStatus();
    return runtime.available && (this.id === "piper" ? runtime.supportsPiper : runtime.supportsKokoro);
  }

  async voices(): Promise<CatalogVoice[]> { return (await importedVoices()).filter(voice => voice.engine === this.id); }
  async initialize(): Promise<void> { if (!await this.detectAvailability()) throw new Error("TTS_ENGINE_UNAVAILABLE"); }
  async dispose(): Promise<void> { await this.cancel(); }
  async synthesize(request: TtsSpeakRequest & { voiceId: string }): Promise<SynthesizedAudio> {
    return synthesizeLocal(request.voiceId, request.text, request.rate);
  }
  async cancel(): Promise<void> { await cancelLocalSynthesis(); }
}

export const ttsEngines: Record<TtsEngineId, TtsEngine> = {
  system: new SystemTtsEngine(),
  piper: new SherpaTtsEngine("piper"),
  kokoro: new SherpaTtsEngine("kokoro"),
};
