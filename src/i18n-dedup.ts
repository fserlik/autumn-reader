const en = {
  bookAlreadyInLibrary: "This book is already in your library.",
  importSummary: "{imported} books imported. {duplicates} were already in your library.",
  importSummaryOne: "{imported} book imported. {duplicates} were already in your library.",
} as const;
type Key = keyof typeof en;
export const dedupTranslations: Record<"en" | "es" | "it" | "fr", Record<Key, string>> = {
  en,
  es: { bookAlreadyInLibrary: "Este libro ya está en tu biblioteca.", importSummary: "{imported} libros importados. {duplicates} ya estaban en tu biblioteca.", importSummaryOne: "{imported} libro importado. {duplicates} ya estaban en tu biblioteca." },
  it: { bookAlreadyInLibrary: "Questo libro è già nella tua biblioteca.", importSummary: "{imported} libri importati. {duplicates} erano già nella tua biblioteca.", importSummaryOne: "{imported} libro importato. {duplicates} erano già nella tua biblioteca." },
  fr: { bookAlreadyInLibrary: "Ce livre est déjà dans votre bibliothèque.", importSummary: "{imported} livres importés. {duplicates} étaient déjà dans votre bibliothèque.", importSummaryOne: "{imported} livre importé. {duplicates} étaient déjà dans votre bibliothèque." },
};
export type DedupKey = Key;
