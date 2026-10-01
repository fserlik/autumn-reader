import { test,expect,vi } from "vitest";
import { translationRequest } from "../../shared/translation";
import { SupabaseTranslationService } from "../../src/services/translation";
import { t } from "../../src/i18n";
const invoke=vi.hoisted(()=>vi.fn());
vi.mock("../../src/services/client",()=>({cloud:()=>({functions:{invoke}})}));
vi.mock("../../src/services/auth",()=>({auth:{state:{status:"authenticated"}}}));
test("translation validates selected fragments/target without forwarding metadata",()=>{
  expect(translationRequest({text:"Selected text",targetLanguage:"ES",filename:"hidden",user_id:"hidden"})).toEqual({text:"Selected text",targetLanguage:"ES"});
  expect(()=>translationRequest({text:"x".repeat(2001),targetLanguage:"ES"})).toThrow("text_too_long");
  expect(()=>translationRequest({text:"",targetLanguage:"ES"})).toThrow("invalid_text");
});
test("translation handles offline, target change, response and provider failures",async()=>{
  const service=new SupabaseTranslationService();vi.stubGlobal("navigator",{onLine:false});
  await expect(service.translate({text:"Hi",targetLanguage:"ES"})).rejects.toThrow(t("translationOffline"));expect(invoke).not.toHaveBeenCalled();
  vi.stubGlobal("navigator",{onLine:true});invoke.mockResolvedValueOnce({data:{text:"Hola",detectedSourceLanguage:"EN",targetLanguage:"ES"},error:null});
  expect(await service.translate({text:"Hi",targetLanguage:"ES"})).toMatchObject({text:"Hola"});
  invoke.mockResolvedValueOnce({data:{text:"Bonjour",detectedSourceLanguage:"EN",targetLanguage:"FR"},error:null});
  expect(await service.translate({text:"Hi",targetLanguage:"FR"})).toMatchObject({targetLanguage:"FR"});
  invoke.mockResolvedValueOnce({data:null,error:{context:Response.json({code:"quota_exceeded"},{status:429})}});
  await expect(service.translate({text:"Hi",targetLanguage:"ES"})).rejects.toThrow(t("translationQuota"));
  invoke.mockResolvedValueOnce({data:null,error:new Error("private raw detail")});await expect(service.translate({text:"Hi",targetLanguage:"ES"})).rejects.toThrow(t("translationProvider"));vi.unstubAllGlobals();
});
