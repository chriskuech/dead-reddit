import { isBotBouncerFlair, type BotBouncerFlair, type FlairResult } from "./types";

const SEARCH_URL = "https://www.reddit.com/r/BotBouncer/search.json";
const BY_ID_URL = "https://www.reddit.com/by_id/";
/** Reddit's /by_id listing endpoint accepts a comma-separated list of fullnames; keep batches modest. */
export const MAX_POST_AUTHOR_BATCH = 50;

export class RateLimitedError extends Error {
  retryAfterMs: number | null;

  constructor(retryAfterMs: number | null) {
    super("Rate limited by reddit.com");
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

interface RedditListingChild {
  data?: {
    link_flair_text?: string | null;
    link_flair_css_class?: string | null;
    url?: string;
    permalink?: string;
  };
}

interface RedditListing {
  data?: {
    children?: RedditListingChild[];
  };
}

function normalizeFlair(value: string | null | undefined): BotBouncerFlair | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return isBotBouncerFlair(normalized) ? normalized : null;
}

/**
 * Looks up `username`'s most recent /r/BotBouncer submission and derives their current
 * classification. Rides the browser's ambient reddit.com session cookies — no OAuth.
 */
export async function fetchFlairForUser(username: string): Promise<FlairResult> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", `author:${username}`);
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("sort", "new");
  url.searchParams.set("limit", "5");

  const response = await fetch(url.toString(), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
    throw new RateLimitedError(retryAfterMs);
  }

  if (response.status === 404) {
    return { flair: null, postUrl: null, checkedAt: Date.now() };
  }

  if (!response.ok) {
    throw new Error(`search.json request failed with status ${response.status}`);
  }

  let listing: RedditListing;
  try {
    listing = (await response.json()) as RedditListing;
  } catch {
    throw new Error("search.json returned malformed JSON");
  }

  const first = listing.data?.children?.[0]?.data;
  if (!first) {
    return { flair: null, postUrl: null, checkedAt: Date.now() };
  }

  const flair = normalizeFlair(first.link_flair_text) ?? normalizeFlair(first.link_flair_css_class);
  const postUrl = first.permalink
    ? `https://www.reddit.com${first.permalink}`
    : (first.url ?? null);

  return { flair, postUrl, checkedAt: Date.now() };
}

interface ByIdListingChild {
  data?: {
    name?: string; // fullname, e.g. "t3_abc123"
    author?: string;
  };
}

interface ByIdListing {
  data?: {
    children?: ByIdListingChild[];
  };
}

/**
 * Batch-resolves the author of up to `MAX_POST_AUTHOR_BATCH` posts via Reddit's public
 * /by_id listing endpoint. Used for search result cards, which — unlike the main feed —
 * don't expose the post author anywhere in the DOM.
 */
export async function fetchAuthorsForPostIds(
  postIds: string[],
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  if (postIds.length === 0) return results;
  for (const postId of postIds) results[postId] = null;

  const fullnames = postIds.map((id) => `t3_${id}`).join(",");
  const response = await fetch(`${BY_ID_URL}${fullnames}.json`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
    throw new RateLimitedError(retryAfterMs);
  }

  if (!response.ok) {
    throw new Error(`by_id request failed with status ${response.status}`);
  }

  let listing: ByIdListing;
  try {
    listing = (await response.json()) as ByIdListing;
  } catch {
    throw new Error("by_id returned malformed JSON");
  }

  for (const child of listing.data?.children ?? []) {
    const name = child.data?.name;
    const author = child.data?.author;
    if (!name?.startsWith("t3_")) continue;
    const postId = name.slice(3);
    if (author && author !== "[deleted]") results[postId] = author;
  }

  return results;
}
