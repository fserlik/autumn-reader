import { expect, test } from "vitest";
import { estimateSpeechSeconds, MAX_AI_SPEECH_CHARACTERS, normalizeSpeechText, speechTextValidationKey, splitSpeechText, validateAiSpeechRequest } from "../../shared/ai-speech";

test("AI speech validates a bounded server request and normalizes its stable text",()=>{
  expect(validateAiSpeechRequest({action:"synthesize",bookId:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",fragmentId:"page-deadbeef-0",text:" A  short\npassage ",voiceId:"Lucia",language:"es-ES",rate:1.2})).toMatchObject({text:"A short passage",rate:1.2});
  expect(()=>validateAiSpeechRequest({action:"synthesize",bookId:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",fragmentId:"page-1",text:"x".repeat(MAX_AI_SPEECH_CHARACTERS+1),voiceId:"Lucia",language:"es-ES",rate:1})).toThrow("text_too_long");
  expect(normalizeSpeechText(" one\n two ")).toBe("one two");
});

test("AI speech quota estimate is conservative, rate-aware and deterministic",()=>{
  expect(estimateSpeechSeconds(1200,1)).toBe(100);
  expect(estimateSpeechSeconds(1200,2)).toBe(50);
  expect(estimateSpeechSeconds(1,1)).toBe(1);
});

test("speech chunks preserve source punctuation around closing quotes",()=>{
  const source=`“Wait.” Then she said “Go.” ${"A long sentence without a stop ".repeat(140)}`.trim();
  const chunks=splitSpeechText(source,650,700);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every(chunk=>normalizeSpeechText(source).includes(chunk))).toBe(true);
  expect(chunks.every(chunk=>chunk.length<=700)).toBe(true);
  expect(chunks[0]).toContain("Wait.”");
  expect(chunks[0]).not.toContain("Wait. ”");
});

test("validation keys ignore only typographic separators",()=>{
  expect(speechTextValidationKey("Wait. ”Then—go" )).toBe(speechTextValidationKey("Wait.” Then go"));
  expect(speechTextValidationKey("different words")).not.toBe(speechTextValidationKey("another passage"));
});
