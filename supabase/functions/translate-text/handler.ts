import { createClient } from "npm:@supabase/supabase-js";
import { translationRequest } from "../../../shared/translation.ts";

type Json=string|number|boolean|null|{[key:string]:Json|undefined}|Json[];
type BackendDatabase={public:{Tables:Record<string,never>;Views:Record<string,never>;Enums:Record<string,never>;CompositeTypes:Record<string,never>;Functions:{
  authorize_account_device:{Args:{p_user:string;p_session:string};Returns:boolean};
  effective_service_budget:{Args:{p_service:string;p_environment_microusd:number};Returns:number};
  record_deepl_provider_usage:{Args:{p_used:number;p_limit:number;p_period_start:string|null;p_period_end:string|null;p_fetched_at:string};Returns:undefined};
  reserve_deepl_translation:{Args:{p_user:string;p_characters:number;p_request_key:string;p_environment_global_limit:number;p_lifetime_limit:number;p_lifetime_used_baseline:number};Returns:string};
  finalize_deepl_translation:{Args:{p_user:string;p_id:string;p_outcome:"succeeded"|"released"|"uncertain";p_error:string|null;p_provider_trace_id:string|null};Returns:boolean};
  translation_usage_for_user:{Args:{p_user:string};Returns:Json};
}}};
type AdminClient=ReturnType<typeof createClient<BackendDatabase>>;

interface DeepLUsage { character_count:number;character_limit:number;start_time?:string;end_time?:string }
const env=(key:string):string=>{const value=Deno.env.get(key)?.trim();if(!value)throw new Error("not_configured");return value;};
const positiveIntegerEnv=(key:string,fallback?:number):number=>{const raw=Deno.env.get(key)?.trim();const value=raw?Number(raw):fallback;if(!Number.isSafeInteger(value)||value===undefined||value<1)throw new Error("not_configured");return value;};
const nonNegativeIntegerEnv=(key:string):number=>{const raw=Deno.env.get(key)?.trim();if(raw===undefined||raw==="")throw new Error("not_configured");const value=Number(raw);if(!Number.isSafeInteger(value)||value<0)throw new Error("not_configured");return value;};
const nonNegativeNumberEnv=(key:string,fallback:number):number=>{const raw=Deno.env.get(key)?.trim();const value=raw?Number(raw):fallback;if(!Number.isFinite(value)||value<0)throw new Error("not_configured");return value;};
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

function deeplConfiguration(){
  const plan=Deno.env.get("DEEPL_API_PLAN")?.trim()||"developer-free";
  if(!["developer-free","legacy-free","pro"].includes(plan))throw new Error("not_configured");
  const endpoint=(Deno.env.get("DEEPL_API_ENDPOINT")?.trim()||(plan==="pro"?"https://api.deepl.com":"https://api-free.deepl.com")).replace(/\/$/,"");
  if(!["https://api.deepl.com","https://api-free.deepl.com"].includes(endpoint))throw new Error("not_configured");
  const budgetUsd=nonNegativeNumberEnv("DEEPL_MONTHLY_BUDGET_USD",0);
  // A zero monetary budget authorizes the free allowance, never a paid endpoint.
  if(budgetUsd===0&&endpoint!=="https://api-free.deepl.com")throw new Error("not_configured");
  return {
    endpoint,key:env("DEEPL_AUTH_KEY"),
    environmentBudgetMicrousd:Math.round(budgetUsd*1_000_000),
    globalLimit:positiveIntegerEnv("DEEPL_GLOBAL_MONTHLY_CHARACTER_LIMIT",250000),
    lifetimeLimit:positiveIntegerEnv("DEEPL_LIFETIME_CHARACTER_LIMIT",1000000),
    lifetimeBaseline:nonNegativeIntegerEnv("DEEPL_LIFETIME_USED_BASELINE"),
  };
}

async function boundedJson(request:Request):Promise<unknown>{
  if(Number(request.headers.get("Content-Length"))>16384||!request.body)throw new Error("text_too_long");
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw new Error("text_too_long");parts.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
const sessionId=(token:string):string|undefined=>{try{const payload=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))) as {session_id?:unknown};return uuid(payload.session_id)?payload.session_id:undefined;}catch{return undefined;}};
const sha256=async(value:string):Promise<string>=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");

async function providerUsage(config:ReturnType<typeof deeplConfiguration>):Promise<DeepLUsage>{
  let response:Response;
  try{response=await fetch(`${config.endpoint}/v2/usage`,{headers:{Authorization:`DeepL-Auth-Key ${config.key}`},signal:AbortSignal.timeout(8000)});}
  catch{throw new Error("provider_usage_unverified");}
  if(response.status===403)throw new Error("not_configured");
  if(!response.ok)throw new Error("provider_usage_unverified");
  const value=await response.json().catch(()=>null) as Partial<DeepLUsage>|null;
  if(!value||!Number.isSafeInteger(value.character_count)||!Number.isSafeInteger(value.character_limit)
    ||value.character_count===undefined||value.character_limit===undefined||value.character_count<0||value.character_limit<1||value.character_count>value.character_limit)throw new Error("provider_usage_unverified");
  return value as DeepLUsage;
}

