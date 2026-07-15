# Dead Reddit — Extension Spec

## Overview

Browser extension (Manifest V3) that annotates Reddit usernames on posts/comments with their BotBouncer classification flair, pulled from `/r/BotBouncer` via authenticated fetch riding the user's existing reddit.com session. Supports filtering (hiding) posts/comments by flair category, with `banned` filtered by default.

## Goals

- Zero-config: works immediately using the user's existing logged-in reddit.com session (no OAuth setup).
- Low API load: aggressive caching + batching, no more than necessary requests to `search.json`.
- Resilient to Reddit's frontend DOM churn (new Reddit uses custom elements / shadow DOM).
- Configurable via options page and popup.

## Non-Goals

- No backend/server component — fully client-side.
- No modification of Reddit's own moderation systems — display/filter only, on the client.
- Not a general anti-spam tool — strictly surfaces existing BotBouncer classifications.

---

## Tech Stack

- TypeScript, strict mode
- Manifest V3
- Vite + `@crxjs/vite-plugin` (or `esbuild`) for build tooling
- No frontend framework required for badges (vanilla DOM); options/popup UI can use plain TS + HTML or a tiny framework (Preact) if preferred — default to vanilla.
- `chrome.storage.sync` for settings, `chrome.storage.local` for cache

---

