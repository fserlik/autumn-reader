import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { personalReviews, validateReview } from "../../src/services/reviews/personal";
import { t } from "../../src/i18n";
import type { StoredBook } from "../../src/storage";
const mocks=vi.hoisted(()=>({state:{ownerId:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",status:"authenticated"},rpc:vi.fn()}));
vi.mock("../../src/services/auth",()=>({auth:{get state(){return mocks.state;},requireUser:()=>mocks.state.ownerId}}));
vi.mock("../../src/services/client",()=>({cloud:()=>({rpc:mocks.rpc}),checkError:(error:{message:string}|null)=>{if(error)throw new Error(error.message);}}));
beforeEach(()=>{vi.stubGlobal("indexedDB",new IDBFactory());vi.stubGlobal("navigator",{onLine:false});vi.stubGlobal("window",{dispatchEvent:vi.fn()});mocks.state.ownerId="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";mocks.rpc.mockReset();});
afterEach(()=>{vi.unstubAllGlobals();});
const book:StoredBook={id:"local-1",name:"Philosophy.epub",format:"epub",data:new Blob(["local bytes"]),addedAt:1,lastOpenedAt:0,page:1,cfi:null,fontSize:100};
test("reviews require an integer rating and bounded text",()=>{
  for(const value of [0,6,1.5,NaN])expect(()=>validateReview(value,"text")).toThrow();
  expect(()=>validateReview(5,"x".repeat(10001))).toThrow();expect(()=>validateReview(1,"")).not.toThrow();
});
test("offline drafts retain their catalog identity and are isolated per account",async()=>{
  const first=await personalReviews.forBook(book);first.rating=4;first.text="Draft";first.dirty=true;await personalReviews.saveDraft(first);
  expect((await personalReviews.forBook(book)).bookId).toBe(first.bookId);expect((await personalReviews.drafts())[0].text).toBe("Draft");
  expect((await personalReviews.forBook({...book,id:"cloud-clone",cloudId:"other-canonical-id",migrationSources:[book.id]})).bookId).toBe(first.bookId);
  await expect(personalReviews.publish(first)).rejects.toThrow(t("errorOffline"));expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.state.ownerId="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";expect(await personalReviews.drafts()).toEqual([]);expect(await personalReviews.cached()).toEqual([]);
  await expect(personalReviews.saveDraft(first)).rejects.toThrow(t("reviewAccountChanged"));
});
test("publication sends metadata only, retains failures and caches a confirmed review",async()=>{
  const draft=await personalReviews.forBook(book);draft.rating=5;draft.text="Excellent";draft.dirty=true;
  vi.stubGlobal("navigator",{onLine:true});mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"Provider unavailable"}});
  await expect(personalReviews.publish(draft)).rejects.toThrow("Provider unavailable");expect((await personalReviews.drafts())[0].text).toBe("Excellent");
  const review={id:"review",book_id:draft.bookId,user_id:mocks.state.ownerId,rating:5,text:"Excellent",created_at:"now",updated_at:"now"};
  mocks.rpc.mockResolvedValueOnce({data:{review,book:{id:draft.bookId,title:draft.title,author:"",format:"epub",cover_url:null,created_at:"now"}},error:null});
  await personalReviews.publish(draft);
  expect(mocks.rpc.mock.calls[1]).toEqual(["publish_book_review",{p_book_id:draft.bookId,p_title:"Philosophy",p_author:"",p_format:"epub",p_rating:5,p_text:"Excellent"}]);
  expect(await personalReviews.drafts()).toEqual([]);expect((await personalReviews.cached())[0].review).toEqual(review);
});
