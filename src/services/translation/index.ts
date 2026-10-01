import { translationRequest, type TranslationRequest, type TranslationResult } from "../../../shared/translation";
import { auth } from "../auth";
import { cloud } from "../client";
import { t, type TranslationKey } from "../../i18n";
export interface TranslationService { translate(request:TranslationRequest,signal?:AbortSignal):Promise<TranslationResult> }
const translationKeys: Record<string, TranslationKey> = {
  offline:"translationOffline", session_expired:"translationSession", text_too_long:"translationTooLong",
  invalid_text:"translationNoText", invalid_language:"translationBadLanguage", not_configured:"translationNotConfigured",
  quota_exceeded:"translationQuota", provider_unavailable:"translationProvider", forbidden:"translationForbidden",
};
export class TranslationError extends Error {
  constructor(readonly code:string){super(t(translationKeys[code] ?? "translationProvider"));}
}
export class SupabaseTranslationService implements TranslationService {
  async translate(request:TranslationRequest,signal?:AbortSignal):Promise<TranslationResult>{
    let valid:TranslationRequest;
    try { valid=translationRequest(request); } catch(error:unknown){throw new TranslationError(error instanceof Error?error.message:"invalid_text");}
    if(!navigator.onLine)throw new TranslationError("offline");
    if(auth.state.status!=="authenticated")throw new TranslationError("session_expired");
    const {data,error}=await cloud().functions.invoke<TranslationResult>("translate-text",{body:valid,signal});
    if(signal?.aborted)throw new DOMException("Cancelled","AbortError");
    if(error){
      const context:unknown="context"in error?error.context:undefined;
      if(context instanceof Response){
        const payload:unknown=await context.json().catch(()=>null);
        if(payload&&typeof payload==="object"&&"code"in payload&&typeof payload.code==="string")throw new TranslationError(payload.code);
      }
      throw new TranslationError("provider_unavailable");
    }
    if(!data||typeof data.text!=="string"||typeof data.detectedSourceLanguage!=="string"||data.targetLanguage!==valid.targetLanguage)throw new TranslationError("provider_unavailable");
    return data;
  }
}
export const translationService:TranslationService=new SupabaseTranslationService();
