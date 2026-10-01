import { translationLanguages, MAX_TRANSLATION_CHARACTERS, type TranslationTarget } from "../../shared/translation";
import type { TranslationService } from "../services/translation";
import { language, t } from "../i18n";
export interface TranslationUI { open(text:string):void; close():void; readonly opened:boolean }
export function mountTranslation(parent:HTMLElement,service:TranslationService,closed:()=>void):TranslationUI{
  parent.innerHTML=`<div class="reader-panel-header"><h2>${t("translate")}</h2><button id="translation-close" class="text-link" type="button">${t("close")}</button></div><p id="translation-original" class="translation-original"></p><label for="translation-target">${t("targetLanguage")}</label><select id="translation-target"></select><p class="translation-privacy">${t("translationPrivacy")}</p><button id="translation-submit" class="primary-button" type="button">${t("translateSelection")}</button><p id="translation-status" role="status" aria-live="polite"></p><p id="translation-result" class="translation-result"></p><p id="translation-language"></p>`;
  const select=parent.querySelector<HTMLSelectElement>("select")!,button=parent.querySelector<HTMLButtonElement>("#translation-submit")!,status=parent.querySelector<HTMLElement>("#translation-status")!,result=parent.querySelector<HTMLElement>("#translation-result")!,detected=parent.querySelector<HTMLElement>("#translation-language")!;
  const languageNames = new Intl.DisplayNames([language], { type: "language" });
  const nameOf = (code: string): string => languageNames.of(code.split("-")[0].toLowerCase()) ?? code;
  for(const code of Object.keys(translationLanguages))select.add(new Option(nameOf(code),code));
  const saved=localStorage.getItem("autumn-translation-target");select.value=saved&&Object.hasOwn(translationLanguages,saved)?saved:"ES";
  let text="",controller:AbortController|undefined,revision=0;
  const translate=async():Promise<void>=>{
    const local=++revision;controller?.abort();controller=new AbortController();button.disabled=true;status.textContent=t("translating");result.textContent="";detected.textContent="";
    try {const response=await service.translate({text,targetLanguage:select.value as TranslationTarget},controller.signal);if(local!==revision)return;
      result.textContent=response.text;detected.textContent=t("detectedLanguage",{source:nameOf(response.detectedSourceLanguage),target:select.selectedOptions[0].text});status.textContent="";
    }catch(error:unknown){if(local===revision&&!(error instanceof DOMException&&error.name==="AbortError"))status.textContent=error instanceof Error?error.message:t("translationFailed");}
    finally{if(local===revision)button.disabled=false;}
  };
  const ui:TranslationUI={get opened(){return!parent.hidden;},open(value){++revision;controller?.abort();controller=undefined;text=value;parent.querySelector<HTMLElement>("#translation-original")!.textContent=text.slice(0,MAX_TRANSLATION_CHARACTERS)+(text.length>MAX_TRANSLATION_CHARACTERS?"…":"");
    result.textContent="";detected.textContent="";button.disabled=text.length>MAX_TRANSLATION_CHARACTERS;status.textContent=button.disabled?t("translationTooLong"):"";
    const toolbar=parent.parentElement!.querySelector<HTMLElement>(".reader-toolbar")!;parent.style.top=`${toolbar.offsetTop+toolbar.offsetHeight+8}px`;parent.hidden=false;button.focus();},close(){if(parent.hidden)return;++revision;controller?.abort();controller=undefined;parent.hidden=true;closed();}};
  button.addEventListener("click",()=>void translate());select.addEventListener("change",()=>{localStorage.setItem("autumn-translation-target",select.value);if(result.textContent||controller)void translate();});
  parent.querySelector("#translation-close")!.addEventListener("click",()=>ui.close());return ui;
}
