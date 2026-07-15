import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "./support/chrome-mock";
import type { CacheEntry } from "../src/lib/types";

const ONE_HOUR = 3_600_000;

describe("cache", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", createChromeMock());
    vi.resetModules();
  });

  it("returns null for a username with no entry", async () => {
    const cache = await import("../src/lib/cache");
    expect(await cache.get("nobody", ONE_HOUR)).toBeNull();
  });

  it("round-trips a stored entry and reports it fresh within the TTL", async () => {
    const cache = await import("../src/lib/cache");
    const entry: CacheEntry = {
      flair: "banned",
      postUrl: "https://example.com",
      checkedAt: Date.now(),
    };
    await cache.set("SomeUser", entry);

    const result = await cache.get("someuser", ONE_HOUR);
    expect(result).toMatchObject({ flair: "banned", isStale: false });
  });

  it("is case-insensitive on username lookup", async () => {
    const cache = await import("../src/lib/cache");
    await cache.set("MixedCase", { flair: "organic", postUrl: null, checkedAt: Date.now() });
    expect(await cache.get("mixedcase", ONE_HOUR)).toMatchObject({ flair: "organic" });
    expect(await cache.get("MIXEDCASE", ONE_HOUR)).toMatchObject({ flair: "organic" });
  });

  it("serves an expired entry as stale but never as null", async () => {
    const cache = await import("../src/lib/cache");
    const twoHoursAgo = Date.now() - 2 * ONE_HOUR;
    await cache.set("staleuser", { flair: "pending", postUrl: null, checkedAt: twoHoursAgo });

    const result = await cache.get("staleuser", ONE_HOUR);
    expect(result).not.toBeNull();
    expect(result?.flair).toBe("pending");
    expect(result?.isStale).toBe(true);
  });

  it("overwrites an existing entry on refresh (never blanks it)", async () => {
    const cache = await import("../src/lib/cache");
    await cache.set("user", {
      flair: "pending",
      postUrl: null,
      checkedAt: Date.now() - 2 * ONE_HOUR,
    });
    await cache.set("user", { flair: "banned", postUrl: "https://x", checkedAt: Date.now() });

    const result = await cache.get("user", ONE_HOUR);
    expect(result).toMatchObject({ flair: "banned", isStale: false });
  });

  it("getMany returns a null entry for unknown usernames alongside known ones", async () => {
    const cache = await import("../src/lib/cache");
    await cache.set("known", { flair: "service", postUrl: null, checkedAt: Date.now() });

    const results = await cache.getMany(["known", "unknown"], ONE_HOUR);
    expect(results.known).toMatchObject({ flair: "service" });
    expect(results.unknown).toBeNull();
  });

  it("clear removes only bouncer cache entries, not unrelated storage keys", async () => {
    const chromeMock = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);
    vi.resetModules();
    const cache = await import("../src/lib/cache");

    await cache.set("someone", { flair: "banned", postUrl: null, checkedAt: Date.now() });
    await chromeMock.storage.local.set({ "unrelated-key": "keep-me" });

    await cache.clear();

    expect(await cache.get("someone", ONE_HOUR)).toBeNull();
    expect((await chromeMock.storage.local.get("unrelated-key"))["unrelated-key"]).toBe("keep-me");
  });

  it("prune removes entries older than maxAgeMs and reports the count removed", async () => {
    const cache = await import("../src/lib/cache");
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    await cache.set("old", {
      flair: "banned",
      postUrl: null,
      checkedAt: Date.now() - THIRTY_DAYS - 1000,
    });
    await cache.set("recent", { flair: "banned", postUrl: null, checkedAt: Date.now() });

    const removed = await cache.prune(THIRTY_DAYS);

    expect(removed).toBe(1);
    expect(await cache.get("old", ONE_HOUR)).toBeNull();
    expect(await cache.get("recent", ONE_HOUR)).not.toBeNull();
  });

  it("getAll returns every cached entry keyed by username, with staleness derived", async () => {
    const cache = await import("../src/lib/cache");
    await cache.set("fresh", { flair: "banned", postUrl: null, checkedAt: Date.now() });
    await cache.set("stale", {
      flair: "pending",
      postUrl: null,
      checkedAt: Date.now() - 2 * ONE_HOUR,
    });

    const all = await cache.getAll(ONE_HOUR);
    expect(Object.keys(all).sort()).toEqual(["fresh", "stale"]);
    expect(all.fresh).toMatchObject({ flair: "banned", isStale: false });
    expect(all.stale).toMatchObject({ flair: "pending", isStale: true });
  });

  it("stats reports total size and stale count", async () => {
    const cache = await import("../src/lib/cache");
    await cache.set("fresh", { flair: "banned", postUrl: null, checkedAt: Date.now() });
    await cache.set("stale", {
      flair: "banned",
      postUrl: null,
      checkedAt: Date.now() - 2 * ONE_HOUR,
    });

    const result = await cache.stats(ONE_HOUR);
    expect(result).toEqual({ size: 2, staleCount: 1 });
  });
});
