import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { handleAiSpeechRequest, textBelongsToBook } from "./handler.ts";
import { ServiceError } from "./diagnostics.ts";
import JSZip from "npm:jszip@3.10.2";

for(const [key,value] of Object.entries({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"service-secret",R2_ACCOUNT_ID:"0".repeat(32),R2_ACCESS_KEY_ID:"r2-access",R2_SECRET_ACCESS_KEY:"r2-secret",R2_BUCKET:"private-books",AWS_ACCESS_KEY_ID:"aws-access",AWS_SECRET_ACCESS_KEY:"aws-secret",AWS_REGION:"us-east-1",AI_SPEECH_MONTHLY_BUDGET_USD:"10",AI_SPEECH_RETENTION_DAYS:"90",POLLY_NEURAL_USD_PER_MILLION_CHARS:"16",ALLOWED_ORIGINS:"http://127.0.0.1:1420"}))Deno.env.set(key,value);
const owner="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",book="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",session="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const jwt=`header.${btoa(JSON.stringify({session_id:session}))}.signature`;
const request=(body:unknown,token=true)=>new Request("https://example.supabase.co/functions/v1/ai-speech",{method:"POST",headers:{"Content-Type":"application/json",Origin:"http://127.0.0.1:1420",...(token?{Authorization:`Bearer ${jwt}`}:{})},body:JSON.stringify(body)});
const synthesis={action:"synthesize",bookId:book,fragmentId:"page-deadbeef-0",text:"Cada historia tiene su estación.",voiceId:"Lucia",language:"es-ES",rate:1};
const archive=new JSZip();archive.file("META-INF/container.xml","<container/>");archive.file("OEBPS/chapter.xhtml","<html><body><p>Cada historia tiene su estación.</p></body></html>");
const epubBytes=await archive.generateAsync({type:"uint8array"});

