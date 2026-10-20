import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleTranslationRequest } from "./handler.ts";

for(const [key,value] of Object.entries({
  SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-admin",
  DEEPL_AUTH_KEY:"private-provider-key",DEEPL_API_PLAN:"developer-free",DEEPL_API_ENDPOINT:"https://api-free.deepl.com",
  DEEPL_GLOBAL_MONTHLY_CHARACTER_LIMIT:"250000",DEEPL_MONTHLY_BUDGET_USD:"0",
  DEEPL_LIFETIME_CHARACTER_LIMIT:"1000000",DEEPL_LIFETIME_USED_BASELINE:"12500",
  ALLOWED_ORIGINS:"http://127.0.0.1:1420",
}))Deno.env.set(key,value);

const owner="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",session="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",reservation="cccccccc-cccc-4ccc-cccc-cccccccccccc";
const jwt=`header.${btoa(JSON.stringify({session_id:session}))}.signature`;
const request=(body:unknown,token=true,origin="http://127.0.0.1:1420")=>new Request("https://example.supabase.co/functions/v1/translate-text",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,...(token?{Authorization:`Bearer ${jwt}`}:{})},body:JSON.stringify(body)});

function mock(options:{auth?:boolean;device?:boolean;providerStatus?:number;quota?:boolean;usageVerified?:boolean;networkFailure?:boolean}={}){
  const original=globalThis.fetch,calls:{url:string;method:string;body:unknown;headers:Headers}[]=[];
  globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const req=input instanceof Request?input:new Request(input,init);const body=req.method==="POST"?await req.clone().json().catch(()=>undefined):undefined;
    calls.push({url:req.url,method:req.method,body,headers:req.headers});
    if(req.url.endsWith("/auth/v1/user"))return options.auth===false?Response.json({message:"expired"},{status:401}):Response.json({id:owner,aud:"authenticated",role:"authenticated"});
    if(req.url.endsWith("/rpc/authorize_account_device"))return Response.json(options.device!==false);
    if(req.url.endsWith("/rpc/effective_service_budget"))return Response.json(0);
    if(req.url.endsWith("/rpc/translation_usage_for_user"))return Response.json({plan:"premium",includedCharacters:20000,usedCharacters:1250,remainingCharacters:18750,cycleStartsAt:"2026-10-01T00:00:00Z",resetsAt:"2026-11-01T00:00:00Z",serviceAvailable:true,globalLimitReached:false,providerUsageVerified:true});
    if(req.url.endsWith("/rpc/record_deepl_provider_usage"))return new Response("null",{status:200,headers:{"Content-Type":"application/json"}});
    if(req.url.endsWith("/rpc/reserve_deepl_translation"))return options.quota?Response.json({message:"translation_quota"},{status:400}):Response.json(reservation);
    if(req.url.endsWith("/rpc/finalize_deepl_translation"))return Response.json(true);
    if(req.url.endsWith("/v2/usage"))return options.usageVerified===false?Response.json({message:"unavailable"},{status:500}):Response.json({character_count:43000,character_limit:500000});
    if(req.url.endsWith("/v2/translate")){
      if(options.networkFailure)throw new TypeError("network");
      return options.providerStatus&&options.providerStatus!==200?Response.json({message:"provider"},{status:options.providerStatus,headers:{"X-Trace-ID":"trace-failure"}}):Response.json({translations:[{text:"Ser o no ser",detected_source_language:"EN"}]},{headers:{"X-Trace-ID":"trace-success"}});
    }
    return Response.json({});
  };
  return {calls,restore:()=>{globalThis.fetch=original;}};
}

