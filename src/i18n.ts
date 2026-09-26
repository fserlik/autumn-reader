export type Language = "en" | "es" | "it" | "fr";

const languageKey = "autumn-language";
const storedLanguage = localStorage.getItem(languageKey);
export const language: Language = storedLanguage === "es" || storedLanguage === "it" || storedLanguage === "fr" ? storedLanguage : "en";

export function saveLanguage(value: Language): void {
  localStorage.setItem(languageKey, value);
}

const en = {
  goHome: "Go to home",
  yourSpace: "Your space",
  mainNavigation: "Main navigation",
  home: "Home",
  library: "Library",
  settings: "Settings",
  storiesSeason: "Stories for every season.",
  booksYourPace: "Your books, your pace",
  homeSubtitle: "A place to return to your stories",
  addBooks: "Add books",
  welcome: "Welcome to your reading corner",
  heroTitle: "Every story has<br />its season.",
  heroDescription: "Add your books and read at your own pace. Your stories stay with you.",
  firstBook: "Add my first book",
  continueWhere: "Pick up where you left off",
  recentReads: "Recent reads",
  viewLibrary: "View library",
  yourPicks: "Your picks",
  favorites: "Favorites",
  viewAll: "View all",
  allBooksOnePlace: "All your books in one place",
  savedBooks: "{count} books saved",
  savedBook: "{count} book saved",
  searchTitle: "Search by title",
  searchBooks: "Search books by title",
  yourWay: "Read your way",
  settingsIntro: "Simple settings to make this space more comfortable.",
  appearance: "Appearance",
  appearanceHelp: "Choose the app colors. You can change them any time.",
  appTheme: "App theme",
  light: "Light",
  dark: "Dark",
  defaultTextSize: "Default text size",
  defaultTextSizeHelp: "Applies to adjustable text in books you add from now on. You can change it while reading.",
  defaultTextSizeLabel: "Default text size",
  sizeSmall: "Small · 90%",
  sizeNormal: "Normal · 100%",
  sizeComfortable: "Comfortable · 110%",
  sizeLarge: "Large · 120%",
  sizeVeryLarge: "Very large · 130%",
  language: "Language",
  languageHelp: "Choose the language used by Autumn Reader. Restart the app to apply it.",
  languageLabel: "App language",
  driveBackup: "Google Drive backup",
  driveBackupHelp: "Save a copy whenever you like and import it later. It includes your books, covers, favorites, notes, and reading progress. Only Autumn Reader can access this copy in your Drive.",
  signInGoogle: "Sign in with Google",
  driveConnected: "Connected to Google Drive",
  saveBackup: "Save backup",
  availableBackup: "Available backup",
  connectToFind: "Connect Drive to find backups",
  importBackup: "Import backup",
  driveOptional: "Drive backup is optional. You can keep reading offline.",
  booksYours: "Your books belong to you",
  localStorageHelp: "Autumn Reader stores books, favorites, and progress on this device. You don't need an account or internet access to read.",
  booksInLibrary: "{count} books in your library",
  bookInLibrary: "{count} book in your library",
  back: "Back",
  previousPage: "Previous page",
  nextPage: "Next page",
  zoom: "Zoom",
  decreaseSize: "Decrease size",
  increaseSize: "Increase size",
  noteHint: "Select text and right-click to add a note",
  progressSaved: "Progress saved",
  addNote: "Add note",
  closeNote: "Close note",
  markerColor: "Marker color",
  yourNote: "Your note",
  notePlaceholder: "Write what you want to remember…",
  deleteNote: "Delete note",
  cancel: "Cancel",
  saveNote: "Save note",
  noBackups: "No backups saved yet",
  savedBackup: "Saved backup",
  driveSessionExpired: "Your Drive session has expired. Connect your account again.",
  openingGoogle: "Opening Google in your browser to authorize Autumn Reader…",
  driveReady: "Drive is connected. You can save or import a backup.",
  preparingBackup: "Preparing a library backup…",
  uploadingBackup: "Uploading {size} MB to Drive…",
  backupSavedCount: "Backup saved to Drive with {count} books.",
  backupSavedOne: "Backup saved to Drive with {count} book.",
  backupSaved: "Backup saved to Drive",
  importBackupMessage: "Books in this backup will be added. Books already in your library will be updated; the others will stay as they are.",
  importBooks: "Import books",
  downloadingBackup: "Downloading and checking the backup…",
  importedCount: "Imported {count} books. Your local library is ready.",
  importedOne: "Imported {count} book. Your local library is ready.",
  backupImported: "Backup imported",
  settingsSubtitle: "Make this space your own",
  reader: "Reader",
  enjoyReading: "Enjoy your reading",
  openBook: "Open {title}",
  reading: "Reading",
  notStarted: "Not started",
  removeFavorite: "Remove from favorites",
  addFavorite: "Add to favorites",
  removeFavoriteBook: "Remove {title} from favorites",
  addFavoriteBook: "Add {title} to favorites",
  removeLibrary: "Remove from library",
  removeLibraryBook: "Remove {title} from library",
  recentEmpty: "Books you open will appear here.",
  favoritesEmpty: "Star a book to see it here.",
  continueReading: "Continue reading",
  exploreLibrary: "Explore library",
  lastRead: "Your last read was “{title}”. Pick it up whenever you like.",
  noSearchResults: "No books match your search.",
  libraryEmpty: "Your library is empty. Add a book to get started.",
  addedFavorite: "Added to favorites",
  removedFavorite: "Removed from favorites",
  favoriteSaveFailed: "Couldn't save the favorite",
  removeBook: "Remove book",
  removeBookMessage: "“{title}” will be removed from your library along with its notes and reading progress on this device.",
  bookRemoved: "Book removed from library",
  bookRemoveFailed: "Couldn't remove the book",
  pageOf: "Page {page} of {total}",
  section: "Section {number}",
  book: "Book",
  text: "Text",
  progressSaveFailed: "Couldn't save progress",
  chooseColor: "Choose color {color}",
  noteEmpty: "Write something in your note before saving it",
  noteSaved: "Note saved",
  noteSaveFailed: "Couldn't save the note",
  noteDeleted: "Note deleted",
  noteDeleteFailed: "Couldn't delete the note",
  openNote: "Open note",
  openNoteQuote: "Open note about {quote}",
  viewerFailed: "Couldn't start the book viewer",
  noSelectableText: "This page has no selectable text",
  openingBook: "Opening book…",
  bookOpenFailedHelp: "Couldn't open this book. Check that the file is supported.",
  bookOpenFailed: "Couldn't open the book",
  simpleCover: "This book will use a simple cover",
  filesRejectedOne: "{count} file couldn't be added",
  filesRejectedMany: "{count} files couldn't be added",
  fontSaved: "Default text size saved",
  driveNotConfigured: "Google Drive will be available once it is configured for this version.",
  driveNotConfiguredTitle: "Google Drive connection isn't configured yet",
  libraryOpenFailed: "Couldn't open the local library",
  restartTitle: "Restart Autumn Reader?",
  restartMessage: "Your language choice has been saved. Restart the app to use it.",
  restartNow: "Restart now",
  restartLater: "Later",
  restartLaterStatus: "Language saved. Restart Autumn Reader to apply it.",
  backupTooLargeLibrary: "Your library exceeds the 250 MB backup limit",
  backupTooLarge: "The backup exceeds the 250 MB limit",
  backupInvalidSize: "The backup is too large or empty",
  backupNoManifest: "The backup has no manifest",
  backupIncompatible: "This backup isn't compatible with Autumn Reader",
  backupInvalidBooks: "The backup contains invalid book data",
  backupInvalidNotes: "The backup contains invalid notes",
  backupMissingFile: "The file for “{title}” is missing",
  backupFilesTooLarge: "The backup contains files that are too large",
  backupMissingCover: "The cover for “{title}” is missing",
} as const;

