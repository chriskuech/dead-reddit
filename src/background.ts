import { fetchFlairForUser, RateLimitedError } from "./lib/reddit-api";
import * as cache from "./lib/cache";
import { getSettings } from "./lib/settings";
import type {
  BackgroundStats,
  CacheEntryWithStaleness,
  CheckUsernamesRequest,
  CheckUsernamesResponse,
  ClearCacheResponse,
  FlairUpdatedPush,
} from "./lib/types";

const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000; // short TTL for lookup failures with no prior cache
const PRUNE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // drop entries untouched for 30+ days
const PRUNE_ALARM = "dr-prune-cache";
const MAX_BACKOFF_MS = 5 * 60 * 1000;

const priorityQueue: string[] = [];
const refreshQueue: string[] = [];
/** Usernames currently present in either queue, for O(1) dedupe. */
const queuedUsernames = new Set<string>();
/** username -> tabIds currently displaying it, so refresh pushes reach every viewer. */
const viewers = new Map<string, Set<number>>();

let processing = false;
let rateLimitedUntil: number | null = null;
let lastSyncAt: number | null = null;
let backoffMs = 0;

function normalize(username: string): string {
  return username.toLowerCase();
}

function registerViewer(username: string, tabId: number | undefined): void {
  if (tabId === undefined) return;
  let set = viewers.get(username);
  if (!set) {
    set = new Set();
    viewers.set(username, set);
  }
  set.add(tabId);
}

function broadcastUpdate(username: string, result: CacheEntryWithStaleness): void {
  const tabIds = viewers.get(username);
  if (!tabIds || tabIds.size === 0) return;
  const message: FlairUpdatedPush = { type: "flair-updated", username, result };
  for (const tabId of tabIds) {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // Tab navigated away, closed, or has no listening content script — drop silently.
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Adds `username` to the appropriate queue and kicks off processing if idle. */
function enqueue(username: string, hasCacheEntry: boolean): void {
  if (queuedUsernames.has(username)) return;
  queuedUsernames.add(username);
  (hasCacheEntry ? refreshQueue : priorityQueue).push(username);
  void processQueue();
}

/** Drains the priority queue fully before touching the refresh queue. */
async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (priorityQueue.length > 0 || refreshQueue.length > 0) {
      if (rateLimitedUntil !== null && Date.now() < rateLimitedUntil) {
        await sleep(rateLimitedUntil - Date.now());
        continue;
      }
      const settings = await getSettings();
      const username = priorityQueue.length > 0 ? priorityQueue.shift() : refreshQueue.shift();
      if (username === undefined) continue;
      queuedUsernames.delete(username);
      await processUsername(username, settings.cacheTtlMs);
      if (priorityQueue.length > 0 || refreshQueue.length > 0) {
        await sleep(settings.requestDelayMs);
      }
    }
  } finally {
    processing = false;
  }
}

async function processUsername(username: string, cacheTtlMs: number): Promise<void> {
  const previous = await cache.get(username, cacheTtlMs);
  try {
    const result = await fetchFlairForUser(username);
    await cache.set(username, result);
    backoffMs = 0;
    lastSyncAt = Date.now();
    const changed =
      !previous || previous.flair !== result.flair || previous.postUrl !== result.postUrl;
    if (changed) {
      broadcastUpdate(username, { ...result, isStale: false });
    }
  } catch (error) {
    if (error instanceof RateLimitedError) {
      backoffMs = backoffMs === 0 ? 2000 : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      rateLimitedUntil = Date.now() + (error.retryAfterMs ?? backoffMs);
      // Requeue for retry once the backoff window elapses.
      queuedUsernames.add(username);
      (previous ? refreshQueue : priorityQueue).unshift(username);
      return;
    }
    // Network error, non-200, malformed JSON: never regress a known-good value.
    if (!previous) {
      const backdatedCheckedAt = Date.now() - Math.max(cacheTtlMs - NEGATIVE_CACHE_TTL_MS, 0);
      await cache.set(username, { flair: null, postUrl: null, checkedAt: backdatedCheckedAt });
    }
    // If a stale value already existed, leave it as-is; it naturally gets re-enqueued
    // as stale again on the next scan that touches this username.
  }
}

async function handleCheckUsernames(
  message: CheckUsernamesRequest,
  tabId: number | undefined,
): Promise<CheckUsernamesResponse> {
  const settings = await getSettings();
  const usernames = Array.from(new Set(message.usernames.map(normalize))).filter(
    (username) => username.length > 0 && username !== "[deleted]",
  );
  const cached = await cache.getMany(usernames, settings.cacheTtlMs);
  const results: Record<string, CacheEntryWithStaleness> = {};

  for (const username of usernames) {
    registerViewer(username, tabId);
    const entry = cached[username];
    if (!entry) {
      enqueue(username, false);
      continue;
    }
    results[username] = entry;
    if (entry.isStale) {
      enqueue(username, true);
    }
  }

  return { results };
}

async function handleGetStats(): Promise<BackgroundStats> {
  const settings = await getSettings();
  const { size, staleCount } = await cache.stats(settings.cacheTtlMs);
  return {
    cacheSize: size,
    staleCount,
    pendingCount: queuedUsernames.size,
    priorityQueueSize: priorityQueue.length,
    refreshQueueSize: refreshQueue.length,
    lastSyncAt,
    rateLimitedUntil,
  };
}

async function handleClearCache(): Promise<ClearCacheResponse> {
  await cache.clear();
  return { success: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "check-usernames":
      void handleCheckUsernames(message as CheckUsernamesRequest, sender.tab?.id).then(
        sendResponse,
      );
      return true;
    case "get-stats":
      void handleGetStats().then(sendResponse);
      return true;
    case "clear-cache":
      void handleClearCache().then(sendResponse);
      return true;
    default:
      return false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const set of viewers.values()) {
    set.delete(tabId);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(PRUNE_ALARM, { periodInMinutes: 60 * 24 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PRUNE_ALARM) {
    void cache.prune(PRUNE_MAX_AGE_MS);
  }
});
