import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleMicrosoftStoreRequest } from "./handler.ts";

const owner="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",session="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const jwt=`header.${btoa(JSON.stringify({session_id:session}))}.signature`;
const storeIds={plusMonthly:"9AAAAAAAAAAA",plusYearly:"9BBBBBBBBBBB",proMonthly:"9CCCCCCCCCCC",proYearly:"9DDDDDDDDDDD"};
for(const[name,value]of Object.entries({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-admin",ALLOWED_ORIGINS:"http://tauri.localhost",MICROSOFT_STORE_TENANT_ID:"tenant",MICROSOFT_STORE_CLIENT_ID:"client",MICROSOFT_STORE_CLIENT_SECRET:"private-secret",MICROSOFT_STORE_PLUS_MONTHLY_ID:storeIds.plusMonthly,MICROSOFT_STORE_PLUS_YEARLY_ID:storeIds.plusYearly,MICROSOFT_STORE_PRO_MONTHLY_ID:storeIds.proMonthly,MICROSOFT_STORE_PRO_YEARLY_ID:storeIds.proYearly}))Deno.env.set(name,value);
const request=(value:unknown)=>new Request("https://example.supabase.co/functions/v1/microsoft-store-subscriptions",{method:"POST",headers:{Authorization:`Bearer ${jwt}`,Origin:"http://tauri.localhost","Content-Type":"application/json"},body:JSON.stringify(value)});
interface Call{url:string;body:unknown;authorization:string|null}
function mock(options:{device?:boolean;items?:unknown[]}={}){
  const original=globalThis.fetch,calls:Call[]=[];
  globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const req=input instanceof Request?input:new Request(input,init);let body:unknown;try{body=req.method!=="POST"?undefined:req.headers.get("content-type")?.includes("application/json")?await req.clone().json():await req.clone().text();}catch{body=undefined;}calls.push({url:req.url,body,authorization:req.headers.get("authorization")});
    if(req.url.endsWith("/auth/v1/user"))return Response.json({id:owner,aud:"authenticated",role:"authenticated"});
    if(req.url.endsWith("/rpc/authorize_account_device"))return Response.json(options.device!==false);
    if(req.url.includes("login.microsoftonline.com"))return Response.json({access_token:"token-"+"x".repeat(120)});
    if(req.url.includes("/recurrences/query"))return Response.json({items:options.items??[]});
    if(req.url.includes("/rpc/"))return new Response("null",{headers:{"Content-Type":"application/json"}});
    throw new Error(`unexpected fetch ${req.url}`);
  };
  return{calls,restore:()=>{globalThis.fetch=original;}};
}

Deno.test("purchase ticket uses the purchase-key audience and stays scoped to the verified user device",async()=>{
  const fake=mock();try{
    const response=await handleMicrosoftStoreRequest(request({action:"ticket",user:"impersonated"}));
    assertEquals(response.status,200);assert(typeof(await response.json()).serviceTicket==="string");
    assertEquals(fake.calls.find(call=>call.url.endsWith("authorize_account_device"))?.body,{p_user:owner,p_session:session});
    const token=fake.calls.find(call=>call.url.includes("login.microsoftonline.com"))!;
    assert(String(token.body).includes("resource=https%3A%2F%2Fonestore.microsoft.com%2Fb2b%2Fkeys%2Fcreate%2Fpurchase"));
    assertEquals(fake.calls.some(call=>call.url.includes("recurrences/query")),false);
  }finally{fake.restore();}
});

Deno.test("active Microsoft recurrence controls the plan and ignores client entitlement claims",async()=>{
  const item={id:"subscription:verified",productId:storeIds.proYearly,recurrenceState:"Active",isTrial:false,startTime:"2026-01-01T00:00:00Z",expirationTime:"2099-01-01T00:00:00Z"};
  const fake=mock({items:[item]});try{
    const response=await handleMicrosoftStoreRequest(request({action:"sync",b2bKey:"b".repeat(200),plan:"pro",status:"active"}));
    assertEquals(response.status,200);assertEquals(await response.json(),{plan:"pro",cycle:"annual",status:"active",expiresAt:item.expirationTime});
    const write=fake.calls.find(call=>call.url.endsWith("sync_microsoft_store_subscription"))!;
    assertEquals(write.body,{p_user:owner,p_plan:"pro",p_status:"active",p_cycle:"annual",p_external:item.id,p_starts:item.startTime,p_expires:item.expirationTime,p_grace:null});
    const query=fake.calls.find(call=>call.url.includes("recurrences/query"))!;
    assertEquals(query.body,{b2bKey:"b".repeat(200),pageSize:"100"});assertEquals(query.authorization,"Bearer token-"+"x".repeat(120));
  }finally{fake.restore();}
});

Deno.test("terminal, expired and unknown products cannot grant access",async()=>{
  const fake=mock({items:[{id:"canceled",productId:storeIds.proMonthly,recurrenceState:"Canceled",startTime:"2026-01-01T00:00:00Z",expirationTime:"2099-01-01T00:00:00Z"},{id:"unknown",productId:"9ZZZZZZZZZZZ",recurrenceState:"Active",startTime:"2026-01-01T00:00:00Z",expirationTime:"2099-01-01T00:00:00Z"}]});try{
    const response=await handleMicrosoftStoreRequest(request({action:"sync",b2bKey:"b".repeat(200)}));
    assertEquals(await response.json(),{plan:"free",status:"expired"});
    assertEquals(fake.calls.find(call=>call.url.endsWith("expire_microsoft_store_subscription"))?.body,{p_user:owner});
    assertEquals(fake.calls.some(call=>call.url.endsWith("sync_microsoft_store_subscription")),false);
  }finally{fake.restore();}
});

Deno.test("a revoked device cannot request Store credentials or query subscriptions",async()=>{
  const fake=mock({device:false});try{
    const response=await handleMicrosoftStoreRequest(request({action:"ticket"}));assertEquals(response.status,403);assertEquals(await response.json(),{code:"device_revoked"});
    assertEquals(fake.calls.some(call=>call.url.includes("microsoftonline.com")||call.url.includes("recurrences/query")),false);
  }finally{fake.restore();}
});
