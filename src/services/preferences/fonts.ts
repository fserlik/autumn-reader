import { invoke, isTauri } from "@tauri-apps/api/core";

/** Browsers and Android WebView do not expose a reliable list of user-installed font families. */
export async function availableSystemFonts(): Promise<string[]> {
  if (/\bAndroid\b/i.test(navigator.userAgent)) return ["sans-serif", "serif", "monospace", "sans-serif-condensed"];
  if (isTauri()) {
    try { return await invoke<string[]>("system_font_families"); } catch { return []; }
  }
  const query = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!query) return [];
  try { return [...new Set((await query()).map(font => font.family))].sort((a, b) => a.localeCompare(b)); }
  catch { return []; }
}

export const fontCss = (choice: string): string => {
  const integrated: Record<string, string> = {
    original: "", georgia: 'Georgia, "Times New Roman", serif',
    arial: 'Arial, Helvetica, sans-serif', verdana: 'Verdana, Geneva, sans-serif',
    times: '"Times New Roman", Times, serif',
  };
  if (Object.hasOwn(integrated, choice)) return integrated[choice];
  const name = choice.startsWith("system:") ? choice.slice(7) : "";
  if (["serif", "sans-serif", "monospace", "sans-serif-condensed"].includes(name)) return name;
  return /^[\p{L}\p{N} .-]{1,90}$/u.test(name) ? `"${name}", sans-serif` : "";
};