## Permissions (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "Dead Reddit",
  "permissions": ["storage"],
  "host_permissions": ["*://*.reddit.com/*"],
  "content_scripts": [
    {
      "matches": ["*://*.reddit.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html" },
  "options_page": "options.html"
}
```

---

## Data Source

**Endpoint:**

```
GET https://www.reddit.com/r/BotBouncer/search.json?q=author:<username>&restrict_sr=1&sort=new&limit=5
```

- Runs with `credentials: 'include'` — reuses the browser's existing reddit.com cookies, no token handling.
- Response: standard Reddit listing JSON. Each post's `data.link_flair_text` (and/or `data.link_flair_css_class`) holds the classification.
- Take the **most recent** matching submission (`sort=new`, first result) as the current classification.
- Flair values to recognize: `banned`, `inactive`, `organic`, `pending`, `purged`, `retired`, `service`. Unknown/absent → treat as "unclassified" (no submission found).

**Caching model — stale-while-revalidate:**
An expired cache entry is never deleted or cleared to `null`/unknown while a refresh is pending. It stays fully readable and is served to the content script as-is (flagged `isStale: true`) until a background fetch resolves and _overwrites_ it with a new result. Expiry only marks an entry eligible for a refresh — it never invalidates the value shown to the user.

```ts
interface CacheEntry {
  flair: BotBouncerFlair | null;
  postUrl: string | null;
  checkedAt: number; // last successful fetch time
  isStale: boolean; // derived: (Date.now() - checkedAt) > cacheTtlMs
}
```

- TTL: 1 hour (configurable in options, default 3,600,000 ms)
- `cache.ts#get(username)` returns the entry immediately regardless of staleness; the background worker separately decides whether to enqueue a refresh based on `isStale`.

**Queue priority:** the background worker maintains two queues:

- **Priority queue** — usernames never seen before (no cache entry at all)
- **Refresh queue** — usernames with an expired (stale) cache entry

The priority queue is always drained first; the refresh queue is only processed once the priority queue is empty. This guarantees never-before-seen users get a first classification before the worker spends cycles refreshing already-known users.

**Rate limiting:**

- Single request queue processor (or small concurrency, e.g. 2) pulls priority queue first, then refresh queue, with a minimum delay between requests (default 250ms, configurable) to avoid tripping Reddit's rate limiter.
- Content script sends the full list of visible usernames once per DOM-settle cycle (debounced ~300ms after `MutationObserver` fires); background worker filters out usernames already pending in either queue before adding new jobs.

---

## Architecture

```
src/
  content.ts             // DOM scanning, badge injection, filtering, subreddit/user block chips
  background.ts           // service worker: dual queue, fetch, cache, rate limit
  popup.ts / popup.html    // quick toggle + stats, links to options and dashboard
  options.ts / options.html // flair filter settings, cache TTL, rate limit config
  dashboard.ts / dashboard.html // analyzed users + blocked subreddits + blocked users, in three tabs
  lib/
    reddit-api.ts          // fetchFlairForUser(username): Promise<FlairResult>; fetchAuthorsForPostIds(postIds): Promise<Record<string, string | null>>
    cache.ts               // get/set/getAll/prune chrome.storage.local cache (username -> flair)
    post-author-cache.ts    // get/set/prune chrome.storage.local cache (postId -> author)
    settings.ts             // typed settings schema + chrome.storage.sync wrapper
    blocked-subreddits.ts   // block/unblock subreddit list + chrome.storage.sync wrapper
    blocked-users.ts        // block/unblock user list + chrome.storage.sync wrapper
    dom-selectors.ts        // centralized selectors for old/new Reddit, isolated for easy maintenance
    types.ts
  manifest.json
```

### `content.ts` responsibilities

- On load and on `MutationObserver` mutation (debounced), scan the page for author elements using selectors in `dom-selectors.ts`. Support both:
  - New Reddit / Shreddit (custom elements, e.g. `shreddit-post`, attributes like `author`)
  - Old Reddit (`.author` anchor tags)
- Extract unique usernames not yet processed on this page (track via a `WeakSet`/`data-dr-processed` attribute to avoid reprocessing).
- Send batch `{ usernames: string[] }` message to background worker via `chrome.runtime.sendMessage`.
- On response `{ [username]: FlairResult }`:
  - Inject a small badge element next to each username (e.g. `<span class="dr-badge dr-badge--banned">banned</span>`), styled via injected CSS, color-coded per flair.
  - If the post/comment's author's flair is in the user's filter list, hide the element (add a class that sets `display: none`, or collapse — configurable) rather than removing from DOM (so it can be un-hidden if settings change without reload).
- Listen for a follow-up push message from the background worker (`{ username, updatedResult }`) sent when a stale entry's refresh resolves with a changed value, and swap the badge/filter state in place — no page reload needed.
- Re-run scan on Reddit's client-side navigation (SPA route changes) — listen for `popstate` and periodically debounce-check `location.href` changes, since new Reddit doesn't full-reload on navigation.
- Also scan for subreddit elements (old Reddit's `a.subreddit` anchors, new Reddit's `shreddit-post[subreddit-name]`) and inject a "Block r/&lt;subreddit&gt;" chip next to each one. Clicking it adds the subreddit to the blocked list (`lib/blocked-subreddits.ts`, `chrome.storage.sync`) and immediately hides that post's container. Posts from an already-blocked subreddit are hidden on scan, before any click. Deliberately does not fall back to a generic `a[href^="/r/"]` selector, since subreddit links are ubiquitous in sidebars/nav widgets unrelated to any single post.
- Every username element found for the badge also gets a matching "Block u/&lt;username&gt;" chip, inserted right after its badge — same chip styling/behavior as the subreddit chip (`dr-block-chip`), just labeled `u/` instead of `r/`. Clicking it adds the username to the blocked list (`lib/blocked-users.ts`, `chrome.storage.sync`) and immediately hides that post/comment's container. Independent of BotBouncer classification — lets a user hand-block an account regardless of its flair.
- Search result cards (`[data-testid="search-post-unit"]`) don't expose an author anywhere in the DOM — not even in an open shadow root — so neither the badge nor the block-u chip can be built synchronously the way they are on the feed. Instead, `scanSearchAuthors` extracts each card's post id from its title permalink and batch-resolves authors via a `resolve-post-authors` message (see below). Once an author resolves, the badge and block-u chip are created and clustered next to the card's subreddit chip, exactly like the feed.

### `background.ts` responsibilities

- Listen for messages from content scripts. For each requested username:
  1. **No cache entry** → respond nothing yet; enqueue on **priority queue**; respond to the content script once resolved.
  2. **Cache entry exists, fresh** → return immediately, no queue.
  3. **Cache entry exists, stale** → return the stale entry immediately (so the badge/filter renders using last-known status) _and_ enqueue on **refresh queue** for silent revalidation. If the refreshed result differs from the stale one, push an update message to the originating tab's content script to swap state in place.
- Queue processor: always fully drains the priority queue, then the refresh queue, then the **post-author queue** (see below) — all through the same rate-limited/backoff gate, so every reddit.com request the extension makes, regardless of purpose, is serialized behind a single `requestDelayMs` spacing.
- On fetch: call `reddit-api.ts#fetchFlairForUser`, parse response, overwrite the cache entry, respond/push to the relevant tab(s).
- Handle fetch failures (network error, non-200, malformed JSON) gracefully: for entries with no prior cache, cache a short-TTL "unknown" result to avoid hammering on persistent failures; for entries that already had a stale value, leave the existing value in place and simply retry the refresh later rather than overwriting with a failure state.
- **Post-author resolution (`resolve-post-authors` message):** for search result cards, which expose no author in the DOM. Already-cached post ids are returned synchronously; uncached ones are deduped into a `postAuthorQueue`, drained in batches of up to `MAX_POST_AUTHOR_BATCH` (50) via `reddit-api.ts#fetchAuthorsForPostIds` — a single request to Reddit's public `/by_id/t3_&lt;id&gt;,...json` listing endpoint returns every requested post's author at once, rather than one request per post. Resolved authors are cached permanently in `lib/post-author-cache.ts` (pruned on the same 30-day alarm as the flair cache) and pushed to viewing tabs via a `post-author-resolved` message, mirroring the `flair-updated` push for stale-refresh. A `[deleted]` author, or a post id `/by_id` doesn't return at all, resolves to `null` and gets no badge/chip.

### `lib/reddit-api.ts`

```ts
export interface FlairResult {
  flair: BotBouncerFlair | null; // null = no submission found / unclassified
  postUrl: string | null;
  checkedAt: number;
}

export type BotBouncerFlair =
  "banned" | "inactive" | "organic" | "pending" | "purged" | "retired" | "service";

export async function fetchFlairForUser(username: string): Promise<FlairResult>;
```

- Normalizes flair text/css-class to the `BotBouncerFlair` union (case-insensitive match against known values; anything else → `null`).

---

## Settings Schema (`chrome.storage.sync`)

```ts
interface Settings {
  enabled: boolean; // master on/off
  filteredFlairs: BotBouncerFlair[]; // default: ["banned"]
  filterAction: "hide" | "collapse" | "badge-only"; // default: "hide"
  badgeColors: Record<BotBouncerFlair, string>; // default palette
  cacheTtlMs: number; // default: 3_600_000
  requestDelayMs: number; // default: 250
  showUnclassifiedBadge: boolean; // default: false (don't clutter unclassified users)
}
```

## Options Page UI

- Toggle extension on/off
- Multi-select checklist of the 7 flair categories, each with hide/show toggle (default: only `banned` checked as hidden)
- Dropdown: filter action (hide entirely / visually collapse / badge only, never hide)
- Cache TTL input (minutes)
- Request delay input (ms)
- "Clear cache" button
- Stats: cache size, last sync time, count of entries currently stale/pending refresh

## Popup UI

- Quick master enable/disable toggle
- Count of flagged users seen on current page (this session)
- Link to options page
- Link to dashboard page (opens `dashboard.html` in a new tab)

## Dashboard Page UI

Opened via the popup's "Dashboard" button (`chrome.tabs.create` to `dashboard.html`), not the options page. Three tabs:

- **Analyzed Users** — every cached username (`cache.ts#getAll`) with its flair, checked-at time, fresh/stale status, and a link to the BotBouncer post that produced the classification.
- **Blocked Subreddits** — every entry in `lib/blocked-subreddits.ts`, with blocked-at time and an "Unblock" button that removes it from the list.
- **Blocked Users** — every entry in `lib/blocked-users.ts`, with blocked-at time and an "Unblock" button that removes it from the list. Separate from the BotBouncer-classified "Analyzed Users" tab — this is the user's own hand-picked block list.

---

## Badge Design

- Small pill next to username, e.g. `u/someuser [BOT: banned]`
- Color coding (suggested):
  - `banned` — red
  - `purged` — dark red
  - `pending` — amber
  - `inactive` — gray
  - `retired` — slate
  - `service` — blue
  - `organic` — green (optional — arguably noise; consider `showOrganicBadge` toggle off by default to reduce visual clutter)
- Optional subtle visual indicator (e.g. reduced opacity or a small "refreshing" dot) on badges currently showing a stale value pending revalidation — nice-to-have, not required for v1.

---

## Edge Cases & Error Handling

- Deleted/suspended accounts: `search.json` may 404 or return empty — treat as unclassified, don't retry aggressively (short negative-cache TTL, e.g. 10 min).
- Reddit logged-out state: cookies absent → `search.json` still works (public endpoint) but may be more aggressively rate-limited; detect repeated 429s and back off exponentially, surface a warning in the popup ("Rate limited, retrying in Ns").
- Username edge cases: `[deleted]`, bots with special chars, case sensitivity — normalize to lowercase for cache keys, skip `[deleted]`.
- SPA navigation on new Reddit: ensure content script doesn't leak observers/listeners across page transitions (disconnect and reconnect `MutationObserver` on navigation).
- Multiple tabs open: background worker cache is shared (storage.local), so second tab benefits from first tab's lookups; a push update from a refresh should broadcast to all tabs currently displaying that username, not just the tab that triggered it.
- Failed refresh of a stale entry must never regress the displayed value to unknown — always leave last-known-good value in place and simply reschedule the refresh attempt.

---

## Build & Package

- `npm run dev` — Vite dev server with HMR for popup/options/dashboard, extension reload for content/background
- `npm run build` — production build → `dist/` loadable as unpacked extension, or zip for store submission
- ESLint + Prettier, strict TS config (`strict: true`, `noUncheckedIndexedAccess: true`)

## CI/CD (`.github/workflows/`)

- **`ci.yml`** — on every PR to `main`: `npm ci`, lint, test, build. Acts as the merge gate.
- **`release.yml`** — on every push to `main`: reruns test + build, computes the next release
  version, zips `dist/` into `extension.zip`, and cuts a GitHub release. `src/manifest.json`'s
  `version` field holds only the major version (e.g. `"0"`); the workflow appends an
  auto-incrementing minor by counting existing `v<major>.*` release tags, so bumping the major
  in `manifest.json` is the only manual version step. `dist/manifest.json` is stamped with the
  full computed version at release time — `src/manifest.json` itself is never modified.
- **`publish.yml`** — on GitHub release publish (or manual dispatch with a tag): downloads that
  release's `extension.zip` and submits it to the Chrome Web Store, Edge Add-ons, Firefox AMO,
  and the Mac App Store (Safari). Each store's job is independent and requires its own secrets
  (documented inline in the workflow) before it will succeed — until configured, the job simply
  fails without blocking the others.

## Testing

- Unit tests (Vitest) for `reddit-api.ts` (mock `fetch`), `cache.ts` (including stale-serve + priority/refresh queue ordering), flair-normalization logic
- Manual test checklist: old Reddit, new Reddit (shreddit), logged-in vs logged-out, SPA navigation, settings persistence across reload, stale badge displaying while refresh is in flight

## Acceptance Criteria

1. Loading reddit.com with the extension on shows badges next to usernames with known BotBouncer classifications within a few seconds of scroll/page load.
2. Users flaired `banned` are hidden by default; toggling filter settings updates visibility without page reload.
3. No more than 1 request per ~250ms leaves the background worker; repeat visits to the same page don't refetch cached (fresh) usernames.
4. Extension works on both old.reddit.com and new Reddit (www.reddit.com) layouts.
5. No use of Reddit OAuth tokens or credential extraction — relies solely on ambient cookie auth via `fetch`.
6. A user with no cache entry is always checked before the worker processes any stale-refresh work already queued.
7. A user with an expired cache entry continues to display their last-known flair (and filtering continues to apply based on it) until a refresh completes — it never flashes to "unclassified" during revalidation.
