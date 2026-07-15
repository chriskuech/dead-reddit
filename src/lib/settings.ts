import { DEFAULT_SETTINGS, type Settings } from "./types";

const STORAGE_KEY = "settings";

/** Merges stored settings over defaults so new fields introduced by an update get sane values. */
function withDefaults(partial: Partial<Settings> | undefined): Settings {
  if (!partial) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    badgeColors: { ...DEFAULT_SETTINGS.badgeColors, ...partial.badgeColors },
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return withDefaults(stored[STORAGE_KEY] as Partial<Settings> | undefined);
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = withDefaults({ ...current, ...patch });
  await setSettings(next);
  return next;
}

/** Invokes `callback` with the latest settings whenever they change in chrome.storage.sync. */
export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== "sync" || !(STORAGE_KEY in changes)) return;
    callback(withDefaults(changes[STORAGE_KEY]?.newValue as Partial<Settings> | undefined));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
