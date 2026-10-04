import { createClient } from "npm:@supabase/supabase-js";
import { translationRequest } from "../../../shared/translation.ts";
type BackendDatabase={public:{Tables:Record<string,never>;Views:Record<string,never>;Enums:Record<string,never>;CompositeTypes:Record<string,never>;Functions:{reserve_translation:{Args:{p_user:string;p_characters:number};Returns:undefined};authorize_account_device:{Args:{p_user:string;p_session:string};Returns:boolean}}}};
const env=(key:string):string=>{const value=Deno.env.get(key);if(!value)throw new Error("not_configured");return value;};
async function boundedJson(request:Request):Promise<unknown>{
  if(Number(request.headers.get("Content-Length"))>16384||!request.body)throw new Error("text_too_long");
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw new Error("text_too_long");parts.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function handleTranslationRequest(request:Request):Promise<Response>{
  const origins=new Set((Deno.env.get("ALLOWED_ORIGINS")??"").split(",").map(value=>value.trim()).filter(Boolean));
  const origin=request.headers.get("Origin"),headers={"Access-Control-Allow-Origin":origin&&origins.has(origin)?origin:"",Vary:"Origin","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Cache-Control":"no-store"};
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
  if(origin&&!origins.has(origin))return reply({code:"forbidden"},403);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(request.method!=="POST")return reply({code:"forbidden"},405);
  const token=request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];if(!token)return reply({code:"session_expired"},401);
  try{
    const admin=createClient<BackendDatabase>(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await admin.auth.getUser(token);if(authError||!user)return reply({code:"session_expired"},401);
    // Auth verifies the JWT; its session claim is then checked against the
    // server-side device registry before any paid provider call or quota write.
    let sessionId: string|undefined;
    try {
      const payload=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))) as {session_id?:unknown};
      if(typeof payload.session_id==="string"&&/^[0-9a-f-]{36}$/i.test(payload.session_id))sessionId=payload.session_id;
    } catch { /* A malformed token cannot authorize a device. */ }
    if(!sessionId)return reply({code:"device_revoked"},403);
    const {data:allowed,error:deviceError}=await admin.rpc("authorize_account_device",{p_user:user.id,p_session:sessionId});
    if(deviceError)throw new Error("provider_unavailable");
    if(!allowed)return reply({code:"device_revoked"},403);
    const value=translationRequest(await boundedJson(request));
    const key=env("DEEPL_AUTH_KEY"),plan=Deno.env.get("DEEPL_API_PLAN")??"developer";
    if(!["developer","legacy-free"].includes(plan))throw new Error("not_configured");
    const {error}=await admin.rpc("reserve_translation",{p_user:user.id,p_characters:value.text.length});
    if(error)throw new Error(error.message.includes("translation_quota")?"quota_exceeded":"provider_unavailable");
    const response=await fetch(plan==="legacy-free"?"https://api-free.deepl.com/v2/translate":"https://api.deepl.com/v2/translate",{
      method:"POST",headers:{Authorization:`DeepL-Auth-Key ${key}`,"Content-Type":"application/json"},
      body:JSON.stringify({text:[value.text],target_lang:value.targetLanguage,...(value.sourceLanguage?{source_lang:value.sourceLanguage}:{})}),signal:AbortSignal.timeout(15000),
    });
    if(response.status===429||response.status===456)throw new Error("quota_exceeded");
    if(response.status===403)throw new Error("not_configured");
    if(!response.ok)throw new Error("provider_unavailable");
    const json:unknown=await response.json();
    if(!json||typeof json!=="object"||!("translations"in json)||!Array.isArray(json.translations))throw new Error("provider_unavailable");
    const translated:unknown=json.translations[0];
    if(!translated||typeof translated!=="object"||!("text"in translated)||typeof translated.text!=="string"||!("detected_source_language"in translated)||typeof translated.detected_source_language!=="string")throw new Error("provider_unavailable");
    return reply({text:translated.text,detectedSourceLanguage:translated.detected_source_language,targetLanguage:value.targetLanguage});
  }catch(error:unknown){
    const code=error instanceof Error?error.message:"provider_unavailable";
    const safe=["not_configured","quota_exceeded","invalid_text","text_too_long","invalid_language"].includes(code)?code:"provider_unavailable";
    return reply({code:safe},safe==="quota_exceeded"?429:safe==="provider_unavailable"?503:safe==="not_configured"?503:400);
  }
}
