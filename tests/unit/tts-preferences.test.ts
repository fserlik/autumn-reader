import { afterEach, expect, test, vi } from "vitest";
import { defaultTtsPreferences, loadBookTtsPreferences, loadTtsPreferences, localDeviceVoices, preferredVoice, saveBookTtsPreferences, saveTtsPreferences } from "../../src/services/tts";

afterEach(() => vi.unstubAllGlobals());

test("TTS preferences persist the engine and one default voice per engine", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  expect(loadTtsPreferences()).toEqual(defaultTtsPreferences);
  const saved = { engine: "piper" as const, voices: { system: "voice-es", piper: "piper-es-carlfm", kokoro: "" } };
  expect(saveTtsPreferences(saved)).toEqual(saved);
  expect(loadTtsPreferences()).toEqual(saved);
});

test("TTS lists local voices and prefers the saved voice, then the book language", () => {
  const voices = [
    { voiceURI: "remote", name: "Cloud", lang: "en-US", localService: false, default: false },
    { voiceURI: "local-en", name: "English", lang: "en-GB", localService: true, default: true },
    { voiceURI: "local-es", name: "Español", lang: "es-ES", localService: true, default: false },
  ] as SpeechSynthesisVoice[];
  const synthesis = { getVoices: () => voices } as SpeechSynthesis;
  expect(localDeviceVoices(synthesis).map(voice => voice.voiceURI)).toEqual(["local-en", "local-es"]);
  expect(preferredVoice(voices, "local-en", "es")?.voiceURI).toBe("local-en");
  expect(preferredVoice(voices, "", "es")?.voiceURI).toBe("local-es");
});

test("reading speed, pitch and voice override are isolated per account and book", () => {
  const values = new Map<string,string>();
  vi.stubGlobal("localStorage", { getItem: (key:string)=>values.get(key)??null, setItem:(key:string,value:string)=>values.set(key,value) });
  saveBookTtsPreferences("owner-a","book-a",{voiceId:"kokoro-es-dora",rate:1.2,pitch:1});
  saveBookTtsPreferences("owner-a","book-b",{voiceId:"system:local-en",rate:.8,pitch:1.3});
  expect(loadBookTtsPreferences("owner-a","book-a")).toEqual({voiceId:"kokoro-es-dora",rate:1.2,pitch:1});
  expect(loadBookTtsPreferences("owner-a","book-b")).toEqual({voiceId:"system:local-en",rate:.8,pitch:1.3});
  expect(loadBookTtsPreferences("owner-b","book-a")).toEqual({voiceId:"",rate:1,pitch:1});
});
