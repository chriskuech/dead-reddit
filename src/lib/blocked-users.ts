import type { BlockedUser } from "./types";

const STORAGE_KEY = "blockedUsers";

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/^u\//, "");
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as BlockedUser[] | undefined) ?? [];
}

export async function isUserBlocked(username: string): Promise<boolean> {
  const normalized = normalizeUsername(username);
  const list = await getBlockedUsers();
  return list.some((entry) => entry.username === normalized);
}

/** Adds `username` to the blocked list. No-op if already blocked. */
export async function blockUser(username: string): Promise<BlockedUser[]> {
  const normalized = normalizeUsername(username);
  const list = await getBlockedUsers();
  if (list.some((entry) => entry.username === normalized)) return list;
  const next = [...list, { username: normalized, blockedAt: Date.now() }];
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

export async function unblockUser(username: string): Promise<BlockedUser[]> {
  const normalized = normalizeUsername(username);
  const list = await getBlockedUsers();
  const next = list.filter((entry) => entry.username !== normalized);
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

/** Invokes `callback` with the latest list whenever it changes in chrome.storage.sync. */
export function onBlockedUsersChanged(callback: (list: BlockedUser[]) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== "sync" || !(STORAGE_KEY in changes)) return;
    callback((changes[STORAGE_KEY]?.newValue as BlockedUser[] | undefined) ?? []);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