type TranslationKey = keyof typeof en;
type TranslationSet = Record<TranslationKey, string>;

const es: TranslationSet = {
  goHome: "Ir al inicio", yourSpace: "Tu espacio", mainNavigation: "Navegación principal", home: "Inicio", library: "Biblioteca", settings: "Configuración", storiesSeason: "Historias para cada estación.", booksYourPace: "Tus libros, a tu ritmo", homeSubtitle: "Un lugar para volver a tus historias", addBooks: "Agregar libros", welcome: "Bienvenido a tu rincón de lectura", heroTitle: "Cada historia tiene<br />su estación.", heroDescription: "Añade tus libros y empieza a leer a tu ritmo. Tus historias se quedan contigo.", firstBook: "Agregar mi primer libro", continueWhere: "Continúa donde lo dejaste", recentReads: "Lecturas recientes", viewLibrary: "Ver biblioteca", yourPicks: "Tus elegidos", favorites: "Favoritos", viewAll: "Ver todos", allBooksOnePlace: "Todos tus libros en un lugar", savedBooks: "{count} libros guardados", savedBook: "{count} libro guardado", searchTitle: "Buscar por título", searchBooks: "Buscar libros por título", yourWay: "Tu manera de leer", settingsIntro: "Ajustes sencillos para hacer este espacio más cómodo.", appearance: "Apariencia", appearanceHelp: "Elige los colores de la aplicación. Puedes cambiarlos cuando quieras.", appTheme: "Tema de la aplicación", light: "Claro", dark: "Oscuro", defaultTextSize: "Tamaño inicial del texto", defaultTextSizeHelp: "Se aplicará a los libros con texto adaptable que agregues a partir de ahora. Puedes ajustarlo mientras lees.", defaultTextSizeLabel: "Tamaño de texto predeterminado", sizeSmall: "Pequeño · 90%", sizeNormal: "Normal · 100%", sizeComfortable: "Cómodo · 110%", sizeLarge: "Grande · 120%", sizeVeryLarge: "Muy grande · 130%", language: "Idioma", languageHelp: "Elige el idioma de Autumn Reader. Reinicia la aplicación para aplicarlo.", languageLabel: "Idioma de la aplicación", driveBackup: "Copia en Google Drive", driveBackupHelp: "Guarda una copia cuando quieras e impórtala después. Incluye tus libros, cubiertas, favoritos, notas y progreso de lectura. La copia solo está disponible para Autumn Reader dentro de tu Drive.", signInGoogle: "Iniciar sesión con Google", driveConnected: "Conectado a Google Drive", saveBackup: "Guardar copia", availableBackup: "Copia disponible", connectToFind: "Conecta Drive para buscar copias", importBackup: "Importar copia", driveOptional: "La copia de Drive es opcional. La lectura sigue funcionando sin conexión.", booksYours: "Tus libros son tuyos", localStorageHelp: "Autumn Reader guarda libros, favoritos y progreso en este dispositivo. No necesitas una cuenta ni conexión para leer.", booksInLibrary: "{count} libros en tu biblioteca", bookInLibrary: "{count} libro en tu biblioteca", back: "Volver", previousPage: "Página anterior", nextPage: "Página siguiente", zoom: "Zoom", decreaseSize: "Reducir tamaño", increaseSize: "Aumentar tamaño", noteHint: "Selecciona texto y haz clic derecho para agregar una nota", progressSaved: "Progreso guardado", addNote: "Agregar nota", closeNote: "Cerrar nota", markerColor: "Color de la marca", yourNote: "Tu nota", notePlaceholder: "Escribe lo que quieres recordar…", deleteNote: "Eliminar nota", cancel: "Cancelar", saveNote: "Guardar nota", noBackups: "Todavía no hay copias guardadas", savedBackup: "Copia guardada", driveSessionExpired: "La sesión de Drive venció. Vuelve a conectar tu cuenta.", openingGoogle: "Abriendo Google en tu navegador para autorizar Autumn Reader…", driveReady: "Drive conectado. Puedes guardar o importar una copia.", preparingBackup: "Preparando copia de la biblioteca…", uploadingBackup: "Subiendo {size} MB a Drive…", backupSavedCount: "Copia guardada en Drive con {count} libros.", backupSavedOne: "Copia guardada en Drive con {count} libro.", backupSaved: "Copia guardada en Drive", importBackupMessage: "Se añadirán los libros de esta copia. Si alguno ya está en tu biblioteca, se actualizará; los demás permanecerán como están.", importBooks: "Importar libros", downloadingBackup: "Descargando y verificando la copia…", importedCount: "Se importaron {count} libros. Tu biblioteca local está lista.", importedOne: "Se importó {count} libro. Tu biblioteca local está lista.", backupImported: "Copia importada", settingsSubtitle: "Haz de este espacio uno tuyo", reader: "Lector", enjoyReading: "Disfruta tu lectura", openBook: "Abrir {title}", reading: "En lectura", notStarted: "Sin empezar", removeFavorite: "Quitar de favoritos", addFavorite: "Agregar a favoritos", removeFavoriteBook: "Quitar {title} de favoritos", addFavoriteBook: "Agregar {title} a favoritos", removeLibrary: "Quitar de la biblioteca", removeLibraryBook: "Quitar {title} de la biblioteca", recentEmpty: "Aquí aparecerán los libros que abras.", favoritesEmpty: "Marca un libro con la estrella para verlo aquí.", continueReading: "Continuar leyendo", exploreLibrary: "Explorar biblioteca", lastRead: "Tu última lectura fue «{title}». Retómala cuando quieras.", noSearchResults: "No hay libros que coincidan con la búsqueda.", libraryEmpty: "Tu biblioteca está vacía. Agrega un libro para empezar.", addedFavorite: "Agregado a favoritos", removedFavorite: "Quitado de favoritos", favoriteSaveFailed: "No se pudo guardar el favorito", removeBook: "Quitar libro", removeBookMessage: "«{title}» se quitará de tu biblioteca junto con sus notas y progreso de lectura en este dispositivo.", bookRemoved: "Libro quitado de la biblioteca", bookRemoveFailed: "No se pudo quitar el libro", pageOf: "Página {page} de {total}", section: "Sección {number}", book: "Libro", text: "Texto", progressSaveFailed: "No se pudo guardar el progreso", chooseColor: "Elegir color {color}", noteEmpty: "Escribe algo en la nota antes de guardarla", noteSaved: "Nota guardada", noteSaveFailed: "No se pudo guardar la nota", noteDeleted: "Nota eliminada", noteDeleteFailed: "No se pudo eliminar la nota", openNote: "Abrir nota", openNoteQuote: "Abrir nota sobre {quote}", viewerFailed: "No se pudo iniciar el visor de libros", noSelectableText: "Esta página no tiene texto seleccionable", openingBook: "Abriendo libro…", bookOpenFailedHelp: "No se pudo abrir este libro. Comprueba que el archivo sea compatible.", bookOpenFailed: "No se pudo abrir el libro", simpleCover: "Este libro se mostrará con una cubierta sencilla", filesRejectedOne: "{count} archivo no se pudo agregar", filesRejectedMany: "{count} archivos no se pudieron agregar", fontSaved: "Tamaño predeterminado guardado", driveNotConfigured: "La conexión con Google Drive estará disponible cuando se configure para esta versión.", driveNotConfiguredTitle: "Conexión con Google Drive pendiente de configurar", libraryOpenFailed: "No se pudo abrir la biblioteca local", restartTitle: "¿Reiniciar Autumn Reader?", restartMessage: "Se guardó el idioma elegido. Reinicia la aplicación para usarlo.", restartNow: "Reiniciar ahora", restartLater: "Más tarde", restartLaterStatus: "Idioma guardado. Reinicia Autumn Reader para aplicarlo.", backupTooLargeLibrary: "La biblioteca supera el límite de copia de 250 MB", backupTooLarge: "La copia supera el límite de 250 MB", backupInvalidSize: "El archivo de copia es demasiado grande o está vacío", backupNoManifest: "La copia no contiene un manifiesto", backupIncompatible: "Esta copia no es compatible con Autumn Reader", backupInvalidBooks: "La copia contiene datos de libros inválidos", backupInvalidNotes: "La copia contiene notas inválidas", backupMissingFile: "Falta el archivo de «{title}»", backupFilesTooLarge: "La copia contiene archivos demasiado grandes", backupMissingCover: "Falta la cubierta de «{title}»",
};

