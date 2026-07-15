import {
  findAuthorElements,
  findSubredditElements,
  markProcessed,
  markSubredditProcessed,
  type AuthorMatch,
  type SubredditMatch,
} from "./lib/dom-selectors";
import { getSettings, onSettingsChanged } from "./lib/settings";
import {
  blockSubreddit,
  getBlockedSubreddits,
  normalizeSubreddit,
  onBlockedSubredditsChanged,
} from "./lib/blocked-subreddits";
import {
  DEFAULT_SETTINGS,
  type CacheEntryWithStaleness,
  type CheckUsernamesRequest,
  type CheckUsernamesResponse,
  type FlairUpdatedPush,
  type PageStats,
  type Settings,
} from "./lib/types";

const STYLE_ID = "dr-styles";
const BADGE_CLASS = "dr-badge";
const STALE_CLASS = "dr-badge--stale";
const HIDDEN_CLASS = "dr-hidden";
const COLLAPSED_CLASS = "dr-collapsed";
const BLOCK_CHIP_CLASS = "dr-block-chip";
const SUB_BLOCKED_CLASS = "dr-sub-blocked";
const SCAN_DEBOUNCE_MS = 300;
const NAV_POLL_MS = 1000;

const STYLES = `
.${BADGE_CLASS} {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  color: #fff;
  vertical-align: middle;
  white-space: nowrap;
}
.${STALE_CLASS} {
  opacity: 0.55;
}
.${HIDDEN_CLASS} {
  display: none !important;
}
.${COLLAPSED_CLASS} {
  max-height: 2.5em !important;
  overflow: hidden !important;
  opacity: 0.5;
}
.${BLOCK_CHIP_CLASS} {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  color: #c0392b;
  background: transparent;
  border: 1px solid #c0392b;
  cursor: pointer;
  vertical-align: middle;
  white-space: nowrap;
}
.${BLOCK_CHIP_CLASS}:hover {
  background: #c0392b;
  color: #fff;
}
.${SUB_BLOCKED_CLASS} {
  display: none !important;
}
`;

interface BadgeRecord {
  username: string;
  badgeEl: HTMLSpanElement;
  containerEl: Element;
}

interface SubredditRecord {
  subreddit: string;
  chipEl: HTMLButtonElement;
  containerEl: Element;
}

/** username -> every badge/container pair currently on the page for that user. */
const records = new Map<string, BadgeRecord[]>();
/** Usernames whose current flair matched the active filter list, this tab session. */
const flaggedUsernames = new Set<string>();
/** subreddit -> every block-chip/container pair currently on the page for that subreddit. */
const subredditRecords = new Map<string, SubredditRecord[]>();
/** Normalized subreddit names currently on the user's block list. */
const blockedSubreddits = new Set<string>();

let currentSettings: Settings = DEFAULT_SETTINGS;
let observer: MutationObserver | null = null;
let scanTimeout: number | undefined;
let currentUrl = location.href;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.documentElement.appendChild(style);
}

function applyRecord(record: BadgeRecord, entry: CacheEntryWithStaleness): void {
  const { badgeEl, containerEl, username } = record;

  if (!currentSettings.enabled) {
    badgeEl.style.display = "none";
    containerEl.classList.remove(HIDDEN_CLASS, COLLAPSED_CLASS);
    return;
  }

  const flair = entry.flair;
  const shouldShowBadge =
    flair === null
      ? currentSettings.showUnclassifiedBadge
      : flair !== "organic" || currentSettings.showOrganicBadge;

  if (shouldShowBadge) {
    badgeEl.textContent = flair ? `BOT: ${flair}` : "unclassified";
    badgeEl.className = `${BADGE_CLASS}${entry.isStale ? ` ${STALE_CLASS}` : ""}`;
    badgeEl.style.display = "";
    badgeEl.style.backgroundColor = flair ? currentSettings.badgeColors[flair] : "#95a5a6";
  } else {
    badgeEl.style.display = "none";
  }

  containerEl.classList.remove(HIDDEN_CLASS, COLLAPSED_CLASS);
  const isFiltered = flair !== null && currentSettings.filteredFlairs.includes(flair);
  if (isFiltered) {
    flaggedUsernames.add(username);
    if (currentSettings.filterAction === "hide") {
      containerEl.classList.add(HIDDEN_CLASS);
    } else if (currentSettings.filterAction === "collapse") {
      containerEl.classList.add(COLLAPSED_CLASS);
    }
  }
}

function applyResultToUsername(username: string, entry: CacheEntryWithStaleness): void {
  const group = records.get(username);
  if (!group) return;
  for (const record of group) applyRecord(record, entry);
}

function createBadgeRecord(match: AuthorMatch): void {
  const username = match.username.toLowerCase();
  const badgeEl = document.createElement("span");
  badgeEl.className = BADGE_CLASS;
  badgeEl.style.display = "none"; // hidden until we know the classification
  match.anchorElement.insertAdjacentElement("afterend", badgeEl);

  const record: BadgeRecord = { username, badgeEl, containerEl: match.containerElement };
  const existing = records.get(username);
  if (existing) existing.push(record);
  else records.set(username, [record]);
}