function samplePdf():Uint8Array<ArrayBuffer>{
  const stream="BT /F1 12 Tf 72 720 Td (Cada historia tiene su estacion.) Tj ET";
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source="%PDF-1.4\n",offsets=[0];
  objects.forEach((object,index)=>{offsets.push(source.length);source+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=source.length;source+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  source+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,"0")} 00000 n \n`).join("");
  source+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(new TextEncoder().encode(source));
}

type FailureRpc="authorize_account_device"|"ai_speech_usage_for_user"|"reserve_ai_speech"|"authorize_book_download"|"mark_ai_speech_generating"|"complete_ai_speech"|"fail_ai_speech";
function mock(options:{plan?:"free"|"plus"|"pro";device?:boolean;reservation?:"reserved"|"pending"|"cached";pollyStatus?:number;pollyErrorType?:string;rpcFailure?:FailureRpc;r2GetStatus?:number;r2PutStatus?:number;bookFormat?:"epub"|"pdf";bookBytes?:Uint8Array<ArrayBuffer>}={}){
  const original=globalThis.fetch,calls:{url:string;method:string;body:unknown;authorization:string|null;amzDate:string|null;securityToken:string|null}[]=[];
  globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const req=input instanceof Request?input:new Request(input,init);let body:unknown;
    if(req.method==="POST"&&req.headers.get("content-type")?.includes("json"))body=await req.clone().json();
    calls.push({url:req.url,method:req.method,body,authorization:req.headers.get("authorization"),amzDate:req.headers.get("x-amz-date"),securityToken:req.headers.get("x-amz-security-token")});
    if(req.url.endsWith("/auth/v1/user"))return Response.json({id:owner,aud:"authenticated",role:"authenticated"});
    const rpc=([...req.url.matchAll(/\/rpc\/([^/?]+)/g)].at(-1)?.[1]??"") as FailureRpc;
    if(options.rpcFailure===rpc)return Response.json({code:"XX000",message:"database failure",details:null,hint:null},{status:500});
    if(req.url.endsWith("/rpc/authorize_account_device"))return Response.json(options.device!==false);
    if(req.url.endsWith("/rpc/ai_speech_usage_for_user"))return Response.json({plan:options.plan??"plus",includedSeconds:3600,usedSeconds:0,remainingSeconds:3600,cycleStartsAt:"2026-10-01T00:00:00Z",resetsAt:"2026-11-01T00:00:00Z",serviceAvailable:true,budgetPaused:false});
    if(req.url.endsWith("/rpc/reserve_ai_speech")){
      const outcome=options.reservation??"reserved";
      return Response.json(outcome==="cached"?{outcome,generationId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",audioKey:`ai-speech/${owner}/${book}/${"e".repeat(64)}.mp3`,durationSeconds:3,expiresAt:"2027-01-01T00:00:00Z"}:{outcome,generationId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",durationSeconds:3});
    }
    const bookBytes=options.bookBytes??epubBytes,bookFormat=options.bookFormat??"epub";
    if(req.url.endsWith("/rpc/authorize_book_download"))return Response.json({r2_key:`books/test.${bookFormat}`,file_size:bookBytes.length,format:bookFormat});
    if(req.url.endsWith("/rpc/mark_ai_speech_generating"))return Response.json(true);
    if(req.url.endsWith("/rpc/complete_ai_speech"))return Response.json({durationSeconds:3,expiresAt:"2027-01-01T00:00:00Z"});
    if(req.url.endsWith("/rpc/fail_ai_speech"))return Response.json(true);
    if(req.url.includes("polly.us-east-1.amazonaws.com"))return options.pollyStatus&&options.pollyStatus!==200?Response.json({__type:options.pollyErrorType??"ProviderFailure"},{status:options.pollyStatus,headers:{"x-amzn-errortype":options.pollyErrorType??"ProviderFailure"}}):new Response(new Uint8Array([73,68,51,4,0,0]),{status:200,headers:{"Content-Type":"audio/mpeg","Content-Length":"6"}});
    if(req.url.includes("r2.cloudflarestorage.com")&&req.method==="GET")return new Response(options.r2GetStatus===undefined||options.r2GetStatus===200?bookBytes.buffer as ArrayBuffer:null,{status:options.r2GetStatus??200,headers:{"Content-Length":String(bookBytes.length)}});
    if(req.url.includes("r2.cloudflarestorage.com")&&req.method==="PUT")return new Response(null,{status:options.r2PutStatus??200});
    if(req.url.includes("r2.cloudflarestorage.com"))return new Response(null,{status:200});
    return Response.json({message:"unexpected"},{status:500});
  };
  return {calls,restore:()=>{globalThis.fetch=original;}};
}

async function captureDiagnostics<T>(run:()=>Promise<T>):Promise<{result:T;entries:Record<string,unknown>[]}>{
  const info=console.info,error=console.error,entries:Record<string,unknown>[]=[];
  const capture=(...args:unknown[])=>{if(args[0]==="ai-speech diagnostic"&&args[1]&&typeof args[1]==="object")entries.push(args[1] as Record<string,unknown>);};
  console.info=capture;console.error=capture;
  try{return {result:await run(),entries};}finally{console.info=info;console.error=error;}
}

Deno.test("AI speech authenticates, reserves before Polly, stores privately and returns only a signed short URL",async()=>{
  const fake=mock();try{
    const response=await handleAiSpeechRequest(request(synthesis));assertEquals(response.status,200);
    const result=await response.json();assertEquals(result.cached,false);assert(String(result.audioUrl).includes("X-Amz-Expires=120"));
    const reserve=fake.calls.findIndex(call=>call.url.endsWith("reserve_ai_speech")),polly=fake.calls.findIndex(call=>call.url.includes("polly.us-east-1")),r2=fake.calls.findIndex(call=>call.url.includes("r2.cloudflarestorage.com")&&call.method==="PUT");
    assert(reserve>=0&&polly>reserve&&r2>polly);
    const provider=fake.calls[polly];assertEquals((provider.body as Record<string,unknown>).Engine,"neural");assertEquals((provider.body as Record<string,unknown>).VoiceId,"Lucia");
    assert(provider.authorization?.startsWith("AWS4-HMAC-SHA256"));assert(provider.authorization?.includes("/us-east-1/polly/aws4_request"));assert(provider.amzDate);assert(!JSON.stringify(result).includes("secret"));
    const storage=fake.calls[r2];assert(storage.authorization?.startsWith("AWS4-HMAC-SHA256"));assert(storage.authorization?.includes("/auto/s3/aws4_request"));
  }finally{fake.restore();}
});

Deno.test("Free, duplicate pending and cached requests never call the paid provider",async()=>{
  for(const settings of [{plan:"free" as const},{reservation:"pending" as const},{reservation:"cached" as const}]){
    const fake=mock(settings);try{
      const response=await handleAiSpeechRequest(request(synthesis));
      assertEquals(response.status,settings.plan==="free"?403:settings.reservation==="pending"?202:200);
      assertEquals(fake.calls.filter(call=>call.url.includes("polly.")).length,0);
    }finally{fake.restore();}
  }
});

Deno.test("provider errors release the reservation and missing/revoked sessions cannot reserve",async()=>{
  const failed=mock({pollyStatus:500});try{
    const response=await handleAiSpeechRequest(request(synthesis));assertEquals(response.status,503);
    const release=failed.calls.find(call=>call.url.endsWith("fail_ai_speech"));assert(release);assertEquals((release.body as Record<string,unknown>).p_provider_billed,false);
  }finally{failed.restore();}
  const revoked=mock({device:false});try{
    assertEquals((await handleAiSpeechRequest(request(synthesis))).status,403);
    assertEquals(revoked.calls.filter(call=>call.url.includes("reserve_ai_speech")||call.url.includes("polly.")).length,0);
    assertEquals((await handleAiSpeechRequest(request(synthesis,false))).status,401);
  }finally{revoked.restore();}
});

Deno.test("voice catalog exposes curated Plus voices and the full Pro set",async()=>{
  const plus=mock({plan:"plus"});try{const data=await (await handleAiSpeechRequest(request({action:"voices"}))).json();assertEquals(data.tier,"limited");assert(data.voices.every((voice:{proOnly:boolean})=>!voice.proOnly));}finally{plus.restore();}
  const pro=mock({plan:"pro"});try{const data=await (await handleAiSpeechRequest(request({action:"voices"}))).json();assertEquals(data.tier,"full");assert(data.voices.some((voice:{id:string})=>voice.id==="Sergio"));}finally{pro.restore();}
});

Deno.test("source validation accepts only text from the referenced PDF page",async()=>{
  assertEquals(await textBelongsToBook(samplePdf(),"pdf","pdf-1-0-0","Cada historia"),true);
  assertEquals(await textBelongsToBook(samplePdf(),"pdf","pdf-1-0-0","Texto que no existe"),false);
  const error=await assertRejects(()=>textBelongsToBook(samplePdf(),"pdf","pdf-2-0-0","Cada historia"),ServiceError);
  assertEquals(error.errorType,"pdf_page_out_of_range");assertEquals(error.parserStage,"fragment_validation");
});

Deno.test("Polly failures log a safe stage, AWS error type and HTTP status without secrets or book text",async()=>{
  const fake=mock({pollyStatus:403,pollyErrorType:"InvalidSignatureException"});try{
    const {result:response,entries}=await captureDiagnostics(()=>handleAiSpeechRequest(request(synthesis)));
    assertEquals(response.status,503);assertEquals((await response.json()).code,"provider_configuration");
    const failure=entries.find(entry=>entry.stage==="polly_synthesis"&&entry.outcome==="error");
    assert(failure);assertEquals(failure.errorType,"InvalidSignatureException");assertEquals(failure.httpStatus,403);assertEquals(failure.service,"polly");
    const serialized=JSON.stringify(entries);assert(!serialized.includes("aws-secret"));assert(!serialized.includes("Cada historia"));assert(!serialized.includes("X-Amz-Signature"));
  }finally{fake.restore();}
});

Deno.test("unsupported Neural regions and missing AWS credentials fail during provider preflight",async()=>{
  const originalRegion=Deno.env.get("AWS_REGION"),originalSecret=Deno.env.get("AWS_SECRET_ACCESS_KEY");
  try{
    Deno.env.set("AWS_REGION","sa-east-1");let fake=mock();
    try{const {result,entries}=await captureDiagnostics(()=>handleAiSpeechRequest(request(synthesis)));assertEquals(result.status,503);assert(entries.some(entry=>entry.stage==="polly_configuration"&&entry.errorType==="unsupported_neural_region"));assertEquals(fake.calls.some(call=>call.url.includes("polly.")),false);}finally{fake.restore();}
    Deno.env.set("AWS_REGION","us-east-1");Deno.env.delete("AWS_SECRET_ACCESS_KEY");fake=mock();
    try{const {result,entries}=await captureDiagnostics(()=>handleAiSpeechRequest(request(synthesis)));assertEquals(result.status,503);assert(entries.some(entry=>entry.stage==="polly_configuration"&&entry.errorType==="missing_aws_credentials"));assertEquals(fake.calls.some(call=>call.url.includes("polly.")),false);}finally{fake.restore();}
  }finally{if(originalRegion)Deno.env.set("AWS_REGION",originalRegion);else Deno.env.delete("AWS_REGION");if(originalSecret)Deno.env.set("AWS_SECRET_ACCESS_KEY",originalSecret);else Deno.env.delete("AWS_SECRET_ACCESS_KEY");}
});

Deno.test("temporary AWS credentials are included in the signed Polly request",async()=>{
  const original=Deno.env.get("AWS_SESSION_TOKEN");Deno.env.set("AWS_SESSION_TOKEN","temporary-session-token");
  const fake=mock();try{
    assertEquals((await handleAiSpeechRequest(request(synthesis))).status,200);
    const provider=fake.calls.find(call=>call.url.includes("polly.us-east-1.amazonaws.com"));assert(provider);assertEquals(provider.securityToken,"temporary-session-token");
  }finally{fake.restore();if(original)Deno.env.set("AWS_SESSION_TOKEN",original);else Deno.env.delete("AWS_SESSION_TOKEN");}
});

Deno.test("R2 download and upload failures keep distinct diagnostics and safe responses",async()=>{
  for(const settings of [{r2GetStatus:404,stage:"book_download",providerBilled:false},{r2PutStatus:503,stage:"r2_audio_upload",providerBilled:true}]){
    const fake=mock(settings);try{
      const {result:response,entries}=await captureDiagnostics(()=>handleAiSpeechRequest(request(synthesis)));assertEquals(response.status,503);assertEquals((await response.json()).code,"storage_unavailable");
      const failure=entries.find(entry=>entry.stage===settings.stage&&entry.outcome==="error");assert(failure);assertEquals(failure.service,"r2");assertEquals(failure.httpStatus,settings.r2GetStatus??settings.r2PutStatus);
      const release=fake.calls.find(call=>call.url.endsWith("fail_ai_speech"));assert(release);assertEquals((release.body as Record<string,unknown>).p_provider_billed,settings.providerBilled);
    }finally{fake.restore();}
  }
});

Deno.test("malformed PDFs are classified as book validation failures and never reach Polly",async()=>{
  const fake=mock({bookFormat:"pdf",bookBytes:new Uint8Array(new TextEncoder().encode("not a pdf"))});try{
    const pdfRequest={...synthesis,fragmentId:"pdf-1-0-0"};const {result:response,entries}=await captureDiagnostics(()=>handleAiSpeechRequest(request(pdfRequest)));
    assertEquals(response.status,400);assertEquals((await response.json()).code,"pdf_damaged");
    assert(entries.some(entry=>entry.stage==="book_validation"&&entry.errorType==="pdf_invalid_document"&&entry.parserStage==="document_load"));assertEquals(fake.calls.some(call=>call.url.includes("polly.")),false);
  }finally{fake.restore();}
});

Deno.test("valid PDFs still reject arbitrary client text before Polly",async()=>{
  const fake=mock({bookFormat:"pdf",bookBytes:samplePdf()});try{
    const pdfRequest={...synthesis,fragmentId:"pdf-1-0-0",text:"Este texto no pertenece al documento"};
    const {result:response,entries}=await captureDiagnostics(()=>handleAiSpeechRequest(request(pdfRequest)));
    assertEquals(response.status,400);assertEquals((await response.json()).code,"book_text_unverified");
    assert(entries.some(entry=>entry.stage==="book_validation"&&entry.errorType==="text_not_found_in_book"&&entry.parserStage==="fragment_validation"));
    assertEquals(fake.calls.some(call=>call.url.includes("polly.")),false);
  }finally{fake.restore();}
});

Deno.test("RPC failures identify their stage while preserving provider_unavailable for the client",async()=>{
  for(const [rpc,expectedStage] of [["authorize_account_device","device_authorization"],["ai_speech_usage_for_user","quota_lookup"],["reserve_ai_speech","reservation"],["complete_ai_speech","finalization"]] as const){
    const fake=mock({rpcFailure:rpc});try{
      const {result:response,entries}=await captureDiagnostics(()=>handleAiSpeechRequest(request(synthesis)));assertEquals(response.status,503);assertEquals((await response.json()).code,"provider_unavailable");
      const failure=entries.find(entry=>entry.stage===expectedStage&&entry.outcome==="error");assert(failure);assert(String(failure.errorType).includes(rpc));
    }finally{fake.restore();}
  }
});
