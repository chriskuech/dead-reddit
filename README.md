# Dead Reddit

A browser extension that flags and blocks bots on Reddit.

## Why

There's a theory that the internet, or large parts of it, is no longer mostly
made of people — that bot accounts, generated content, and coordinated
inauthentic activity now make up a huge and growing share of what you scroll
past every day, dressed up to look like a person posted it. Reddit is not
immune. Karma-farming bots repost old content for engagement, sock-puppet
networks upvote and reply to each other, and entire subreddits can end up
dominated by accounts that were never a person in the first place. The
comment thread that looks lively might mostly be bots talking to bots.

Dead Reddit doesn't try to solve that problem — it just refuses to pretend it
isn't happening. It surfaces what's already known about an account and gives
you the tools to stop seeing it.

## What it does

Both of the extension's main features are ways of blocking bots — one at the
account level, one at the community level:

1. **Flags individual bot accounts.** Every username you encounter is checked
   against [r/BotBouncer](https://www.reddit.com/r/BotBouncer/), a
   community that classifies Reddit accounts (`banned`, `purged`, `pending`,
   `inactive`, `retired`, `service`, `organic`). A small badge appears next to
   the username showing its classification, and accounts in your filter list
   (bots are filtered by default) are hidden or collapsed automatically.
2. **Blocks bot-overrun subreddits.** A "Block r/‹subreddit›" chip appears
   next to every subreddit name you see. If a community has been taken over
   by bots, one click hides every post from it, immediately and permanently,
   without leaving the page.

Nothing is sent anywhere you didn't already send it — the extension rides
your existing logged-in reddit.com session to look up classifications
directly, with no separate account, API key, or backend server involved.

## Features

- **Bot classification badges** — color-coded pill next to usernames showing
  their BotBouncer flair, with a subtle "stale" indicator while a
  background refresh is in flight.
- **Configurable filtering** — hide flagged accounts entirely, visually
  collapse them, or just show the badge without hiding anything.
- **One-click subreddit blocking** — block a subreddit straight from the
  feed; blocked subreddits are hidden on every subsequent visit.
- **Dashboard page** — a full-page view (opened from the popup) with two
  tabs:
  - **Analyzed Users** — every account the extension has looked up, with its
    classification, when it was last checked, and a link to the source post.
  - **Blocked Subreddits** — every subreddit you've blocked, with a one-click
    unblock button.
- **Popup** — master on/off toggle, a count of flagged accounts on the
  current page, and links to the dashboard and settings.
- **Options page** — pick which classifications to filter, how to filter them
  (hide/collapse/badge-only), cache TTL, request rate limiting, and a
  "clear cache" button.
- **Aggressive caching, low API load** — a stale-while-revalidate cache means
  repeat visits don't re-fetch known-fresh accounts, and a priority queue
  ensures accounts you've never seen before are always checked first.

## Installation

Not yet published to the Chrome Web Store or Firefox AMO — install it as an
unpacked extension for now. Either download `extension.zip` from the
[latest release](https://github.com/chriskuech/dead-reddit/releases/latest)
and unzip it, or build from source:

```bash
npm install
npm run build
```

Then, in Chrome/Edge/Brave:

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the unzipped folder (or the `dist/`
   folder produced by the build)

## Development

```bash
npm run dev         # Vite dev server with HMR for popup/options/dashboard
npm run build        # type-check + production build to dist/
npm run typecheck    # tsc --noEmit
npm test              # run the Vitest suite once
npm run test:watch    # Vitest in watch mode
npm run lint           # ESLint
npm run format          # Prettier --write
```

See [`SPEC.md`](./SPEC.md) for the full design spec — architecture,
caching/queueing model, message protocol, and settings schema.

### CI/CD

- Every PR runs lint, tests, and a production build (`.github/workflows/ci.yml`).
- Every push to `main` builds, zips the extension, and cuts a GitHub release
  with an auto-incrementing version (`.github/workflows/release.yml`).
- Publishing a release submits it to the Chrome Web Store, Edge Add-ons,
  Firefox AMO, and the Mac App Store (`.github/workflows/publish.yml`) — each
  store requires its own secrets, documented inline in the workflow.

## Privacy

- No backend. Everything runs client-side in your browser.
- No telemetry, analytics, or third-party requests beyond Reddit itself.
- Classification lookups are plain `fetch` requests to
  `reddit.com/r/BotBouncer/search.json`, riding your browser's existing
  reddit.com session cookies — no OAuth, no separate credentials.
- Settings and your block lists sync via `chrome.storage.sync`; cached
  classifications are stored locally via `chrome.storage.local`.

## Contributing

Issues and pull requests are welcome. Please run `npm run lint`,
`npm run typecheck`, and `npm test` before opening a PR.
