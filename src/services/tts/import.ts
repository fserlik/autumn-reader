import { appDataDir, join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, remove } from "@tauri-apps/plugin-fs";
import { importVoice, inspectVoiceImport } from "./native";
import type { CatalogVoice, VoiceImportInspection, VoiceImportRequest } from "./types";

export interface SelectedVoiceFile {
  path: string;
  label: string;
}

function archiveLabel(path: string): string {
  const segment = path.split(/[\\/]/).at(-1) ?? path;
  try { return decodeURIComponent(segment); }
  catch { return segment; }
}

export async function chooseVoiceFile(title: string): Promise<SelectedVoiceFile | null> {
  const selected = await open({
    title,
    multiple: false,
    directory: false,
    pickerMode: "document",
    fileAccessMode: "copy",
    filters: [{ name: "Kokoro / sherpa-onnx", extensions: ["bin", "bz2", "tbz2"] }],
  });
  if (typeof selected !== "string") return null;
  return { path: selected, label: archiveLabel(selected) };
}

function stagedExtension(label: string): string {
  if (/\.bin$/i.test(label)) return ".bin";
  if (/\.tbz2$/i.test(label)) return ".tbz2";
  return ".tar.bz2";
}

function safeImportLabel(label: string): string {
  const stem = label.replace(/\.(?:tar\.bz2|tbz2|bin)$/i, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return stem || "voice";
}

export interface PreparedVoiceImport {
  stagedPath: string;
  label: string;
  inspection: VoiceImportInspection;
}

export async function prepareVoiceImport(selected: SelectedVoiceFile): Promise<PreparedVoiceImport> {
  const staged = await join(await appDataDir(), `${safeImportLabel(selected.label)}-tts-import-${crypto.randomUUID()}${stagedExtension(selected.label)}`);
  await copyFile(selected.path, staged);
  try {
    return { stagedPath: staged, label: selected.label, inspection: await inspectVoiceImport(staged) };
  } catch (error) {
    await remove(staged).catch(() => undefined);
    throw error;
  }
}

export async function discardPreparedVoiceImport(prepared: PreparedVoiceImport | null): Promise<void> {
  if (prepared) await remove(prepared.stagedPath).catch(() => undefined);
}

export async function installPreparedVoice(
  prepared: PreparedVoiceImport,
  metadata: Omit<VoiceImportRequest, "sourcePath"> = {},
): Promise<CatalogVoice> {
  const voice = await importVoice({ ...metadata, sourcePath: prepared.stagedPath });
  await discardPreparedVoiceImport(prepared);
  return voice;
}

/** @deprecated Kept for callers compiled against the first local-import API. */
export const chooseVoiceArchive = chooseVoiceFile;
