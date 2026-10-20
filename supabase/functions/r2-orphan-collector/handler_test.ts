import { assertEquals } from "jsr:@std/assert@1";
import { handleOrphanCollector } from "./handler.ts";

Deno.env.set("SUPABASE_URL","https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","service-role-test");
Deno.env.set("R2_ORPHAN_COLLECTOR_SECRET","collector-secret");

const request=(body:unknown,secret="collector-secret")=>new Request("https://example.test",{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify(body)});

Deno.test("orphan collector is simulation-only and returns database candidates",async()=>{
  const original=globalThis.fetch;let rpcBody:unknown;
  globalThis.fetch=async(input,init)=>{const req=input instanceof Request?input:new Request(input,init);rpcBody=await req.json();return Response.json({dryRun:true,physicalDeletes:0,candidateCount:2,candidateBytes:300,eligibleCount:1,items:[]});};
  try{const response=await handleOrphanCollector(request({dryRun:true,limit:25}));assertEquals(response.status,200);assertEquals((rpcBody as Record<string,unknown>).p_limit,25);assertEquals((await response.json()).physicalDeletes,0);}finally{globalThis.fetch=original;}
});

Deno.test("orphan collector rejects physical deletion requests and invalid authorization",async()=>{
  assertEquals((await handleOrphanCollector(request({dryRun:false}))).status,400);
  assertEquals((await handleOrphanCollector(request({dryRun:true},"wrong"))).status,403);
});
