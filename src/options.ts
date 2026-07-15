import { getSettings, updateSettings } from "./lib/settings";
import {
  BOT_BOUNCER_FLAIRS,
  type BackgroundStats,
  type BotBouncerFlair,
  type FilterAction,
  type Settings,
} from "./lib/types";

const enabledToggle = document.getElementById("enabled-toggle") as HTMLInputElement;
const flairListEl = document.getElementById("flair-list") as HTMLElement;
const filterActionSelect = document.getElementById("filter-action") as HTMLSelectElement;
const showUnclassifiedToggle = document.getElementById("show-unclassified") as HTMLInputElement;
const cacheTtlInput = document.getElementById("cache-ttl") as HTMLInputElement;
const requestDelayInput = document.getElementById("request-delay") as HTMLInputElement;
const clearCacheButton = document.getElementById("clear-cache") as HTMLButtonElement;

const statCacheSize = document.getElementById("stat-cache-size") as HTMLElement;
const statStaleCount = document.getElementById("stat-stale-count") as HTMLElement;
const statPendingCount = document.getElementById("stat-pending-count") as HTMLElement;
const statLastSync = document.getElementById("stat-last-sync") as HTMLElement;

function flairCheckboxId(flair: BotBouncerFlair): string {
  return `flair-hide-${flair}`;
}

function renderFlairList(settings: Settings): void {
  flairListEl.innerHTML = "";
  for (const flair of BOT_BOUNCER_FLAIRS) {
    const row = document.createElement("div");
    row.className = "dr-flair-row";

    const swatch = document.createElement("span");
    swatch.className = "dr-flair-swatch";
    swatch.style.backgroundColor = settings.badgeColors[flair];

    const name = document.createElement("span");
    name.className = "dr-flair-name";
    name.textContent = flair;

    const label = document.createElement("label");
    label.textContent = "Hide";
    label.htmlFor = flairCheckboxId(flair);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = flairCheckboxId(flair);
    checkbox.checked = settings.filteredFlairs.includes(flair);
    checkbox.addEventListener("change", () => void onFlairToggle(flair, checkbox.checked));

    row.append(swatch, name, label, checkbox);
    flairListEl.appendChild(row);
  }
}

async function onFlairToggle(flair: BotBouncerFlair, hidden: boolean): Promise<void> {
  const settings = await getSettings();
  const filteredFlairs = hidden
    ? Array.from(new Set([...settings.filteredFlairs, flair]))
    : settings.filteredFlairs.filter((f) => f !== flair);
  await updateSettings({ filteredFlairs });
}

function formatLastSync(lastSyncAt: number | null): string {
  if (!lastSyncAt) return "never";
  return new Date(lastSyncAt).toLocaleTimeString();
}

async function loadStats(): Promise<void> {
  const stats: BackgroundStats = await chrome.runtime.sendMessage({ type: "get-stats" });
  statCacheSize.textContent = String(stats.cacheSize);
  statStaleCount.textContent = String(stats.staleCount);
  statPendingCount.textContent = String(stats.priorityQueueSize + stats.refreshQueueSize);
  statLastSync.textContent = formatLastSync(stats.lastSyncAt);
}

async function renderSettings(settings: Settings): Promise<void> {
  enabledToggle.checked = settings.enabled;
  filterActionSelect.value = settings.filterAction;
  showUnclassifiedToggle.checked = settings.showUnclassifiedBadge;
  cacheTtlInput.value = String(Math.round(settings.cacheTtlMs / 60_000));
  requestDelayInput.value = String(settings.requestDelayMs);
  renderFlairList(settings);
}

async function init(): Promise<void> {
  const settings = await getSettings();
  await renderSettings(settings);
  await loadStats();

  enabledToggle.addEventListener("change", () => {
    void updateSettings({ enabled: enabledToggle.checked });
  });

  filterActionSelect.addEventListener("change", () => {
    void updateSettings({ filterAction: filterActionSelect.value as FilterAction });
  });

  showUnclassifiedToggle.addEventListener("change", () => {
    void updateSettings({ showUnclassifiedBadge: showUnclassifiedToggle.checked });
  });

  cacheTtlInput.addEventListener("change", () => {
    const minutes = Math.max(1, Number(cacheTtlInput.value) || 1);
    void updateSettings({ cacheTtlMs: minutes * 60_000 });
  });

  requestDelayInput.addEventListener("change", () => {
    const ms = Math.max(0, Number(requestDelayInput.value) || 0);
    void updateSettings({ requestDelayMs: ms });
  });

  clearCacheButton.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "clear-cache" }).then(() => loadStats());
  });

  window.setInterval(() => void loadStats(), 2000);
}

void init();