const it: TranslationSet = {
  goHome: "Vai alla pagina iniziale", yourSpace: "Il tuo spazio", mainNavigation: "Navigazione principale", home: "Home", library: "Biblioteca", settings: "Impostazioni", storiesSeason: "Storie per ogni stagione.", booksYourPace: "I tuoi libri, al tuo ritmo", homeSubtitle: "Un luogo in cui ritrovare le tue storie", addBooks: "Aggiungi libri", welcome: "Benvenuto nel tuo angolo di lettura", heroTitle: "Ogni storia ha<br />la sua stagione.", heroDescription: "Aggiungi i tuoi libri e leggi al tuo ritmo. Le tue storie restano con te.", firstBook: "Aggiungi il mio primo libro", continueWhere: "Riprendi da dove eri rimasto", recentReads: "Letture recenti", viewLibrary: "Vai alla biblioteca", yourPicks: "Le tue scelte", favorites: "Preferiti", viewAll: "Vedi tutti", allBooksOnePlace: "Tutti i tuoi libri in un unico posto", savedBooks: "{count} libri salvati", savedBook: "{count} libro salvato", searchTitle: "Cerca per titolo", searchBooks: "Cerca libri per titolo", yourWay: "Leggi a modo tuo", settingsIntro: "Impostazioni semplici per rendere questo spazio più confortevole.", appearance: "Aspetto", appearanceHelp: "Scegli i colori dell'app. Puoi cambiarli quando vuoi.", appTheme: "Tema dell'app", light: "Chiaro", dark: "Scuro", defaultTextSize: "Dimensione iniziale del testo", defaultTextSizeHelp: "Si applica al testo regolabile dei libri che aggiungi da ora. Puoi modificarla durante la lettura.", defaultTextSizeLabel: "Dimensione predefinita del testo", sizeSmall: "Piccolo · 90%", sizeNormal: "Normale · 100%", sizeComfortable: "Comodo · 110%", sizeLarge: "Grande · 120%", sizeVeryLarge: "Molto grande · 130%", language: "Lingua", languageHelp: "Scegli la lingua di Autumn Reader. Riavvia l'app per applicarla.", languageLabel: "Lingua dell'app", driveBackup: "Backup su Google Drive", driveBackupHelp: "Salva una copia quando vuoi e importala in seguito. Include libri, copertine, preferiti, note e avanzamento di lettura. Solo Autumn Reader può accedere a questa copia nel tuo Drive.", signInGoogle: "Accedi con Google", driveConnected: "Connesso a Google Drive", saveBackup: "Salva backup", availableBackup: "Backup disponibile", connectToFind: "Connetti Drive per cercare i backup", importBackup: "Importa backup", driveOptional: "Il backup su Drive è facoltativo. Puoi continuare a leggere offline.", booksYours: "I tuoi libri sono tuoi", localStorageHelp: "Autumn Reader salva libri, preferiti e progressi su questo dispositivo. Non serve un account né una connessione per leggere.", booksInLibrary: "{count} libri nella tua biblioteca", bookInLibrary: "{count} libro nella tua biblioteca", back: "Indietro", previousPage: "Pagina precedente", nextPage: "Pagina successiva", zoom: "Zoom", decreaseSize: "Riduci dimensione", increaseSize: "Aumenta dimensione", noteHint: "Seleziona il testo e fai clic destro per aggiungere una nota", progressSaved: "Avanzamento salvato", addNote: "Aggiungi nota", closeNote: "Chiudi nota", markerColor: "Colore del segnalibro", yourNote: "La tua nota", notePlaceholder: "Scrivi ciò che vuoi ricordare…", deleteNote: "Elimina nota", cancel: "Annulla", saveNote: "Salva nota", noBackups: "Nessun backup salvato", savedBackup: "Backup salvato", driveSessionExpired: "La sessione Drive è scaduta. Riconnetti il tuo account.", openingGoogle: "Apertura di Google nel browser per autorizzare Autumn Reader…", driveReady: "Drive è connesso. Puoi salvare o importare un backup.", preparingBackup: "Preparazione del backup della biblioteca…", uploadingBackup: "Caricamento di {size} MB su Drive…", backupSavedCount: "Backup salvato su Drive con {count} libri.", backupSavedOne: "Backup salvato su Drive con {count} libro.", backupSaved: "Backup salvato su Drive", importBackupMessage: "I libri di questo backup verranno aggiunti. Quelli già presenti saranno aggiornati; gli altri resteranno invariati.", importBooks: "Importa libri", downloadingBackup: "Download e verifica del backup…", importedCount: "Importati {count} libri. La tua biblioteca locale è pronta.", importedOne: "Importato {count} libro. La tua biblioteca locale è pronta.", backupImported: "Backup importato", settingsSubtitle: "Rendi questo spazio tuo", reader: "Lettore", enjoyReading: "Buona lettura", openBook: "Apri {title}", reading: "In lettura", notStarted: "Da iniziare", removeFavorite: "Rimuovi dai preferiti", addFavorite: "Aggiungi ai preferiti", removeFavoriteBook: "Rimuovi {title} dai preferiti", addFavoriteBook: "Aggiungi {title} ai preferiti", removeLibrary: "Rimuovi dalla biblioteca", removeLibraryBook: "Rimuovi {title} dalla biblioteca", recentEmpty: "Qui appariranno i libri che apri.", favoritesEmpty: "Seleziona la stella di un libro per vederlo qui.", continueReading: "Continua a leggere", exploreLibrary: "Esplora la biblioteca", lastRead: "L'ultima lettura è stata «{title}». Riprendila quando vuoi.", noSearchResults: "Nessun libro corrisponde alla ricerca.", libraryEmpty: "La tua biblioteca è vuota. Aggiungi un libro per iniziare.", addedFavorite: "Aggiunto ai preferiti", removedFavorite: "Rimosso dai preferiti", favoriteSaveFailed: "Impossibile salvare il preferito", removeBook: "Rimuovi libro", removeBookMessage: "«{title}» verrà rimosso dalla biblioteca insieme alle note e all'avanzamento su questo dispositivo.", bookRemoved: "Libro rimosso dalla biblioteca", bookRemoveFailed: "Impossibile rimuovere il libro", pageOf: "Pagina {page} di {total}", section: "Sezione {number}", book: "Libro", text: "Testo", progressSaveFailed: "Impossibile salvare l'avanzamento", chooseColor: "Scegli colore {color}", noteEmpty: "Scrivi qualcosa nella nota prima di salvarla", noteSaved: "Nota salvata", noteSaveFailed: "Impossibile salvare la nota", noteDeleted: "Nota eliminata", noteDeleteFailed: "Impossibile eliminare la nota", openNote: "Apri nota", openNoteQuote: "Apri nota su {quote}", viewerFailed: "Impossibile avviare il lettore", noSelectableText: "Questa pagina non contiene testo selezionabile", openingBook: "Apertura del libro…", bookOpenFailedHelp: "Impossibile aprire il libro. Verifica che il file sia supportato.", bookOpenFailed: "Impossibile aprire il libro", simpleCover: "Questo libro userà una copertina semplice", filesRejectedOne: "Impossibile aggiungere {count} file", filesRejectedMany: "Impossibile aggiungere {count} file", fontSaved: "Dimensione predefinita del testo salvata", driveNotConfigured: "Google Drive sarà disponibile dopo la configurazione di questa versione.", driveNotConfiguredTitle: "Connessione a Google Drive non ancora configurata", libraryOpenFailed: "Impossibile aprire la biblioteca locale", restartTitle: "Riavviare Autumn Reader?", restartMessage: "La lingua scelta è stata salvata. Riavvia l'app per usarla.", restartNow: "Riavvia ora", restartLater: "Più tardi", restartLaterStatus: "Lingua salvata. Riavvia Autumn Reader per applicarla.", backupTooLargeLibrary: "La biblioteca supera il limite di backup di 250 MB", backupTooLarge: "Il backup supera il limite di 250 MB", backupInvalidSize: "Il backup è troppo grande o vuoto", backupNoManifest: "Il backup non contiene un manifesto", backupIncompatible: "Questo backup non è compatibile con Autumn Reader", backupInvalidBooks: "Il backup contiene dati dei libri non validi", backupInvalidNotes: "Il backup contiene note non valide", backupMissingFile: "Manca il file di «{title}»", backupFilesTooLarge: "Il backup contiene file troppo grandi", backupMissingCover: "Manca la copertina di «{title}»",
};

