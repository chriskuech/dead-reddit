import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "./support/chrome-mock";

describe("blocked-users", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", createChromeMock());
    vi.resetModules();
  });

  it("returns an empty list when nothing is blocked", async () => {
    const blockedUsers = await import("../src/lib/blocked-users");
    expect(await blockedUsers.getBlockedUsers()).toEqual([]);
  });

  it("blocks a user, normalizing case and a leading u/ prefix", async () => {
    const blockedUsers = await import("../src/lib/blocked-users");
    await blockedUsers.blockUser("u/SomeUser");

    const list = await blockedUsers.getBlockedUsers();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ username: "someuser" });
    expect(await blockedUsers.isUserBlocked("SOMEUSER")).toBe(true);
  });

  it("is idempotent: blocking an already-blocked user does not duplicate it", async () => {
    const blockedUsers = await import("../src/lib/blocked-users");
    await blockedUsers.blockUser("spez");
    await blockedUsers.blockUser("spez");

    expect(await blockedUsers.getBlockedUsers()).toHaveLength(1);
  });

  it("unblocks a user", async () => {
    const blockedUsers = await import("../src/lib/blocked-users");
    await blockedUsers.blockUser("spez");
    await blockedUsers.unblockUser("spez");

    expect(await blockedUsers.getBlockedUsers()).toEqual([]);
    expect(await blockedUsers.isUserBlocked("spez")).toBe(false);
  });

  it("unblocking a user that was never blocked is a no-op", async () => {
    const blockedUsers = await import("../src/lib/blocked-users");
    await blockedUsers.blockUser("spez");

    const result = await blockedUsers.unblockUser("nonexistent");
    expect(result).toHaveLength(1);
  });

  it("notifies listeners when the blocked list changes", async () => {
    const chromeMock = createChromeMock();
    vi.stubGlobal("chrome", chromeMock);
    vi.resetModules();
    const blockedUsers = await import("../src/lib/blocked-users");

    const callback = vi.fn();
    blockedUsers.onBlockedUsersChanged(callback);

    await blockedUsers.blockUser("spez");

    // Simulate storage.onChanged firing, as chrome.storage.sync.set does not trigger
    // the mock's onChanged listeners automatically.
    const listener = chromeMock._internal.onChangedListeners[0];
    listener!({ blockedUsers: { newValue: [{ username: "spez", blockedAt: 1 }] } }, "sync");

    expect(callback).toHaveBeenCalledWith([{ username: "spez", blockedAt: 1 }]);
  });
});
