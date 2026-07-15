import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFlairForUser, RateLimitedError } from "../src/lib/reddit-api";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function listingWithFlair(flairText: string | null, cssClass: string | null = null) {
  return {
    data: {
      children: [
        {
          data: {
            link_flair_text: flairText,
            link_flair_css_class: cssClass,
            permalink: "/r/BotBouncer/comments/abc123/some_post/",
          },
        },
      ],
    },
  };
}

describe("fetchFlairForUser", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests search.json with credentials included and expected query params", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(listingWithFlair("banned")));

    await fetchFlairForUser("someuser");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("https://www.reddit.com/r/BotBouncer/search.json");
    expect(String(url)).toContain("q=author%3Asomeuser");
    expect(String(url)).toContain("restrict_sr=1");
    expect(String(url)).toContain("sort=new");
    expect(options).toMatchObject({ credentials: "include" });
  });

  it("normalizes a recognized flair (case-insensitive)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listingWithFlair("Banned")));
    const result = await fetchFlairForUser("someuser");
    expect(result.flair).toBe("banned");
    expect(result.postUrl).toBe("https://www.reddit.com/r/BotBouncer/comments/abc123/some_post/");
  });

  it("falls back to the css class when flair text is unrecognized", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(listingWithFlair("Some Weird Label", "purged")),
    );
    const result = await fetchFlairForUser("someuser");
    expect(result.flair).toBe("purged");
  });

  it("returns null flair for an unrecognized flair with no matching css class", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(listingWithFlair("literally anything else", "also-unknown")),
    );
    const result = await fetchFlairForUser("someuser");
    expect(result.flair).toBeNull();
  });

  it("treats an empty result set as unclassified", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: { children: [] } }));
    const result = await fetchFlairForUser("someuser");
    expect(result.flair).toBeNull();
    expect(result.postUrl).toBeNull();
  });

  it("treats a 404 (deleted/suspended account) as unclassified", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const result = await fetchFlairForUser("deleted-user");
    expect(result.flair).toBeNull();
  });

  it("throws RateLimitedError on 429, using Retry-After when present", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "30" } }),
    );
    await expect(fetchFlairForUser("someuser")).rejects.toBeInstanceOf(RateLimitedError);
    try {
      await fetchFlairForUser("someuser");
    } catch (error) {
      expect((error as RateLimitedError).retryAfterMs).toBe(30_000);
    }
  });

  it("throws on other non-200 statuses", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    await expect(fetchFlairForUser("someuser")).rejects.toThrow();
  });

  it("throws on malformed JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(fetchFlairForUser("someuser")).rejects.toThrow();
  });
});
