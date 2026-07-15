import { describe, expect, it } from "vitest";
import { BOT_BOUNCER_FLAIRS, isBotBouncerFlair } from "../src/lib/types";

describe("isBotBouncerFlair", () => {
  it("accepts each known flair value", () => {
    for (const flair of BOT_BOUNCER_FLAIRS) {
      expect(isBotBouncerFlair(flair)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isBotBouncerFlair("not-a-real-flair")).toBe(false);
    expect(isBotBouncerFlair("")).toBe(false);
    expect(isBotBouncerFlair("Banned")).toBe(false); // callers must lowercase first
  });
});
