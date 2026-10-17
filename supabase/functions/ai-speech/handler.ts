import { createClient } from "npm:@supabase/supabase-js";
import { AwsClient } from "npm:aws4fetch";
import he from "npm:he@1.2.0";
import JSZip from "npm:jszip@3.10.2";
import { estimateSpeechSeconds, speechTextValidationKey, validateAiSpeechRequest } from "../../../shared/ai-speech.ts";
import { diagnosticError, logDiagnostic, rpcFailure, ServiceError, type DiagnosticStage } from "./diagnostics.ts";
import { validatePdfFragment } from "./pdf-validator.ts";
import { amazonPollyNeural } from "./providers/polly.ts";
import type { SpeechVoice } from "./providers/types.ts";

type Json = string|number|boolean|null|{[key:string]:Json|undefined}|Json[];
type Database={public:{Tables:Record<string,never>;Views:Record<string,never>;Enums:Record<string,never>;CompositeTypes:Record<string,never>;Functions:{
  authorize_account_device:{Args:{p_user:string;p_session:string};Returns:boolean};
  reserve_ai_speech:{Args:{p_user:string;p_book:string;p_request_key:string;p_fragment_hash:string;p_fragment_id:string;p_voice:string;p_language:string;p_rate:number;p_characters:number;p_estimated_seconds:number;p_cost_microusd:number;p_budget_microusd:number;p_retention_days:number};Returns:Json};
  mark_ai_speech_generating:{Args:{p_user:string;p_id:string};Returns:boolean};
  complete_ai_speech:{Args:{p_user:string;p_id:string;p_audio_key:string;p_actual_seconds:number|null};Returns:Json};
  fail_ai_speech:{Args:{p_user:string;p_id:string;p_error:string;p_provider_billed:boolean};Returns:boolean};
  ai_speech_usage_for_user:{Args:{p_user:string;p_budget_microusd:number};Returns:Json};
  authorize_book_download:{Args:{p_user:string;p_book:string};Returns:Json};
}}};
interface Reservation { outcome:"reserved"|"pending"|"cached";generationId:string;audioKey?:string;durationSeconds?:number;expiresAt?:string; }
interface Usage { plan:"free"|"plus"|"pro";includedSeconds:number;usedSeconds:number;remainingSeconds:number;cycleStartsAt:string;resetsAt:string;serviceAvailable:boolean;budgetPaused:boolean; }
const voices:readonly SpeechVoice[]=amazonPollyNeural.voices;
const env=(name:string):string=>{const value=Deno.env.get(name)?.trim();if(!value)throw new Error("not_configured");return value;};
const numberEnv=(name:string,fallback:number,min:number,max:number):number=>{const value=Number(Deno.env.get(name)??fallback);if(!Number.isFinite(value)||value<min||value>max)throw new Error("not_configured");return value;};
const budgetMicros=()=>Math.round(numberEnv("AI_SPEECH_MONTHLY_BUDGET_USD",10,0.01,1000)*1_000_000);
const origins=()=>new Set((Deno.env.get("ALLOWED_ORIGINS")??"").split(",").map(v=>v.trim()).filter(Boolean));
const admin=()=>createClient<Database>(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
const r2Configuration=()=>{
  try{return {accountId:env("R2_ACCOUNT_ID"),accessKeyId:env("R2_ACCESS_KEY_ID"),secretAccessKey:env("R2_SECRET_ACCESS_KEY"),bucket:env("R2_BUCKET")};}
  catch{throw new ServiceError("storage_unavailable","missing_r2_configuration","r2");}
};
const r2Signer=()=>{const value=r2Configuration();return new AwsClient({accessKeyId:value.accessKeyId,secretAccessKey:value.secretAccessKey,service:"s3",region:"auto",retries:2});};
const r2Url=(key:string)=>{const value=r2Configuration();return `https://${value.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(value.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;};
const hex=async(value:string):Promise<string>=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,"0")).join("");
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
async function boundedJson(request:Request):Promise<unknown>{
  if(Number(request.headers.get("Content-Length"))>16384||!request.body)throw new Error("invalid_request");
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const{done,value}=await reader.read();if(done)break;length+=value.length;if(length>16384)throw new Error("invalid_request");chunks.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
async function presign(key:string):Promise<string>{
  try{const url=new URL(r2Url(key));url.searchParams.set("X-Amz-Expires","120");
    return (await r2Signer().sign(url,{method:"GET",aws:{signQuery:true,allHeaders:true}})).url;
  }catch(reason){if(reason instanceof ServiceError)throw reason;throw new ServiceError("storage_unavailable","r2_presign_error","r2");}
}
async function putAudio(key:string,audio:Uint8Array<ArrayBuffer>):Promise<number>{
  let response:Response;
  try{response=await r2Signer().fetch(r2Url(key),{method:"PUT",headers:{"Content-Type":"audio/mpeg","Cache-Control":"private, max-age=31536000, immutable","If-None-Match":"*"},body:audio,signal:AbortSignal.timeout(30000)});}
  catch(reason){if(reason instanceof ServiceError)throw reason;const type=reason instanceof DOMException&&reason.name==="TimeoutError"?"r2_put_timeout":"r2_put_network_error";throw new ServiceError("storage_unavailable",type,"r2");}
  if(!response.ok&&response.status!==412)throw new ServiceError("storage_unavailable","r2_put_http_error","r2",response.status);return response.status;
}
async function getPrivateObject(key:string,expected:number):Promise<{bytes:Uint8Array<ArrayBuffer>;httpStatus:number}>{
  if(expected<1||expected>33_554_432)throw new ServiceError("book_text_unverified","invalid_book_size","book_parser");
  let response:Response;
  try{response=await r2Signer().fetch(r2Url(key),{method:"GET",signal:AbortSignal.timeout(30000)});}
  catch(reason){if(reason instanceof ServiceError)throw reason;const type=reason instanceof DOMException&&reason.name==="TimeoutError"?"r2_get_timeout":"r2_get_network_error";throw new ServiceError("storage_unavailable",type,"r2");}
  if(!response.ok)throw new ServiceError("storage_unavailable","r2_get_http_error","r2",response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==expected)throw new ServiceError("book_text_unverified","book_size_mismatch","book_parser");return {bytes,httpStatus:response.status};
}
const comparable=(value:string)=>value.normalize("NFKC").replace(/\s+/gu," ").trim();
function decodeHtml(value:string):string{return he.decode(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu," ").replace(/<[^>]+>/gu," "));}
export async function textBelongsToBook(bytes:Uint8Array<ArrayBuffer>,format:"epub"|"pdf",fragmentId:string,text:string):Promise<boolean>{
  const needle=comparable(text),validationNeedle=speechTextValidationKey(needle);if(!needle)return false;
  if(format==="epub"){
    try{const zip=await JSZip.loadAsync(bytes);let scanned=0;
      const entries=Object.values(zip.files).filter(entry=>!entry.dir&&/\.(xhtml|html|htm)$/i.test(entry.name));
      for(const entry of entries){const html=await entry.async("string");scanned+=html.length;if(scanned>20_000_000)throw new ServiceError("book_text_unverified","epub_scan_limit","book_parser");const source=comparable(decodeHtml(html));if(source.includes(needle)||(validationNeedle&&speechTextValidationKey(source).includes(validationNeedle)))return true;}
      return false;
    }catch(reason){if(reason instanceof ServiceError)throw reason;throw new ServiceError("book_text_unverified","epub_parse_error","book_parser");}
  }
  return validatePdfFragment(bytes,fragmentId,text);
}
function sessionId(token:string):string|undefined{try{const payload=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))) as {session_id?:unknown};return uuid(payload.session_id)?payload.session_id:undefined;}catch{return undefined;}}
const databaseCodes=["subscription_required","ai_speech_quota","generation_limit","rate_limited","global_budget","forbidden"] as const;
function publicError(reason:unknown):string{
  if(reason instanceof ServiceError)return reason.safeCode;
  const raw=reason instanceof Error?reason.message:"provider_unavailable";
  return ["subscription_required","ai_speech_quota","generation_limit","rate_limited","global_budget","voice_unavailable","invalid_request","text_too_long","not_configured","storage_unavailable","provider_configuration","book_text_unverified","pdf_encrypted","pdf_damaged","pdf_no_extractable_text","pdf_validation_unavailable"].includes(raw)?raw:"provider_unavailable";
}

export async function handleAiSpeechRequest(request:Request):Promise<Response>{
  const origin=request.headers.get("Origin"),allowed=origins(),headers={"Access-Control-Allow-Origin":origin&&allowed.has(origin)?origin:"",Vary:"Origin","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Cache-Control":"no-store"};
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
  if(origin&&!allowed.has(origin))return reply({code:"forbidden"},403);if(request.method==="OPTIONS")return new Response(null,{status:204,headers});if(request.method!=="POST")return reply({code:"forbidden"},405);
  const requestId=crypto.randomUUID();let stage:DiagnosticStage="authentication";
  const ok=(details:Record<string,unknown>={})=>logDiagnostic(requestId,stage,"ok",details);
  const token=request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if(!token){logDiagnostic(requestId,stage,"error",diagnosticError(new ServiceError("session_expired","missing_bearer_token")));return reply({code:"session_expired"},401);}
  let generationId:string|undefined,providerBilled=false,user="";
  try{
    const db=admin(),identity=await db.auth.getUser(token);
    if(identity.error||!identity.data.user)throw new ServiceError("session_expired","supabase_auth_rejected","supabase",(identity.error as {status?:number}|null)?.status);
    user=identity.data.user.id;ok();
    stage="device_authorization";
    const session=sessionId(token);if(!session)throw new ServiceError("device_revoked","invalid_session_claim");
    const device=await db.rpc("authorize_account_device",{p_user:user,p_session:session});if(device.error)throw rpcFailure("authorize_account_device",device.error);if(!device.data)throw new ServiceError("device_revoked","device_not_authorized","supabase");ok();
    stage="request_validation";const input=validateAiSpeechRequest(await boundedJson(request));const budget=budgetMicros();ok({action:input.action});
    stage="quota_lookup";const usageResult=await db.rpc("ai_speech_usage_for_user",{p_user:user,p_budget_microusd:budget});if(usageResult.error||!usageResult.data)throw rpcFailure("ai_speech_usage_for_user",usageResult.error);ok();
    const usage=usageResult.data as unknown as Usage;
    if(input.action==="usage")return reply(usage);
    if(usage.plan==="free")return reply({code:"subscription_required"},403);
    const tier=usage.plan==="pro"?"full":"limited",available=voices.filter(voice=>tier==="full"||!voice.proOnly);
    stage="polly_configuration";const providerConfig=amazonPollyNeural.configuration();ok({...providerConfig});
    if(input.action==="voices")return reply({voices:available,tier});
    if(!input.bookId||!input.text||!input.voiceId||!input.language||input.rate===undefined||!input.fragmentId)throw new Error("invalid_request");
    const voice=available.find(item=>item.id===input.voiceId&&item.language===input.language);if(!voice)throw new Error("voice_unavailable");
    const fragmentHash=await hex(input.text),requestKey=await hex(`${input.bookId}|${input.fragmentId}|${fragmentHash}|${voice.id}|${voice.language}|${input.rate.toFixed(1)}|${amazonPollyNeural.id}`);
    const seconds=estimateSpeechSeconds(input.text.length,input.rate),cost=Math.ceil(input.text.length*numberEnv("POLLY_NEURAL_USD_PER_MILLION_CHARS",16,0.01,100));
    stage="reservation";const reservation=await db.rpc("reserve_ai_speech",{p_user:user,p_book:input.bookId,p_request_key:requestKey,p_fragment_hash:fragmentHash,p_fragment_id:input.fragmentId,p_voice:voice.id,p_language:voice.language,p_rate:input.rate,p_characters:input.text.length,p_estimated_seconds:seconds,p_cost_microusd:cost,p_budget_microusd:budget,p_retention_days:Math.round(numberEnv("AI_SPEECH_RETENTION_DAYS",90,1,365))});
    if(reservation.error||!reservation.data)throw rpcFailure("reserve_ai_speech",reservation.error,"provider_unavailable",databaseCodes);const record=reservation.data as unknown as Reservation;ok({reservationOutcome:record.outcome});
    if(record.outcome==="cached"&&record.audioKey){stage="r2_audio_presign";const audioUrl=await presign(record.audioKey);ok();return reply({audioUrl,cached:true,durationSeconds:record.durationSeconds,expiresAt:record.expiresAt});}
    if(record.outcome==="pending")return reply({code:"generation_pending",retryAfterMs:800},202);
    if(record.outcome!=="reserved"||!uuid(record.generationId))throw new ServiceError("provider_unavailable","invalid_reservation_response","supabase");
    generationId=record.generationId;
    stage="book_authorization";const fileResult=await db.rpc("authorize_book_download",{p_user:user,p_book:input.bookId});
    if(fileResult.error)throw rpcFailure("authorize_book_download",fileResult.error,"forbidden");if(!fileResult.data)throw new ServiceError("forbidden","book_not_owned","supabase");ok();
    const file=fileResult.data as unknown as {r2_key:string;file_size:number;format:"epub"|"pdf"};
    if((file.format!=="epub"&&file.format!=="pdf")||typeof file.r2_key!=="string")throw new ServiceError("book_text_unverified","invalid_book_record","supabase");
    stage="book_download";const bookObject=await getPrivateObject(file.r2_key,Number(file.file_size));ok({service:"r2",httpStatus:bookObject.httpStatus});
    stage="book_validation";if(!await textBelongsToBook(bookObject.bytes,file.format,input.fragmentId,input.text))throw new ServiceError("book_text_unverified","text_not_found_in_book","book_parser",undefined,"fragment_validation");ok({format:file.format});
    stage="generation_claim";const started=await db.rpc("mark_ai_speech_generating",{p_user:user,p_id:generationId});if(started.error)throw rpcFailure("mark_ai_speech_generating",started.error);if(!started.data){ok({claimResult:"already_claimed"});return reply({code:"generation_pending",retryAfterMs:800},202);}ok();
    stage="polly_synthesis";const synthesis=await amazonPollyNeural.synthesize(input.text,voice,input.rate);providerBilled=true;ok({service:"polly",httpStatus:synthesis.httpStatus});
    const key=`ai-speech/${user}/${input.bookId}/${requestKey}.mp3`;stage="r2_audio_upload";const uploadStatus=await putAudio(key,synthesis.audio);ok({service:"r2",httpStatus:uploadStatus});
    stage="finalization";const completed=await db.rpc("complete_ai_speech",{p_user:user,p_id:generationId,p_audio_key:key,p_actual_seconds:null});if(completed.error||!completed.data)throw rpcFailure("complete_ai_speech",completed.error);ok();
    const done=completed.data as unknown as {durationSeconds:number;expiresAt:string};stage="r2_audio_presign";const audioUrl=await presign(key);ok();return reply({audioUrl,cached:false,durationSeconds:done.durationSeconds,expiresAt:done.expiresAt});
  }catch(reason:unknown){
    logDiagnostic(requestId,stage,"error",diagnosticError(reason));const safe=publicError(reason);
    if(generationId&&user){const failedStage:DiagnosticStage="failure_cleanup";try{const failed=await admin().rpc("fail_ai_speech",{p_user:user,p_id:generationId,p_error:safe,p_provider_billed:providerBilled});if(failed.error)throw rpcFailure("fail_ai_speech",failed.error);logDiagnostic(requestId,failedStage,"ok",{providerBilled});}catch(cleanupError){logDiagnostic(requestId,failedStage,"error",diagnosticError(cleanupError));}}
    const status=safe==="session_expired"?401:["subscription_required","forbidden","device_revoked"].includes(safe)?403:["ai_speech_quota","generation_limit","rate_limited","global_budget"].includes(safe)?429:["invalid_request","text_too_long","voice_unavailable","book_text_unverified","pdf_encrypted","pdf_damaged","pdf_no_extractable_text"].includes(safe)?400:503;
    return reply({code:safe},status);
  }
}