function applySubredditRecord(record: SubredditRecord): void {
  const { chipEl, containerEl, subreddit } = record;

  if (!currentSettings.enabled) {
    chipEl.style.display = "none";
    containerEl.classList.remove(SUB_BLOCKED_CLASS);
    return;
  }

  if (blockedSubreddits.has(subreddit)) {
    chipEl.style.display = "none";
    containerEl.classList.add(SUB_BLOCKED_CLASS);
  } else {
    chipEl.style.display = "";
    containerEl.classList.remove(SUB_BLOCKED_CLASS);
  }
}

function applyAllSubredditRecords(): void {
  for (const group of subredditRecords.values()) {
    for (const record of group) applySubredditRecord(record);
  }
}

async function handleBlockClick(subreddit: string): Promise<void> {
  await blockSubreddit(subreddit);
  blockedSubreddits.add(normalizeSubreddit(subreddit));
  const group = subredditRecords.get(normalizeSubreddit(subreddit));
  if (group) for (const record of group) applySubredditRecord(record);
}

function createSubredditRecord(match: SubredditMatch): void {
  const subreddit = normalizeSubreddit(match.subreddit);
  const chipEl = document.createElement("button");
  chipEl.type = "button";
  chipEl.className = BLOCK_CHIP_CLASS;
  chipEl.textContent = `Block r/${subreddit}`;
  chipEl.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handleBlockClick(subreddit);
  });
  match.anchorElement.insertAdjacentElement("afterend", chipEl);

  const record: SubredditRecord = { subreddit, chipEl, containerEl: match.containerElement };
  const existing = subredditRecords.get(subreddit);
  if (existing) existing.push(record);
  else subredditRecords.set(subreddit, [record]);
  applySubredditRecord(record);
}

async function requestClassifications(usernames: string[]): Promise<void> {
  if (usernames.length === 0) return;
  const request: CheckUsernamesRequest = { type: "check-usernames", usernames };
  let response: CheckUsernamesResponse | undefined;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch {
    return; // background not reachable (e.g. extension reloading); next scan will retry
  }
  if (!response) return;
  for (const [username, entry] of Object.entries(response.results)) {
    applyResultToUsername(username, entry);
  }
}

function scan(root: ParentNode): void {
  const matches = findAuthorElements(root);
  for (const match of matches) {
    markProcessed(match.markerElement);
    createBadgeRecord(match);
  }
  if (matches.length > 0) {
    void requestClassifications(matches.map((match) => match.username.toLowerCase()));
  }

  const subredditMatches = findSubredditElements(root);
  for (const match of subredditMatches) {
    markSubredditProcessed(match.markerElement);
    createSubredditRecord(match);
  }
}

function scheduleScan(root: ParentNode): void {
  if (scanTimeout !== undefined) window.clearTimeout(scanTimeout);
  scanTimeout = window.setTimeout(() => {
    scanTimeout = undefined;
    scan(root);
  }, SCAN_DEBOUNCE_MS);
}

function startObserving(): void {
  observer?.disconnect();
  observer = new MutationObserver(() => scheduleScan(document.body));
  observer.observe(document.body, { childList: true, subtree: true });
}

function handleNavigationIfChanged(): void {
  if (location.href === currentUrl) return;
  currentUrl = location.href;
  startObserving();
  scheduleScan(document.body);
}

/** Re-renders every known badge/container using the freshest cached entries (no network hit for fresh entries). */
async function refreshAllRecords(): Promise<void> {
  await requestClassifications(Array.from(records.keys()));
}

function handleRuntimeMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: PageStats) => void,
): boolean {
  if (!message || typeof message !== "object" || !("type" in message)) return false;

  if (message.type === "flair-updated") {
    const push = message as FlairUpdatedPush;
    applyResultToUsername(push.username, push.result);
    return false;
  }

  if (message.type === "get-page-stats") {
    sendResponse({ flaggedCount: flaggedUsernames.size });
    return false;
  }

  return false;
}

async function init(): Promise<void> {
  injectStyles();
  currentSettings = await getSettings();
  for (const entry of await getBlockedSubreddits()) blockedSubreddits.add(entry.subreddit);
  startObserving();
  scan(document.body);

  window.addEventListener("popstate", handleNavigationIfChanged);
  window.setInterval(handleNavigationIfChanged, NAV_POLL_MS);

  onSettingsChanged((settings) => {
    currentSettings = settings;
    void refreshAllRecords();
    applyAllSubredditRecords();
  });

  onBlockedSubredditsChanged((list) => {
    blockedSubreddits.clear();
    for (const entry of list) blockedSubreddits.add(entry.subreddit);
    applyAllSubredditRecords();
  });

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
}

void init();
