import { getSettings, updateSettings } from "./lib/settings";
import type { BackgroundStats, GetPageStatsRequest, PageStats } from "./lib/types";

const enabledToggle = document.getElementById("enabled-toggle") as HTMLInputElement;
const flaggedCountEl = document.getElementById("flagged-count") as HTMLElement;
const rateLimitWarningEl = document.getElementById("rate-limit-warning") as HTMLElement;
const openOptionsButton = document.getElementById("open-options") as HTMLButtonElement;
const openDashboardButton = document.getElementById("open-dashboard") as HTMLButtonElement;

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function loadFlaggedCount(): Promise<void> {
  const tabId = await getActiveTabId();
  if (tabId === undefined) return;
  try {
    const request: GetPageStatsRequest = { type: "get-page-stats" };
    const response: PageStats = await chrome.tabs.sendMessage(tabId, request);
    flaggedCountEl.textContent = String(response?.flaggedCount ?? 0);
  } catch {
    flaggedCountEl.textContent = "0"; // no content script on this tab (not reddit.com)
  }
}

function renderRateLimitWarning(stats: BackgroundStats): void {
  const remainingMs = stats.rateLimitedUntil ? stats.rateLimitedUntil - Date.now() : 0;
  if (remainingMs > 0) {
    rateLimitWarningEl.hidden = false;
    rateLimitWarningEl.textContent = `Rate limited, retrying in ${Math.ceil(remainingMs / 1000)}s`;
  } else {
    rateLimitWarningEl.hidden = true;
  }
}

async function loadStats(): Promise<void> {
  const stats: BackgroundStats = await chrome.runtime.sendMessage({ type: "get-stats" });
  renderRateLimitWarning(stats);
}

async function init(): Promise<void> {
  const settings = await getSettings();
  enabledToggle.checked = settings.enabled;

  enabledToggle.addEventListener("change", () => {
    void updateSettings({ enabled: enabledToggle.checked });
  });

  openOptionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  openDashboardButton.addEventListener("click", () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard.html") });
  });

  void loadFlaggedCount();
  void loadStats();
  window.setInterval(() => void loadStats(), 1000);
}

void init();
