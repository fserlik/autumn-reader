import { assertEquals, assert } from "jsr:@std/assert@1";
import { handleTranslationRequest } from "./handler.ts";
Deno.env.set("SUPABASE_URL","https://example.supabase.co");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","test-admin");Deno.env.set("DEEPL_AUTH_KEY","private-provider-key");Deno.env.set("DEEPL_API_PLAN","developer");Deno.env.set("ALLOWED_ORIGINS","http://127.0.0.1:1420");
const owner="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const request=(body:unknown,token=true,origin="http://127.0.0.1:1420")=>new Request("https://example.supabase.co/functions/v1/translate-text",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,...(token?{Authorization:"Bearer account-token"}:{})},body:JSON.stringify(body)});
function mock(options:{auth?:boolean;status?:number;quota?:boolean}={}){
  const original=globalThis.fetch,calls:{url:string;body:unknown;headers:Headers}[]=[];
  globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const req=input instanceof Request?input:new Request(input,init);const body=req.method==="POST"?await req.json():undefined;calls.push({url:req.url,body,headers:req.headers});
    if(req.url.endsWith("/auth/v1/user"))return options.auth===false?Response.json({message:"expired"},{status:401}):Response.json({id:owner,aud:"authenticated",role:"authenticated"});
    if(req.url.endsWith("/rpc/reserve_translation"))return options.quota?Response.json({message:"translation_quota"},{status:400}):new Response("null",{status:200,headers:{"Content-Type":"application/json"}});
    return Response.json({translations:[{text:"Ser o no ser",detected_source_language:"EN"}]},{status:options.status??200});
  };
  return {calls,restore:()=>{globalThis.fetch=original;}};
}
Deno.test("translation verifies session and sends only the selected fragment/languages to the provider",async()=>{
  const fake=mock();try{
    const response=await handleTranslationRequest(request({text:"To be or not to be",targetLanguage:"ES",filename:"PRIVATE.epub",user_id:"impersonated"}));assertEquals(response.status,200);
    assertEquals(await response.json(),{text:"Ser o no ser",detectedSourceLanguage:"EN",targetLanguage:"ES"});
    const provider=fake.calls.find(call=>call.url.startsWith("https://api.deepl.com"))!;
    assertEquals(provider.body,{text:["To be or not to be"],target_lang:"ES"});assertEquals(provider.headers.get("authorization"),"DeepL-Auth-Key private-provider-key");
    assertEquals(fake.calls.find(c=>c.url.endsWith("reserve_translation"))!.body,{p_user:owner,p_characters:18});
    assert(!JSON.stringify(provider).includes(owner));
  }finally{fake.restore();}
});
Deno.test("translation rejects missing/expired auth, disallowed origin, empty/oversized text and invalid target",async()=>{
  const fake=mock();try{
    assertEquals((await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"},false))).status,401);
    assertEquals((await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"},true,"https://evil.example"))).status,403);
    for(const value of [{text:"",targetLanguage:"ES"},{text:"x".repeat(2001),targetLanguage:"ES"},{text:"Hi",targetLanguage:"arbitrary"}])assertEquals((await handleTranslationRequest(request(value))).status,400);
    assertEquals(fake.calls.filter(c=>c.url.includes("deepl.com")).length,0);
  }finally{fake.restore();}
  const expired=mock({auth:false});try{assertEquals((await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"}))).status,401);}finally{expired.restore();}
});
Deno.test("translation maps provider and database quotas without leaking provider errors or retrying",async()=>{
  for(const settings of [{status:500},{status:456},{status:429},{quota:true}]){
    const fake=mock(settings);try{
      const response=await handleTranslationRequest(request({text:"Hi",targetLanguage:"FR"}));assertEquals(response.status,settings.status===500?503:429);
      assertEquals(await response.json(),{code:settings.status===500?"provider_unavailable":"quota_exceeded"});
      assertEquals(fake.calls.filter(c=>c.url.includes("deepl.com")).length,settings.quota?0:1);
    }finally{fake.restore();}
  }
});
Deno.test("translation is unavailable without a backend-only key and does not reserve budget",async()=>{
  Deno.env.delete("DEEPL_AUTH_KEY");const fake=mock();try{
    const response=await handleTranslationRequest(request({text:"Hi",targetLanguage:"ES"}));assertEquals(response.status,503);assertEquals(await response.json(),{code:"not_configured"});assertEquals(fake.calls.length,1);
  }finally{Deno.env.set("DEEPL_AUTH_KEY","private-provider-key");fake.restore();}
});
