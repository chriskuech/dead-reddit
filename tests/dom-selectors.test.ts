import { describe, expect, it } from "vitest";
import {
  findSearchAuthorTargets,
  findSubredditElements,
  isSearchAuthorProcessed,
  isSubredditProcessed,
  markSearchAuthorProcessed,
  markSubredditProcessed,
} from "../src/lib/dom-selectors";

describe("findSubredditElements", () => {
  it("extracts the subreddit from an old-Reddit a.subreddit anchor", () => {
    document.body.innerHTML = `
      <div class="thing">
        <a class="subreddit" href="/r/aww/">r/aww</a>
      </div>
    `;
    const matches = findSubredditElements(document.body);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ subreddit: "aww" });
  });

  it("extracts the subreddit from a shreddit-post subreddit-name attribute, once credit-bar retries are exhausted", () => {
    document.body.innerHTML = `
      <shreddit-post subreddit-name="funny" subreddit-prefixed-name="r/funny">
        <a href="/r/funny/">r/funny</a>
      </shreddit-post>
    `;
    // No credit bar/timeago in this fixture, so the match is deferred a few scans
    // (simulating late-hydrating content) before falling back to the generic link.
    for (let i = 0; i < 5; i++) {
      expect(findSubredditElements(document.body)).toHaveLength(0);
    }
    const matches = findSubredditElements(document.body);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ subreddit: "funny" });
  });

  it("does not re-match elements already marked processed", () => {
    document.body.innerHTML = `<a class="subreddit" href="/r/aww/">r/aww</a>`;
    const [first] = findSubredditElements(document.body);
    expect(first).toBeDefined();
    markSubredditProcessed(first!.markerElement);

    expect(isSubredditProcessed(first!.markerElement)).toBe(true);
    expect(findSubredditElements(document.body)).toHaveLength(0);
  });

  it("ignores generic /r/ links outside of a.subreddit or shreddit-post (e.g. sidebar widgets)", () => {
    document.body.innerHTML = `
      <div class="sidebar">
        <a href="/r/someunrelatedsub/">r/someunrelatedsub</a>
      </div>
    `;
    expect(findSubredditElements(document.body)).toHaveLength(0);
  });

  it("anchors the chip on the community hovercard link when the shreddit-post credit bar uses an absolute href", () => {
    document.body.innerHTML = `
      <shreddit-post subreddit-name="funny" subreddit-prefixed-name="r/funny">
        <a data-ks-id="full-post-link" href="https://www.reddit.com/r/funny/comments/abc/title/">full post</a>
        <faceplate-hovercard data-id="community-hover-card" label="r/funny">
          <a data-testid="subreddit-name" href="https://www.reddit.com/r/funny/">r/funny</a>
        </faceplate-hovercard>
      </shreddit-post>
    `;
    // No credit bar/timeago in this fixture, so retries are exhausted before falling back.
    for (let i = 0; i < 5; i++) {
      expect(findSubredditElements(document.body)).toHaveLength(0);
    }
    const matches = findSubredditElements(document.body);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ subreddit: "funny" });
    expect(matches[0]!.anchorElement.getAttribute("data-testid")).toBe("subreddit-name");
  });

  it("extracts the subreddit from a search results post unit via its community hovercard link", () => {
    document.body.innerHTML = `
      <div data-testid="search-post-unit">
        <a data-testid="post-title" href="/r/FloridaHookups/comments/123/title/">post title</a>
        <faceplate-hovercard data-id="community-hover-card" label="r/FloridaHookups">
          <a href="/r/FloridaHookups/">r/FloridaHookups</a>
        </faceplate-hovercard>
      </div>
    `;
    // No credit bar/timeago in this fixture, so retries are exhausted before falling back.
    for (let i = 0; i < 5; i++) {
      expect(findSubredditElements(document.body)).toHaveLength(0);
    }
    const matches = findSubredditElements(document.body);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ subreddit: "FloridaHookups" });
    expect(matches[0]!.anchorElement.getAttribute("data-testid")).toBeNull();
  });

  it("anchors the chip on the credit bar's timeago element when present, on the feed", () => {
    document.body.innerHTML = `
      <shreddit-post subreddit-name="funny" subreddit-prefixed-name="r/funny">
        <span slot="credit-bar" class="flex justify-between">
          <span id="feed-post-credit-bar-t3_x" class="flex items-center">
            <faceplate-hovercard data-id="community-hover-card" label="r/funny">
              <a data-testid="subreddit-name" href="https://www.reddit.com/r/funny/">r/funny</a>
            </faceplate-hovercard>
            <faceplate-timeago ts="2026-07-15T03:12:59.159000+0000">
              <time datetime="2026-07-15T03:12:59.159Z">24 min. ago</time>
            </faceplate-timeago>
          </span>
        </span>
      </shreddit-post>
    `;
    const matches = findSubredditElements(document.body);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ subreddit: "funny" });
    expect(matches[0]!.anchorElement.tagName.toLowerCase()).toBe("faceplate-timeago");
  });

  it("anchors the chip on the credit bar's timeago element when present, on search results", () => {
    document.body.innerHTML = `
      <div data-testid="search-post-unit">
        <a data-testid="post-title" href="/r/FloridaHookups/comments/123/title/">post title</a>
        <div class="post-credit-row flex items-center">
          <faceplate-hovercard data-id="community-hover-card" label="r/FloridaHookups">
            <a href="/r/FloridaHookups/">r/FloridaHookups</a>
          </faceplate-hovercard>
          <faceplate-timeago ts="2026-07-15T03:22:00.482000+0000">
            <time datetime="2026-07-15T03:22:00.482Z">18m ago</time>
          </faceplate-timeago>
        </div>
      </div>
    `;
    const matches = findSubredditElements(document.body);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ subreddit: "FloridaHookups" });
    expect(matches[0]!.anchorElement.tagName.toLowerCase()).toBe("faceplate-timeago");
  });

  it("picks up a credit bar that hydrates in after the first couple of scans, instead of committing to the fallback", () => {
    document.body.innerHTML = `
      <shreddit-post subreddit-name="funny" subreddit-prefixed-name="r/funny">
        <faceplate-hovercard data-id="community-hover-card" label="r/funny">
          <a data-testid="subreddit-name" href="https://www.reddit.com/r/funny/">r/funny</a>
        </faceplate-hovercard>
      </shreddit-post>
    `;
    // No credit bar yet on the first two scans.
    expect(findSubredditElements(document.body)).toHaveLength(0);
    expect(findSubredditElements(document.body)).toHaveLength(0);

    // The credit bar (with its timeago) hydrates in.
    const post = document.querySelector("shreddit-post")!;
    post.insertAdjacentHTML(
      "beforeend",
      `<span slot="credit-bar"><faceplate-timeago ts="2026-07-15T03:12:59.159000+0000"></faceplate-timeago></span>`,
    );

    const matches = findSubredditElements(document.body);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ subreddit: "funny" });
    expect(matches[0]!.anchorElement.tagName.toLowerCase()).toBe("faceplate-timeago");
  });

  it("pierces an open shadow root to find the credit bar (e.g. SDUI search cards)", () => {
    document.body.innerHTML = `<div data-testid="search-post-unit"></div>`;
    const host = document.querySelector('[data-testid="search-post-unit"]')!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <a data-testid="post-title" href="/r/FloridaHookups/comments/123/title/">post title</a>
      <div class="post-credit-row">
        <faceplate-hovercard data-id="community-hover-card" label="r/FloridaHookups">
          <a href="/r/FloridaHookups/">r/FloridaHookups</a>
        </faceplate-hovercard>
        <faceplate-timeago ts="2026-07-15T03:22:00.482000+0000"></faceplate-timeago>
      </div>
    `;

    const matches = findSubredditElements(document.body);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ subreddit: "FloridaHookups" });
    expect(matches[0]!.anchorElement.tagName.toLowerCase()).toBe("faceplate-timeago");
  });
});

describe("findSearchAuthorTargets", () => {
  it("extracts the post id from a search result's title permalink", () => {
    document.body.innerHTML = `
      <div data-testid="search-post-unit">
        <a data-testid="post-title" href="/r/FloridaHookups/comments/abc123/some_title/">post title</a>
      </div>
    `;
    const targets = findSearchAuthorTargets(document.body);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ postId: "abc123" });
  });

  it("finds the title link inside an open shadow root (SDUI search cards)", () => {
    document.body.innerHTML = `<div data-testid="search-post-unit"></div>`;
    const host = document.querySelector('[data-testid="search-post-unit"]')!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<a data-testid="post-title" href="/r/aww/comments/xyz789/title/">post title</a>`;

    const targets = findSearchAuthorTargets(document.body);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ postId: "xyz789" });
  });

  it("skips a card with no resolvable post id", () => {
    document.body.innerHTML = `<div data-testid="search-post-unit"></div>`;
    expect(findSearchAuthorTargets(document.body)).toHaveLength(0);
  });

  it("skips cards already marked search-author-processed", () => {
    document.body.innerHTML = `
      <div data-testid="search-post-unit">
        <a data-testid="post-title" href="/r/aww/comments/abc123/title/">post title</a>
      </div>
    `;
    const host = document.querySelector('[data-testid="search-post-unit"]')!;
    expect(isSearchAuthorProcessed(host)).toBe(false);
    markSearchAuthorProcessed(host);
    expect(isSearchAuthorProcessed(host)).toBe(true);
    expect(findSearchAuthorTargets(document.body)).toHaveLength(0);
  });
});
