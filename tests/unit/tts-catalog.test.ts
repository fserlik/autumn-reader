import { expect, test } from "vitest";
import { knownVoices, packageForVoice, ttsEngines, ttsPackages } from "../../src/services/tts";

test("legacy package registry remains valid for already-installed models", () => {
  expect(ttsPackages).toHaveLength(5);
  for (const model of ttsPackages) {
    expect(model.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(model.size).toBeGreaterThan(10_000_000);
    expect(model).not.toHaveProperty("url");
  }
  expect(knownVoices.some(voice => voice.locale.startsWith("es"))).toBe(true);
  expect(knownVoices.every(voice => packageForVoice(voice).engine === voice.engine)).toBe(true);
});

test("all three engines implement the common capability contract", () => {
  expect(Object.keys(ttsEngines)).toEqual(["system", "piper", "kokoro"]);
  expect(ttsEngines.system.capabilities).toMatchObject({ rate: true, pitch: true, downloadableVoices: false });
  expect(ttsEngines.piper.capabilities).toMatchObject({ rate: true, pitch: false, downloadableVoices: false });
  expect(ttsEngines.kokoro.capabilities).toMatchObject({ rate: true, pitch: false, downloadableVoices: false });
});
