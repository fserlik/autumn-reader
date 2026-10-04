const en = {
  legacyBooksTitle: "Earlier books on this device",
  legacyBooksHelp: "Some books were saved before local libraries belonged to accounts. They are hidden until you confirm they are yours.",
  legacyBooksClaim: "Add these books to my account",
  legacyBooksConfirm: "Only continue if these books are yours. They will become private to this account on this device; no files will be deleted.",
  legacyBooksClaimed: "Earlier books added to your local library.",
  legacyBooksFailed: "Could not recover the earlier books. They remain safely stored on this device.",
};
export type OwnershipKey = keyof typeof en;
export const ownershipTranslations: Record<"en" | "es" | "it" | "fr", Record<OwnershipKey, string>> = {
  en,
  es: {
    legacyBooksTitle: "Libros anteriores en este dispositivo",
    legacyBooksHelp: "Algunos libros se guardaron antes de que las bibliotecas locales pertenecieran a una cuenta. Permanecen ocultos hasta que confirmes que son tuyos.",
    legacyBooksClaim: "Agregar estos libros a mi cuenta",
    legacyBooksConfirm: "Continúa solo si estos libros son tuyos. Quedarán privados para esta cuenta en este dispositivo; no se borrará ningún archivo.",
    legacyBooksClaimed: "Los libros anteriores se agregaron a tu biblioteca local.",
    legacyBooksFailed: "No se pudieron recuperar los libros anteriores. Siguen guardados en este dispositivo.",
  },
  it: {
    legacyBooksTitle: "Libri precedenti su questo dispositivo",
    legacyBooksHelp: "Alcuni libri sono stati salvati prima che le biblioteche locali appartenessero a un account. Restano nascosti finché non confermi che sono tuoi.",
    legacyBooksClaim: "Aggiungi questi libri al mio account",
    legacyBooksConfirm: "Continua solo se questi libri sono tuoi. Diventeranno privati per questo account sul dispositivo; nessun file verrà eliminato.",
    legacyBooksClaimed: "I libri precedenti sono stati aggiunti alla tua biblioteca locale.",
    legacyBooksFailed: "Impossibile recuperare i libri precedenti. Restano salvati su questo dispositivo.",
  },
  fr: {
    legacyBooksTitle: "Livres antérieurs sur cet appareil",
    legacyBooksHelp: "Certains livres ont été enregistrés avant que les bibliothèques locales soient liées à un compte. Ils restent masqués jusqu'à ce que vous confirmiez qu'ils sont à vous.",
    legacyBooksClaim: "Ajouter ces livres à mon compte",
    legacyBooksConfirm: "Continuez seulement si ces livres sont à vous. Ils deviendront privés pour ce compte sur cet appareil ; aucun fichier ne sera supprimé.",
    legacyBooksClaimed: "Les livres antérieurs ont été ajoutés à votre bibliothèque locale.",
    legacyBooksFailed: "Impossible de récupérer les livres antérieurs. Ils restent enregistrés sur cet appareil.",
  },
};
