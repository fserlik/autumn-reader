const en = {
  aiSpeechPreview: "Hear voice sample", aiSpeechPreviewHint: "A new sample uses a few seconds of your allowance; saved samples do not.",
  aiSpeechName: "Premium AI Speech", aiSpeechEngine: "Voice engine", aiSpeechLocal: "Device voice", aiSpeechPremium: "Premium AI Speech",
  aiSpeechSubscriberOnly: "Available with Autumn+ or Autumn Pro.", aiSpeechNeedsCloudBook: "Sync this book to the cloud before using Premium AI Speech.",
  aiSpeechVoices: "Available voices", aiSpeechLanguage: "Language", aiSpeechGenerating: "Generating audioâ€¦", aiSpeechCached: "Playing saved audio",
  aiSpeechQuotaMonthly: "Monthly allowance", aiSpeechMinutesAvailable: "{minutes} minutes per month", aiSpeechUsed: "Used", aiSpeechRemaining: "Remaining",
  aiSpeechReset: "Resets {date}", aiSpeechQuotaExhausted: "Your monthly AI speech allowance is used up.", aiSpeechGenerationError: "Audio could not be generated.",
  aiSpeechRetry: "Try again", aiSpeechUseLocal: "Switch to device voice", aiSpeechCachedHelp: "Listening to saved audio does not use additional minutes.",
  aiSpeechServiceReady: "Service available", aiSpeechServicePaused: "New generations are temporarily paused.", aiSpeechOfflineFallback: "Premium speech needs a connection. Device voice remains available offline.",
  aiSpeechBudgetReached: "New generations are paused because the service budget was reached.", aiSpeechRateLimited: "Too many generations are in progress. Try again shortly.",
};
type Key = keyof typeof en;
const es: Record<Key,string> = {
  aiSpeechPreview: "Escuchar muestra", aiSpeechPreviewHint: "Una muestra nueva usa unos segundos de tu cuota; las guardadas no consumen.",
  aiSpeechName: "Voz IA premium", aiSpeechEngine: "Motor de voz", aiSpeechLocal: "Voz del dispositivo", aiSpeechPremium: "Voz IA premium",
  aiSpeechSubscriberOnly: "Disponible con Autumn+ o Autumn Pro.", aiSpeechNeedsCloudBook: "Sincronizá este libro con la nube antes de usar Voz IA premium.",
  aiSpeechVoices: "Voces disponibles", aiSpeechLanguage: "Idioma", aiSpeechGenerating: "Generando audioâ€¦", aiSpeechCached: "Reproduciendo audio guardado",
  aiSpeechQuotaMonthly: "Cuota mensual", aiSpeechMinutesAvailable: "{minutes} minutos al mes", aiSpeechUsed: "Utilizados", aiSpeechRemaining: "Restantes",
  aiSpeechReset: "Se reinicia el {date}", aiSpeechQuotaExhausted: "Agotaste la cuota mensual de voz IA.", aiSpeechGenerationError: "No se pudo generar el audio.",
  aiSpeechRetry: "Reintentar", aiSpeechUseLocal: "Cambiar a voz local", aiSpeechCachedHelp: "Escuchar audio ya generado no consume minutos adicionales.",
  aiSpeechServiceReady: "Servicio disponible", aiSpeechServicePaused: "Las nuevas generaciones están pausadas temporalmente.", aiSpeechOfflineFallback: "La voz premium necesita conexión. La voz del dispositivo sigue disponible sin conexión.",
  aiSpeechBudgetReached: "Las nuevas generaciones están pausadas porque se alcanzó el presupuesto del servicio.", aiSpeechRateLimited: "Hay demasiadas generaciones en curso. Intentá de nuevo en unos instantes.",
};
const it: Record<Key,string> = {
  aiSpeechPreview: "Ascolta un campione", aiSpeechPreviewHint: "Un nuovo campione usa alcuni secondi della quota; quelli salvati non consumano.",
  aiSpeechName: "Voce IA Premium", aiSpeechEngine: "Motore vocale", aiSpeechLocal: "Voce del dispositivo", aiSpeechPremium: "Voce IA Premium",
  aiSpeechSubscriberOnly: "Disponibile con Autumn+ o Autumn Pro.", aiSpeechNeedsCloudBook: "Sincronizza questo libro nel cloud prima di usare Voce IA Premium.",
  aiSpeechVoices: "Voci disponibili", aiSpeechLanguage: "Lingua", aiSpeechGenerating: "Generazione audioâ€¦", aiSpeechCached: "Riproduzione dell'audio salvato",
  aiSpeechQuotaMonthly: "Quota mensile", aiSpeechMinutesAvailable: "{minutes} minuti al mese", aiSpeechUsed: "Utilizzati", aiSpeechRemaining: "Rimanenti",
  aiSpeechReset: "Si rinnova il {date}", aiSpeechQuotaExhausted: "Hai esaurito la quota mensile per la voce IA.", aiSpeechGenerationError: "Impossibile generare l'audio.",
  aiSpeechRetry: "Riprova", aiSpeechUseLocal: "Passa alla voce del dispositivo", aiSpeechCachedHelp: "L'ascolto di audio già generato non consuma altri minuti.",
  aiSpeechServiceReady: "Servizio disponibile", aiSpeechServicePaused: "Le nuove generazioni sono temporaneamente sospese.", aiSpeechOfflineFallback: "La voce Premium richiede una connessione. La voce del dispositivo resta disponibile offline.",
  aiSpeechBudgetReached: "Le nuove generazioni sono sospese perché è stato raggiunto il budget del servizio.", aiSpeechRateLimited: "Sono già in corso troppe generazioni. Riprova tra poco.",
};
const fr: Record<Key,string> = {
  aiSpeechPreview: "Écouter un extrait", aiSpeechPreviewHint: "Un nouvel extrait utilise quelques secondes du quota ; les extraits enregistrés ne consomment rien.",
  aiSpeechName: "Voix IA Premium", aiSpeechEngine: "Moteur vocal", aiSpeechLocal: "Voix de l'appareil", aiSpeechPremium: "Voix IA Premium",
  aiSpeechSubscriberOnly: "Disponible avec Autumn+ ou Autumn Pro.", aiSpeechNeedsCloudBook: "Synchronisez ce livre dans le cloud avant d'utiliser Voix IA Premium.",
  aiSpeechVoices: "Voix disponibles", aiSpeechLanguage: "Langue", aiSpeechGenerating: "Génération de l'audioâ€¦", aiSpeechCached: "Lecture de l'audio enregistré",
  aiSpeechQuotaMonthly: "Quota mensuel", aiSpeechMinutesAvailable: "{minutes} minutes par mois", aiSpeechUsed: "Utilisées", aiSpeechRemaining: "Restantes",
  aiSpeechReset: "Renouvellement le {date}", aiSpeechQuotaExhausted: "Votre quota mensuel de voix IA est épuisé.", aiSpeechGenerationError: "Impossible de générer l'audio.",
  aiSpeechRetry: "Réessayer", aiSpeechUseLocal: "Passer à la voix de l'appareil", aiSpeechCachedHelp: "L'écoute d'un audio déjà généré ne consomme pas de minutes supplémentaires.",
  aiSpeechServiceReady: "Service disponible", aiSpeechServicePaused: "Les nouvelles générations sont temporairement suspendues.", aiSpeechOfflineFallback: "La voix Premium nécessite une connexion. La voix de l'appareil reste disponible hors ligne.",
  aiSpeechBudgetReached: "Les nouvelles générations sont suspendues car le budget du service est atteint.", aiSpeechRateLimited: "Trop de générations sont en cours. Réessayez dans un instant.",
};
export type AiSpeechKey = Key;
export const aiSpeechTranslations: Record<"en"|"es"|"it"|"fr",Record<Key,string>> = { en, es, it, fr };
