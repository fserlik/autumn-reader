export interface SpeechVoice {
  id: string;
  name: string;
  language: string;
  gender: "female" | "male";
  proOnly: boolean;
}

export interface SpeechProvider {
  readonly id: string;
  readonly voices: readonly SpeechVoice[];
  configuration(): SpeechProviderConfiguration;
  synthesize(text: string, voice: SpeechVoice, rate: number): Promise<SpeechSynthesisResult>;
}

export interface SpeechProviderConfiguration {
  region: string;
  credentialsConfigured: boolean;
  sessionTokenConfigured: boolean;
}

export interface SpeechSynthesisResult {
  audio: Uint8Array<ArrayBuffer>;
  httpStatus: number;
}
