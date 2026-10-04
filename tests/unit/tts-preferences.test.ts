import { afterEach, expect, test, vi } from "vitest";
import { defaultTtsPreferences, loadTtsPreferences, localDeviceVoices, preferredVoice, saveTtsPreferences } from "../../src/services/tts";

afterEach(() => vi.unstubAllGlobals());

test("TTS preferences persist valid voice and speed and repair invalid values", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  expect(loadTtsPreferences()).toEqual(defaultTtsPreferences);
  expect(saveTtsPreferences({ voiceUri: "voice-es", rate: 1.4 })).toEqual({ voiceUri: "voice-es", rate: 1.4 });
  expect(loadTtsPreferences()).toEqual({ voiceUri: "voice-es", rate: 1.4 });
  values.set("autumn-tts-preferences", JSON.stringify({ voiceUri: 4, rate: 8 }));
  expect(loadTtsPreferences()).toEqual(defaultTtsPreferences);
});

test("TTS lists local voices and prefers the saved voice, then the book language", () => {
  const voices = [
    { voiceURI: "remote", name: "Cloud", lang: "en-US", localService: false, default: false },
    { voiceURI: "local-en", name: "English", lang: "en-GB", localService: true, default: true },
    { voiceURI: "local-es", name: "Español", lang: "es-ES", localService: true, default: false },
  ] as SpeechSynthesisVoice[];
  const synthesis = { getVoices: () => voices } as SpeechSynthesis;
  expect(localDeviceVoices(synthesis).map(voice => voice.voiceURI)).toEqual(["local-en", "local-es"]);
  expect(preferredVoice(voices, { voiceUri: "local-en", rate: 1 }, "es")?.voiceURI).toBe("local-en");
  expect(preferredVoice(voices, defaultTtsPreferences, "es")?.voiceURI).toBe("local-es");
});
