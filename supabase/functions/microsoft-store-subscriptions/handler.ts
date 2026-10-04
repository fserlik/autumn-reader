import { createClient } from "npm:@supabase/supabase-js";

type BackendDatabase={public:{Tables:Record<string,never>;Views:Record<string,never>;Enums:Record<string,never>;CompositeTypes:Record<string,never>;Functions:{
  authorize_account_device:{Args:{p_user:string;p_session:string};Returns:boolean};
  sync_microsoft_store_subscription:{Args:{p_user:string;p_plan:string;p_status:string;p_cycle:string;p_external:string;p_starts:string;p_expires:string;p_grace:string|null};Returns:undefined};
  expire_microsoft_store_subscription:{Args:{p_user:string};Returns:undefined};
}}};
type Plan="plus"|"pro";type Cycle="monthly"|"annual";
interface Product{plan:Plan;cycle:Cycle}
interface Recurrence{autoRenew?:unknown;expirationTime?:unknown;expirationTimeWithGrace?:unknown;id?:unknown;isTrial?:unknown;productId?:unknown;startTime?:unknown;recurrenceState?:unknown}

const required=(name:string):string=>{const value=Deno.env.get(name);if(!value)throw new Error("not_configured");return value;};
const origins=()=>new Set((Deno.env.get("ALLOWED_ORIGINS")??"").split(",").map(value=>value.trim()).filter(Boolean));
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const iso=(value:unknown):value is string=>typeof value==="string"&&!Number.isNaN(Date.parse(value));
const configuredProducts=():Map<string,Product>=>{
  const values:[string,Product][]=[
    [required("MICROSOFT_STORE_PLUS_MONTHLY_ID"),{plan:"plus",cycle:"monthly"}],
    [required("MICROSOFT_STORE_PLUS_YEARLY_ID"),{plan:"plus",cycle:"annual"}],
    [required("MICROSOFT_STORE_PRO_MONTHLY_ID"),{plan:"pro",cycle:"monthly"}],
    [required("MICROSOFT_STORE_PRO_YEARLY_ID"),{plan:"pro",cycle:"annual"}],
  ];
  if(values.some(([id])=>!/^[A-Z0-9]{12}$/i.test(id))||new Set(values.map(([id])=>id.toUpperCase())).size!==4)throw new Error("not_configured");
  return new Map(values.map(([id,product])=>[id.toUpperCase(),product]));
};
async function entraToken(resource:string):Promise<string>{
  const form=new URLSearchParams({grant_type:"client_credentials",client_id:required("MICROSOFT_STORE_CLIENT_ID"),client_secret:required("MICROSOFT_STORE_CLIENT_SECRET"),resource});
  const response=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(required("MICROSOFT_STORE_TENANT_ID"))}/oauth2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(response.status===400||response.status===401?"not_configured":"provider_unavailable");
  const json=await response.json() as {access_token?:unknown};
  if(typeof json.access_token!=="string"||json.access_token.length<100)throw new Error("provider_unavailable");
  return json.access_token;
}
async function body(request:Request):Promise<Record<string,unknown>>{
  if(Number(request.headers.get("Content-Length"))>20_000||!request.body)throw new Error("invalid_request");
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>20_000)throw new Error("invalid_request");parts.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_request");return value as Record<string,unknown>;
}
function sessionId(token:string):string|undefined{try{const encoded=token.split(".")[1];const value=JSON.parse(atob(encoded.replace(/-/g,"+").replace(/_/g,"/"))) as {session_id?:unknown};return uuid(value.session_id)?value.session_id:undefined;}catch{return undefined;}}
function entitled(items:Recurrence[],products:Map<string,Product>):{record:Recurrence;product:Product;status:"trialing"|"active"|"past_due"}|undefined{
  const now=Date.now();
  const active:{record:Recurrence;product:Product;status:"trialing"|"active"|"past_due"}[]=[];
  for(const record of items){
    if(typeof record.productId!=="string"||typeof record.recurrenceState!=="string"||typeof record.id!=="string"||!iso(record.startTime)||!iso(record.expirationTime))continue;
    const product=products.get(record.productId.toUpperCase());if(!product)continue;
    const expiration=Date.parse(record.expirationTime);
    if(record.recurrenceState==="Active"&&expiration>now)active.push({record,product,status:record.isTrial===true?"trialing":"active"});
    else if(record.recurrenceState==="InDunning"&&iso(record.expirationTimeWithGrace)&&Date.parse(record.expirationTimeWithGrace)>now)active.push({record,product,status:"past_due"});
  }
  active.sort((a,b)=>(b.product.plan==="pro"?2:1)-(a.product.plan==="pro"?2:1)||Date.parse(String(b.record.expirationTime))-Date.parse(String(a.record.expirationTime)));
  return active[0];
}

