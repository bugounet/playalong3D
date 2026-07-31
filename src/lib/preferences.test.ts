import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalPreferences,
  countStoredSongPreferences,
  loadGlobalPreferences,
  loadSongPreferences,
  saveGlobalPreferences,
  saveSongPreferences,
} from "./preferences";

function createLocalStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  } satisfies Storage;
}

describe("browser-local preferences", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createLocalStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips global and per-song settings", () => {
    saveGlobalPreferences({
      language: "de",
      viewMode: "flat",
      masterVolume: 61,
      soundEnabled: true,
      lastSongId: "demo:g-major",
    });
    saveSongPreferences("demo:g-major", {
      tempoPercent: 85,
      score: {
        correct: 31,
        missed: 1,
        wrong: 2,
        timingSum: 28,
        streak: 4,
        bestStreak: 19,
      },
      showHands: true,
      loopEnabled: true,
      loopStartBar: 2,
      loopEndBar: 4,
      metronomeEnabled: true,
      metronomeVolume: 64,
      handMode: "right",
      practiceMode: "tempo",
    });

    expect(loadGlobalPreferences()).toMatchObject({
      language: "de",
      viewMode: "flat",
      masterVolume: 61,
      lastSongId: "demo:g-major",
    });
    expect(loadSongPreferences("demo:g-major")).toMatchObject({
      tempoPercent: 85,
      metronomeEnabled: true,
      metronomeVolume: 64,
      handMode: "right",
    });
    expect(countStoredSongPreferences()).toBe(1);
  });

  it("clears Playalong data without touching unrelated browser storage", () => {
    window.localStorage.setItem("unrelated-app", "keep");
    window.localStorage.setItem("playalong3d-language", "fr");
    saveSongPreferences("demo:c-major", {
      tempoPercent: 100,
      score: {
        correct: 0,
        missed: 0,
        wrong: 0,
        timingSum: 0,
        streak: 0,
        bestStreak: 0,
      },
      showHands: false,
      loopEnabled: false,
      loopStartBar: 1,
      loopEndBar: 2,
      metronomeEnabled: false,
      metronomeVolume: 75,
      handMode: "both",
      practiceMode: "wait",
    });

    clearLocalPreferences();

    expect(window.localStorage.getItem("unrelated-app")).toBe("keep");
    expect(countStoredSongPreferences()).toBe(0);
    expect(window.localStorage.getItem("playalong3d-language")).toBeNull();
  });
});
