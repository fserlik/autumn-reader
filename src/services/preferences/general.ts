export interface DesktopGeneralPreferences {
  disableTrashBin: boolean;
  deleteBooksWithFolder: boolean;
  preventScreenBlanking: boolean;
  autoMaximize: boolean;
  launchOnStartup: boolean;
  minimizeToTrayOnClose: boolean;
}

export const defaultDesktopGeneralPreferences: Readonly<DesktopGeneralPreferences> = {
  disableTrashBin: false,
  deleteBooksWithFolder: false,
  preventScreenBlanking: false,
  autoMaximize: false,
  launchOnStartup: false,
  minimizeToTrayOnClose: false,
};

const storageKey = "autumn-desktop-general";

export function loadDesktopGeneralPreferences(): DesktopGeneralPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<DesktopGeneralPreferences>;
    return Object.fromEntries(Object.keys(defaultDesktopGeneralPreferences).map(key => [
      key,
      typeof stored[key as keyof DesktopGeneralPreferences] === "boolean"
        ? stored[key as keyof DesktopGeneralPreferences]
        : defaultDesktopGeneralPreferences[key as keyof DesktopGeneralPreferences],
    ])) as unknown as DesktopGeneralPreferences;
  } catch {
    return { ...defaultDesktopGeneralPreferences };
  }
}

export function saveDesktopGeneralPreferences(value: DesktopGeneralPreferences): DesktopGeneralPreferences {
  const normalized = Object.fromEntries(Object.keys(defaultDesktopGeneralPreferences).map(key => [
    key,
    Boolean(value[key as keyof DesktopGeneralPreferences]),
  ])) as unknown as DesktopGeneralPreferences;
  localStorage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}
