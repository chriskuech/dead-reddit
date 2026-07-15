/**
 * Centralizes DOM lookups for both old.reddit.com (server-rendered `.thing`/`.author`
 * markup) and new Reddit / Shreddit (custom elements with an `author` attribute), so
 * frontend DOM churn only needs to be chased down in one place.
 */

export interface AuthorMatch {
  username: string;
  /** Element the badge should be inserted next to. */
  anchorElement: Element;
  /** Post/comment container to hide or collapse when filtering. */
  containerElement: Element;
  /** Element to tag as processed, preventing reprocessing on subsequent scans. */
  markerElement: Element;
}

const PROCESSED_ATTR = "data-dr-processed";
const PROCESSED_SUBREDDIT_ATTR = "data-dr-sub-processed";

const OLD_REDDIT_AUTHOR_SELECTOR = "a.author";
const OLD_REDDIT_CONTAINER_SELECTOR = ".thing, .Comment";
const OLD_REDDIT_SUBREDDIT_SELECTOR = "a.subreddit";

const SHREDDIT_HOST_SELECTOR =
  "shreddit-post, shreddit-comment, shreddit-profile-comment, shreddit-profile-post, shreddit-async-loader";
const SHREDDIT_AUTHOR_HOST_SELECTOR = "shreddit-post[author], shreddit-comment[author]";
const SHREDDIT_SUBREDDIT_HOST_SELECTOR =
  "shreddit-post[subreddit-name], shreddit-post[subreddit-prefixed-name]";

const GENERIC_USER_LINK_SELECTOR = 'a[href^="/user/"], a[href^="/u/"]';
const GENERIC_SUBREDDIT_LINK_SELECTOR = 'a[href^="/r/"]';

export function isProcessed(el: Element): boolean {
  return el.hasAttribute(PROCESSED_ATTR);
}

export function markProcessed(el: Element): void {
  el.setAttribute(PROCESSED_ATTR, "1");
}

export function isSubredditProcessed(el: Element): boolean {
  return el.hasAttribute(PROCESSED_SUBREDDIT_ATTR);
}

export function markSubredditProcessed(el: Element): void {
  el.setAttribute(PROCESSED_SUBREDDIT_ATTR, "1");
}

function isDeletedUsername(username: string): boolean {
  return username.length === 0 || username.toLowerCase() === "[deleted]";
}

function extractUsernameFromHref(href: string): string | null {
  const match = /\/u(?:ser)?\/([^/?#]+)/i.exec(href);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function extractSubredditFromHref(href: string): string | null {
  const match = /\/r\/([^/?#]+)/i.exec(href);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function findContainer(el: Element): Element {
  return (
    el.closest(OLD_REDDIT_CONTAINER_SELECTOR) ??
    el.closest(SHREDDIT_HOST_SELECTOR) ??
    el.parentElement ??
    el
  );
}

/** Queries `selector` within `root`, including `root` itself when it's an Element that matches. */
function queryAllInclusive(root: ParentNode, selector: string): Element[] {
  const results: Element[] = [];
  if (root instanceof Element && root.matches(selector)) {
    results.push(root);
  }
  results.push(...Array.from(root.querySelectorAll(selector)));
  return results;
}

/**
 * Scans `root` for username-bearing elements not yet marked processed, covering old
 * Reddit's `.author` anchors, Shreddit custom elements exposing an `author` attribute,
 * and a generic `/user/<name>` link fallback for anything else (profile pages, inbox, etc).
 */
export function findAuthorElements(root: ParentNode): AuthorMatch[] {
  const matches: AuthorMatch[] = [];
  const claimed = new Set<Element>();

  for (const el of queryAllInclusive(root, OLD_REDDIT_AUTHOR_SELECTOR)) {
    if (isProcessed(el) || claimed.has(el)) continue;
    const username = el.textContent?.trim().replace(/^u\//i, "") ?? "";
    if (isDeletedUsername(username)) continue;
    claimed.add(el);
    matches.push({
      username,
      anchorElement: el,
      containerElement: findContainer(el),
      markerElement: el,
    });
  }

  for (const host of queryAllInclusive(root, SHREDDIT_AUTHOR_HOST_SELECTOR)) {
    if (isProcessed(host) || claimed.has(host)) continue;
    const username = host.getAttribute("author")?.trim() ?? "";
    if (isDeletedUsername(username)) continue;
    const anchor =
      host.querySelector('a[slot="authorName"]') ??
      host.querySelector(GENERIC_USER_LINK_SELECTOR) ??
      host.shadowRoot?.querySelector(GENERIC_USER_LINK_SELECTOR) ??
      host;
    claimed.add(host);
    matches.push({
      username,
      anchorElement: anchor,
      containerElement: host,
      markerElement: host,
    });
  }

  for (const el of queryAllInclusive(root, GENERIC_USER_LINK_SELECTOR)) {
    if (isProcessed(el) || claimed.has(el)) continue;
    if (el.closest(SHREDDIT_AUTHOR_HOST_SELECTOR)) continue; // already covered above
    const href = el.getAttribute("href");
    const username = href ? extractUsernameFromHref(href) : null;
    if (!username || isDeletedUsername(username)) continue;
    claimed.add(el);
    matches.push({
      username,
      anchorElement: el,
      containerElement: findContainer(el),
      markerElement: el,
    });
  }

  return matches;
}

export interface SubredditMatch {
  /** No "r/" prefix, original casing. */
  subreddit: string;
  /** Element the block chip should be inserted next to. */
  anchorElement: Element;
  /** Post/comment container to hide when the subreddit is blocked. */
  containerElement: Element;
  /** Element to tag as processed, preventing reprocessing on subsequent scans. */
  markerElement: Element;
}

/**
 * Scans `root` for subreddit-bearing elements not yet marked processed, covering old
 * Reddit's `.subreddit` anchors and Shreddit posts exposing a `subreddit-name` attribute.
 * Deliberately does not fall back to a generic `a[href^="/r/"]` selector — subreddit
 * links are ubiquitous in sidebars/nav widgets unrelated to any single post.
 */
export function findSubredditElements(root: ParentNode): SubredditMatch[] {
  const matches: SubredditMatch[] = [];
  const claimed = new Set<Element>();

  for (const host of queryAllInclusive(root, SHREDDIT_SUBREDDIT_HOST_SELECTOR)) {
    if (isSubredditProcessed(host) || claimed.has(host)) continue;
    const subreddit =
      host.getAttribute("subreddit-name")?.trim() ||
      host.getAttribute("subreddit-prefixed-name")?.trim().replace(/^r\//i, "") ||
      "";
    if (!subreddit) continue;
    const anchor =
      host.querySelector(GENERIC_SUBREDDIT_LINK_SELECTOR) ??
      host.shadowRoot?.querySelector(GENERIC_SUBREDDIT_LINK_SELECTOR) ??
      host;
    claimed.add(host);
    matches.push({
      subreddit,
      anchorElement: anchor,
      containerElement: host,
      markerElement: host,
    });
  }

  for (const el of queryAllInclusive(root, OLD_REDDIT_SUBREDDIT_SELECTOR)) {
    if (isSubredditProcessed(el) || claimed.has(el)) continue;
    const href = el.getAttribute("href");
    const subreddit = href
      ? extractSubredditFromHref(href)
      : (el.textContent?.trim().replace(/^r\//i, "") ?? "");
    if (!subreddit) continue;
    claimed.add(el);
    matches.push({
      subreddit,
      anchorElement: el,
      containerElement: findContainer(el),
      markerElement: el,
    });
  }

  return matches;
}
