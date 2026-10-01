import { test, expect } from "@playwright/test";
import { mockCloud, login, epubFixture, a, b, bookId } from "./helpers/cloud";
test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem("autumn-language", "es")); });
test.afterEach(async({page})=>{await page.unrouteAll({behavior:"wait"});});
test("local book reviews publish only metadata, appear in profile, edit/delete and survive offline",async({page,context},info)=>{
  const cloud=await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"Local philosophy.epub",mimeType:"application/epub+zip",buffer:await epubFixture()});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();await page.locator("#back-button").click();await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#folder-filter")).toHaveCount(0);
  await page.locator("#library-list .book-menu summary").click();await page.locator("#library-list .book-menu-options").getByRole("button",{name:"Reseñar",exact:true}).click();await expect(page.locator("#review-dialog")).toBeVisible();
  await page.getByRole("radio",{name:"4 estrellas",exact:true}).check();await expect(page.locator("#review-rating-label")).toHaveText("4 de 5 estrellas");
  await page.locator("#review-text").fill("Una lectura excelente. <img src=x> Es mi opinión.");
  await page.screenshot({path:info.outputPath("review-composer.png")});await page.locator("#review-publish").click();await expect(page.locator("#review-dialog")).toBeHidden();
  expect(cloud.reviewRows.size).toBe(1);expect(cloud.uploads).toBe(0);expect(cloud.downloads).toBe(0);
  await page.locator('.nav-button[data-view="profile"]').click();await expect(page.locator("#profile-reviews .profile-review")).toHaveCount(1);
  await expect(page.locator("#profile-reviews")).toContainText("Local philosophy");await expect(page.locator("#profile-reviews")).toContainText("4/5");await expect(page.locator("#profile-reviews .profile-review-cover .book-cover")).toHaveCount(1);
  await expect(page.locator("#profile-reviews .profile-review-cover span")).not.toHaveText("L");
  await expect(page.locator("#profile-reviews a")).toHaveCount(0);
  await page.screenshot({path:info.outputPath("profile-review.png")});
  await page.locator("#profile-reviews").getByRole("button",{name:"Editar reseña",exact:true}).click();
  await page.getByRole("radio",{name:"5 estrellas",exact:true}).check();await page.locator("#review-text").fill("Una lectura inolvidable.");await page.locator("#review-publish").click();
  await expect(page.locator("#profile-reviews")).toContainText("Una lectura inolvidable.");expect(cloud.reviewRows.size).toBe(1);
  await context.setOffline(true);await page.reload();await page.locator('.nav-button[data-view="profile"]').click();await expect(page.locator("#profile-reviews")).toContainText("Una lectura inolvidable.");
  await context.setOffline(false);await page.locator("#profile-reviews").getByRole("button",{name:"Eliminar reseña",exact:true}).click();await page.locator("#confirm-accept").click();await expect(page.locator("#profile-reviews .profile-review")).toHaveCount(0);
  await page.locator('.nav-button[data-view="library"]').click();await expect(page.locator("#library-list .book-title")).toHaveCount(1);
});
test("offline/error drafts persist, public reviews are readable and another account cannot edit them",async({page,context})=>{
  const cloud=await mockCloud(page);await page.goto("/");await login(page);
  await page.locator("#library-list .book-menu summary").click();await page.locator("#library-list .book-menu-options").getByRole("button",{name:"Reseñar",exact:true}).click();await page.getByRole("radio",{name:"3 estrellas",exact:true}).check();
  await page.locator("#review-text").fill("Mi borrador protegido.");await context.setOffline(true);await page.locator("#review-publish").click();await expect(page.locator("#review-status")).toContainText("Sin conexión");
  await page.locator("#review-close").click();await page.reload();await page.locator('.nav-button[data-view="profile"]').click();await expect(page.locator("#profile-review-drafts")).toContainText("Cloud EPUB");
  await page.locator("#profile-review-drafts button").click();await expect(page.locator("#review-text")).toHaveValue("Mi borrador protegido.");
  await context.setOffline(false);cloud.reviewFailure=true;await page.locator("#review-publish").click();await expect(page.locator("#review-status")).toContainText("inaccesibles");await expect(page.locator("#review-text")).toHaveValue("Mi borrador protegido.");
  cloud.reviewFailure=false;await page.locator("#review-publish").click();await expect(page.locator("#review-dialog")).toBeHidden();expect([...cloud.reviewRows.values()][0].user_id).toBe(a);
  await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#account-logout").click();await login(page,"b@example.org");await page.locator('.nav-button[data-view="profile"]').click();
  await expect(page.locator("#profile-reviews .profile-review")).toHaveCount(0);await expect(page.locator("#profile-review-drafts button")).toHaveCount(0);
  await page.evaluate(id=>{location.hash=`/books/${id}`;},bookId);await expect(page.locator("#view-details")).toContainText("Mi borrador protegido.");
  await expect(page.locator("#view-details").getByRole("button",{name:"Guardar reseña",exact:true})).toHaveCount(0);await expect(page.locator("#view-details").getByRole("button",{name:"Borrar reseña",exact:true})).toHaveCount(0);
  expect([...cloud.reviewRows.values()][0].user_id).not.toBe(b);expect(cloud.downloads).toBe(0);
});
test("profile paginates reviews independently of the file library and caches loaded pages offline",async({page,context})=>{
  const cloud=await mockCloud(page,true),stamp=new Date().toISOString();
  for(let i=0;i<23;i++){
    const id=`dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12,"0")}`,reviewId=`eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12,"0")}`;
    cloud.catalog.set(id,{id,title:`Reviewed book ${i}`,author:"Author",format:"pdf",cover_url:null,created_at:stamp});
    cloud.reviewRows.set(reviewId,{id:reviewId,user_id:a,book_id:id,rating:4,text:`Opinion ${i}`,created_at:stamp,updated_at:stamp});
  }
  await page.goto("/");await login(page);await page.locator('.nav-button[data-view="profile"]').click();
  await expect(page.locator("#profile-reviews .profile-review")).toHaveCount(20);await page.locator("#profile-reviews-more").click();
  await expect(page.locator("#profile-reviews .profile-review")).toHaveCount(23);await expect(page.locator("#profile-reviews-more")).toBeHidden();
  expect(cloud.downloads).toBe(0);expect(cloud.uploads).toBe(0);
  await context.setOffline(true);await page.reload();await page.locator('.nav-button[data-view="profile"]').click();
  await expect(page.locator("#profile-reviews .profile-review")).toHaveCount(23);await expect(page.locator("#profile-reviews-more")).toBeHidden();
});
