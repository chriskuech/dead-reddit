import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, type ChromeMock } from "./support/chrome-mock";
import type { CheckUsernamesRequest, CheckUsernamesResponse } from "../src/lib/types";

const fetchOrder: string[] = [];

vi.mock("../src/lib/reddit-api", () => ({
  fetchFlairForUser: vi.fn(async (username: string) => {
    fetchOrder.push(username);
    return { flair: "banned", postUrl: null, checkedAt: Date.now() };
  }),
  RateLimitedError: class RateLimitedError extends Error {
    retryAfterMs: number | null;
    constructor(retryAfterMs: number | null) {
      super("rate limited");
      this.retryAfterMs = retryAfterMs;
    }
  },
}));

let chromeMock: ChromeMock;

async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("background queue ordering", () => {
  beforeEach(async () => {
    vi.resetModules();
    fetchOrder.length = 0;
    chromeMock = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);

    // Pre-seed a stale cache entry so "staleuser" is a refresh-queue candidate.
    const twoHoursAgo = Date.now() - 2 * 3_600_000;
    await chromeMock.storage.local.set({
      "flair:staleuser": { flair: "pending", postUrl: null, checkedAt: twoHoursAgo },
    });

    await import("../src/background");
    await flushMicrotasks();
  });

  it("drains the priority queue (never-seen users) before the refresh queue (stale users)", async () => {
    const listener = chromeMock._internal.onMessageListeners[0];
    expect(listener).toBeTruthy();

    const request: CheckUsernamesRequest = {
      type: "check-usernames",
      usernames: ["staleuser", "newuser"],
    };

    let response: CheckUsernamesResponse | undefined;
    listener!(request, { tab: { id: 1 } }, (r: CheckUsernamesResponse) => {
      response = r;
    });

    // The stale entry must be served immediately, without waiting on the queue.
    await flushMicrotasks();
    expect(response?.results.staleuser).toMatchObject({ flair: "pending", isStale: true });
    expect(response?.results.newuser).toBeUndefined();

    await waitFor(() => fetchOrder.length === 2);
    expect(fetchOrder).toEqual(["newuser", "staleuser"]);
  });
});
