import * as cache from "./lib/cache";
import { getSettings } from "./lib/settings";
import {
  getBlockedSubreddits,
  onBlockedSubredditsChanged,
  unblockSubreddit,
} from "./lib/blocked-subreddits";

const STATS_POLL_MS = 5000;

const tabUsers = document.getElementById("tab-users") as HTMLButtonElement;
const tabSubreddits = document.getElementById("tab-subreddits") as HTMLButtonElement;
const panelUsers = document.getElementById("panel-users") as HTMLElement;
const panelSubreddits = document.getElementById("panel-subreddits") as HTMLElement;

const usersCountEl = document.getElementById("users-count") as HTMLElement;
const usersTableBody = document.getElementById("users-table-body") as HTMLElement;
const subredditsCountEl = document.getElementById("subreddits-count") as HTMLElement;
const subredditsTableBody = document.getElementById("subreddits-table-body") as HTMLElement;

function switchTab(tab: "users" | "subreddits"): void {
  const isUsers = tab === "users";
  tabUsers.classList.toggle("dr-tab--active", isUsers);
  tabUsers.setAttribute("aria-selected", String(isUsers));
  tabSubreddits.classList.toggle("dr-tab--active", !isUsers);
  tabSubreddits.setAttribute("aria-selected", String(!isUsers));
  panelUsers.hidden = !isUsers;
  panelSubreddits.hidden = isUsers;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

async function renderUsers(): Promise<void> {
  const settings = await getSettings();
  const all = await cache.getAll(settings.cacheTtlMs);
  const entries = Object.entries(all).sort(([, a], [, b]) => b.checkedAt - a.checkedAt);

  usersCountEl.textContent = `${entries.length} user${entries.length === 1 ? "" : "s"} analyzed`;
  usersTableBody.innerHTML = "";

  for (const [username, entry] of entries) {
    const row = document.createElement("tr");

    const usernameCell = document.createElement("td");
    usernameCell.textContent = `u/${username}`;

    const flairCell = document.createElement("td");
    flairCell.textContent = entry.flair ?? "unclassified";

    const checkedCell = document.createElement("td");
    checkedCell.textContent = formatTime(entry.checkedAt);

    const statusCell = document.createElement("td");
    statusCell.textContent = entry.isStale ? "stale" : "fresh";

    const postCell = document.createElement("td");
    if (entry.postUrl) {
      const link = document.createElement("a");
      link.href = entry.postUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "view";
      postCell.appendChild(link);
    } else {
      postCell.textContent = "–";
    }

    row.append(usernameCell, flairCell, checkedCell, statusCell, postCell);
    usersTableBody.appendChild(row);
  }
}

async function renderSubreddits(): Promise<void> {
  const list = await getBlockedSubreddits();
  const sorted = [...list].sort((a, b) => b.blockedAt - a.blockedAt);

  subredditsCountEl.textContent = `${sorted.length} blocked subreddit${sorted.length === 1 ? "" : "s"}`;
  subredditsTableBody.innerHTML = "";

  for (const entry of sorted) {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = `r/${entry.subreddit}`;

    const blockedAtCell = document.createElement("td");
    blockedAtCell.textContent = formatTime(entry.blockedAt);

    const actionCell = document.createElement("td");
    const unblockButton = document.createElement("button");
    unblockButton.className = "dr-link-button";
    unblockButton.textContent = "Unblock";
    unblockButton.addEventListener("click", () => {
      void unblockSubreddit(entry.subreddit).then(() => renderSubreddits());
    });
    actionCell.appendChild(unblockButton);

    row.append(nameCell, blockedAtCell, actionCell);
    subredditsTableBody.appendChild(row);
  }
}

function init(): void {
  tabUsers.addEventListener("click", () => switchTab("users"));
  tabSubreddits.addEventListener("click", () => switchTab("subreddits"));

  void renderUsers();
  void renderSubreddits();

  onBlockedSubredditsChanged(() => void renderSubreddits());
  window.setInterval(() => void renderUsers(), STATS_POLL_MS);
}

init();
