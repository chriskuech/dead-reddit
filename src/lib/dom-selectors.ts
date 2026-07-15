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
const PROCESSED_SEARCH_AUTHOR_ATTR = "data-dr-search-author-processed";
/** Counts scans where a post's credit bar/timeago wasn't found yet, so we can give late-hydrating content a few more passes before settling for a worse fallback anchor. */
const CREDIT_BAR_ATTEMPTS_ATTR = "data-dr-credit-bar-attempts";
const MAX_CREDIT_BAR_ATTEMPTS = 5;

const OLD_REDDIT_AUTHOR_SELECTOR = "a.author";
const OLD_REDDIT_CONTAINER_SELECTOR = ".thing, .Comment";
const OLD_REDDIT_SUBREDDIT_SELECTOR = "a.subreddit";

const SHREDDIT_HOST_SELECTOR =
  "shreddit-post, shreddit-comment, shreddit-profile-comment, shreddit-profile-post, shreddit-async-loader";
const SHREDDIT_AUTHOR_HOST_SELECTOR = "shreddit-post[author], shreddit-comment[author]";
const SHREDDIT_SUBREDDIT_HOST_SELECTOR =
  "shreddit-post[subreddit-name], shreddit-post[subreddit-prefixed-name]";
/** Search results render posts as a plain div (no shreddit-post host) tagged with this testid. */
const SEARCH_POST_UNIT_SELECTOR = '[data-testid="search-post-unit"]';
/** The permalink on a search result's title — the only place its post id is exposed. */
const SEARCH_POST_TITLE_LINK_SELECTOR = '[data-testid="post-title"]';

/** The top metadata row of a feed post (subreddit name, timestamp, join button). */
const HOME_CREDIT_BAR_SELECTOR = '[slot="credit-bar"]';
/** The equivalent metadata row on a search result. */
const SEARCH_CREDIT_BAR_SELECTOR = ".post-credit-row";
/**
 * The "x ago" timestamp within a credit bar. Anchoring the chip immediately after this
 * element (matching the approach used by the Advanced Reddit Filters extension) puts it in
 * the top metadata row next to the timestamp, and is stable against async-loaded content
 * elsewhere in the post (media, recommendations, hovercard partials) that would otherwise
 * shift a host-level fallback insertion around non-deterministically.
 */
const CREDIT_BAR_TIME_SELECTOR = "faceplate-timeago, time";

function findCreditBarTimeAnchor(host: Element, creditBarSelector: string): Element | null {
  const creditBar = deepQuerySelector(host, creditBarSelector);
  return (creditBar && deepQuerySelector(creditBar, CREDIT_BAR_TIME_SELECTOR)) ?? null;
}

/**
 * Like Element.querySelector, but also descends into open shadow roots. Reddit's newer
 * components (e.g. the SDUI-based search result cards) keep some of their content inside an
 * open shadow root rather than assigning it to a light-DOM slot, where a plain querySelector
 * can't see it. Closed shadow roots are still unreachable — there's no workaround for those
 * from a content script.
 */
