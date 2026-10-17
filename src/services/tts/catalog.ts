import data from "./catalog-data.json";
import type { CatalogPackage, CatalogVoice, TtsEngineId } from "./types";

type CatalogData = { schemaVersion: number; runtimeVersion: string; packages: CatalogPackage[]; voices: CatalogVoice[] };
const catalog = data as CatalogData;

export const ttsRuntimeVersion = catalog.runtimeVersion;
export const ttsPackages = Object.freeze(catalog.packages);
/** Legacy metadata used only to recognize packages already present on disk. */
export const knownVoices = Object.freeze(catalog.voices);

export function packageForVoice(voice: CatalogVoice): CatalogPackage {
  const entry = ttsPackages.find(item => item.id === voice.packageId);
  if (!entry) throw new Error("TTS_PACKAGE_UNKNOWN");
  return entry;
}

export function catalogVoicesFor(engine: TtsEngineId): CatalogVoice[] {
  return engine === "system" ? [] : knownVoices.filter(voice => voice.engine === engine);
}

export function formatModelBytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: bytes < 20_000_000 ? 1 : 0 })
    .format(bytes / 1_000_000);
}
