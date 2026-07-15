import { vi } from "vitest";

type Listener = (...args: unknown[]) => unknown;

function createStorageArea() {
  const data = new Map<string, unknown>();
  return {
    async get(query?: string | string[] | null | Record<string, unknown>) {
      if (query === null || query === undefined) {
        return Object.fromEntries(data.entries());
      }
      const keys =
        typeof query === "string" ? [query] : Array.isArray(query) ? query : Object.keys(query);
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (data.has(key)) result[key] = data.get(key);
      }
      return result;
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    },
    async clear() {
      data.clear();
    },
    _data: data,
  };
}

export function createChromeMock() {
  const onMessageListeners: Listener[] = [];
  const onChangedListeners: Listener[] = [];
  const onAlarmListeners: Listener[] = [];
  const onInstalledListeners: Listener[] = [];
  const onRemovedListeners: Listener[] = [];

  const local = createStorageArea();
  const sync = createStorageArea();

  const chrome = {
    storage: {
      local,
      sync,
      onChanged: {
        addListener: (fn: Listener) => onChangedListeners.push(fn),
        removeListener: (fn: Listener) => {
          const i = onChangedListeners.indexOf(fn);
          if (i >= 0) onChangedListeners.splice(i, 1);
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => onMessageListeners.push(fn),
      },
      onInstalled: {
        addListener: (fn: Listener) => onInstalledListeners.push(fn),
      },
      sendMessage: vi.fn(),
      openOptionsPage: vi.fn(),
    },
    tabs: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      onRemoved: {
        addListener: (fn: Listener) => onRemovedListeners.push(fn),
      },
    },
    alarms: {
      create: vi.fn(),
      onAlarm: {
        addListener: (fn: Listener) => onAlarmListeners.push(fn),
      },
    },
    _internal: {
      onMessageListeners,
      onChangedListeners,
      onAlarmListeners,
      onInstalledListeners,
      onRemovedListeners,
    },
  };

  return chrome;
}

export type ChromeMock = ReturnType<typeof createChromeMock>;
