import { AwsClient } from "npm:aws4fetch";
import { ServiceError } from "../diagnostics.ts";
import type { SpeechProvider, SpeechVoice } from "./types.ts";

export const pollyVoices: readonly SpeechVoice[] = [
  {id:"Lucia",name:"Lucía",language:"es-ES",gender:"female",proOnly:false},
  {id:"Mia",name:"Mia",language:"es-MX",gender:"female",proOnly:false},
  {id:"Lupe",name:"Lupe",language:"es-US",gender:"female",proOnly:false},
  {id:"Sergio",name:"Sergio",language:"es-ES",gender:"male",proOnly:true},
  {id:"Andres",name:"Andrés",language:"es-MX",gender:"male",proOnly:true},
  {id:"Pedro",name:"Pedro",language:"es-US",gender:"male",proOnly:true},
  {id:"Joanna",name:"Joanna",language:"en-US",gender:"female",proOnly:false},
  {id:"Amy",name:"Amy",language:"en-GB",gender:"female",proOnly:false},
  {id:"Matthew",name:"Matthew",language:"en-US",gender:"male",proOnly:true},
  {id:"Brian",name:"Brian",language:"en-GB",gender:"male",proOnly:true},
  {id:"Lea",name:"Léa",language:"fr-FR",gender:"female",proOnly:false},
  {id:"Remi",name:"Rémi",language:"fr-FR",gender:"male",proOnly:true},
  {id:"Bianca",name:"Bianca",language:"it-IT",gender:"female",proOnly:false},
  {id:"Adriano",name:"Adriano",language:"it-IT",gender:"male",proOnly:true},
];

const neuralRegions=new Set(["us-east-1","us-west-2","af-south-1","ap-northeast-1","ap-northeast-2","ap-northeast-3","ap-south-1","ap-southeast-1","ap-southeast-2","ap-southeast-5","ap-southeast-7","ca-central-1","eu-central-1","eu-west-1","eu-west-2","eu-west-3","eu-south-2","eu-central-2","us-gov-west-1"]);
const escapeXml=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const providerErrorType=async(response:Response):Promise<string>=>{
  const header=response.headers.get("x-amzn-errortype")?.split(":")[0]?.split("#").pop();
  if(header&&/^[a-z0-9_.-]{1,80}$/i.test(header))return header;
  try{
    const data=await response.clone().json() as Record<string,unknown>;
    const value=String(data.__type??data.code??data.Code??"").split("#").pop()??"";
    if(/^[a-z0-9_.-]{1,80}$/i.test(value))return value;
  }catch{/* Polly can return a non-JSON gateway response. */}
  return `polly_http_${response.status}`;
};

function configuration(){
  const accessKeyId=Deno.env.get("AWS_ACCESS_KEY_ID")?.trim()??"";
  const secretAccessKey=Deno.env.get("AWS_SECRET_ACCESS_KEY")?.trim()??"";
  const sessionToken=Deno.env.get("AWS_SESSION_TOKEN")?.trim()??"";
  const region=Deno.env.get("AWS_REGION")?.trim()??"";
  if(!accessKeyId||!secretAccessKey)throw new ServiceError("provider_configuration","missing_aws_credentials","polly");
  if(!region)throw new ServiceError("provider_configuration","missing_aws_region","polly");
  if(!neuralRegions.has(region))throw new ServiceError("provider_configuration","unsupported_neural_region","polly");
  return {region,credentialsConfigured:true,sessionTokenConfigured:Boolean(sessionToken),accessKeyId,secretAccessKey,sessionToken};
}

export const amazonPollyNeural: SpeechProvider = {
  id: "amazon_polly_neural_v1",
  voices: pollyVoices,
  configuration(){const value=configuration();return {region:value.region,credentialsConfigured:value.credentialsConfigured,sessionTokenConfigured:value.sessionTokenConfigured};},
  async synthesize(text,voice,rate) {
    const config=configuration();
    const signer=new AwsClient({accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey,service:"polly",region:config.region,retries:2,...(config.sessionToken?{sessionToken:config.sessionToken}:{})});
    let response:Response;
    try{
      response=await signer.fetch(`https://polly.${config.region}.amazonaws.com/v1/speech`,{method:"POST",headers:{"Content-Type":"application/json","Accept":"audio/mpeg"},body:JSON.stringify({Engine:"neural",LanguageCode:voice.language,OutputFormat:"mp3",SampleRate:"24000",TextType:"ssml",VoiceId:voice.id,Text:`<speak><prosody rate="${Math.round(rate*100)}%">${escapeXml(text)}</prosody></speak>`}),signal:AbortSignal.timeout(25000)});
    }catch(reason){
      const type=reason instanceof DOMException&&reason.name==="TimeoutError"?"polly_timeout":"polly_network_error";
      throw new ServiceError("provider_unavailable",type,"polly");
    }
    if(!response.ok){
      const type=await providerErrorType(response);
      const code=response.status===429?"rate_limited":response.status===400||response.status===401||response.status===403?"provider_configuration":"provider_unavailable";
      throw new ServiceError(code,type,"polly",response.status);
    }
    if(!response.headers.get("content-type")?.toLowerCase().startsWith("audio/"))throw new ServiceError("provider_unavailable","polly_invalid_content_type","polly",response.status);
    const length=Number(response.headers.get("content-length")??0);if(length>5_000_000)throw new ServiceError("provider_unavailable","polly_audio_too_large","polly",response.status);
    const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length||bytes.length>5_000_000)throw new ServiceError("provider_unavailable",bytes.length?"polly_audio_too_large":"polly_empty_audio","polly",response.status);
    return {audio:bytes,httpStatus:response.status};
  },
};