export async function handleMicrosoftStoreRequest(request:Request):Promise<Response>{
  const origin=request.headers.get("Origin"),allowed=origins(),headers={"Access-Control-Allow-Origin":origin&&allowed.has(origin)?origin:"",Vary:"Origin","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Cache-Control":"no-store"};
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
  if(origin&&!allowed.has(origin))return reply({code:"forbidden"},403);if(request.method==="OPTIONS")return new Response(null,{status:204,headers});if(request.method!=="POST")return reply({code:"forbidden"},405);
  const token=request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];if(!token)return reply({code:"session_expired"},401);
  try{
    const admin=createClient<BackendDatabase>(required("SUPABASE_URL"),required("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await admin.auth.getUser(token);if(authError||!user)return reply({code:"session_expired"},401);
    const session=sessionId(token);if(!session)return reply({code:"device_revoked"},403);
    const {data:allowedDevice,error:deviceError}=await admin.rpc("authorize_account_device",{p_user:user.id,p_session:session});if(deviceError)throw new Error("provider_unavailable");if(!allowedDevice)return reply({code:"device_revoked"},403);
    const value=await body(request);
    if(value.action==="ticket"){
      const serviceTicket=await entraToken("https://onestore.microsoft.com/b2b/keys/create/purchase");
      return reply({serviceTicket});
    }
    if(value.action!=="sync"||typeof value.b2bKey!=="string"||value.b2bKey.length<100||value.b2bKey.length>16_384)throw new Error("invalid_request");
    const products=configuredProducts(),apiToken=await entraToken("https://onestore.microsoft.com");
    const response=await fetch("https://purchase.mp.microsoft.com/v8.0/b2b/recurrences/query",{method:"POST",headers:{Authorization:`Bearer ${apiToken}`,"Content-Type":"application/json"},body:JSON.stringify({b2bKey:value.b2bKey,pageSize:"100"}),signal:AbortSignal.timeout(15000)});
    if(response.status===401||response.status===403)throw new Error("not_configured");if(!response.ok)throw new Error("provider_unavailable");
    const json=await response.json() as {items?:unknown};if(!Array.isArray(json.items))throw new Error("provider_unavailable");
    const match=entitled(json.items as Recurrence[],products);
    if(!match){const{error}=await admin.rpc("expire_microsoft_store_subscription",{p_user:user.id});if(error)throw new Error("provider_unavailable");return reply({plan:"free",status:"expired"});}
    const record=match.record,grace=match.status==="past_due"?String(record.expirationTimeWithGrace):null;
    const {error}=await admin.rpc("sync_microsoft_store_subscription",{p_user:user.id,p_plan:match.product.plan,p_status:match.status,p_cycle:match.product.cycle,p_external:String(record.id),p_starts:String(record.startTime),p_expires:String(record.expirationTime),p_grace:grace});
    if(error)throw new Error("provider_unavailable");
    return reply({plan:match.product.plan,cycle:match.product.cycle,status:match.status,expiresAt:record.expirationTime});
  }catch(error:unknown){
    const code=error instanceof Error?error.message:"provider_unavailable",safe=["not_configured","invalid_request"].includes(code)?code:"provider_unavailable";
    return reply({code:safe},safe==="invalid_request"?400:503);
  }
}
