import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, type ChromeMock } from "./support/chrome-mock";
import type {
  PostAuthorResolvedPush,
  ResolvePostAuthorsRequest,
  ResolvePostAuthorsResponse,
} from "../src/lib/types";

const fetchAuthorsForPostIdsMock = vi.fn(async (postIds: string[]) => {
  const results: Record<string, string | null> = {};
  for (const postId of postIds) results[postId] = `author-of-${postId}`;
  return results;
});

vi.mock("../src/lib/reddit-api", () => ({
  fetchFlairForUser: vi.fn(async () => ({ flair: null, postUrl: null, checkedAt: Date.now() })),
  fetchAuthorsForPostIds: (postIds: string[]) => fetchAuthorsForPostIdsMock(postIds),
  MAX_POST_AUTHOR_BATCH: 50,
  RateLimitedError: class RateLimitedError extends Error {
    retryAfterMs: number | null;
    constructor(retryAfterMs: number | null) {
      super("rate limited");
      this.retryAfterMs = retryAfterMs;
    }
  },
}));

let chromeMock: ChromeMock;

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("background resolve-post-authors", () => {
  beforeEach(async () => {
    vi.resetModules();
    fetchAuthorsForPostIdsMock.mockClear();
    chromeMock = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);
    await import("../src/background");
  });

  it("queues uncached post ids, resolves them via a batch fetch, and pushes the result to the requesting tab", async () => {
    const listener = chromeMock._internal.onMessageListeners[0];
    expect(listener).toBeTruthy();

    const request: ResolvePostAuthorsRequest = {
      type: "resolve-post-authors",
      postIds: ["abc123", "def456"],
    };

    let response: ResolvePostAuthorsResponse | undefined;
    listener!(request, { tab: { id: 7 } }, (r: ResolvePostAuthorsResponse) => {
      response = r;
    });

    await waitFor(() => response !== undefined);
    // Uncached post ids are queued, not resolved synchronously.
    expect(response?.results).toEqual({});

    await waitFor(() => fetchAuthorsForPostIdsMock.mock.calls.length === 1);
    expect(fetchAuthorsForPostIdsMock).toHaveBeenCalledWith(["abc123", "def456"]);

    await waitFor(() => chromeMock.tabs.sendMessage.mock.calls.length >= 2);
    const pushes = chromeMock.tabs.sendMessage.mock.calls.map(
      (call) => call[1] as PostAuthorResolvedPush,
    );
    expect(pushes).toContainEqual({
      type: "post-author-resolved",
      postId: "abc123",
      author: "author-of-abc123",
    });
    expect(pushes).toContainEqual({
      type: "post-author-resolved",
      postId: "def456",
      author: "author-of-def456",
    });
  });

  it("serves a previously-resolved post id from cache without re-fetching", async () => {
    await chromeMock.storage.local.set({
      "post-author:cached123": { author: "someuser", checkedAt: Date.now() },
    });

    const listener = chromeMock._internal.onMessageListeners[0];
    const request: ResolvePostAuthorsRequest = {
      type: "resolve-post-authors",
      postIds: ["cached123"],
    };

    let response: ResolvePostAuthorsResponse | undefined;
    listener!(request, { tab: { id: 1 } }, (r: ResolvePostAuthorsResponse) => {
      response = r;
    });

    await waitFor(() => response !== undefined);
    expect(response?.results).toEqual({ cached123: "someuser" });
    expect(fetchAuthorsForPostIdsMock).not.toHaveBeenCalled();
  });
});
