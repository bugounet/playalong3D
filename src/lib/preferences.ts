import type { Language } from "../i18n";
import type {
  HandMode,
  PracticeMode,
  ScoreState,
} from "../types";

const GLOBAL_PREFERENCES_KEY = "playalong3d-preferences";
const SONG_PREFERENCES_PREFIX = "playalong3d-song:";

export interface GlobalPreferences {
  language: Language;
  viewMode: "perspective" | "flat";
  masterVolume: number;
  soundEnabled: boolean;
  lastSongId: string;
}

export interface SongPreferences {
  tempoPercent: number;
  score: ScoreState;
  showHands: boolean;
  loopEnabled: boolean;
  loopStartBar: number;
  loopEndBar: number;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  handMode: HandMode;
  practiceMode: PracticeMode;
}

function readJson(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function loadGlobalPreferences(): Partial<GlobalPreferences> {
  const value = readJson(GLOBAL_PREFERENCES_KEY);
  if (!isRecord(value)) return {};
  const language =
    value.language === "fr" ||
    value.language === "en" ||
    value.language === "de" ||
    value.language === "es"
      ? value.language
      : undefined;
  const viewMode =
    value.viewMode === "flat" || value.viewMode === "perspective"
      ? value.viewMode
      : undefined;
  return {
    language,
    viewMode,
    masterVolume: Math.max(
      0,
      Math.min(100, finiteNumber(value.masterVolume, 72)),
    ),
    soundEnabled: booleanValue(value.soundEnabled, true),
    lastSongId:
      typeof value.lastSongId === "string" ? value.lastSongId : "demo",
  };
}

export function saveGlobalPreferences(preferences: GlobalPreferences) {
  try {
    window.localStorage.setItem(
      GLOBAL_PREFERENCES_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

export function loadSongPreferences(
  songId: string,
): Partial<SongPreferences> {
  const value = readJson(`${SONG_PREFERENCES_PREFIX}${songId}`);
  if (!isRecord(value)) return {};
  const score = isRecord(value.score)
    ? {
        correct: Math.max(0, finiteNumber(value.score.correct, 0)),
        missed: Math.max(0, finiteNumber(value.score.missed, 0)),
        wrong: Math.max(0, finiteNumber(value.score.wrong, 0)),
        timingSum: Math.max(0, finiteNumber(value.score.timingSum, 0)),
        streak: Math.max(0, finiteNumber(value.score.streak, 0)),
        bestStreak: Math.max(0, finiteNumber(value.score.bestStreak, 0)),
      }
    : undefined;
  return {
    tempoPercent: Math.max(
      25,
      Math.min(200, finiteNumber(value.tempoPercent, 100)),
    ),
    score,
    showHands: booleanValue(value.showHands, false),
    loopEnabled: booleanValue(value.loopEnabled, false),
    loopStartBar: Math.max(1, finiteNumber(value.loopStartBar, 1)),
    loopEndBar: Math.max(1, finiteNumber(value.loopEndBar, 2)),
    metronomeEnabled: booleanValue(value.metronomeEnabled, false),
    metronomeVolume: Math.max(
      0,
      Math.min(100, finiteNumber(value.metronomeVolume, 75)),
    ),
    handMode:
      value.handMode === "left" ||
      value.handMode === "right" ||
      value.handMode === "both"
        ? value.handMode
        : undefined,
    practiceMode:
      value.practiceMode === "tempo" || value.practiceMode === "wait"
        ? value.practiceMode
        : undefined,
  };
}

export function saveSongPreferences(
  songId: string,
  preferences: SongPreferences,
) {
  try {
    window.localStorage.setItem(
      `${SONG_PREFERENCES_PREFIX}${songId}`,
      JSON.stringify(preferences),
    );
  } catch {
    // The app remains usable when the browser rejects persistence.
  }
}

export function countStoredSongPreferences() {
  let count = 0;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      if (
        window.localStorage.key(index)?.startsWith(SONG_PREFERENCES_PREFIX)
      ) {
        count += 1;
      }
    }
  } catch {
    return 0;
  }
  return count;
}

export function clearLocalPreferences() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("playalong3d-")) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Nothing else to do if the storage backend itself is unavailable.
  }
}