function deepQuerySelector(root: ParentNode, selector: string): Element | null {
  if (root instanceof Element && root.shadowRoot) {
    const inOwnShadow = deepQuerySelector(root.shadowRoot, selector);
    if (inOwnShadow) return inOwnShadow;
  }
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.shadowRoot) {
      const found = deepQuerySelector(el.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

const GENERIC_USER_LINK_SELECTOR = 'a[href^="/user/"], a[href^="/u/"]';
const GENERIC_SUBREDDIT_LINK_SELECTOR = 'a[href^="/r/"]';
/**
 * Reddit wraps the community-name link in this hovercard trigger on both feed posts and
 * search results, and its href is reliably scoped to the community (unlike other /r/-prefixed
 * links in the same card, e.g. the post-title/permalink overlay). Newer feed markup also renders
 * this link with an absolute https://www.reddit.com/... href instead of a relative one, so it
 * won't match GENERIC_SUBREDDIT_LINK_SELECTOR at all — this selector is host-agnostic.
 */
const COMMUNITY_HOVERCARD_LINK_SELECTOR = 'faceplate-hovercard[data-id="community-hover-card"] a';

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

export function isSearchAuthorProcessed(el: Element): boolean {
  return el.hasAttribute(PROCESSED_SEARCH_AUTHOR_ATTR);
}

export function markSearchAuthorProcessed(el: Element): void {
  el.setAttribute(PROCESSED_SEARCH_AUTHOR_ATTR, "1");
}

/**
 * Returns true (and records the attempt) if `host` should be skipped this scan to give its
 * credit bar/timeago more time to render, rather than committing permanently to a worse
 * fallback anchor. After MAX_CREDIT_BAR_ATTEMPTS scans, returns false so the caller proceeds
 * with whatever fallback it has — some post types may never render a credit bar at all.
 */
function deferForCreditBar(host: Element): boolean {
  const attempts = Number(host.getAttribute(CREDIT_BAR_ATTEMPTS_ATTR) ?? "0");
  if (attempts >= MAX_CREDIT_BAR_ATTEMPTS) return false;
  host.setAttribute(CREDIT_BAR_ATTEMPTS_ATTR, String(attempts + 1));
  return true;
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

function extractPostIdFromHref(href: string): string | null {
  const match = /\/comments\/([a-z0-9]+)/i.exec(href);
  return match?.[1] ?? null;
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

  const feedHosts = queryAllInclusive(root, SHREDDIT_SUBREDDIT_HOST_SELECTOR);
  const searchHosts = queryAllInclusive(root, SEARCH_POST_UNIT_SELECTOR);

  for (const host of feedHosts) {
    if (isSubredditProcessed(host) || claimed.has(host)) continue;
    const subreddit =
      host.getAttribute("subreddit-name")?.trim() ||
      host.getAttribute("subreddit-prefixed-name")?.trim().replace(/^r\//i, "") ||
      "";
    if (!subreddit) continue;

    const creditBarAnchor = findCreditBarTimeAnchor(host, HOME_CREDIT_BAR_SELECTOR);
    if (!creditBarAnchor && deferForCreditBar(host)) continue;

    const anchor =
      creditBarAnchor ??
      deepQuerySelector(host, COMMUNITY_HOVERCARD_LINK_SELECTOR) ??
      deepQuerySelector(host, GENERIC_SUBREDDIT_LINK_SELECTOR) ??
      host;
    claimed.add(host);
    matches.push({
      subreddit,
      anchorElement: anchor,
      containerElement: host,
      markerElement: host,
    });
  }

  // Search results have no shreddit-post host at all — posts are a plain div carrying only
  // a data-testid, so the community link (inside its hovercard trigger) is the sole source
  // of the subreddit name.
  for (const host of searchHosts) {
    if (isSubredditProcessed(host) || claimed.has(host)) continue;
    const hovercardAnchor = deepQuerySelector(host, COMMUNITY_HOVERCARD_LINK_SELECTOR);
    const href = hovercardAnchor?.getAttribute("href");
    const subreddit = href ? extractSubredditFromHref(href) : null;
    if (!hovercardAnchor || !subreddit) continue;

    const creditBarAnchor = findCreditBarTimeAnchor(host, SEARCH_CREDIT_BAR_SELECTOR);
    if (!creditBarAnchor && deferForCreditBar(host)) continue;

    claimed.add(host);
    matches.push({
      subreddit,
      anchorElement: creditBarAnchor ?? hovercardAnchor,
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

export interface SearchAuthorTarget {
  /** The post id extracted from its title permalink (no "t3_" prefix). */
  postId: string;
  /** Search-result card whose author needs an async lookup. */
  containerElement: Element;
}

/**
 * Search result cards don't expose their author anywhere in the DOM (unlike the feed, where
 * it's an attribute/link right on the post), so there's no username to read synchronously.
 * This returns each unprocessed card's post id instead, so the caller can batch-resolve
 * authors via Reddit's /by_id endpoint and fill in the badge/block-chip once resolved.
 */
export function findSearchAuthorTargets(root: ParentNode): SearchAuthorTarget[] {
  const targets: SearchAuthorTarget[] = [];
  for (const host of queryAllInclusive(root, SEARCH_POST_UNIT_SELECTOR)) {
    if (isSearchAuthorProcessed(host)) continue;
    const titleLink = deepQuerySelector(host, SEARCH_POST_TITLE_LINK_SELECTOR);
    const href = titleLink?.getAttribute("href");
    const postId = href ? extractPostIdFromHref(href) : null;
    if (!postId) continue;
    targets.push({ postId, containerElement: host });
  }
  return targets;
}
