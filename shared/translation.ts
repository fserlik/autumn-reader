export const MAX_TRANSLATION_CHARACTERS = 2000;
export const translationLanguages = { ES:"Español", "EN-US":"Inglés", FR:"Francés", DE:"Alemán", IT:"Italiano", "PT-BR":"Portugués", JA:"Japonés", ZH:"Chino" } as const;
export type TranslationTarget = keyof typeof translationLanguages;
export interface TranslationRequest { text:string; sourceLanguage?:string; targetLanguage:TranslationTarget }
export interface TranslationResult { text:string; detectedSourceLanguage:string; targetLanguage:TranslationTarget }
export function translationRequest(value: unknown): TranslationRequest {
  if (!value || typeof value!=="object" || !("text" in value) || typeof value.text!=="string" || !value.text.trim()) throw new Error("invalid_text");
  if (value.text.length>MAX_TRANSLATION_CHARACTERS) throw new Error("text_too_long");
  if (!("targetLanguage" in value) || typeof value.targetLanguage!=="string" || !Object.hasOwn(translationLanguages,value.targetLanguage)) throw new Error("invalid_language");
  const source = "sourceLanguage" in value ? value.sourceLanguage : undefined;
  if(source!==undefined && (typeof source!=="string" || !/^(ES|EN|FR|DE|IT|PT|JA|ZH)$/.test(source)))throw new Error("invalid_language");
  return {text:value.text.trim(),targetLanguage:value.targetLanguage as TranslationTarget,...(typeof source==="string"?{sourceLanguage:source}:{})};
}
