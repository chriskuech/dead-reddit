import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "./support/chrome-mock";

describe("post-author-cache", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", createChromeMock());
    vi.resetModules();
  });

  it("returns undefined for a post id that has never been resolved", async () => {
    const postAuthorCache = await import("../src/lib/post-author-cache");
    expect(await postAuthorCache.get("abc123")).toBeUndefined();
  });

  it("round-trips a resolved author", async () => {
    const postAuthorCache = await import("../src/lib/post-author-cache");
    await postAuthorCache.set("abc123", "someuser");
    expect(await postAuthorCache.get("abc123")).toBe("someuser");
  });

  it("distinguishes a resolved-but-authorless post from one never looked up", async () => {
    const postAuthorCache = await import("../src/lib/post-author-cache");
    await postAuthorCache.set("deleted-post", null);

    expect(await postAuthorCache.get("deleted-post")).toBeNull();
    expect(await postAuthorCache.get("never-looked-up")).toBeUndefined();
  });

  it("getMany returns undefined for unknown post ids alongside known ones", async () => {
    const postAuthorCache = await import("../src/lib/post-author-cache");
    await postAuthorCache.set("known", "someuser");

    const results = await postAuthorCache.getMany(["known", "unknown"]);
    expect(results.known).toBe("someuser");
    expect(results.unknown).toBeUndefined();
  });

  it("getMany returns an empty object for an empty list", async () => {
    const postAuthorCache = await import("../src/lib/post-author-cache");
    expect(await postAuthorCache.getMany([])).toEqual({});
  });

  it("prune removes entries older than maxAgeMs and reports the count removed", async () => {
    const chromeMock = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);
    vi.resetModules();
    const postAuthorCache = await import("../src/lib/post-author-cache");
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    await chromeMock.storage.local.set({
      "post-author:old": { author: "someuser", checkedAt: Date.now() - THIRTY_DAYS - 1000 },
    });
    await postAuthorCache.set("recent", "otheruser");

    const removed = await postAuthorCache.prune(THIRTY_DAYS);

    expect(removed).toBe(1);
    expect(await postAuthorCache.get("old")).toBeUndefined();
    expect(await postAuthorCache.get("recent")).toBe("otheruser");
  });
});
