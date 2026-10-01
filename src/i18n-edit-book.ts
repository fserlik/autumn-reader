const en = {
  editBook: "Edit book", editBookTitle: "Title", editBookAuthor: "Author", editBookCover: "Cover",
  editBookChangeCover: "Change cover", editBookCoverHelp: "JPG, PNG or WebP, up to 10 MB. Optimized before saving.",
  editBookCoverInvalid: "Choose a valid JPG, PNG or WebP image.", editBookCoverTooLarge: "The image must be smaller than 10 MB.",
  editBookCoverUploadFailed: "Could not sync the cover. Your local change is safe and will retry.",
  editBookCoverDownloadFailed: "Could not download this private cover.",
  editBookTitleRequired: "Enter a title.", editBookSaved: "Book details saved.", editBookSaveFailed: "Could not save the book details.",
  editBookPreparing: "Preparing cover…", editBookSave: "Save changes",
  animationReducedBySystem: "Reduced by system",
} as const;
export type EditBookKey = keyof typeof en;
export const editBookTranslations: Record<"en" | "es" | "it" | "fr", Record<EditBookKey, string>> = {
  en,
  es: {
    editBook: "Editar libro", editBookTitle: "Título", editBookAuthor: "Autor", editBookCover: "Portada",
    editBookChangeCover: "Cambiar portada", editBookCoverHelp: "JPG, PNG o WebP, hasta 10 MB. Se optimiza antes de guardar.",
    editBookCoverInvalid: "Selecciona una imagen JPG, PNG o WebP válida.", editBookCoverTooLarge: "La imagen debe pesar menos de 10 MB.",
    editBookCoverUploadFailed: "No se pudo sincronizar la portada. El cambio local se conserva y se reintentará.",
    editBookCoverDownloadFailed: "No se pudo descargar esta portada privada.",
    editBookTitleRequired: "Escribe un título.", editBookSaved: "Datos del libro guardados.", editBookSaveFailed: "No se pudieron guardar los datos del libro.",
    editBookPreparing: "Preparando portada…", editBookSave: "Guardar cambios",
    animationReducedBySystem: "Reducida por el sistema",
  },
  it: {
    editBook: "Modifica libro", editBookTitle: "Titolo", editBookAuthor: "Autore", editBookCover: "Copertina",
    editBookChangeCover: "Cambia copertina", editBookCoverHelp: "JPG, PNG o WebP, fino a 10 MB. Ottimizzata prima del salvataggio.",
    editBookCoverInvalid: "Scegli un'immagine JPG, PNG o WebP valida.", editBookCoverTooLarge: "L'immagine deve essere inferiore a 10 MB.",
    editBookCoverUploadFailed: "Impossibile sincronizzare la copertina. La modifica locale resta salvata e verrà riprovata.",
    editBookCoverDownloadFailed: "Impossibile scaricare questa copertina privata.",
    editBookTitleRequired: "Inserisci un titolo.", editBookSaved: "Dettagli del libro salvati.", editBookSaveFailed: "Impossibile salvare i dettagli del libro.",
    editBookPreparing: "Preparazione della copertina…", editBookSave: "Salva modifiche",
    animationReducedBySystem: "Ridotta dal sistema",
  },
  fr: {
    editBook: "Modifier le livre", editBookTitle: "Titre", editBookAuthor: "Auteur", editBookCover: "Couverture",
    editBookChangeCover: "Changer la couverture", editBookCoverHelp: "JPG, PNG ou WebP, 10 Mo maximum. Optimisée avant l'enregistrement.",
    editBookCoverInvalid: "Choisissez une image JPG, PNG ou WebP valide.", editBookCoverTooLarge: "L'image doit peser moins de 10 Mo.",
    editBookCoverUploadFailed: "Impossible de synchroniser la couverture. La modification locale est conservée et sera réessayée.",
    editBookCoverDownloadFailed: "Impossible de télécharger cette couverture privée.",
    editBookTitleRequired: "Saisissez un titre.", editBookSaved: "Détails du livre enregistrés.", editBookSaveFailed: "Impossible d'enregistrer les détails du livre.",
    editBookPreparing: "Préparation de la couverture…", editBookSave: "Enregistrer les modifications",
    animationReducedBySystem: "Réduite par le système",
  },
};
