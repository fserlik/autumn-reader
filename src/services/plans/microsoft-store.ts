import { invoke, isTauri } from "@tauri-apps/api/core";
import { auth } from "../auth";
import { cloud } from "../client";

export type MicrosoftProductId = "autumn_plus_monthly" | "autumn_plus_yearly" | "autumn_pro_monthly" | "autumn_pro_yearly";
export interface MicrosoftStoreProduct {
  productId: MicrosoftProductId;
  storeId: string;
  title: string;
  formattedPrice: string;
  formattedRecurrencePrice: string;
  owned: boolean;
}
interface PurchaseResult { status:"succeeded"|"already_purchased"|"not_purchased"|"network_error"|"server_error";extendedError:number }
interface TicketResponse { serviceTicket:string }
interface SyncResponse { plan:"free"|"plus"|"pro";cycle?:"monthly"|"annual";status:string;expiresAt?:string }

const productIds=new Set<MicrosoftProductId>(["autumn_plus_monthly","autumn_plus_yearly","autumn_pro_monthly","autumn_pro_yearly"]);

export function isMicrosoftStoreWindows():boolean {
  return isTauri() && /\bWindows\b/i.test(navigator.userAgent);
}

function functionError(error:unknown,data:unknown):Error {
  const code=data&&typeof data==="object"&&"code" in data&&typeof data.code==="string"?data.code:"";
  if(code)return new Error(code);
  return error instanceof Error?error:new Error("provider_unavailable");
}

async function sync():Promise<SyncResponse>{
  const user=auth.requireUser();
  const ticket=await cloud().functions.invoke<TicketResponse>("microsoft-store-subscriptions",{body:{action:"ticket"}});
  if(ticket.error||!ticket.data?.serviceTicket)throw functionError(ticket.error,ticket.data);
  const b2bKey=await invoke<string>("microsoft_store_customer_purchase_id",{serviceTicket:ticket.data.serviceTicket,publisherUserId:user});
  const result=await cloud().functions.invoke<SyncResponse>("microsoft-store-subscriptions",{body:{action:"sync",b2bKey}});
  if(result.error||!result.data)throw functionError(result.error,result.data);
  return result.data;
}

export const microsoftStore={
  available:isMicrosoftStoreWindows,
  async products():Promise<MicrosoftStoreProduct[]>{
    if(!isMicrosoftStoreWindows())return [];
    const products=await invoke<MicrosoftStoreProduct[]>("microsoft_store_products");
    return products.filter(product=>productIds.has(product.productId)&&/^[A-Z0-9]{12}$/i.test(product.storeId));
  },
  async purchase(product:MicrosoftStoreProduct):Promise<SyncResponse>{
    if(!productIds.has(product.productId))throw new Error("invalid_product");
    const result=await invoke<PurchaseResult>("microsoft_store_purchase",{storeId:product.storeId});
    if(result.status==="not_purchased")throw new Error("purchase_cancelled");
    if(result.status!=="succeeded"&&result.status!=="already_purchased")throw new Error("purchase_failed");
    return sync();
  },
  restore:sync,
};
