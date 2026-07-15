import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "./support/chrome-mock";

describe("blocked-subreddits", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", createChromeMock());
    vi.resetModules();
  });

  it("returns an empty list when nothing is blocked", async () => {
    const blockedSubreddits = await import("../src/lib/blocked-subreddits");
    expect(await blockedSubreddits.getBlockedSubreddits()).toEqual([]);
  });

  it("blocks a subreddit, normalizing case and a leading r/ prefix", async () => {
    const blockedSubreddits = await import("../src/lib/blocked-subreddits");
    await blockedSubreddits.blockSubreddit("r/AskReddit");

    const list = await blockedSubreddits.getBlockedSubreddits();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ subreddit: "askreddit" });
    expect(await blockedSubreddits.isSubredditBlocked("ASKREDDIT")).toBe(true);
  });

  it("is idempotent: blocking an already-blocked subreddit does not duplicate it", async () => {
    const blockedSubreddits = await import("../src/lib/blocked-subreddits");
    await blockedSubreddits.blockSubreddit("aww");
    await blockedSubreddits.blockSubreddit("aww");

    expect(await blockedSubreddits.getBlockedSubreddits()).toHaveLength(1);
  });

  it("unblocks a subreddit", async () => {
    const blockedSubreddits = await import("../src/lib/blocked-subreddits");
    await blockedSubreddits.blockSubreddit("aww");
    await blockedSubreddits.unblockSubreddit("aww");

    expect(await blockedSubreddits.getBlockedSubreddits()).toEqual([]);
    expect(await blockedSubreddits.isSubredditBlocked("aww")).toBe(false);
  });

  it("unblocking a subreddit that was never blocked is a no-op", async () => {
    const blockedSubreddits = await import("../src/lib/blocked-subreddits");
    await blockedSubreddits.blockSubreddit("aww");

    const result = await blockedSubreddits.unblockSubreddit("nonexistent");
    expect(result).toHaveLength(1);
  });

  it("notifies listeners when the blocked list changes", async () => {
    const chromeMock = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);
    vi.resetModules();
    const blockedSubreddits = await import("../src/lib/blocked-subreddits");

    const callback = vi.fn();
    blockedSubreddits.onBlockedSubredditsChanged(callback);

    await blockedSubreddits.blockSubreddit("aww");

    // Simulate storage.onChanged firing, as chrome.storage.sync.set does not trigger
    // the mock's onChanged listeners automatically.
    const listener = chromeMock._internal.onChangedListeners[0];
    listener!({ blockedSubreddits: { newValue: [{ subreddit: "aww", blockedAt: 1 }] } }, "sync");

    expect(callback).toHaveBeenCalledWith([{ subreddit: "aww", blockedAt: 1 }]);
  });
});
