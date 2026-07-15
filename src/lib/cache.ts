import type { CacheEntry, CacheEntryWithStaleness } from "./types";

const KEY_PREFIX = "flair:";

function keyFor(username: string): string {
  return `${KEY_PREFIX}${username.toLowerCase()}`;
}

export function deriveStaleness(entry: CacheEntry, cacheTtlMs: number): boolean {
  return Date.now() - entry.checkedAt > cacheTtlMs;
}

/**
 * Returns the cache entry regardless of staleness — an expired entry is still fully
 * readable. Callers decide whether to enqueue a refresh based on `isStale`.
 */
export async function get(
  username: string,
  cacheTtlMs: number,
): Promise<CacheEntryWithStaleness | null> {
  const key = keyFor(username);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key] as CacheEntry | undefined;
  if (!entry) return null;
  return { ...entry, isStale: deriveStaleness(entry, cacheTtlMs) };
}

export async function getMany(
  usernames: string[],
  cacheTtlMs: number,
): Promise<Record<string, CacheEntryWithStaleness | null>> {
  if (usernames.length === 0) return {};
  const keys = usernames.map(keyFor);
  const stored = await chrome.storage.local.get(keys);
  const result: Record<string, CacheEntryWithStaleness | null> = {};
  for (const username of usernames) {
    const normalized = username.toLowerCase();
    const entry = stored[keyFor(username)] as CacheEntry | undefined;
    result[normalized] = entry ? { ...entry, isStale: deriveStaleness(entry, cacheTtlMs) } : null;
  }
  return result;
}

/** Returns every cached username entry, keyed by (lowercase) username. */
export async function getAll(cacheTtlMs: number): Promise<Record<string, CacheEntryWithStaleness>> {
  const all = await chrome.storage.local.get(null);
  const result: Record<string, CacheEntryWithStaleness> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const username = key.slice(KEY_PREFIX.length);
    const entry = value as CacheEntry;
    result[username] = { ...entry, isStale: deriveStaleness(entry, cacheTtlMs) };
  }
  return result;
}

/** Overwrites the cache entry for `username`. Never deletes/nulls an entry on refresh. */
export async function set(username: string, entry: CacheEntry): Promise<void> {
  await chrome.storage.local.set({ [keyFor(username)]: entry });
}

export async function clear(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(KEY_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

/** Removes entries older than `maxAgeMs` (independent of TTL) to bound storage growth. */
export async function prune(maxAgeMs: number): Promise<number> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const expired: string[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const entry = value as CacheEntry;
    if (now - entry.checkedAt > maxAgeMs) expired.push(key);
  }
  if (expired.length) await chrome.storage.local.remove(expired);
  return expired.length;
}

export interface CacheStats {
  size: number;
  staleCount: number;
}

export async function stats(cacheTtlMs: number): Promise<CacheStats> {
  const all = await chrome.storage.local.get(null);
  let size = 0;
  let staleCount = 0;
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    size++;
    if (deriveStaleness(value as CacheEntry, cacheTtlMs)) staleCount++;
  }
  return { size, staleCount };
}
