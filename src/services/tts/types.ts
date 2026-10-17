export type TtsEngineId = "system" | "piper" | "kokoro";

export interface TtsCapabilities {
  rate: boolean;
  pitch: boolean;
  downloadableVoices: boolean;
  wordBoundaries: boolean;
}

export interface TtsVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface CatalogPackage {
  id: string;
  engine: Exclude<TtsEngineId, "system">;
  size: number;
  sha256: string;
}

export interface CatalogVoice {
  id: string;
  packageId: string;
  engine: Exclude<TtsEngineId, "system">;
  name: string;
  locale: string;
  region: string;
  speakerId: number;
  quality: string;
  attribution?: string;
  imported?: boolean;
  archiveSha256?: string;
  storageBytes?: number;
  modelVersion?: string;
  modelPackageId?: string;
}

export interface VoiceImportRequest {
  sourcePath: string;
  engine?: Exclude<TtsEngineId, "system">;
  name?: string;
  locale?: string;
  speakerId?: number;
}

export interface VoiceImportInspection {
  kind: "kokoro-voice" | "model-package";
  engine: Exclude<TtsEngineId, "system">;
  format: string;
  name?: string;
  locale?: string;
  modelVersion?: string;
  baseModelInstalled: boolean;
  requiresName: boolean;
  requiresLocale: boolean;
  size: number;
}

export interface InstalledPackage {
  packageId: string;
  installed: boolean;
  corrupt: boolean;
  bytes: number;
}

export interface TtsRuntimeStatus {
  available: boolean;
  version: string;
  platform: string;
  architecture: string;
  supportsPiper: boolean;
  supportsKokoro: boolean;
  memoryMb?: number;
}

export interface TtsGlobalPreferences {
  engine: TtsEngineId;
  voices: Record<TtsEngineId, string>;
}

export interface BookTtsPreferences {
  rate: number;
  pitch: number;
  voiceId: string;
}

export interface TtsSpeakRequest {
  text: string;
  voiceUri: string;
  language: string;
  rate: number;
  pitch?: number;
}

export interface SynthesizedAudio {
  dataBase64: string;
  mimeType: string;
  durationMs: number;
}

export interface TtsEngine {
  readonly id: TtsEngineId;
  readonly capabilities: TtsCapabilities;
  detectAvailability(): Promise<boolean>;
  voices(): Promise<Array<TtsVoice | CatalogVoice>>;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  synthesize(request: TtsSpeakRequest & { voiceId: string }): Promise<SynthesizedAudio | void>;
  cancel(): Promise<void>;
}
