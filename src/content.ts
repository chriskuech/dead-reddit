import {
  findAuthorElements,
  findSearchAuthorTargets,
  findSubredditElements,
  markProcessed,
  markSearchAuthorProcessed,
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
  blockUser,
  getBlockedUsers,
  normalizeUsername,
  onBlockedUsersChanged,
} from "./lib/blocked-users";
import {
  DEFAULT_SETTINGS,
  type CacheEntryWithStaleness,
  type CheckUsernamesRequest,
  type CheckUsernamesResponse,
  type FlairUpdatedPush,
  type PageStats,
  type PostAuthorResolvedPush,
  type ResolvePostAuthorsRequest,
  type ResolvePostAuthorsResponse,
  type Settings,
} from "./lib/types";

const STYLE_ID = "dr-styles";
const BADGE_CLASS = "dr-badge";
const STALE_CLASS = "dr-badge--stale";
const HIDDEN_CLASS = "dr-hidden";
const COLLAPSED_CLASS = "dr-collapsed";
const BLOCK_CHIP_CLASS = "dr-block-chip";
const SUB_BLOCKED_CLASS = "dr-sub-blocked";
const USER_BLOCKED_CLASS = "dr-user-blocked";
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
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 4px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  vertical-align: middle;
  flex: none;
  color: inherit;
}
.${BLOCK_CHIP_CLASS}:hover {
  background: var(--color-brand-background, #ff4500);
}
.${BLOCK_CHIP_CLASS}__ring {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  border-radius: 50%;
  border: 1.5px solid var(--color-brand-background, #ff4500);
}
.${BLOCK_CHIP_CLASS}__slash {
  position: absolute;
  top: 50%;
  left: 9%;
  width: 82%;
  height: 1.5px;
  background: var(--color-brand-background, #ff4500);
  transform: translateY(-50%) rotate(45deg);
}
.${BLOCK_CHIP_CLASS}__label {
  position: relative;
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
  color: inherit;
}
.${SUB_BLOCKED_CLASS} {
  display: none !important;
}
.${USER_BLOCKED_CLASS} {
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

interface UserBlockRecord {
  username: string;
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
/** username -> every block-chip/container pair currently on the page for that user. */
const userBlockRecords = new Map<string, UserBlockRecord[]>();
/** Normalized usernames currently on the user's block list. */
const blockedUsers = new Set<string>();
/** Post/comment container -> its subreddit block chip, so the user-block chip can sit right next to it. */
const subredditChipByContainer = new WeakMap<Element, HTMLButtonElement>();
/** postId -> search-result card awaiting an async author resolution. */
const pendingSearchAuthors = new Map<string, Element>();

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

function createBadgeRecord(match: AuthorMatch): HTMLSpanElement {
  const username = match.username.toLowerCase();
  const badgeEl = document.createElement("span");
  badgeEl.className = BADGE_CLASS;
  badgeEl.style.display = "none"; // hidden until we know the classification
  match.anchorElement.insertAdjacentElement("afterend", badgeEl);

  const record: BadgeRecord = { username, badgeEl, containerEl: match.containerElement };
  const existing = records.get(username);
  if (existing) existing.push(record);
  else records.set(username, [record]);
  return badgeEl;
}

/** Builds a small circular "block" button — a slashed ring with a `r/`/`u/` label inside. */
function createBlockChip(label: string, fullLabel: string): HTMLButtonElement {
  const chipEl = document.createElement("button");
  chipEl.type = "button";
  chipEl.className = BLOCK_CHIP_CLASS;
  chipEl.title = `Block ${fullLabel}`;
  chipEl.setAttribute("aria-label", `Block ${fullLabel}`);
  chipEl.innerHTML = `<span class="${BLOCK_CHIP_CLASS}__ring" aria-hidden="true"></span><span class="${BLOCK_CHIP_CLASS}__slash" aria-hidden="true"></span><span class="${BLOCK_CHIP_CLASS}__label" aria-hidden="true">${label}</span>`;
  return chipEl;
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
  const chipEl = createBlockChip("r/", `r/${subreddit}`);
  chipEl.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handleBlockClick(subreddit);
  });
  match.anchorElement.insertAdjacentElement("afterend", chipEl);
  subredditChipByContainer.set(match.containerElement, chipEl);

  const record: SubredditRecord = { subreddit, chipEl, containerEl: match.containerElement };
  const existing = subredditRecords.get(subreddit);
  if (existing) existing.push(record);
  else subredditRecords.set(subreddit, [record]);
  applySubredditRecord(record);
}

function applyUserBlockRecord(record: UserBlockRecord): void {
  const { chipEl, containerEl, username } = record;

  if (!currentSettings.enabled) {
    chipEl.style.display = "none";
    containerEl.classList.remove(USER_BLOCKED_CLASS);
    return;
  }

  if (blockedUsers.has(username)) {
    chipEl.style.display = "none";
    containerEl.classList.add(USER_BLOCKED_CLASS);
  } else {
    chipEl.style.display = "";
    containerEl.classList.remove(USER_BLOCKED_CLASS);
  }
}

function applyAllUserBlockRecords(): void {
  for (const group of userBlockRecords.values()) {
    for (const record of group) applyUserBlockRecord(record);
  }
}

async function handleUserBlockClick(username: string): Promise<void> {
  await blockUser(username);
  blockedUsers.add(normalizeUsername(username));
  const group = userBlockRecords.get(normalizeUsername(username));
  if (group) for (const record of group) applyUserBlockRecord(record);
}

/**
 * Inserts a "Block u/‹username›" chip immediately after the post's subreddit block chip, so
 * the two block buttons sit right next to each other. Falls back to right after `afterEl`
 * (the just-created badge) when the container has no subreddit chip (e.g. search cards before
 * their subreddit chip has been created). Only ever called for posts — comment authors don't
 * get a block chip at all (see the `isComment` check in scan()), so this can't drift to a
 * comment's subreddit-chip-less container the way it used to.
 */
function createUserBlockRecord(match: AuthorMatch, afterEl: Element): void {
  const username = normalizeUsername(match.username);
  const chipEl = createBlockChip("u/", `u/${username}`);
  chipEl.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handleUserBlockClick(username);
  });
  const insertAfter = subredditChipByContainer.get(match.containerElement) ?? afterEl;
  insertAfter.insertAdjacentElement("afterend", chipEl);

  const record: UserBlockRecord = { username, chipEl, containerEl: match.containerElement };
  const existing = userBlockRecords.get(username);
  if (existing) existing.push(record);
  else userBlockRecords.set(username, [record]);
  applyUserBlockRecord(record);
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

/** Builds the badge + user-block chip for a search card once its author has been resolved. */
function createSearchAuthorRecord(containerElement: Element, username: string): void {
  const anchorElement = subredditChipByContainer.get(containerElement) ?? containerElement;
  const match: AuthorMatch = {
    username,
    anchorElement,
    containerElement,
    markerElement: containerElement,
    isComment: false,
  };
  const badgeEl = createBadgeRecord(match);
  createUserBlockRecord(match, badgeEl);
  void requestClassifications([username.toLowerCase()]);
}

function applyResolvedPostAuthor(postId: string, author: string | null): void {
  const containerElement = pendingSearchAuthors.get(postId);
  if (!containerElement) return;
  pendingSearchAuthors.delete(postId);
  if (author) createSearchAuthorRecord(containerElement, author);
}

async function requestPostAuthors(postIds: string[]): Promise<void> {
  const request: ResolvePostAuthorsRequest = { type: "resolve-post-authors", postIds };
  let response: ResolvePostAuthorsResponse | undefined;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch {
    return; // background not reachable; unresolved postIds arrive later via the push, if at all
  }
  if (!response) return;
  for (const [postId, author] of Object.entries(response.results)) {
    applyResolvedPostAuthor(postId, author);
  }
}

/**
 * Search result cards expose no username in the DOM at all, so instead of reading one
 * synchronously (like findAuthorElements), this collects post ids and batch-resolves their
 * authors via the background worker's /by_id lookup (see requestPostAuthors).
 */
function scanSearchAuthors(root: ParentNode): void {
  const targets = findSearchAuthorTargets(root);
  const newPostIds: string[] = [];
  for (const target of targets) {
    markSearchAuthorProcessed(target.containerElement);
    pendingSearchAuthors.set(target.postId, target.containerElement);
    newPostIds.push(target.postId);
  }
  if (newPostIds.length > 0) void requestPostAuthors(newPostIds);
}

function scan(root: ParentNode): void {
  // Subreddit chips are created first so createUserBlockRecord/createSearchAuthorRecord can
  // find one on the same container and cluster the user-block chip right next to it.
  const subredditMatches = findSubredditElements(root);
  for (const match of subredditMatches) {
    markSubredditProcessed(match.markerElement);
    createSubredditRecord(match);
  }

  scanSearchAuthors(root);

  const matches = findAuthorElements(root);
  for (const match of matches) {
    markProcessed(match.markerElement);
    const badgeEl = createBadgeRecord(match);
    if (!match.isComment) createUserBlockRecord(match, badgeEl);
  }
  if (matches.length > 0) {
    void requestClassifications(matches.map((match) => match.username.toLowerCase()));
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

  if (message.type === "post-author-resolved") {
    const push = message as PostAuthorResolvedPush;
    applyResolvedPostAuthor(push.postId, push.author);
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
  for (const entry of await getBlockedUsers()) blockedUsers.add(entry.username);
  startObserving();
  scan(document.body);

  window.addEventListener("popstate", handleNavigationIfChanged);
  window.setInterval(handleNavigationIfChanged, NAV_POLL_MS);

  onSettingsChanged((settings) => {
    currentSettings = settings;
    void refreshAllRecords();
    applyAllSubredditRecords();
    applyAllUserBlockRecords();
  });

  onBlockedSubredditsChanged((list) => {
    blockedSubreddits.clear();
    for (const entry of list) blockedSubreddits.add(entry.subreddit);
    applyAllSubredditRecords();
  });

  onBlockedUsersChanged((list) => {
    blockedUsers.clear();
    for (const entry of list) blockedUsers.add(entry.username);
    applyAllUserBlockRecords();
  });

  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
}

void init();