export async function handleTranslationRequest(request:Request):Promise<Response>{
  const origins=new Set((Deno.env.get("ALLOWED_ORIGINS")??"").split(",").map(value=>value.trim()).filter(Boolean));
  const origin=request.headers.get("Origin"),headers={"Access-Control-Allow-Origin":origin&&origins.has(origin)?origin:"",Vary:"Origin","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Cache-Control":"no-store"};
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
  if(origin&&!origins.has(origin))return reply({code:"forbidden"},403);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(request.method!=="POST")return reply({code:"forbidden"},405);
  const token=request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];if(!token)return reply({code:"session_expired"},401);
  let reservationId:string|undefined,userId="",providerStarted=false;
  let db:AdminClient|undefined;
  try{
    db=createClient<BackendDatabase>(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await db.auth.getUser(token);if(authError||!user)return reply({code:"session_expired"},401);userId=user.id;
    const session=sessionId(token);if(!session)return reply({code:"device_revoked"},403);
    const {data:allowed,error:deviceError}=await db.rpc("authorize_account_device",{p_user:user.id,p_session:session});
    if(deviceError)throw new Error("provider_unavailable");if(!allowed)return reply({code:"device_revoked"},403);
    const raw=await boundedJson(request);
    if(raw&&typeof raw==="object"&&"action" in raw&&(raw as {action?:unknown}).action==="usage"){
      const result=await db.rpc("translation_usage_for_user",{p_user:user.id});if(result.error||!result.data)throw new Error("provider_unavailable");return reply(result.data);
    }
    const value=translationRequest(raw),config=deeplConfiguration();
    const budget=await db.rpc("effective_service_budget",{p_service:"deepl",p_environment_microusd:config.environmentBudgetMicrousd});
    if(budget.error||!Number.isSafeInteger(budget.data)||budget.data<0)throw new Error("provider_unavailable");
    if(budget.data===0&&config.endpoint!=="https://api-free.deepl.com")throw new Error("not_configured");
    const usage=await providerUsage(config);
    const usageWrite=await db.rpc("record_deepl_provider_usage",{p_used:usage.character_count,p_limit:usage.character_limit,p_period_start:usage.start_time??null,p_period_end:usage.end_time??null,p_fetched_at:new Date().toISOString()});
    if(usageWrite.error)throw new Error("provider_unavailable");
    const characters=[...value.text].length;
    const requestKey=await sha256(`${value.sourceLanguage??"auto"}|${value.targetLanguage}|${value.text}`);
    const reservation=await db.rpc("reserve_deepl_translation",{p_user:user.id,p_characters:characters,p_request_key:requestKey,p_environment_global_limit:config.globalLimit,p_lifetime_limit:config.lifetimeLimit,p_lifetime_used_baseline:config.lifetimeBaseline});
    if(reservation.error){const message=reservation.error.message;throw new Error(message.includes("translation_pending")?"translation_pending":message.includes("translation_quota")?"quota_exceeded":message.includes("provider_usage_unverified")?"provider_usage_unverified":"provider_unavailable");}
    if(reservation.data==="quota_exceeded")throw new Error("quota_exceeded");
    if(!uuid(reservation.data))throw new Error("provider_unavailable");reservationId=reservation.data;
    providerStarted=true;
    let response:Response;
    try{response=await fetch(`${config.endpoint}/v2/translate`,{method:"POST",headers:{Authorization:`DeepL-Auth-Key ${config.key}`,"Content-Type":"application/json","X-DeepL-Reporting-Tag":"autumn-reader"},body:JSON.stringify({text:[value.text],target_lang:value.targetLanguage,...(value.sourceLanguage?{source_lang:value.sourceLanguage}:{})}),signal:AbortSignal.timeout(15000)});}
    catch{throw new Error("provider_result_uncertain");}
    const trace=response.headers.get("X-Trace-ID");
    if(!response.ok){providerStarted=false;const released=await db.rpc("finalize_deepl_translation",{p_user:user.id,p_id:reservationId,p_outcome:"released",p_error:`deepl_http_${response.status}`,p_provider_trace_id:trace});if(released.error)throw new Error("provider_unavailable");reservationId=undefined;
      if(response.status===429||response.status===456)throw new Error("quota_exceeded");if(response.status===403)throw new Error("not_configured");throw new Error("provider_unavailable");}
    const json:unknown=await response.json();
    if(!json||typeof json!=="object"||!("translations"in json)||!Array.isArray(json.translations))throw new Error("provider_result_uncertain");
    const translated:unknown=json.translations[0];
    if(!translated||typeof translated!=="object"||!("text"in translated)||typeof translated.text!=="string"||!("detected_source_language"in translated)||typeof translated.detected_source_language!=="string")throw new Error("provider_result_uncertain");
    const finalized=await db.rpc("finalize_deepl_translation",{p_user:user.id,p_id:reservationId,p_outcome:"succeeded",p_error:null,p_provider_trace_id:trace});
    if(finalized.error||!finalized.data)throw new Error("provider_unavailable");reservationId=undefined;
    return reply({text:translated.text,detectedSourceLanguage:translated.detected_source_language,targetLanguage:value.targetLanguage});
  }catch(error:unknown){
    const raw=error instanceof Error?error.message:"provider_unavailable";
    if(reservationId&&db&&userId){const uncertain=providerStarted||raw==="provider_result_uncertain";try{await db.rpc("finalize_deepl_translation",{p_user:userId,p_id:reservationId,p_outcome:uncertain?"uncertain":"released",p_error:raw,p_provider_trace_id:null});}catch{/* A stale reservation becomes conservative uncertain usage in SQL. */}}
    const safe=["not_configured","quota_exceeded","invalid_text","text_too_long","invalid_language","translation_pending","provider_usage_unverified"].includes(raw)?raw:"provider_unavailable";
    return reply({code:safe},safe==="quota_exceeded"?429:safe==="translation_pending"?409:["provider_unavailable","provider_usage_unverified","not_configured"].includes(safe)?503:400);
  }
}