Deno.test("translation verifies provider usage, reserves atomically and records only metadata",async()=>{
  const fake=mock();try{
    const response=await handleTranslationRequest(request({text:"To be or not to be",targetLanguage:"ES",filename:"PRIVATE.epub",user_id:"impersonated"}));
    assertEquals(response.status,200);assertEquals(await response.json(),{text:"Ser o no ser",detectedSourceLanguage:"EN",targetLanguage:"ES"});
    const provider=fake.calls.find(call=>call.url.endsWith("/v2/translate"))!;
    assertEquals(provider.body,{text:["To be or not to be"],target_lang:"ES"});
    assertEquals(provider.headers.get("authorization"),"DeepL-Auth-Key private-provider-key");
    assertEquals(provider.headers.get("x-deepl-reporting-tag"),"autumn-reader");
    const reserve=fake.calls.find(call=>call.url.endsWith("reserve_deepl_translation"))!;
    assertEquals((reserve.body as Record<string,unknown>).p_user,owner);
    assertEquals((reserve.body as Record<string,unknown>).p_characters,18);
    assertEquals((reserve.body as Record<string,unknown>).p_environment_global_limit,250000);
    assertEquals((reserve.body as Record<string,unknown>).p_lifetime_used_baseline,12500);
    assert(!JSON.stringify(reserve.body).includes("To be or not to be"));
    const finalized=fake.calls.find(call=>call.url.endsWith("finalize_deepl_translation"))!;
    assertEquals((finalized.body as Record<string,unknown>).p_outcome,"succeeded");
    assertEquals((finalized.body as Record<string,unknown>).p_provider_trace_id,"trace-success");
  }finally{fake.restore();}
});

Deno.test("usage is available without calling DeepL and exposes remaining characters",async()=>{
  const fake=mock();try{
    const response=await handleTranslationRequest(request({action:"usage"}));assertEquals(response.status,200);
    assertEquals((await response.json()).remainingCharacters,18750);
    assertEquals(fake.calls.filter(call=>call.url.includes("deepl.com")).length,0);
  }finally{fake.restore();}
});

Deno.test("a revoked device cannot spend quota or call the provider",async()=>{
  const fake=mock({device:false});try{
    const response=await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"}));assertEquals(response.status,403);assertEquals(await response.json(),{code:"device_revoked"});
    assertEquals(fake.calls.filter(call=>call.url.includes("reserve_deepl")||call.url.includes("deepl.com")).length,0);
  }finally{fake.restore();}
});

Deno.test("translation rejects missing auth, bad origin and invalid input before provider translation",async()=>{
  const fake=mock();try{
    assertEquals((await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"},false))).status,401);
    assertEquals((await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"},true,"https://evil.example"))).status,403);
    for(const value of [{text:"",targetLanguage:"ES"},{text:"x".repeat(2001),targetLanguage:"ES"},{text:"Hi",targetLanguage:"arbitrary"}])assertEquals((await handleTranslationRequest(request(value))).status,400);
    assertEquals(fake.calls.filter(call=>call.url.endsWith("/v2/translate")).length,0);
  }finally{fake.restore();}
});

Deno.test("provider and local quotas fail closed without leaking provider errors",async()=>{
  for(const settings of [{providerStatus:500},{providerStatus:456},{providerStatus:429},{quota:true},{usageVerified:false}]){
    const fake=mock(settings);try{
      const response=await handleTranslationRequest(request({text:"Hi",targetLanguage:"FR"}));
      assertEquals(response.status,settings.providerStatus===456||settings.providerStatus===429||settings.quota?429:503);
      const result=await response.json();assert(["quota_exceeded","provider_unavailable","provider_usage_unverified"].includes(result.code));
    }finally{fake.restore();}
  }
});

Deno.test("definite HTTP failure releases the reservation while an uncertain network result remains counted",async()=>{
  const definite=mock({providerStatus:500});try{await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"}));
    const final=(definite.calls.find(call=>call.url.endsWith("finalize_deepl_translation"))!.body as Record<string,unknown>);assertEquals(final.p_outcome,"released");
  }finally{definite.restore();}
  const uncertain=mock({networkFailure:true});try{await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"}));
    const final=(uncertain.calls.find(call=>call.url.endsWith("finalize_deepl_translation"))!.body as Record<string,unknown>);assertEquals(final.p_outcome,"uncertain");
  }finally{uncertain.restore();}
});

Deno.test("zero monetary budget permits only the verified free endpoint and requires a lifetime baseline",async()=>{
  Deno.env.set("DEEPL_API_ENDPOINT","https://api.deepl.com");let fake=mock();try{const response=await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"}));assertEquals(await response.json(),{code:"not_configured"});}finally{fake.restore();Deno.env.set("DEEPL_API_ENDPOINT","https://api-free.deepl.com");}
  Deno.env.delete("DEEPL_LIFETIME_USED_BASELINE");fake=mock();try{const response=await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"}));assertEquals(await response.json(),{code:"not_configured"});}finally{fake.restore();Deno.env.set("DEEPL_LIFETIME_USED_BASELINE","12500");}
});