const fr: TranslationSet = {
  goHome: "Aller à l'accueil", yourSpace: "Votre espace", mainNavigation: "Navigation principale", home: "Accueil", library: "Bibliothèque", settings: "Paramètres", storiesSeason: "Des histoires pour chaque saison.", booksYourPace: "Vos livres, à votre rythme", homeSubtitle: "Un endroit où retrouver vos histoires", addBooks: "Ajouter des livres", welcome: "Bienvenue dans votre coin lecture", heroTitle: "Chaque histoire a<br />sa saison.", heroDescription: "Ajoutez vos livres et lisez à votre rythme. Vos histoires restent avec vous.", firstBook: "Ajouter mon premier livre", continueWhere: "Reprenez là où vous en étiez", recentReads: "Lectures récentes", viewLibrary: "Voir la bibliothèque", yourPicks: "Vos choix", favorites: "Favoris", viewAll: "Voir tout", allBooksOnePlace: "Tous vos livres au même endroit", savedBooks: "{count} livres enregistrés", savedBook: "{count} livre enregistré", searchTitle: "Rechercher par titre", searchBooks: "Rechercher des livres par titre", yourWay: "Lisez à votre façon", settingsIntro: "Des réglages simples pour rendre cet espace plus agréable.", appearance: "Apparence", appearanceHelp: "Choisissez les couleurs de l'application. Vous pouvez les changer à tout moment.", appTheme: "Thème de l'application", light: "Clair", dark: "Sombre", defaultTextSize: "Taille initiale du texte", defaultTextSizeHelp: "S'applique au texte réglable des livres ajoutés à partir de maintenant. Vous pouvez la modifier pendant la lecture.", defaultTextSizeLabel: "Taille du texte par défaut", sizeSmall: "Petit · 90 %", sizeNormal: "Normal · 100 %", sizeComfortable: "Confortable · 110 %", sizeLarge: "Grand · 120 %", sizeVeryLarge: "Très grand · 130 %", language: "Langue", languageHelp: "Choisissez la langue d'Autumn Reader. Redémarrez l'application pour l'appliquer.", languageLabel: "Langue de l'application", driveBackup: "Sauvegarde Google Drive", driveBackupHelp: "Enregistrez une copie quand vous le souhaitez et importez-la plus tard. Elle contient vos livres, couvertures, favoris, notes et progression. Seul Autumn Reader peut accéder à cette copie dans votre Drive.", signInGoogle: "Se connecter avec Google", driveConnected: "Connecté à Google Drive", saveBackup: "Enregistrer une copie", availableBackup: "Copie disponible", connectToFind: "Connectez Drive pour chercher des copies", importBackup: "Importer une copie", driveOptional: "La sauvegarde Drive est facultative. Vous pouvez continuer à lire hors ligne.", booksYours: "Vos livres vous appartiennent", localStorageHelp: "Autumn Reader conserve les livres, favoris et progrès sur cet appareil. Aucun compte ni connexion n'est nécessaire pour lire.", booksInLibrary: "{count} livres dans votre bibliothèque", bookInLibrary: "{count} livre dans votre bibliothèque", back: "Retour", previousPage: "Page précédente", nextPage: "Page suivante", zoom: "Zoom", decreaseSize: "Réduire la taille", increaseSize: "Augmenter la taille", noteHint: "Sélectionnez du texte et faites un clic droit pour ajouter une note", progressSaved: "Progression enregistrée", addNote: "Ajouter une note", closeNote: "Fermer la note", markerColor: "Couleur du repère", yourNote: "Votre note", notePlaceholder: "Écrivez ce que vous souhaitez retenir…", deleteNote: "Supprimer la note", cancel: "Annuler", saveNote: "Enregistrer la note", noBackups: "Aucune copie enregistrée", savedBackup: "Copie enregistrée", driveSessionExpired: "Votre session Drive a expiré. Reconnectez votre compte.", openingGoogle: "Ouverture de Google dans votre navigateur pour autoriser Autumn Reader…", driveReady: "Drive est connecté. Vous pouvez enregistrer ou importer une copie.", preparingBackup: "Préparation de la sauvegarde de la bibliothèque…", uploadingBackup: "Envoi de {size} Mo vers Drive…", backupSavedCount: "Copie enregistrée sur Drive avec {count} livres.", backupSavedOne: "Copie enregistrée sur Drive avec {count} livre.", backupSaved: "Copie enregistrée sur Drive", importBackupMessage: "Les livres de cette copie seront ajoutés. Ceux déjà présents seront mis à jour ; les autres resteront inchangés.", importBooks: "Importer les livres", downloadingBackup: "Téléchargement et vérification de la copie…", importedCount: "{count} livres importés. Votre bibliothèque locale est prête.", importedOne: "{count} livre importé. Votre bibliothèque locale est prête.", backupImported: "Copie importée", settingsSubtitle: "Faites de cet espace le vôtre", reader: "Lecteur", enjoyReading: "Bonne lecture", openBook: "Ouvrir {title}", reading: "En cours", notStarted: "Pas commencé", removeFavorite: "Retirer des favoris", addFavorite: "Ajouter aux favoris", removeFavoriteBook: "Retirer {title} des favoris", addFavoriteBook: "Ajouter {title} aux favoris", removeLibrary: "Retirer de la bibliothèque", removeLibraryBook: "Retirer {title} de la bibliothèque", recentEmpty: "Les livres ouverts apparaîtront ici.", favoritesEmpty: "Marquez un livre d'une étoile pour le voir ici.", continueReading: "Continuer la lecture", exploreLibrary: "Explorer la bibliothèque", lastRead: "Votre dernière lecture était « {title} ». Reprenez-la quand vous voulez.", noSearchResults: "Aucun livre ne correspond à votre recherche.", libraryEmpty: "Votre bibliothèque est vide. Ajoutez un livre pour commencer.", addedFavorite: "Ajouté aux favoris", removedFavorite: "Retiré des favoris", favoriteSaveFailed: "Impossible d'enregistrer le favori", removeBook: "Retirer le livre", removeBookMessage: "« {title} » sera retiré de votre bibliothèque, avec ses notes et votre progression sur cet appareil.", bookRemoved: "Livre retiré de la bibliothèque", bookRemoveFailed: "Impossible de retirer le livre", pageOf: "Page {page} sur {total}", section: "Section {number}", book: "Livre", text: "Texte", progressSaveFailed: "Impossible d'enregistrer la progression", chooseColor: "Choisir la couleur {color}", noteEmpty: "Écrivez quelque chose dans la note avant de l'enregistrer", noteSaved: "Note enregistrée", noteSaveFailed: "Impossible d'enregistrer la note", noteDeleted: "Note supprimée", noteDeleteFailed: "Impossible de supprimer la note", openNote: "Ouvrir la note", openNoteQuote: "Ouvrir la note sur {quote}", viewerFailed: "Impossible de démarrer le lecteur", noSelectableText: "Cette page n'a pas de texte sélectionnable", openingBook: "Ouverture du livre…", bookOpenFailedHelp: "Impossible d'ouvrir ce livre. Vérifiez que le fichier est pris en charge.", bookOpenFailed: "Impossible d'ouvrir le livre", simpleCover: "Ce livre utilisera une couverture simple", filesRejectedOne: "Impossible d'ajouter {count} fichier", filesRejectedMany: "Impossible d'ajouter {count} fichiers", fontSaved: "Taille du texte par défaut enregistrée", driveNotConfigured: "Google Drive sera disponible après sa configuration pour cette version.", driveNotConfiguredTitle: "Connexion Google Drive pas encore configurée", libraryOpenFailed: "Impossible d'ouvrir la bibliothèque locale", restartTitle: "Redémarrer Autumn Reader ?", restartMessage: "Votre choix de langue a été enregistré. Redémarrez l'application pour l'utiliser.", restartNow: "Redémarrer maintenant", restartLater: "Plus tard", restartLaterStatus: "Langue enregistrée. Redémarrez Autumn Reader pour l'appliquer.", backupTooLargeLibrary: "Votre bibliothèque dépasse la limite de sauvegarde de 250 Mo", backupTooLarge: "La copie dépasse la limite de 250 Mo", backupInvalidSize: "La copie est trop grande ou vide", backupNoManifest: "La copie ne contient pas de manifeste", backupIncompatible: "Cette copie n'est pas compatible avec Autumn Reader", backupInvalidBooks: "La copie contient des données de livres invalides", backupInvalidNotes: "La copie contient des notes invalides", backupMissingFile: "Le fichier de « {title} » est manquant", backupFilesTooLarge: "La copie contient des fichiers trop volumineux", backupMissingCover: "La couverture de « {title} » est manquante",
};

