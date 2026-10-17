import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn(), copyFile: vi.fn(), remove: vi.fn(), importVoice: vi.fn(), inspectVoiceImport: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/plugin-fs", () => ({ copyFile: mocks.copyFile, remove: mocks.remove }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "C:/AutumnData"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));
vi.mock("../../src/services/tts/native", () => ({ importVoice: mocks.importVoice, inspectVoiceImport: mocks.inspectVoiceImport }));

import { chooseVoiceFile, discardPreparedVoiceImport, installPreparedVoice, prepareVoiceImport } from "../../src/services/tts/import";

describe("local voice import", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.remove.mockResolvedValue(undefined); });

  it("uses the native document picker and keeps a readable archive label", async () => {
    mocks.open.mockResolvedValue("content://models/Kokoro%20Spanish.tar.bz2");
    await expect(chooseVoiceFile("Choose model")).resolves.toEqual({
      path: "content://models/Kokoro%20Spanish.tar.bz2",
      label: "Kokoro Spanish.tar.bz2",
    });
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      multiple: false, directory: false, pickerMode: "document", fileAccessMode: "copy",
    }));
    expect(mocks.open.mock.calls[0][0].filters[0].extensions).toContain("bin");
  });

  it("copies and inspects a single Kokoro voice while preserving its readable name", async () => {
    const inspection = { kind: "kokoro-voice", engine: "kokoro", format: "Kokoro voice (.bin)", name: "Heart", locale: "en-US", modelVersion: "kokoro-1.0", baseModelInstalled: true, requiresName: false, requiresLocale: false, size: 522240 };
    mocks.inspectVoiceImport.mockResolvedValue(inspection);
    const prepared = await prepareVoiceImport({ path: "content://voices/af_heart.bin", label: "af_heart.bin" });
    expect(prepared.inspection).toEqual(inspection);
    expect(mocks.copyFile).toHaveBeenCalledWith("content://voices/af_heart.bin", expect.stringMatching(/af_heart-tts-import-.*\.bin/));
  });

  it("invokes native validation and removes the staging file only after successful installation", async () => {
    const voice = { id: "imported-voice", packageId: "imported-package", engine: "piper", name: "Luna", locale: "es-AR", region: "AR", speakerId: 0, quality: "imported", imported: true };
    mocks.importVoice.mockResolvedValue(voice);
    const prepared = { stagedPath: "C:/AutumnData/model-tts-import-id.tar.bz2", label: "model.tar.bz2", inspection: { kind: "model-package", engine: "piper", format: "sherpa-onnx (.tar.bz2)", name: "Luna", locale: "es-AR", baseModelInstalled: true, requiresName: false, requiresLocale: false, size: 42 } } as const;
    await expect(installPreparedVoice(prepared, { name: "Luna", locale: "es-AR" })).resolves.toEqual(voice);
    expect(mocks.importVoice).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: expect.stringContaining(".tar.bz2"), name: "Luna" }));
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("retains a selected voice after a missing-base failure until the dialog discards it", async () => {
    mocks.importVoice.mockRejectedValue(new Error("TTS_IMPORT_MODEL_INVALID"));
    const prepared = { stagedPath: "C:/AutumnData/af_heart.bin", label: "af_heart.bin", inspection: { kind: "kokoro-voice", engine: "kokoro", format: "Kokoro voice (.bin)", name: "Heart", locale: "en-US", modelVersion: "kokoro-1.0", baseModelInstalled: false, requiresName: false, requiresLocale: false, size: 522240 } } as const;
    await expect(installPreparedVoice(prepared)).rejects.toThrow("TTS_IMPORT_MODEL_INVALID");
    expect(mocks.remove).not.toHaveBeenCalled();
    await discardPreparedVoiceImport(prepared);
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
