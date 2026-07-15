import type { BlockedSubreddit } from "./types";

const STORAGE_KEY = "blockedSubreddits";

export function normalizeSubreddit(subreddit: string): string {
  return subreddit.trim().toLowerCase().replace(/^r\//, "");
}

export async function getBlockedSubreddits(): Promise<BlockedSubreddit[]> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as BlockedSubreddit[] | undefined) ?? [];
}

export async function isSubredditBlocked(subreddit: string): Promise<boolean> {
  const normalized = normalizeSubreddit(subreddit);
  const list = await getBlockedSubreddits();
  return list.some((entry) => entry.subreddit === normalized);
}

/** Adds `subreddit` to the blocked list. No-op if already blocked. */
export async function blockSubreddit(subreddit: string): Promise<BlockedSubreddit[]> {
  const normalized = normalizeSubreddit(subreddit);
  const list = await getBlockedSubreddits();
  if (list.some((entry) => entry.subreddit === normalized)) return list;
  const next = [...list, { subreddit: normalized, blockedAt: Date.now() }];
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

export async function unblockSubreddit(subreddit: string): Promise<BlockedSubreddit[]> {
  const normalized = normalizeSubreddit(subreddit);
  const list = await getBlockedSubreddits();
  const next = list.filter((entry) => entry.subreddit !== normalized);
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

/** Invokes `callback` with the latest list whenever it changes in chrome.storage.sync. */
export function onBlockedSubredditsChanged(
  callback: (list: BlockedSubreddit[]) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== "sync" || !(STORAGE_KEY in changes)) return;
    callback((changes[STORAGE_KEY]?.newValue as BlockedSubreddit[] | undefined) ?? []);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
