const KEY_PREFIX = "post-author:";

interface PostAuthorEntry {
  /** null means resolved-but-authorless (deleted account, or no author found). */
  author: string | null;
  checkedAt: number;
}

function keyFor(postId: string): string {
  return `${KEY_PREFIX}${postId}`;
}

/** Returns `undefined` when `postId` has never been resolved (distinct from a resolved-null author). */
export async function get(postId: string): Promise<string | null | undefined> {
  const key = keyFor(postId);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key] as PostAuthorEntry | undefined;
  return entry?.author;
}

export async function getMany(
  postIds: string[],
): Promise<Record<string, string | null | undefined>> {
  if (postIds.length === 0) return {};
  const keys = postIds.map(keyFor);
  const stored = await chrome.storage.local.get(keys);
  const result: Record<string, string | null | undefined> = {};
  for (const postId of postIds) {
    const entry = stored[keyFor(postId)] as PostAuthorEntry | undefined;
    result[postId] = entry?.author;
  }
  return result;
}

export async function set(postId: string, author: string | null): Promise<void> {
  const entry: PostAuthorEntry = { author, checkedAt: Date.now() };
  await chrome.storage.local.set({ [keyFor(postId)]: entry });
}

/** Removes entries older than `maxAgeMs` to bound storage growth. */
export async function prune(maxAgeMs: number): Promise<number> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const expired: string[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const entry = value as PostAuthorEntry;
    if (now - entry.checkedAt > maxAgeMs) expired.push(key);
  }
  if (expired.length) await chrome.storage.local.remove(expired);
  return expired.length;
}
