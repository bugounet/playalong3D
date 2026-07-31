import {
  ChevronDown,
  CircleHelp,
  Gauge,
  Hand,
  KeyboardMusic,
  Languages,
  Layers3,
  LoaderCircle,
  Maximize2,
  Menu,
  Minus,
  Music2,
  Pause,
  Play,
  PlugZap,
  Plus,
  Redo2,
  Repeat2,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { PianoStage } from "./components/PianoStage";
import { useMidiInput } from "./hooks/useMidiInput";
import { usePianoSynth } from "./hooks/usePianoSynth";
import {
  LANGUAGES,
  getInitialLanguage,
  translate,
  type Language,
} from "./i18n";
import {
  DEFAULT_DEMO_SONG_ID,
  DEMO_SONGS,
  annotateForPractice,
  createDemoSong,
  isDemoSongId,
  parseMidiFile,
  type DemoSongId,
} from "./lib/music";
import {
  clearLocalPreferences,
  countStoredSongPreferences,
  loadGlobalPreferences,
  loadSongPreferences,
  saveGlobalPreferences,
  saveSongPreferences,
} from "./lib/preferences";
import {
  clearStoredMidiFiles,
  listStoredMidiFiles,
  loadStoredMidiFile,
  saveStoredMidiFile,
  type StoredMidiSummary,
} from "./lib/songLibrary";
import {
  calculatePerformanceMetrics,
  type PerformanceMetrics,
} from "./lib/scoring";
import type {
  HandHint,
  HandMode,
  MidiInputEvent,
  PracticeMode,
  PracticeNote,
  ScoreState,
  SongData,
  TrackInfo,
} from "./types";

const EMPTY_SCORE: ScoreState = {
  correct: 0,
  missed: 0,
  wrong: 0,
  timingSum: 0,
  streak: 0,
  bestStreak: 0,
};

type DiscoveryStep = "low" | "high" | "result";

interface KeyboardCalibration {
  lowNote: number;
  highNote: number;
  keyCount: number;
  label: string;
}

interface PerformanceSummaryData {
  score: ScoreState;
  metrics: PerformanceMetrics;
}

interface LoopFeedback {
  passed: boolean;
  score: number;
  title: string;
  detail: string;
}

function describeKeyboard(keyCount: number, language: Language) {
  if (keyCount === 25) return translate(language, "keyboard.mini");
  if (keyCount === 88) return translate(language, "keyboard.piano88");
  return translate(language, "keyboard.generic", { count: keyCount });
}

const COMPUTER_KEYS: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
  o: 73,
  l: 74,
  p: 75,
  ";": 76,
};

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60)
    .toString()
    .padStart(2, "0")}`;
}

function groupOnsets(notes: PracticeNote[]) {
  const groups: PracticeNote[][] = [];
  for (const note of [...notes].sort(
    (a, b) => a.time - b.time || a.midi - b.midi,
  )) {
    const current = groups[groups.length - 1];
    if (!current || note.time - current[0].time >= 0.045) {
      groups.push([note]);
    } else {
      current.push(note);
    }
  }
  return groups;
}

function useMobileLayout() {
  const query = "(max-width: 760px)";
  const [mobile, setMobile] = useState(
    () => window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return mobile;
}

export default function App() {
  const mobileLayout = useMobileLayout();
  const [initialGlobalPreferences] = useState(loadGlobalPreferences);
  const [initialDemoPreferences] = useState(() =>
    loadSongPreferences(DEFAULT_DEMO_SONG_ID),
  );
  const [language, setLanguage] = useState<Language>(
    () => initialGlobalPreferences.language ?? getInitialLanguage(),
  );
  const t = useCallback(
    (key: string, variables: Record<string, string | number> = {}) =>
      translate(language, key, variables),
    [language],
  );
  const [showSplash, setShowSplash] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(72);
  const [loadingStatusKey, setLoadingStatusKey] = useState("loading.scene");
  const [song, setSong] = useState<SongData>(() => createDemoSong());
  const [tracks, setTracks] = useState<TrackInfo[]>(song.tracks);
  const [handMode, setHandMode] = useState<HandMode>(() => {
    const stored = initialDemoPreferences.handMode ?? "both";
    return mobileLayout && stored === "both" ? "right" : stored;
  });
  const [practiceMode, setPracticeMode] = useState<PracticeMode>(
    () => initialDemoPreferences.practiceMode ?? "tempo",
  );
  const [playing, setPlaying] = useState(false);
  const [countIn, setCountIn] = useState<3 | 2 | 1 | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [tempoPercent, setTempoPercent] = useState(
    () => initialDemoPreferences.tempoPercent ?? 100,
  );
  const [showHands, setShowHands] = useState(
    () => initialDemoPreferences.showHands ?? false,
  );
  const [loopEnabled, setLoopEnabled] = useState(
    () => initialDemoPreferences.loopEnabled ?? false,
  );
  const [loopStartBar, setLoopStartBar] = useState(
    () => initialDemoPreferences.loopStartBar ?? 1,
  );
  const [loopEndBar, setLoopEndBar] = useState(
    () => initialDemoPreferences.loopEndBar ?? 2,
  );
  const [score, setScore] = useState<ScoreState>(EMPTY_SCORE);
  const [lastScore, setLastScore] = useState<ScoreState>(
    () => initialDemoPreferences.score ?? EMPTY_SCORE,
  );
  const [activeMidi, setActiveMidi] = useState<Set<number>>(new Set());
  const [waitIndex, setWaitIndex] = useState(0);
  const [waitHits, setWaitHits] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [midiPlaybackEnabled, setMidiPlaybackEnabled] = useState(
    () => initialGlobalPreferences.soundEnabled ?? true,
  );
  const [masterVolume, setMasterVolumeState] = useState(
    () => initialGlobalPreferences.masterVolume ?? 72,
  );
  const [volumePanelOpen, setVolumePanelOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"perspective" | "flat">(
    () => initialGlobalPreferences.viewMode ?? "perspective",
  );
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveryStep, setDiscoveryStep] = useState<DiscoveryStep>("low");
  const [discoveryLowNote, setDiscoveryLowNote] = useState<number | null>(null);
  const [keyboardCalibration, setKeyboardCalibration] =
    useState<KeyboardCalibration | null>(null);
  const [performanceSummary, setPerformanceSummary] =
    useState<PerformanceSummaryData | null>(null);
  const [loopFeedback, setLoopFeedback] = useState<LoopFeedback | null>(null);
  const [metronomeEnabled, setMetronomeEnabled] = useState(
    () => initialDemoPreferences.metronomeEnabled ?? false,
  );
  const [metronomeVolume, setMetronomeVolume] = useState(
    () => initialDemoPreferences.metronomeVolume ?? 75,
  );
  const [metronomePanelOpen, setMetronomePanelOpen] = useState(false);
  const [previewTrackId, setPreviewTrackId] = useState<number | null>(null);
  const [songLibraryOpen, setSongLibraryOpen] = useState(false);
  const [storedMidiFiles, setStoredMidiFiles] = useState<StoredMidiSummary[]>([]);
  const [activeSongId, setActiveSongId] = useState<string>(
    DEFAULT_DEMO_SONG_ID,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storageConfirmation, setStorageConfirmation] = useState<
    "preferences" | "all" | null
  >(null);
  const [storedPreferenceCount, setStoredPreferenceCount] = useState(
    countStoredSongPreferences,
  );
  const [clearingStorage, setClearingStorage] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const songLibraryRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef(playhead);
  const playingRef = useRef(false);
  const countInRef = useRef<3 | 2 | 1 | null>(null);
  const resumeAfterVisibilityRef = useRef(false);
  const scoreRef = useRef(score);
  const hitIdsRef = useRef(new Set<string>());
  const missedIdsRef = useRef(new Set<string>());
  const waitIndexRef = useRef(waitIndex);
  const waitHitsRef = useRef(waitHits);
  const audioCursorRef = useRef(0);
  const pressedComputerKeys = useRef(new Set<string>());
  const selectedMidiIdRef = useRef("");
  const promptedMidiDevicesRef = useRef(new Set<string>());
  const nextMetronomeBeatRef = useRef(0);
  const previewTimersRef = useRef(new Set<number>());
  const restoredLastSongRef = useRef(false);
  const {
    noteOn,
    noteOff,
    tap,
    stopAll,
    setMasterVolume,
    metronomeClick,
    ensureContext,
  } = usePianoSynth(
    midiPlaybackEnabled ? masterVolume / 100 : 0,
  );

  const refreshSongLibrary = useCallback(async () => {
    try {
      setStoredMidiFiles(await listStoredMidiFiles());
    } catch {
      setStoredMidiFiles([]);
    }
  }, []);

  useEffect(() => {
    const stages = [
      window.setTimeout(() => {
        setLoadingProgress(84);
        setLoadingStatusKey("loading.midi");
      }, 120),
      window.setTimeout(() => {
        setLoadingProgress(94);
        setLoadingStatusKey("loading.fingering");
      }, 360),
      window.setTimeout(() => {
        setLoadingProgress(100);
        setLoadingStatusKey("loading.ready");
      }, 650),
      window.setTimeout(() => setShowSplash(false), 920),
    ];
    return () => stages.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    void refreshSongLibrary();
  }, [refreshSongLibrary]);

  useEffect(() => {
    window.localStorage.setItem("playalong3d-language", language);
    document.documentElement.lang = language;
    document.title = "Playalong 3D";
  }, [language]);

  useEffect(() => {
    if (!preferencesReady) return;
    saveGlobalPreferences({
      language,
      viewMode,
      masterVolume,
      soundEnabled: midiPlaybackEnabled,
      lastSongId: activeSongId,
    });
  }, [
    activeSongId,
    language,
    masterVolume,
    midiPlaybackEnabled,
    preferencesReady,
    viewMode,
  ]);

  useEffect(() => {
    if (!preferencesReady) return;
    const timer = window.setTimeout(() => {
      saveSongPreferences(activeSongId, {
        tempoPercent,
        score: lastScore,
        showHands,
        loopEnabled,
        loopStartBar,
        loopEndBar,
        metronomeEnabled,
        metronomeVolume,
        handMode,
        practiceMode,
      });
      setStoredPreferenceCount(countStoredSongPreferences());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    activeSongId,
    handMode,
    lastScore,
    loopEnabled,
    loopEndBar,
    loopStartBar,
    metronomeEnabled,
    metronomeVolume,
    practiceMode,
    preferencesReady,
    showHands,
    tempoPercent,
  ]);

  useEffect(() => {
    if (mobileLayout && handMode === "both") setHandMode("right");
  }, [handMode, mobileLayout]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
        setVolumePanelOpen(false);
        setMetronomePanelOpen(false);
        setSongLibraryOpen(false);
        setSettingsOpen(false);
        setStorageConfirmation(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    const closeSongLibrary = (event: PointerEvent) => {
      if (
        songLibraryRef.current &&
        !songLibraryRef.current.contains(event.target as Node)
      ) {
        setSongLibraryOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeSongLibrary);
    return () => window.removeEventListener("pointerdown", closeSongLibrary);
  }, []);

  const analysis = useMemo(
    () =>
      annotateForPractice(
        song.rawNotes,
        tracks,
        song.ppq,
        song.timeSignature[0],
      ),
    [song, tracks],
  );
  const practiceNotes = useMemo(
    () =>
      analysis.notes.filter(
        (note) => handMode === "both" || note.hand === handMode,
      ),
    [analysis.notes, handMode],
  );
  const onsetGroups = useMemo(() => groupOnsets(practiceNotes), [practiceNotes]);
  const sortedSongNotes = useMemo(
    () => [...song.rawNotes].sort((a, b) => a.time - b.time),
    [song.rawNotes],
  );
  const practiceNoteIds = useMemo(
    () => new Set(practiceNotes.map((note) => note.id)),
    [practiceNotes],
  );
  const measureDuration = (60 / song.bpm) * song.timeSignature[0];
  const beatDuration = 60 / song.bpm;
  const totalBars = Math.max(1, Math.ceil(song.duration / measureDuration));
  const loopStart = Math.max(0, (loopStartBar - 1) * measureDuration);
  const loopEnd = Math.min(song.duration, loopEndBar * measureDuration);
  const effectiveEnd = loopEnabled ? loopEnd : song.duration;

  const syncAudioCursor = useCallback(
    (time: number) => {
      let low = 0;
      let high = sortedSongNotes.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (sortedSongNotes[middle].time < time - 0.01) low = middle + 1;
        else high = middle;
      }
      audioCursorRef.current = low;
    },
    [sortedSongNotes],
  );

  const syncMetronome = useCallback(
    (time: number) => {
      nextMetronomeBeatRef.current =
        Math.ceil((time - 0.005) / beatDuration) * beatDuration;
    },
    [beatDuration],
  );

  const resetAttempt = useCallback(
    (targetTime = 0, preservePlayback = false) => {
      stopAll();
      syncAudioCursor(targetTime);
      syncMetronome(targetTime);
      hitIdsRef.current.clear();
      missedIdsRef.current.clear();
      setScore(EMPTY_SCORE);
      scoreRef.current = EMPTY_SCORE;
      setWaitHits(new Set());
      waitHitsRef.current = new Set();
      const nextWaitIndex = Math.max(
        0,
        onsetGroups.findIndex((group) => group[0].time >= targetTime - 0.04),
      );
      setWaitIndex(nextWaitIndex);
      waitIndexRef.current = nextWaitIndex;
      setPlayhead(targetTime);
      playheadRef.current = targetTime;
      setPerformanceSummary(null);
      setCountIn(null);
      countInRef.current = null;
      if (!preservePlayback) {
        setPlaying(false);
        playingRef.current = false;
        resumeAfterVisibilityRef.current = false;
      }
    },
    [onsetGroups, stopAll, syncAudioCursor, syncMetronome],
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => {
      setNotice((current) => (current === message ? "" : current));
    }, 3200);
  }, []);

  const stopTrackPreview = useCallback(() => {
    for (const timer of previewTimersRef.current) window.clearTimeout(timer);
    previewTimersRef.current.clear();
    stopAll();
    setPreviewTrackId(null);
  }, [stopAll]);

  const previewTrack = useCallback(
    (trackId: number) => {
      if (previewTrackId === trackId) {
        stopTrackPreview();
        return;
      }

      stopTrackPreview();
      ensureContext();
      resumeAfterVisibilityRef.current = false;
      countInRef.current = null;
      playingRef.current = false;
      setCountIn(null);
      setPlaying(false);
      const trackNotes = song.rawNotes
        .filter((note) => note.trackId === trackId)
        .sort((a, b) => a.time - b.time || a.midi - b.midi);
      if (trackNotes.length === 0) {
        showNotice(t("notice.noPreview"));
        return;
      }

      const excerptStart = trackNotes[0].time;
      const excerptDuration = 7;
      const excerpt = trackNotes
        .filter((note) => note.time <= excerptStart + excerptDuration)
        .slice(0, 96);
      setPreviewTrackId(trackId);

      for (const note of excerpt) {
        const delay = Math.max(0, note.time - excerptStart) * 1000;
        const timer = window.setTimeout(() => {
          previewTimersRef.current.delete(timer);
          tap(
            note.midi,
            Math.max(0.18, note.velocity),
            Math.max(0.08, Math.min(note.duration, 2.2)),
          );
        }, delay);
        previewTimersRef.current.add(timer);
      }

      const excerptEnd = Math.max(
        ...excerpt.map((note) => note.time - excerptStart + note.duration),
      );
      const finishTimer = window.setTimeout(() => {
        previewTimersRef.current.delete(finishTimer);
        stopAll();
        setPreviewTrackId((current) => (current === trackId ? null : current));
      }, Math.min(excerptDuration + 1, excerptEnd + 0.25) * 1000);
      previewTimersRef.current.add(finishTimer);
    },
    [
      ensureContext,
      previewTrackId,
      showNotice,
      song.rawNotes,
      stopAll,
      stopTrackPreview,
      tap,
      t,
    ],
  );

  useEffect(
    () => () => {
      for (const timer of previewTimersRef.current) window.clearTimeout(timer);
      previewTimersRef.current.clear();
    },
    [],
  );

  const stopPlayback = useCallback(() => {
    resumeAfterVisibilityRef.current = false;
    countInRef.current = null;
    playingRef.current = false;
    setCountIn(null);
    setPlaying(false);
    stopAll();
  }, [stopAll]);

  const startPlaybackCountIn = useCallback(() => {
    stopTrackPreview();
    ensureContext();
    resumeAfterVisibilityRef.current = false;
    playingRef.current = false;
    setPlaying(false);

    if (playheadRef.current >= effectiveEnd - 0.03) {
      resetAttempt(loopEnabled ? loopStart : 0, true);
    }

    syncAudioCursor(playheadRef.current);
    syncMetronome(playheadRef.current);
    countInRef.current = 3;
    setCountIn(3);
    metronomeClick(true, metronomeVolume / 100);
  }, [
    effectiveEnd,
    ensureContext,
    loopEnabled,
    loopStart,
    metronomeClick,
    metronomeVolume,
    resetAttempt,
    stopTrackPreview,
    syncAudioCursor,
    syncMetronome,
  ]);

  const togglePlayback = useCallback(() => {
    if (playingRef.current || countInRef.current !== null) {
      stopPlayback();
      return;
    }
    startPlaybackCountIn();
  }, [startPlaybackCountIn, stopPlayback]);

  useEffect(() => {
    if (countIn === null) return;
    const effectiveTempo = Math.max(1, (song.bpm * tempoPercent) / 100);
    const timer = window.setTimeout(() => {
      if (countIn > 1) {
        const nextCount = (countIn - 1) as 2 | 1;
        countInRef.current = nextCount;
        setCountIn(nextCount);
        metronomeClick(false, metronomeVolume / 100);
        return;
      }

      countInRef.current = null;
      setCountIn(null);
      if (document.visibilityState !== "visible") {
        resumeAfterVisibilityRef.current = true;
        return;
      }
      syncAudioCursor(playheadRef.current);
      syncMetronome(playheadRef.current);
      playingRef.current = true;
      setPlaying(true);
    }, 60_000 / effectiveTempo);

    return () => window.clearTimeout(timer);
  }, [
    countIn,
    metronomeClick,
    metronomeVolume,
    song.bpm,
    syncAudioCursor,
    syncMetronome,
    tempoPercent,
  ]);

  useEffect(() => {
    const pauseForVisibility = () => {
      const shouldResume =
        playingRef.current || countInRef.current !== null;
      if (!shouldResume) return;

      playingRef.current = false;
      countInRef.current = null;
      setPlaying(false);
      setCountIn(null);
      stopAll();
      resumeAfterVisibilityRef.current = true;
    };

    const resumeWhenVisible = () => {
      if (
        document.visibilityState === "visible" &&
        resumeAfterVisibilityRef.current
      ) {
        resumeAfterVisibilityRef.current = false;
        startPlaybackCountIn();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") pauseForVisibility();
      else resumeWhenVisible();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", pauseForVisibility);
    window.addEventListener("pageshow", resumeWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", pauseForVisibility);
      window.removeEventListener("pageshow", resumeWhenVisible);
    };
  }, [startPlaybackCountIn, stopAll]);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    countInRef.current = countIn;
  }, [countIn]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    waitIndexRef.current = waitIndex;
  }, [waitIndex]);

  useEffect(() => {
    waitHitsRef.current = waitHits;
  }, [waitHits]);

  useEffect(() => {
    resetAttempt(loopEnabled ? loopStart : 0);
  }, [handMode, practiceMode, song.name, tracks, loopEnabled, loopStart, resetAttempt]);

  const evaluateLoop = useCallback(() => {
    const attempt = scoreRef.current;
    setLastScore({ ...attempt });
    const precision = calculatePerformanceMetrics(attempt).precision;
    const passed = precision >= 95;

    if (passed && tempoPercent < 100) {
      const nextTempo = Math.min(100, tempoPercent + 5);
      setTempoPercent(nextTempo);
      setLoopFeedback({
        passed: true,
        score: precision,
        title: t("notice.loopPassed"),
        detail: t("notice.loopNext", { score: precision, tempo: nextTempo }),
      });
    } else if (passed) {
      setLoopFeedback({
        passed: true,
        score: precision,
        title: t("notice.loopMastered"),
        detail: t("notice.loopMasteredDetail", { score: precision }),
      });
    } else {
      setLoopFeedback({
        passed: false,
        score: precision,
        title: t("notice.loopRetry"),
        detail: t("notice.loopRetryDetail", { score: precision }),
      });
    }
    window.setTimeout(() => setLoopFeedback(null), 3800);
    resetAttempt(loopStart, true);
  }, [loopStart, resetAttempt, t, tempoPercent]);

  const finishPerformance = useCallback(() => {
    const finalScore = { ...scoreRef.current };
    setLastScore(finalScore);
    setPerformanceSummary({
      score: finalScore,
      metrics: calculatePerformanceMetrics(finalScore),
    });
    stopAll();
  }, [stopAll]);

  const playMidiBetween = useCallback(
    (from: number, to: number) => {
      if (!midiPlaybackEnabled || to < from) return;
      const speed = Math.max(0.3, tempoPercent / 100);
      let cursor = audioCursorRef.current;

      while (
        cursor < sortedSongNotes.length &&
        sortedSongNotes[cursor].time <= to + 0.006
      ) {
        const note = sortedSongNotes[cursor];
        if (
          note.time >= from - 0.012 &&
          !(
            practiceMode === "wait" &&
            practiceNoteIds.has(note.id)
          )
        ) {
          tap(
            note.midi,
            Math.max(0.18, note.velocity),
            Math.max(0.07, note.duration / speed),
          );
        }
        cursor += 1;
      }

      audioCursorRef.current = cursor;
    },
    [
      midiPlaybackEnabled,
      practiceMode,
      practiceNoteIds,
      sortedSongNotes,
      tap,
      tempoPercent,
    ],
  );

  const playMetronomeBetween = useCallback(
    (from: number, to: number) => {
      if (!metronomeEnabled || to < from) return;
      let beat = nextMetronomeBeatRef.current;
      while (beat <= to + 0.006) {
        if (beat >= from - 0.012) {
          const beatIndex = Math.round(beat / beatDuration);
          metronomeClick(
            beatIndex % song.timeSignature[0] === 0,
            metronomeVolume / 100,
          );
        }
        beat += beatDuration;
      }
      nextMetronomeBeatRef.current = beat;
    },
    [
      beatDuration,
      metronomeClick,
      metronomeEnabled,
      metronomeVolume,
      song.timeSignature,
    ],
  );

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previousTime = performance.now();

    const animate = (now: number) => {
      const delta = Math.min(0.05, (now - previousTime) / 1000);
      previousTime = now;
      const speed = tempoPercent / 100;
      const previousPlayhead = playheadRef.current;
      let next = previousPlayhead + delta * speed;

      if (practiceMode === "wait") {
        const target = onsetGroups[waitIndexRef.current];
        if (target && next > target[0].time) next = target[0].time;
      }

      if (practiceMode === "tempo") {
        const newlyMissed = practiceNotes.filter(
          (note) =>
            note.time >= (loopEnabled ? loopStart : 0) &&
            note.time <= effectiveEnd &&
            note.time < next - 0.42 &&
            !hitIdsRef.current.has(note.id) &&
            !missedIdsRef.current.has(note.id),
        );
        if (newlyMissed.length > 0) {
          newlyMissed.forEach((note) => missedIdsRef.current.add(note.id));
          const nextScore: ScoreState = {
            ...scoreRef.current,
            missed: scoreRef.current.missed + newlyMissed.length,
            streak: 0,
          };
          scoreRef.current = nextScore;
          setScore(nextScore);
        }
      }

      playMidiBetween(previousPlayhead, Math.min(next, effectiveEnd));
      playMetronomeBetween(previousPlayhead, Math.min(next, effectiveEnd));

      if (next >= effectiveEnd) {
        const remainingMissed = practiceNotes.filter(
          (note) =>
            note.time >= (loopEnabled ? loopStart : 0) &&
            note.time <= effectiveEnd &&
            !hitIdsRef.current.has(note.id) &&
            !missedIdsRef.current.has(note.id),
        );
        if (remainingMissed.length > 0) {
          remainingMissed.forEach((note) => missedIdsRef.current.add(note.id));
          const finalScore: ScoreState = {
            ...scoreRef.current,
            missed: scoreRef.current.missed + remainingMissed.length,
            streak: 0,
          };
          scoreRef.current = finalScore;
          setScore(finalScore);
        }

        if (loopEnabled) {
          evaluateLoop();
          next = loopStart;
        } else {
          next = song.duration;
          playingRef.current = false;
          resumeAfterVisibilityRef.current = false;
          setPlaying(false);
          finishPerformance();
        }
      }

      playheadRef.current = next;
      setPlayhead(next);
      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [
    effectiveEnd,
    evaluateLoop,
    finishPerformance,
    loopEnabled,
    loopStart,
    onsetGroups,
    playMidiBetween,
    playMetronomeBetween,
    playing,
    practiceMode,
    practiceNotes,
    song.duration,
    tempoPercent,
  ]);

  const registerNoteOn = useCallback(
    (midi: number, velocity = 0.78) => {
      noteOn(midi, velocity);
      setActiveMidi((current) => new Set(current).add(midi));
      if (countInRef.current !== null) return;
      const now = playheadRef.current;

      if (practiceMode === "wait") {
        const targetGroup = onsetGroups[waitIndexRef.current];
        const match = targetGroup?.find(
          (note) => note.midi === midi && !waitHitsRef.current.has(note.id),
        );
        if (!match) {
          const nextScore: ScoreState = {
            ...scoreRef.current,
            wrong: scoreRef.current.wrong + 1,
            streak: 0,
          };
          scoreRef.current = nextScore;
          setScore(nextScore);
          return;
        }

        hitIdsRef.current.add(match.id);
        const nextHits = new Set(waitHitsRef.current).add(match.id);
        const groupCompleted = targetGroup.every((note) => nextHits.has(note.id));
        const nextScore: ScoreState = {
          ...scoreRef.current,
          correct: scoreRef.current.correct + 1,
          timingSum: scoreRef.current.timingSum + 1,
          streak: scoreRef.current.streak + 1,
          bestStreak: Math.max(
            scoreRef.current.bestStreak,
            scoreRef.current.streak + 1,
          ),
        };
        scoreRef.current = nextScore;
        setScore(nextScore);

        if (groupCompleted) {
          const nextIndex = waitIndexRef.current + 1;
          setWaitIndex(nextIndex);
          waitIndexRef.current = nextIndex;
          setWaitHits(new Set());
          waitHitsRef.current = new Set();
          playheadRef.current = Math.max(now, targetGroup[0].time + 0.035);
        } else {
          setWaitHits(nextHits);
          waitHitsRef.current = nextHits;
        }
        return;
      }

      const tolerance = 0.62;
      const candidates = practiceNotes
        .filter(
          (note) =>
            note.midi === midi &&
            !hitIdsRef.current.has(note.id) &&
            !missedIdsRef.current.has(note.id) &&
            note.time >= (loopEnabled ? loopStart : 0) &&
            note.time <= effectiveEnd &&
            Math.abs(note.time - now) <= tolerance,
        )
        .sort(
          (a, b) => Math.abs(a.time - now) - Math.abs(b.time - now),
        );
      const match = candidates[0];
      if (!match) {
        const nextScore: ScoreState = {
          ...scoreRef.current,
          wrong: scoreRef.current.wrong + 1,
          streak: 0,
        };
        scoreRef.current = nextScore;
        setScore(nextScore);
        return;
      }

      hitIdsRef.current.add(match.id);
      const distance = Math.abs(match.time - now);
      const timingQuality = Math.max(0, 1 - distance / tolerance);
      const nextScore: ScoreState = {
        ...scoreRef.current,
        correct: scoreRef.current.correct + 1,
        timingSum: scoreRef.current.timingSum + timingQuality,
        streak: scoreRef.current.streak + 1,
        bestStreak: Math.max(
          scoreRef.current.bestStreak,
          scoreRef.current.streak + 1,
        ),
      };
      scoreRef.current = nextScore;
      setScore(nextScore);
    },
    [
      effectiveEnd,
      loopEnabled,
      loopStart,
      noteOn,
      onsetGroups,
      practiceMode,
      practiceNotes,
    ],
  );

  const registerNoteOff = useCallback(
    (midi: number) => {
      noteOff(midi);
      setActiveMidi((current) => {
        const next = new Set(current);
        next.delete(midi);
        return next;
      });
    },
    [noteOff],
  );

  const handleMidiEvent = useCallback(
    (event: MidiInputEvent) => {
      if (discoveryOpen && discoveryStep !== "result") {
        if (event.type === "off") {
          noteOff(event.note);
          setActiveMidi((current) => {
            const next = new Set(current);
            next.delete(event.note);
            return next;
          });
          return;
        }

        noteOn(event.note, event.velocity);
        setActiveMidi((current) => new Set(current).add(event.note));
        if (discoveryStep === "low") {
          setDiscoveryLowNote(event.note);
          setDiscoveryStep("high");
          return;
        }

        if (discoveryLowNote === null || event.note <= discoveryLowNote) {
          showNotice(t("notice.highMustBeHigher"));
          return;
        }

        const keyCount = event.note - discoveryLowNote + 1;
        const calibration: KeyboardCalibration = {
          lowNote: discoveryLowNote,
          highNote: event.note,
          keyCount,
          label: describeKeyboard(keyCount, language),
        };
        setKeyboardCalibration(calibration);
        setDiscoveryStep("result");
        const deviceId = selectedMidiIdRef.current;
        if (deviceId) {
          window.localStorage.setItem(
            `playalong3d-midi-range:${deviceId}`,
            JSON.stringify(calibration),
          );
        }
        return;
      }

      if (event.type === "on") registerNoteOn(event.note, event.velocity);
      else registerNoteOff(event.note);
    },
    [
      discoveryLowNote,
      discoveryOpen,
      discoveryStep,
      noteOff,
      noteOn,
      registerNoteOff,
      registerNoteOn,
      showNotice,
      language,
      t,
    ],
  );

  const midi = useMidiInput(handleMidiEvent, {
    defaultDevice: t("midi.defaultDevice"),
    unsupported: t("midi.unsupported"),
    denied: t("midi.denied"),
  });

  useEffect(() => {
    if (!midi.connected || !midi.selectedId) return;
    selectedMidiIdRef.current = midi.selectedId;
    const storageKey = `playalong3d-midi-range:${midi.selectedId}`;
    const savedCalibration = window.localStorage.getItem(storageKey);

    if (savedCalibration) {
      try {
        const parsed = JSON.parse(savedCalibration) as KeyboardCalibration;
        if (
          Number.isInteger(parsed.lowNote) &&
          Number.isInteger(parsed.highNote) &&
          parsed.highNote > parsed.lowNote
        ) {
          setKeyboardCalibration(parsed);
          setDiscoveryOpen(false);
          promptedMidiDevicesRef.current.add(midi.selectedId);
          return;
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }

    if (!promptedMidiDevicesRef.current.has(midi.selectedId)) {
      promptedMidiDevicesRef.current.add(midi.selectedId);
      resumeAfterVisibilityRef.current = false;
      countInRef.current = null;
      playingRef.current = false;
      setCountIn(null);
      setPlaying(false);
      stopAll();
      setKeyboardCalibration(null);
      setDiscoveryLowNote(null);
      setDiscoveryStep("low");
      setDiscoveryOpen(true);
    }
  }, [midi.connected, midi.selectedId, stopAll]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "BUTTON"
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }
      const midiNote = COMPUTER_KEYS[event.key.toLowerCase()];
      if (midiNote && !pressedComputerKeys.current.has(event.key)) {
        pressedComputerKeys.current.add(event.key);
        registerNoteOn(midiNote);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const midiNote = COMPUTER_KEYS[event.key.toLowerCase()];
      if (midiNote) {
        pressedComputerKeys.current.delete(event.key);
        registerNoteOff(midiNote);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    registerNoteOff,
    registerNoteOn,
    togglePlayback,
  ]);

  const currentTargets = useMemo(() => {
    if (practiceMode === "wait") return onsetGroups[waitIndex] ?? [];
    const upcoming = onsetGroups.find(
      (group) => group[0].time >= playhead - 0.16,
    );
    return upcoming ?? [];
  }, [onsetGroups, playhead, practiceMode, waitIndex]);

  const applyLoadedSong = useCallback(
    (parsed: SongData, sourceId: string) => {
      const preferences = loadSongPreferences(sourceId);
      const parsedMeasureDuration =
        (60 / parsed.bpm) * parsed.timeSignature[0];
      const parsedTotalBars = Math.max(
        1,
        Math.ceil(parsed.duration / parsedMeasureDuration),
      );
      const restoredHandMode = preferences.handMode ?? (
        mobileLayout ? "right" : "both"
      );
      const restoredScore = preferences.score ?? EMPTY_SCORE;
      stopTrackPreview();
      stopAll();
      setSong(parsed);
      setTracks(parsed.tracks);
      setHandMode(
        mobileLayout && restoredHandMode === "both"
          ? "right"
          : restoredHandMode,
      );
      setPracticeMode(preferences.practiceMode ?? "tempo");
      setShowHands(preferences.showHands ?? false);
      setLoopEnabled(preferences.loopEnabled ?? false);
      setLoopStartBar(
        Math.min(parsedTotalBars, preferences.loopStartBar ?? 1),
      );
      setLoopEndBar(
        Math.min(
          parsedTotalBars,
          Math.max(
            preferences.loopStartBar ?? 1,
            preferences.loopEndBar ?? Math.min(2, parsedTotalBars),
          ),
        ),
      );
      setTempoPercent(preferences.tempoPercent ?? 100);
      setMetronomeEnabled(preferences.metronomeEnabled ?? false);
      setMetronomeVolume(preferences.metronomeVolume ?? 75);
      setLastScore(restoredScore);
      setScore(EMPTY_SCORE);
      scoreRef.current = EMPTY_SCORE;
      resumeAfterVisibilityRef.current = false;
      countInRef.current = null;
      playingRef.current = false;
      setCountIn(null);
      setPlaying(false);
      setPlayhead(0);
      playheadRef.current = 0;
      audioCursorRef.current = 0;
      setPerformanceSummary(null);
      setLoopFeedback(null);
      setActiveSongId(sourceId);
      setSongLibraryOpen(false);
      syncMetronome(0);
    },
    [mobileLayout, stopAll, stopTrackPreview, syncMetronome],
  );

  useEffect(() => {
    if (restoredLastSongRef.current) return;
    restoredLastSongRef.current = true;

    const restoreLastSong = async () => {
      const savedId =
        initialGlobalPreferences.lastSongId === "demo"
          ? DEFAULT_DEMO_SONG_ID
          : initialGlobalPreferences.lastSongId;
      if (!savedId || savedId === DEFAULT_DEMO_SONG_ID) {
        setPreferencesReady(true);
        return;
      }

      try {
        if (isDemoSongId(savedId)) {
          applyLoadedSong(createDemoSong(savedId), savedId);
        } else {
          const file = await loadStoredMidiFile(savedId);
          const parsed = await parseMidiFile(file);
          if (parsed.tracks.length === 0) throw new Error("empty");
          applyLoadedSong(parsed, savedId);
        }
      } catch {
        applyLoadedSong(
          createDemoSong(DEFAULT_DEMO_SONG_ID),
          DEFAULT_DEMO_SONG_ID,
        );
        await refreshSongLibrary();
      } finally {
        setPreferencesReady(true);
      }
    };

    void restoreLastSong();
  }, [
    applyLoadedSong,
    initialGlobalPreferences.lastSongId,
    refreshSongLibrary,
  ]);

  const handleFile = useCallback(
    async (file?: File) => {
      if (!file) return;
      if (!/\.(mid|midi)$/i.test(file.name)) {
        showNotice(t("notice.chooseMidi"));
        return;
      }
      setLoadingFile(true);
      try {
        const parsed = await parseMidiFile(file);
        if (parsed.tracks.length === 0) throw new Error("empty");
        applyLoadedSong(parsed, `session:${file.name}`);
        try {
          const stored = await saveStoredMidiFile(file);
          setActiveSongId(stored.id);
          await refreshSongLibrary();
          showNotice(t("notice.loaded", { count: parsed.rawNotes.length }));
        } catch {
          showNotice(t("notice.loadedUnsaved", {
            count: parsed.rawNotes.length,
          }));
        }
      } catch {
        showNotice(t("notice.emptyMidi"));
      } finally {
        setLoadingFile(false);
      }
    },
    [applyLoadedSong, refreshSongLibrary, showNotice, t],
  );

  const selectDemoSong = (demoId: DemoSongId) => {
    if (demoId === activeSongId) {
      setSongLibraryOpen(false);
      return;
    }
    applyLoadedSong(createDemoSong(demoId), demoId);
  };

  const selectStoredSong = async (stored: StoredMidiSummary) => {
    if (stored.id === activeSongId) {
      setSongLibraryOpen(false);
      return;
    }
    setLoadingFile(true);
    try {
      const file = await loadStoredMidiFile(stored.id);
      const parsed = await parseMidiFile(file);
      if (parsed.tracks.length === 0) throw new Error("empty");
      applyLoadedSong(parsed, stored.id);
    } catch {
      showNotice(t("library.loadFailed"));
      await refreshSongLibrary();
    } finally {
      setLoadingFile(false);
    }
  };

  const toggleTrack = (trackId: number) => {
    setTracks((current) => {
      const target = current.find((track) => track.id === trackId);
      if (!target) return current;
      const selectedCount = current.filter((track) => track.selected).length;
      if (!target.selected && selectedCount >= 2) {
        showNotice(t("notice.maxTracks"));
        return current;
      }
      if (target.selected && selectedCount === 1) {
        showNotice(t("notice.keepTrack"));
        return current;
      }
      return current.map((track) =>
        track.id === trackId ? { ...track, selected: !track.selected } : track,
      );
    });
  };

  const setTrackHand = (trackId: number, handHint: HandHint) => {
    setTracks((current) =>
      current.map((track) =>
        track.id === trackId ? { ...track, handHint } : track,
      ),
    );
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    void handleFile(event.dataTransfer.files[0]);
  };

  const changeLoopEnabled = (enabled: boolean) => {
    setLoopEnabled(enabled);
    if (enabled) {
      setTempoPercent(50);
      showNotice(t("notice.loopStarted"));
    }
  };

  const tonalWindow =
    analysis.windows.find(
      (window) =>
        practiceNotes.find(
          (note) =>
            note.time >= playhead &&
            note.ticks >= window.startTick &&
            note.ticks < window.endTick,
        ),
    ) ?? analysis.windows[0];
  const targetNoteCount = practiceNotes.filter(
    (note) =>
      note.time >= (loopEnabled ? loopStart : 0) &&
      note.time <= effectiveEnd,
  ).length;
  const performanceMetrics = calculatePerformanceMetrics(score);
  const effectiveBpm = Math.round((song.bpm * tempoPercent) / 100);
  const playbackActive = playing || countIn !== null;
  const activeDemo = DEMO_SONGS.find((demo) => demo.id === activeSongId);
  const isDemoSong = Boolean(activeDemo);
  const displaySongName = activeDemo
    ? t(activeDemo.translationKey)
    : song.name;
  const displayTrackName = (track: TrackInfo, index: number) => {
    if (isDemoSong) return track.id === 0 ? t("demo.left") : t("demo.right");
    return track.name || t("track.name", { number: index + 1 });
  };
  const displayInstrument = (track: TrackInfo) => {
    if (isDemoSong) return t("demo.instrument");
    return track.instrument || t("instrument.piano");
  };
  const displayHandHint = (hint: HandHint) => {
    if (hint === "left") return t("hand.leftShort");
    if (hint === "right") return t("hand.rightShort");
    if (hint === "both") return t("hand.bothShort");
    return t("hand.auto");
  };
  const tonalNotes = t("notes").split("|");
  const localizedNoteName = (midi: number) =>
    `${tonalNotes[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  const tonalLabel = tonalWindow
    ? `${tonalNotes[tonalWindow.tonic]} ${t(
        tonalWindow.mode === "major" ? "scale.major" : "scale.minor",
      )}`
    : `${tonalNotes[0]} ${t("scale.major")}`;
  const applyTempoBpm = (nextBpm: number) => {
    if (loopEnabled) return;
    const boundedBpm = Math.max(
      Math.round(song.bpm * 0.25),
      Math.min(Math.round(song.bpm * 2), nextBpm),
    );
    setTempoPercent(Math.round((boundedBpm / song.bpm) * 100));
    syncMetronome(playheadRef.current);
  };

  const clearStoredData = async (scope: "preferences" | "all") => {
    if (storageConfirmation !== scope) {
      setStorageConfirmation(scope);
      return;
    }

    setClearingStorage(true);
    try {
      if (scope === "all") await clearStoredMidiFiles();
      clearLocalPreferences();
      window.location.reload();
    } catch {
      setClearingStorage(false);
      showNotice(t("settings.clearFailed"));
    }
  };

  return (
    <div
      className="app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".mid,.midi,audio/midi,audio/x-midi"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <header className="topbar">
        <button
          className="icon-button mobile-menu"
          onClick={() => setSidebarOpen(true)}
          aria-label={t("top.openSettings")}
        >
          <Menu size={19} />
        </button>
        <div className="brand">
          <div className="brand-mark"><Music2 size={19} /></div>
          <span>PLAYALONG</span><b>3D</b>
        </div>
        <div className="song-library-wrap" ref={songLibraryRef}>
          <button
            className="song-summary"
            onClick={() => setSongLibraryOpen((current) => !current)}
            aria-label={t("library.open")}
            aria-expanded={songLibraryOpen}
            aria-haspopup="menu"
          >
            <div className="song-icon"><Music2 size={17} /></div>
            <div>
              <strong>{displaySongName}</strong>
              <span>
                {song.bpm} BPM · {song.timeSignature.join("/")} ·{" "}
                {practiceNotes.length} {t("score.notes").toLowerCase()}
              </span>
            </div>
            <ChevronDown
              className={songLibraryOpen ? "open" : ""}
              size={16}
            />
          </button>
          {songLibraryOpen && (
            <div className="song-library-popover" role="menu">
              <span className="song-library-title">{t("library.title")}</span>
              {DEMO_SONGS.map((demo) => (
                <button
                  className={`song-library-item ${
                    activeSongId === demo.id ? "active" : ""
                  }`}
                  onClick={() => selectDemoSong(demo.id)}
                  role="menuitem"
                  key={demo.id}
                >
                  <i><Music2 size={15} /></i>
                  <span>
                    <strong>{t(demo.translationKey)}</strong>
                    <small>{t("library.demoHint")}</small>
                  </span>
                  {activeSongId === demo.id && <b />}
                </button>
              ))}
              {storedMidiFiles.map((stored) => (
                <button
                  className={`song-library-item ${
                    activeSongId === stored.id ? "active" : ""
                  }`}
                  onClick={() => void selectStoredSong(stored)}
                  role="menuitem"
                  key={stored.id}
                >
                  <i><Music2 size={15} /></i>
                  <span>
                    <strong>{stored.name.replace(/\.(midi?|smf)$/i, "")}</strong>
                    <small>{t("library.localFile", {
                      size: Math.max(1, Math.round(stored.size / 1024)),
                    })}</small>
                  </span>
                  {activeSongId === stored.id && <b />}
                </button>
              ))}
              {storedMidiFiles.length === 0 && (
                <p>{t("library.empty")}</p>
              )}
              <button
                className="song-library-import"
                onClick={() => {
                  setSongLibraryOpen(false);
                  fileInputRef.current?.click();
                }}
                role="menuitem"
              >
                <Upload size={14} />
                {t("library.import")}
              </button>
            </div>
          )}
        </div>
        <div className="top-actions">
          {midi.connected ? (
            <>
              <label className="midi-select connected">
                <span className="status-pulse" />
                <select
                  value={midi.selectedId}
                  onChange={(event) => midi.setSelectedId(event.target.value)}
                  aria-label={t("top.midiInput")}
                >
                  {midi.devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
              <button
                className="midi-discovery-button"
                onClick={() => {
                  stopPlayback();
                  setDiscoveryLowNote(null);
                  setDiscoveryStep("low");
                  setDiscoveryOpen(true);
                }}
                title={t("top.discoverRange")}
              >
                <KeyboardMusic size={15} />
                <span>
                  {keyboardCalibration
                    ? t("top.keys", { count: keyboardCalibration.keyCount })
                    : t("top.discover")}
                </span>
              </button>
            </>
          ) : (
            <button className="midi-connect" onClick={midi.requestAccess}>
              <PlugZap size={17} />
              <span>{t("top.connectMidi")}</span>
            </button>
          )}
          <label className="language-select" title={t("language.title")}>
            <Languages size={15} />
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
              aria-label={t("language.title")}
            >
              {LANGUAGES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            <strong>{language.toUpperCase()}</strong>
            <ChevronDown size={12} />
          </label>
          <button
            className="icon-button"
            aria-label={t("top.openHelp")}
            title={t("top.help")}
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={19} />
          </button>
          <button
            className="icon-button settings-button"
            aria-label={t("settings.open")}
            title={t("settings.title")}
            onClick={() => {
              setStoredPreferenceCount(countStoredSongPreferences());
              setStorageConfirmation(null);
              setSettingsOpen(true);
            }}
          >
            <Settings size={19} />
          </button>
        </div>
      </header>

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-mobile-head">
          <strong>{t("sidebar.settings")}</strong>
          <button
            className="icon-button"
            onClick={() => setSidebarOpen(false)}
            aria-label={t("sidebar.close")}
          >
            <X size={18} />
          </button>
        </div>

        <section className="control-section import-section">
          <button
            className="import-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loadingFile}
          >
            {loadingFile ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Upload size={18} />
            )}
            <span>{loadingFile ? t("sidebar.importing") : t("sidebar.import")}</span>
          </button>
          <small>{t("sidebar.drop")}</small>
        </section>

        <section className="control-section">
          <div className="section-title">
            <span><Hand size={16} />{t("sidebar.practiceHand")}</span>
          </div>
          <div className="segmented three">
            {(
              [
                ["left", t("hand.left")],
                ["right", t("hand.right")],
                ["both", t("hand.both")],
              ] as [HandMode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={handMode === value ? "active" : ""}
                disabled={mobileLayout && value === "both"}
                onClick={() => setHandMode(value)}
                title={
                  mobileLayout && value === "both"
                    ? t("hand.mobileSingleOnly")
                    : undefined
                }
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="control-section">
          <div className="section-title">
            <span><Gauge size={16} />{t("sidebar.practiceMode")}</span>
          </div>
          <div className="mode-cards">
            <button
              className={practiceMode === "tempo" ? "active" : ""}
              onClick={() => setPracticeMode("tempo")}
            >
              <span className="mode-icon"><Gauge size={18} /></span>
              <span><strong>{t("mode.tempo")}</strong><small>{t("mode.tempoHint")}</small></span>
              <i />
            </button>
            <button
              className={practiceMode === "wait" ? "active" : ""}
              onClick={() => setPracticeMode("wait")}
            >
              <span className="mode-icon"><Hand size={18} /></span>
              <span><strong>{t("mode.wait")}</strong><small>{t("mode.waitHint")}</small></span>
              <i />
            </button>
          </div>
        </section>

        <section className="control-section">
          <div className="section-title">
            <span><Layers3 size={16} />{t("sidebar.midiTracks")}</span>
            <em>{tracks.filter((track) => track.selected).length}/2</em>
          </div>
          <div className="track-list">
            {tracks.slice(0, 8).map((track, index) => {
              const trackLabel = displayTrackName(track, index);
              return (
              <div
                className={`track-row ${track.selected ? "selected" : ""} ${
                  previewTrackId === track.id ? "previewing" : ""
                }`}
                key={track.id}
              >
                <button
                  className="track-check"
                  onClick={() => toggleTrack(track.id)}
                  aria-label={t(
                    track.selected ? "track.disable" : "track.enable",
                    { name: trackLabel },
                  )}
                >
                  {track.selected && <span />}
                </button>
                <div className={`track-color color-${index % 4}`} />
                <button className="track-main" onClick={() => toggleTrack(track.id)}>
                  <strong>{trackLabel}</strong>
                  <small>{displayInstrument(track)} · {track.noteCount} {t("score.notes").toLowerCase()}</small>
                </button>
                <button
                  className="track-preview"
                  onClick={() => previewTrack(track.id)}
                  aria-label={
                    previewTrackId === track.id
                      ? t("track.stopPreview", { name: trackLabel })
                      : t("track.preview", { name: trackLabel })
                  }
                  title={
                    previewTrackId === track.id
                      ? t("track.stopPreviewTitle")
                      : t("track.previewTitle")
                  }
                >
                  {previewTrackId === track.id ? (
                    <Pause size={12} fill="currentColor" />
                  ) : (
                    <Play size={12} fill="currentColor" />
                  )}
                </button>
                <label className="hand-select" title={t("track.assignment")}>
                  <select
                    value={track.handHint}
                    disabled={!track.selected}
                    onChange={(event) =>
                      setTrackHand(track.id, event.target.value as HandHint)
                    }
                  >
                    <option value="auto">{t("hand.auto")}</option>
                    <option value="left">{t("hand.left")}</option>
                    <option value="right">{t("hand.right")}</option>
                    <option value="both">{t("hand.both")}</option>
                  </select>
                  <span>{displayHandHint(track.handHint)}</span>
                </label>
              </div>
            )})}
          </div>
        </section>

        <section className="control-section toggles-section">
          <button
            className={`toggle-row ${showHands ? "enabled" : ""}`}
            onClick={() => setShowHands((current) => !current)}
          >
            <span><Sparkles size={16} /><span><strong>{t("sidebar.virtualHands")}</strong><small>{t("sidebar.virtualHandsHint")}</small></span></span>
            <i><b /></i>
          </button>
          <button
            className={`toggle-row ${loopEnabled ? "enabled" : ""}`}
            onClick={() => changeLoopEnabled(!loopEnabled)}
          >
            <span><Repeat2 size={16} /><span><strong>{t("sidebar.progressiveLoop")}</strong><small>{t("sidebar.progressiveLoopHint")}</small></span></span>
            <i><b /></i>
          </button>
          {loopEnabled && (
            <div className="loop-settings">
              <label>
                {t("loop.start")}
                <select
                  value={loopStartBar}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setLoopStartBar(value);
                    if (value > loopEndBar) setLoopEndBar(value);
                  }}
                >
                  {Array.from({ length: totalBars }, (_, index) => (
                    <option value={index + 1} key={index + 1}>
                      {t("loop.measure", { number: index + 1 })}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("loop.end")}
                <select
                  value={loopEndBar}
                  onChange={(event) =>
                    setLoopEndBar(Math.max(loopStartBar, Number(event.target.value)))
                  }
                >
                  {Array.from({ length: totalBars }, (_, index) => (
                    <option value={index + 1} key={index + 1}>
                      {t("loop.measure", { number: index + 1 })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </section>

        <div className="analysis-card">
          <div><Sparkles size={15} /><span>{t("analysis.title")}</span></div>
          <strong>{tonalLabel}</strong>
          <small>{t("analysis.confidence", {
            value: Math.round((tonalWindow?.confidence ?? 1) * 100),
          })}</small>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label={t("sidebar.close")}
        />
      )}

      <main className="workspace">
        <div className="workspace-toolbar">
          <button
            className={`tool-pill view-toggle ${viewMode === "flat" ? "flat" : ""}`}
            onClick={() =>
              setViewMode((current) =>
                current === "perspective" ? "flat" : "perspective",
              )
            }
            aria-label={
              viewMode === "perspective"
                ? t("view.toFlat")
                : t("view.toPerspective")
            }
            title={
              viewMode === "perspective"
                ? t("view.toFlat")
                : t("view.toPerspective")
            }
          >
            <Layers3 size={15} />
            <span>
              {viewMode === "perspective" ? t("view.perspective") : t("view.flat")}
            </span>
          </button>
          <div className="bar-indicator">
            {t("toolbar.measure")}{" "}
            <strong>
              {Math.min(totalBars, Math.floor(playhead / measureDuration) + 1)}
            </strong>
            <span>/ {totalBars}</span>
          </div>
          <div className="shortcut-hint">
            <KeyboardMusic size={15} />
            <span>{t("toolbar.keyboardTest")}</span>
          </div>
        </div>

        {countIn !== null && (
          <div
            className="count-in-overlay"
            role="status"
            aria-live="assertive"
            aria-label={t("countIn.announcement", { count: countIn })}
          >
            <span>{t("countIn.label")}</span>
            <div className="count-in-beat" key={countIn}>
              <i />
              <strong>{countIn}</strong>
            </div>
            <small>{t("countIn.stopHint")}</small>
          </div>
        )}

        <PianoStage
          notes={practiceNotes}
          playhead={playhead}
          activeMidi={activeMidi}
          currentTargets={currentTargets}
          showHands={showHands}
          compactKeyboard={mobileLayout}
          viewMode={viewMode}
          score={score}
          onKeyDown={registerNoteOn}
          onKeyUp={registerNoteOff}
          labels={{
            failed: t("stage.failed"),
            failedHint: t("stage.failedHint"),
            left: t("stage.left"),
            right: t("stage.right"),
            precision: t("score.precision"),
            streak: t("score.streak"),
          }}
        />

        <div className="transport">
          <div className="transport-left">
            <button
              className="transport-icon"
              onClick={() => {
                stopTrackPreview();
                resetAttempt(loopEnabled ? loopStart : 0);
              }}
              aria-label={t("transport.restart")}
              title={t("transport.restart")}
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="play-button"
              onClick={togglePlayback}
              aria-label={
                countIn !== null
                  ? t("transport.stopCountIn")
                  : playing
                    ? t("transport.pause")
                    : t("transport.play")
              }
            >
              {playbackActive ? (
                <Pause size={21} fill="currentColor" />
              ) : (
                <Play size={21} fill="currentColor" />
              )}
            </button>
            <button
              className="transport-icon"
              onClick={() => {
                const next = Math.min(effectiveEnd, playhead + measureDuration);
                stopAll();
                syncAudioCursor(next);
                syncMetronome(next);
                setPlayhead(next);
                playheadRef.current = next;
              }}
              aria-label={t("transport.nextMeasure")}
              title={t("transport.nextMeasure")}
            >
              <Redo2 size={18} />
            </button>
            <div className="timecode">
              <strong>{formatTime(playhead)}</strong>
              <span>/ {formatTime(effectiveEnd)}</span>
            </div>
          </div>

          <div className="timeline">
            <input
              type="range"
              min={loopEnabled ? loopStart : 0}
              max={Math.max(effectiveEnd, 0.01)}
              step="0.01"
              value={Math.min(playhead, effectiveEnd)}
              onChange={(event) => {
                const next = Number(event.target.value);
                stopAll();
                syncAudioCursor(next);
                syncMetronome(next);
                setPlayhead(next);
                playheadRef.current = next;
              }}
              aria-label={t("transport.position")}
              style={
                {
                  "--progress": `${
                    (playhead / Math.max(effectiveEnd, 0.01)) * 100
                  }%`,
                } as React.CSSProperties
              }
            />
            <div className="timeline-labels">
              <span>{practiceMode === "wait" ? t("transport.waitMode") : t("transport.freeTempo")}</span>
              {loopEnabled && <b>{t("transport.loop", { start: loopStartBar, end: loopEndBar })}</b>}
            </div>
          </div>

          <div className="transport-right">
            <div className="metric">
              <span>{t("score.precision")}</span>
              <strong>{performanceMetrics.precision}</strong><small>/100</small>
            </div>
            <div className="metric">
              <span>{t("score.notes")}</span>
              <strong>{score.correct}</strong><small>/{targetNoteCount}</small>
            </div>
            <label className="tempo-control">
              <span><SlidersHorizontal size={14} />{t("tempo.title")}</span>
              <select
                value={tempoPercent}
                disabled={loopEnabled}
                onChange={(event) => setTempoPercent(Number(event.target.value))}
              >
                {Array.from({ length: 36 }, (_, index) => 25 + index * 5).map(
                  (value) => (
                    <option key={value} value={value}>{value} %</option>
                  ),
                )}
              </select>
              <strong>{tempoPercent}%</strong>
            </label>
            <div className="metronome-control-wrap">
              <button
                className={`metronome-button ${metronomeEnabled ? "enabled" : ""}`}
                onClick={() => {
                  setVolumePanelOpen(false);
                  setMetronomePanelOpen((current) => !current);
                }}
                aria-label={t("metronome.settings")}
                aria-expanded={metronomePanelOpen}
                title={t("help.metronomeTitle")}
              >
                <Timer size={17} />
              </button>
              {metronomePanelOpen && (
                <div className="metronome-popover">
                  <div className="metronome-head">
                    <span>{t("metronome.title")}</span>
                    <button
                      className={`mini-toggle ${metronomeEnabled ? "enabled" : ""}`}
                      onClick={() => {
                        ensureContext();
                        syncMetronome(playheadRef.current);
                        const nextEnabled = !metronomeEnabled;
                        setMetronomeEnabled(nextEnabled);
                        if (nextEnabled) {
                          metronomeClick(true, metronomeVolume / 100);
                        }
                      }}
                    >
                      <i />
                      {metronomeEnabled ? t("metronome.enabled") : t("metronome.disabled")}
                    </button>
                  </div>
                  <div className="bpm-display">
                    <button
                      onClick={() => applyTempoBpm(effectiveBpm - 5)}
                      disabled={loopEnabled}
                      aria-label={t("metronome.slower")}
                    >
                      <Minus size={14} />
                    </button>
                    <div><strong>{effectiveBpm}</strong><span>BPM</span></div>
                    <button
                      onClick={() => applyTempoBpm(effectiveBpm + 5)}
                      disabled={loopEnabled}
                      aria-label={t("metronome.faster")}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <input
                    className="tempo-slider"
                    type="range"
                    min="25"
                    max="200"
                    step="1"
                    value={tempoPercent}
                    disabled={loopEnabled}
                    onChange={(event) => {
                      setTempoPercent(Number(event.target.value));
                      syncMetronome(playheadRef.current);
                    }}
                    aria-label={t("metronome.musicTempo")}
                  />
                  <div className="tempo-scale">
                    <span>25 %</span>
                    <strong>{t("metronome.original", { value: tempoPercent })}</strong>
                    <span>200 %</span>
                  </div>
                  <div className="metronome-volume">
                    <div>
                      <span>{t("metronome.volume")}</span>
                      <strong>{metronomeVolume}%</strong>
                    </div>
                    <div className="metronome-volume-row">
                      <VolumeX size={13} />
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={metronomeVolume}
                        onChange={(event) => {
                          const nextVolume = Number(event.target.value);
                          setMetronomeVolume(nextVolume);
                          if (metronomeEnabled && nextVolume > 0) {
                            ensureContext();
                            metronomeClick(false, nextVolume / 100);
                          }
                        }}
                        aria-label={t("metronome.volume")}
                      />
                      <Volume2 size={14} />
                    </div>
                  </div>
                  {loopEnabled && (
                    <p>{t("metronome.loopLocked")}</p>
                  )}
                </div>
              )}
            </div>
            <div className="volume-control-wrap">
              <button
                className={`volume-button ${midiPlaybackEnabled ? "enabled" : ""}`}
                onClick={() => {
                  setMetronomePanelOpen(false);
                  setVolumePanelOpen((current) => !current);
                }}
                aria-label={t("volume.settings")}
                aria-expanded={volumePanelOpen}
                title={t("volume.title")}
              >
                {midiPlaybackEnabled && masterVolume > 0 ? (
                  <Volume2 size={17} />
                ) : (
                  <VolumeX size={17} />
                )}
              </button>
              {volumePanelOpen && (
                <div className="volume-popover">
                  <div className="volume-popover-head">
                    <span>{t("volume.general")}</span>
                    <strong>{midiPlaybackEnabled ? masterVolume : 0}%</strong>
                  </div>
                  <div className="volume-slider-row">
                    <VolumeX size={13} />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={midiPlaybackEnabled ? masterVolume : 0}
                      onChange={(event) => {
                        const nextVolume = Number(event.target.value);
                        ensureContext();
                        setMasterVolumeState(nextVolume);
                        setMidiPlaybackEnabled(nextVolume > 0);
                        setMasterVolume(nextVolume / 100);
                        if (nextVolume > 0) syncAudioCursor(playheadRef.current);
                      }}
                      aria-label={t("volume.general")}
                    />
                    <Volume2 size={14} />
                  </div>
                  <button
                    className="mute-button"
                    onClick={() => {
                      if (midiPlaybackEnabled) {
                        stopAll();
                        setMasterVolume(0);
                        setMidiPlaybackEnabled(false);
                      } else {
                        ensureContext();
                        setMasterVolume(masterVolume / 100);
                        syncAudioCursor(playheadRef.current);
                        setMidiPlaybackEnabled(true);
                      }
                    }}
                  >
                    {midiPlaybackEnabled ? (
                      <><VolumeX size={14} />{t("volume.mute")}</>
                    ) : (
                      <><Volume2 size={14} />{t("volume.unmute")}</>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {notice && <div className="toast"><Sparkles size={16} />{notice}</div>}
      {midi.error && <div className="midi-error">{midi.error}</div>}
      {loopFeedback && (
        <div className={`loop-feedback ${loopFeedback.passed ? "passed" : "retry"}`}>
          <div className="loop-feedback-score">{loopFeedback.score}</div>
          <div>
            <strong>{loopFeedback.title}</strong>
            <span>{loopFeedback.detail}</span>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div
          className="settings-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSettingsOpen(false);
              setStorageConfirmation(null);
            }
          }}
        >
          <div className="settings-panel">
            <div className="settings-head">
              <div>
                <span className="settings-kicker">{t("settings.kicker")}</span>
                <h2 id="settings-title">{t("settings.title")}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => {
                  setSettingsOpen(false);
                  setStorageConfirmation(null);
                }}
                aria-label={t("settings.close")}
              >
                <X size={19} />
              </button>
            </div>
            <div className="settings-body">
              <div className="storage-privacy">
                <Settings size={19} />
                <div>
                  <strong>{t("settings.localOnly")}</strong>
                  <p>{t("settings.privacy")}</p>
                </div>
              </div>
              <div className="storage-stats">
                <div>
                  <span>{t("settings.midiFiles")}</span>
                  <strong>{storedMidiFiles.length}</strong>
                </div>
                <div>
                  <span>{t("settings.songProfiles")}</span>
                  <strong>{storedPreferenceCount}</strong>
                </div>
              </div>
              <div className="storage-actions">
                <section>
                  <div>
                    <strong>{t("settings.clearPreferences")}</strong>
                    <p>{t("settings.clearPreferencesHint")}</p>
                  </div>
                  <button
                    className={
                      storageConfirmation === "preferences"
                        ? "danger-action confirming"
                        : "danger-action"
                    }
                    disabled={clearingStorage}
                    onClick={() => void clearStoredData("preferences")}
                  >
                    <Trash2 size={14} />
                    {storageConfirmation === "preferences"
                      ? t("settings.confirm")
                      : t("settings.clear")}
                  </button>
                </section>
                <section>
                  <div>
                    <strong>{t("settings.clearAll")}</strong>
                    <p>{t("settings.clearAllHint")}</p>
                  </div>
                  <button
                    className={
                      storageConfirmation === "all"
                        ? "danger-action confirming"
                        : "danger-action"
                    }
                    disabled={clearingStorage}
                    onClick={() => void clearStoredData("all")}
                  >
                    {clearingStorage && storageConfirmation === "all" ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    {storageConfirmation === "all"
                      ? t("settings.confirm")
                      : t("settings.clear")}
                  </button>
                </section>
              </div>
              {storageConfirmation && !clearingStorage && (
                <div className="storage-confirmation">
                  <span>{t("settings.confirmHint")}</span>
                  <button onClick={() => setStorageConfirmation(null)}>
                    {t("settings.cancel")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {performanceSummary && !loopEnabled && (
        <div
          className="summary-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="summary-title"
        >
          <div className="summary-panel">
            <span className="summary-kicker">{t("summary.kicker")}</span>
            <h2 id="summary-title">
              {performanceSummary.metrics.precision >= 95
                ? t("summary.excellent")
                : performanceSummary.metrics.precision >= 80
                  ? t("summary.good")
                  : t("summary.keepGoing")}
            </h2>
            <p>{t("summary.explanation")}</p>
            <div className="summary-score-ring">
              <strong>{performanceSummary.metrics.precision}</strong>
              <span>/100</span>
            </div>
            <div className="summary-stats">
              <div><span>{t("summary.timing")}</span><strong>{performanceSummary.metrics.timing}%</strong></div>
              <div><span>{t("summary.correct")}</span><strong>{performanceSummary.score.correct}</strong></div>
              <div><span>{t("summary.missed")}</span><strong>{performanceSummary.score.missed}</strong></div>
              <div><span>{t("summary.wrong")}</span><strong>{performanceSummary.score.wrong}</strong></div>
              <div><span>{t("summary.bestStreak")}</span><strong>{performanceSummary.score.bestStreak}</strong></div>
            </div>
            <div className="summary-actions">
              <button
                className="secondary-action"
                onClick={() => setPerformanceSummary(null)}
              >
                {t("summary.close")}
              </button>
              <button
                className="primary-action"
                onClick={() => {
                  resetAttempt(0, true);
                  startPlaybackCountIn();
                }}
              >
                <RotateCcw size={14} /> {t("summary.replay")}
              </button>
            </div>
          </div>
        </div>
      )}
      {discoveryOpen && (
        <div
          className="discovery-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discovery-title"
        >
          <div className="discovery-panel">
            <button
              className="icon-button discovery-close"
              onClick={() => setDiscoveryOpen(false)}
              aria-label={t("discovery.close")}
            >
              <X size={18} />
            </button>
            <div className="discovery-icon">
              <KeyboardMusic size={25} />
            </div>
            {discoveryStep !== "result" ? (
              <>
                <span className="discovery-kicker">
                  {t("discovery.kicker", { step: discoveryStep === "low" ? 1 : 2 })}
                </span>
                <h2 id="discovery-title">
                  {discoveryStep === "low"
                    ? t("discovery.lowTitle")
                    : t("discovery.highTitle")}
                </h2>
                <p>
                  {discoveryStep === "low"
                    ? t("discovery.lowHelp")
                    : t("discovery.highHelp", {
                        note: localizedNoteName(discoveryLowNote ?? 21),
                        midi: discoveryLowNote ?? 21,
                      })}
                </p>
                <div className={`discovery-keyboard ${discoveryStep}`}>
                  {Array.from({ length: 18 }, (_, index) => (
                    <i key={index} className={index % 7 === 2 || index % 7 === 5 ? "black-hint" : ""} />
                  ))}
                  <b />
                </div>
                <div className="discovery-listening">
                  <span className="status-pulse" />
                  {t("discovery.waiting")}
                </div>
              </>
            ) : (
              <>
                <span className="discovery-kicker">{t("discovery.done")}</span>
                <h2 id="discovery-title">
                  {describeKeyboard(keyboardCalibration?.keyCount ?? 88, language)}
                </h2>
                <p>{t("discovery.range", {
                  low: localizedNoteName(keyboardCalibration?.lowNote ?? 21),
                  high: localizedNoteName(keyboardCalibration?.highNote ?? 108),
                })}</p>
                <div className="discovery-result">
                  <div><span>{t("discovery.keys")}</span><strong>{keyboardCalibration?.keyCount}</strong></div>
                  <div><span>{t("discovery.lowNote")}</span><strong>{keyboardCalibration?.lowNote}</strong></div>
                  <div><span>{t("discovery.highNote")}</span><strong>{keyboardCalibration?.highNote}</strong></div>
                </div>
                <div className="discovery-actions">
                  <button
                    className="secondary-action"
                    onClick={() => {
                      setDiscoveryLowNote(null);
                      setDiscoveryStep("low");
                    }}
                  >
                    {t("discovery.retry")}
                  </button>
                  <button
                    className="primary-action"
                    onClick={() => setDiscoveryOpen(false)}
                  >
                    {t("discovery.finish")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {helpOpen && (
        <div
          className="help-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHelpOpen(false);
          }}
        >
          <div className="help-panel">
            <div className="help-head">
              <div>
                <span className="help-kicker">{t("help.kicker")}</span>
                <h2 id="help-title">{t("help.title")}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setHelpOpen(false)}
                aria-label={t("help.close")}
              >
                <X size={19} />
              </button>
            </div>
            <div className="help-body">
              <section className="quick-start">
                <h3>{t("help.firstSession")}</h3>
                <ol>
                  <li><b>1</b><span><strong>{t("help.importTitle")}</strong><small>{t("help.importText")}</small></span></li>
                  <li><b>2</b><span><strong>{t("help.connectTitle")}</strong><small>{t("help.connectText")}</small></span></li>
                  <li><b>3</b><span><strong>{t("help.tracksTitle")}</strong><small>{t("help.tracksText")}</small></span></li>
                  <li><b>4</b><span><strong>{t("help.playTitle")}</strong><small>{t("help.playText")}</small></span></li>
                </ol>
              </section>
              <div className="help-grid">
                <section>
                  <div className="help-section-icon"><Gauge size={18} /></div>
                  <h3>{t("mode.tempo")}</h3>
                  <p>{t("help.tempoText")}</p>
                </section>
                <section>
                  <div className="help-section-icon"><Hand size={18} /></div>
                  <h3>{t("help.waitTitle")}</h3>
                  <p>{t("help.waitText")}</p>
                </section>
                <section>
                  <div className="help-section-icon"><Repeat2 size={18} /></div>
                  <h3>{t("sidebar.progressiveLoop")}</h3>
                  <p>{t("help.loopText")}</p>
                </section>
                <section>
                  <div className="help-section-icon"><Volume2 size={18} /></div>
                  <h3>{t("help.soundTitle")}</h3>
                  <p>{t("help.soundText")}</p>
                </section>
                <section>
                  <div className="help-section-icon"><Timer size={18} /></div>
                  <h3>{t("help.metronomeTitle")}</h3>
                  <p>{t("help.metronomeText")}</p>
                </section>
                <section>
                  <div className="help-section-icon"><Layers3 size={18} /></div>
                  <h3>{t("help.viewsTitle")}</h3>
                  <p>{t("help.viewsText")}</p>
                </section>
              </div>
              <section className="shortcuts">
                <div>
                  <h3>{t("help.shortcuts")}</h3>
                  <p><kbd>Space</kbd> {t("help.space")}</p>
                  <p><kbd>A–P</kbd> {t("help.testPiano")}</p>
                  <p><kbd>Esc</kbd> {t("help.escape")}</p>
                </div>
                <div className="browser-note">
                  <Maximize2 size={17} />
                  <span><strong>{t("help.compatibility")}</strong>{t("help.compatibilityText")}</span>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
      {showSplash && (
        <div className="app-splash" role="status" aria-live="polite">
          <div className="splash-ambient ambient-one" />
          <div className="splash-ambient ambient-two" />
          <div className="splash-content">
            <div className="splash-logo">
              <Music2 size={31} strokeWidth={2.5} />
            </div>
            <div className="splash-name">PLAYALONG<b>3D</b></div>
            <p>{t("splash.tagline")}</p>
            <div className="splash-progress" aria-label={t("splash.loading", { progress: loadingProgress })}>
              <i style={{ width: `${loadingProgress}%` }} />
            </div>
            <div className="splash-meta">
              <span>{t(loadingStatusKey)}</span>
              <strong>{loadingProgress}%</strong>
            </div>
          </div>
          <small className="splash-version">{t("splash.version")}</small>
        </div>
      )}
    </div>
  );
}
