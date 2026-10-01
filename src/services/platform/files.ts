import type { BookFormat } from "../types";
/** The browser/Tauri chooser resolves SAF content:// URIs into readable File/Blob objects.
 * No path parsing, file:// fetching, Node fs, or desktop-only commands in shared code. */
export interface SelectedBookFile {
  name: string;
  blob: Blob;
  format: BookFormat;
}
export interface PlatformFilePicker {
  selected(files: FileList): { accepted: SelectedBookFile[]; rejected: number };
}
export const platformFilePicker: PlatformFilePicker = {
  selected(files) {
    const accepted: SelectedBookFile[] = [];
    let rejected = 0;
    for (const file of Array.from(files)) {
      const extension = file.name.toLowerCase().split(".").at(-1);
      if (extension !== "pdf" && extension !== "epub") {
        rejected++;
        continue;
      }
      accepted.push({ name: file.name, blob: file, format: extension });
    }
    return { accepted, rejected };
  },
};
