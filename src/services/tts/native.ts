import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CatalogVoice, InstalledPackage, SynthesizedAudio, TtsRuntimeStatus, VoiceImportInspection, VoiceImportRequest } from "./types";

export function supportsLocalNeuralTts(): boolean {
  if (!isTauri() || typeof navigator === "undefined") return false;
  return /\bAndroid\b/i.test(navigator.userAgent) || /\bWindows\b/i.test(navigator.userAgent);
}

export async function runtimeStatus(): Promise<TtsRuntimeStatus> {
  if (!supportsLocalNeuralTts()) return { available: false, version: "", platform: "web", architecture: "", supportsPiper: false, supportsKokoro: false, memoryMb: undefined };
  return invoke<TtsRuntimeStatus>("local_tts_runtime_status");
}

export async function installedPackages(): Promise<InstalledPackage[]> {
  if (!supportsLocalNeuralTts()) return [];
  return invoke<InstalledPackage[]>("local_tts_installed");
}

export async function importedVoices(): Promise<CatalogVoice[]> {
  if (!supportsLocalNeuralTts()) return [];
  return invoke<CatalogVoice[]>("local_tts_imported_voices");
}

export async function importVoice(request: VoiceImportRequest): Promise<CatalogVoice> {
  return invoke<CatalogVoice>("local_tts_import", { request });
}
export async function inspectVoiceImport(sourcePath: string): Promise<VoiceImportInspection> {
  return invoke<VoiceImportInspection>("local_tts_inspect_import", { sourcePath });
}

export async function removePackage(packageId: string): Promise<void> { await invoke("local_tts_remove", { packageId }); }
export async function removeImportedVoice(voiceId: string): Promise<void> { await invoke("local_tts_remove_voice", { voiceId }); }
export async function synthesizeLocal(voiceId: string, text: string, rate: number): Promise<SynthesizedAudio> {
  return invoke<SynthesizedAudio>("local_tts_synthesize", { voiceId, text, rate });
}
export async function cancelLocalSynthesis(): Promise<void> { if (supportsLocalNeuralTts()) await invoke("local_tts_cancel_synthesis"); }
export function synthesizedAudioUrl(audio: SynthesizedAudio): string { return `data:${audio.mimeType};base64,${audio.dataBase64}`; }
