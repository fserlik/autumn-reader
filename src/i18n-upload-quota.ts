const en = {
  errorBookLimit: "Your cloud library has reached its book limit.",
  errorStorageLimit: "Your cloud storage limit has been reached.",
  errorPendingUploadLimit: "Too many uploads are currently pending on the server. Try again shortly.",
  errorUploadRateLimit: "Too many different uploads were started recently. Try again later.",
  serverPendingUploads: "Server: {count} active upload reservations · {usedMb} MB reserved.",
  pendingDataChanges: "{count} queued data changes",
};
export type UploadQuotaKey = keyof typeof en;
export const uploadQuotaTranslations: Record<"en" | "es" | "it" | "fr", Record<UploadQuotaKey, string>> = {
  en,
  es: {
    errorBookLimit: "Tu biblioteca en la nube alcanzó su límite de libros.",
    errorStorageLimit: "Alcanzaste el límite de almacenamiento en la nube.",
    errorPendingUploadLimit: "Hay demasiadas subidas pendientes en el servidor. Vuelve a intentarlo pronto.",
    errorUploadRateLimit: "Se iniciaron demasiadas subidas de libros distintos recientemente. Vuelve a intentarlo más tarde.",
    serverPendingUploads: "Servidor: {count} reservas de subida activas · {usedMb} MB reservados.",
    pendingDataChanges: "{count} cambios de datos en cola",
  },
  it: {
    errorBookLimit: "La tua libreria cloud ha raggiunto il limite di libri.",
    errorStorageLimit: "Hai raggiunto il limite di spazio cloud.",
    errorPendingUploadLimit: "Ci sono troppi caricamenti in attesa sul server. Riprova tra poco.",
    errorUploadRateLimit: "Sono stati avviati troppi caricamenti di libri diversi di recente. Riprova più tardi.",
    serverPendingUploads: "Server: {count} prenotazioni di caricamento attive · {usedMb} MB prenotati.",
    pendingDataChanges: "{count} modifiche ai dati in coda",
  },
  fr: {
    errorBookLimit: "Votre bibliothèque cloud a atteint sa limite de livres.",
    errorStorageLimit: "Vous avez atteint votre limite de stockage cloud.",
    errorPendingUploadLimit: "Trop de transferts sont en attente sur le serveur. Réessayez dans un instant.",
    errorUploadRateLimit: "Trop de transferts de livres différents ont été lancés récemment. Réessayez plus tard.",
    serverPendingUploads: "Serveur : {count} réservations de transfert actives · {usedMb} Mo réservés.",
    pendingDataChanges: "{count} modifications de données en attente",
  },
};
