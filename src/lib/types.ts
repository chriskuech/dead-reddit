export type BotBouncerFlair =
  "banned" | "inactive" | "organic" | "pending" | "purged" | "retired" | "service";

export const BOT_BOUNCER_FLAIRS: readonly BotBouncerFlair[] = [
  "banned",
  "inactive",
  "organic",
  "pending",
  "purged",
  "retired",
  "service",
];

export function isBotBouncerFlair(value: string): value is BotBouncerFlair {
  return (BOT_BOUNCER_FLAIRS as readonly string[]).includes(value);
}

/** Result of a single classification lookup, before staleness is derived. */
export interface FlairResult {
  flair: BotBouncerFlair | null;
  postUrl: string | null;
  checkedAt: number;
}

/** Persisted shape in chrome.storage.local. */
export type CacheEntry = FlairResult;

/** Cache entry plus the derived staleness flag, as served to content scripts. */
export interface CacheEntryWithStaleness extends CacheEntry {
  isStale: boolean;
}

export type FilterAction = "hide" | "collapse" | "badge-only";

export interface Settings {
  enabled: boolean;
  filteredFlairs: BotBouncerFlair[];
  filterAction: FilterAction;
  badgeColors: Record<BotBouncerFlair, string>;
  cacheTtlMs: number;
  requestDelayMs: number;
  showUnclassifiedBadge: boolean;
  showOrganicBadge: boolean;
}

export const DEFAULT_BADGE_COLORS: Record<BotBouncerFlair, string> = {
  banned: "#c0392b",
  purged: "#7b241c",
  pending: "#d68910",
  inactive: "#7f8c8d",
  retired: "#5d6d7e",
  service: "#2e86c1",
  organic: "#27ae60",
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  filteredFlairs: ["banned"],
  filterAction: "hide",
  badgeColors: DEFAULT_BADGE_COLORS,
  cacheTtlMs: 3_600_000,
  requestDelayMs: 250,
  showUnclassifiedBadge: false,
  showOrganicBadge: false,
};

// ---- Messages: content script <-> background service worker ----

export interface CheckUsernamesRequest {
  type: "check-usernames";
  usernames: string[];
}

export interface CheckUsernamesResponse {
  results: Record<string, CacheEntryWithStaleness>;
}

/** Pushed from background to content scripts when a stale entry's refresh resolves with a changed value. */
export interface FlairUpdatedPush {
  type: "flair-updated";
  username: string;
  result: CacheEntryWithStaleness;
}

/**
 * Search result cards don't expose their author anywhere in the DOM, so the content script
 * batch-resolves post ids (extracted from the title permalink) via Reddit's /by_id endpoint
 * instead. Cached entries are returned immediately; uncached ones are queued and delivered
 * later via a `post-author-resolved` push, mirroring the check-usernames/flair-updated flow.
 */
export interface ResolvePostAuthorsRequest {
  type: "resolve-post-authors";
  postIds: string[];
}

export interface ResolvePostAuthorsResponse {
  /** Only already-cached post ids are included here. */
  results: Record<string, string | null>;
}

/** Pushed from background to content scripts once a queued post's author batch-fetch resolves. */
export interface PostAuthorResolvedPush {
  type: "post-author-resolved";
  postId: string;
  author: string | null;
}

export interface GetStatsRequest {
  type: "get-stats";
}

export interface BackgroundStats {
  cacheSize: number;
  staleCount: number;
  pendingCount: number;
  priorityQueueSize: number;
  refreshQueueSize: number;
  lastSyncAt: number | null;
  rateLimitedUntil: number | null;
}

export interface ClearCacheRequest {
  type: "clear-cache";
}

export interface ClearCacheResponse {
  success: true;
}

export type BackgroundRequest =
  | CheckUsernamesRequest
  | ResolvePostAuthorsRequest
  | GetStatsRequest
  | ClearCacheRequest;

export type BackgroundResponse =
  | CheckUsernamesResponse
  | ResolvePostAuthorsResponse
  | BackgroundStats
  | ClearCacheResponse;

// ---- Messages: popup -> content script (per-tab session stats) ----

export interface GetPageStatsRequest {
  type: "get-page-stats";
}

export interface PageStats {
  flaggedCount: number;
}

// ---- Blocked subreddits (chrome.storage.sync) ----

export interface BlockedSubreddit {
  /** Lowercase, no "r/" prefix. */
  subreddit: string;
  blockedAt: number;
}

// ---- Blocked users (chrome.storage.sync) ----

export interface BlockedUser {
  /** Lowercase, no "u/" prefix. */
  username: string;
  blockedAt: number;
}
