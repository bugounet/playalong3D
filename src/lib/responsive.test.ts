import { describe, expect, it } from "vitest";
import {
  compactMidiRangeAround,
  MOBILE_PIANO_KEY_COUNT,
} from "./responsive";

describe("mobile piano range", () => {
  it("always exposes exactly eight playable MIDI keys", () => {
    for (const center of [21, 60, 108]) {
      const range = compactMidiRangeAround(center);
      expect(range).toHaveLength(MOBILE_PIANO_KEY_COUNT);
      expect(new Set(range).size).toBe(MOBILE_PIANO_KEY_COUNT);
      expect(range[0]).toBeGreaterThanOrEqual(21);
      expect(range.at(-1)).toBeLessThanOrEqual(108);
    }
  });

  it("keeps the requested note inside the compact range", () => {
    for (const center of [21, 36, 60, 84, 108]) {
      expect(compactMidiRangeAround(center)).toContain(center);
    }
  });
});
