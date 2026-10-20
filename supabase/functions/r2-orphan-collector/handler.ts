import { createClient } from "npm:@supabase/supabase-js";

type Database={public:{Tables:Record<string,never>;Views:Record<string,never>;Enums:Record<string,never>;CompositeTypes:Record<string,never>;Functions:{preview_r2_orphan_collection:{Args:{p_limit:number};Returns:unknown}}}};
const env=(name:string):string=>{const value=Deno.env.get(name)?.trim();if(!value)throw new Error("not_configured");return value;};
function equal(a:string,b:string):boolean{if(a.length!==b.length)return false;let value=0;for(let index=0;index<a.length;index++)value|=a.charCodeAt(index)^b.charCodeAt(index);return value===0;}

export async function handleOrphanCollector(request:Request):Promise<Response>{
  const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
  if(request.method!=="POST")return reply({code:"forbidden"},405);
  let secret:string;
  try{secret=env("R2_ORPHAN_COLLECTOR_SECRET");}catch{return reply({code:"not_configured"},503);}
  const bearer=request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1]??"";
  if(!equal(secret,bearer))return reply({code:"forbidden"},403);
  const body=await request.json().catch(()=>null) as {dryRun?:unknown;limit?:unknown}|null;
  if(!body||body.dryRun!==true)return reply({code:"dry_run_required"},400);
  const limit=body.limit===undefined?500:Number(body.limit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>5000)return reply({code:"invalid_limit"},400);
  try{
    const admin=createClient<Database>(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
    const result=await admin.rpc("preview_r2_orphan_collection",{p_limit:limit});
    if(result.error||!result.data)throw new Error("database_unavailable");
    const value=result.data as {dryRun?:unknown;physicalDeletes?:unknown};
    if(value.dryRun!==true||value.physicalDeletes!==0)throw new Error("unsafe_collector_response");
    return reply(value);
  }catch{return reply({code:"collector_unavailable"},503);}
}