const translations: Record<Language, TranslationSet> = { en, es, it, fr };

export function t(key: TranslationKey, values: Record<string, string | number> = {}): string {
  return translations[language][key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name]));
}

export function countText(count: number, one: TranslationKey, many: TranslationKey): string {
  return t(count === 1 ? one : many, { count });
}

const driveErrorMessages: Record<Language, Record<string, string>> = {
  en: {
    invalid_oauth_response: "Google sent an invalid response", state_mismatch: "Google's response did not match this request", not_authorized: "Google did not authorize the connection", timeout: "The Google sign-in timed out", invalid_client_id: "A Google desktop OAuth Client ID is required", missing_oauth_config: "Google OAuth is not configured for this version", browser_failed: "Couldn't open the browser", google_rejected: "Google rejected the connection", session_expired: "Your Drive session has expired. Connect your account again.", list_failed: "Drive couldn't list your backups", invalid_backup_format: "The backup has an invalid format", backup_size_limit: "The backup must be smaller than 250 MB", invalid_backup_data: "The backup contains invalid data", upload_start_failed: "Drive couldn't start the backup", upload_location_missing: "Drive did not return an upload address", upload_location_invalid: "Drive returned an unexpected upload address", upload_failed: "Drive couldn't save the backup", invalid_backup_id: "Invalid backup ID", download_failed: "Drive couldn't download the backup",
  },
  es: {
    invalid_oauth_response: "Google envió una respuesta OAuth inválida", state_mismatch: "La respuesta de Google no coincide con esta solicitud", not_authorized: "Google no autorizó la conexión", timeout: "Se agotó el tiempo para conectar con Google", invalid_client_id: "Se necesita un Client ID de Google OAuth para escritorio", missing_oauth_config: "Google OAuth no está configurado para esta versión", browser_failed: "No se pudo abrir el navegador", google_rejected: "Google rechazó la conexión", session_expired: "La sesión de Drive venció. Vuelve a conectar tu cuenta.", list_failed: "Drive no pudo listar las copias", invalid_backup_format: "La copia tiene un formato inválido", backup_size_limit: "La copia debe ocupar menos de 250 MB", invalid_backup_data: "La copia contiene datos inválidos", upload_start_failed: "Drive no pudo iniciar la copia", upload_location_missing: "Drive no devolvió una dirección de subida", upload_location_invalid: "Drive devolvió una dirección de subida inesperada", upload_failed: "Drive no pudo guardar la copia", invalid_backup_id: "Identificador de copia inválido", download_failed: "Drive no pudo descargar la copia",
  },
  it: {
    invalid_oauth_response: "Google ha inviato una risposta non valida", state_mismatch: "La risposta di Google non corrisponde alla richiesta", not_authorized: "Google non ha autorizzato la connessione", timeout: "Tempo scaduto per l'accesso a Google", invalid_client_id: "È necessario un Client ID Google OAuth per desktop", missing_oauth_config: "Google OAuth non è configurato per questa versione", browser_failed: "Impossibile aprire il browser", google_rejected: "Google ha rifiutato la connessione", session_expired: "La sessione Drive è scaduta. Riconnetti il tuo account.", list_failed: "Drive non ha potuto elencare i backup", invalid_backup_format: "Il backup ha un formato non valido", backup_size_limit: "Il backup deve essere inferiore a 250 MB", invalid_backup_data: "Il backup contiene dati non validi", upload_start_failed: "Drive non ha potuto avviare il backup", upload_location_missing: "Drive non ha restituito un indirizzo di caricamento", upload_location_invalid: "Drive ha restituito un indirizzo di caricamento inatteso", upload_failed: "Drive non ha potuto salvare il backup", invalid_backup_id: "ID backup non valido", download_failed: "Drive non ha potuto scaricare il backup",
  },
  fr: {
    invalid_oauth_response: "Google a envoyé une réponse invalide", state_mismatch: "La réponse de Google ne correspond pas à cette demande", not_authorized: "Google n'a pas autorisé la connexion", timeout: "La connexion à Google a expiré", invalid_client_id: "Un identifiant client Google OAuth pour ordinateur est nécessaire", missing_oauth_config: "Google OAuth n'est pas configuré pour cette version", browser_failed: "Impossible d'ouvrir le navigateur", google_rejected: "Google a refusé la connexion", session_expired: "Votre session Drive a expiré. Reconnectez votre compte.", list_failed: "Drive n'a pas pu lister les copies", invalid_backup_format: "Le format de la copie est invalide", backup_size_limit: "La copie doit faire moins de 250 Mo", invalid_backup_data: "La copie contient des données invalides", upload_start_failed: "Drive n'a pas pu commencer la sauvegarde", upload_location_missing: "Drive n'a pas fourni d'adresse d'envoi", upload_location_invalid: "Drive a fourni une adresse d'envoi inattendue", upload_failed: "Drive n'a pas pu enregistrer la copie", invalid_backup_id: "Identifiant de copie invalide", download_failed: "Drive n'a pas pu télécharger la copie",
  },
};

export function localizeDriveError(raw: string): string {
  if (!raw.startsWith("DRIVE_ERROR:")) return raw;
  const [, code, ...rest] = raw.split(":");
  const messages = driveErrorMessages[language];
  const message = messages[code];
  if (!message) return raw;
  const details = rest.join(":").trim();
  return details ? `${message}: ${details}` : message;
}
