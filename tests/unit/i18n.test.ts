import { expect, test, vi } from "vitest";
import { extraTranslations } from "../../src/i18n-extra";
import { bookColors, colorName } from "../../src/book-colors";

test("every recently added interface key exists with matching placeholders in all supported languages", () => {
  const english = extraTranslations.en;
  const keys = Object.keys(english).sort();
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const locale of ["es", "it", "fr"] as const) {
    const dictionary = extraTranslations[locale];
    expect(Object.keys(dictionary).sort()).toEqual(keys);
    for (const key of keys) {
      expect(dictionary[key as keyof typeof dictionary]?.trim(), `${locale}:${key}`).toBeTruthy();
      expect(placeholders(dictionary[key as keyof typeof dictionary]), `${locale}:${key}`).toEqual(placeholders(english[key as keyof typeof english]));
    }
  }
});

test("folder, library and sync labels follow the saved language at startup", async () => {
  for (const locale of ["en", "es", "it", "fr"] as const) {
    vi.stubGlobal("localStorage", { getItem: () => locale, setItem: vi.fn() });
    vi.resetModules();
    const { t, language } = await import("../../src/i18n");
    expect(language).toBe(locale);
    for (const key of ["newFolder", "noFolder", "libraryGrid", "syncAction", "errorCorruptEpub"] as const)
      expect(t(key)).toBe(extraTranslations[locale][key]);
  }
  vi.unstubAllGlobals();
});

test("folder and note colour labels are localized in each supported language", () => {
  for (const locale of ["en", "es", "it", "fr"] as const)
    for (const color of bookColors) expect(colorName(color.value, locale)).toBe(color.name[locale]);
});

test("Home and Profile presentation labels are available in every supported language", () => {
  for (const locale of ["en", "es", "it", "fr"] as const)
    for (const key of ["homeHeroEmptyTitle", "homeHeroNoCurrentTitle", "homeReadingEmpty", "profileStats", "profileCompleted", "previousBooks", "nextBooks", "profileReviews", "profileReviewsEmpty", "profileFavoritesEmpty", "filterLibrary"] as const)
      expect(extraTranslations[locale][key]?.trim(), `${locale}:${key}`).toBeTruthy();
});

test("book editing labels are translated in every supported language", () => {
  for (const locale of ["en", "es", "it", "fr"] as const)
    for (const key of ["editBook", "editBookTitle", "editBookAuthor", "editBookCover", "editBookChangeCover", "editBookCoverInvalid", "editBookSave"] as const)
      expect(extraTranslations[locale][key]?.trim(), `${locale}:${key}`).toBeTruthy();
});
test("book, byte, active upload and hourly limits have distinct localized messages", () => {
  for (const locale of ["en", "es", "it", "fr"] as const)
    for (const key of ["errorBookLimit", "errorStorageLimit", "errorPendingUploadLimit", "errorUploadRateLimit", "serverPendingUploads", "pendingDataChanges"] as const)
      expect(extraTranslations[locale][key]?.trim(), `${locale}:${key}`).toBeTruthy();
});
test("account security and cloud management are translated in every supported language", () => {
  for (const locale of ["en", "es", "it", "fr"] as const)
    for (const key of ["changeAccountPassword", "currentPassword", "passwordMismatch", "passwordOffline",
      "manageCloudStorage", "cloudStorageUsage", "removeFromCloud", "removeCloudWithoutCopy"] as const)
      expect(extraTranslations[locale][key]?.trim(), `${locale}:${key}`).toBeTruthy();
});
test("plans and device management have all labels in every supported language", () => {
  for (const locale of ["en", "es", "it", "fr"] as const)
    for (const key of ["planSection", "planStorageUsage", "planOverQuota", "viewPlans",
      "plansTitle", "planPerMonth", "planPerYear", "planTranslationVeryLimited",
      "planTtsLimited", "deviceLimitReached", "manageDevices", "deviceRemoveConfirm"] as const)
      expect(extraTranslations[locale][key]?.trim(), `${locale}:${key}`).toBeTruthy();
});
