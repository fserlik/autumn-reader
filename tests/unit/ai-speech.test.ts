import { expect, test } from "vitest";
import { estimateSpeechSeconds, MAX_AI_SPEECH_CHARACTERS, normalizeSpeechText, validateAiSpeechRequest } from "../../shared/ai-speech";

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
