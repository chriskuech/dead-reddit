import { describe, expect, it } from "vitest";
import {
  findSubredditElements,
  isSubredditProcessed,
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

  it("extracts the subreddit from a shreddit-post subreddit-name attribute", () => {
    document.body.innerHTML = `
      <shreddit-post subreddit-name="funny" subreddit-prefixed-name="r/funny">
        <a href="/r/funny/">r/funny</a>
      </shreddit-post>
    `;
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
});
