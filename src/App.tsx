import {
  ChevronDown,
  CircleHelp,
  Gauge,
  Hand,
  KeyboardMusic,
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
  SlidersHorizontal,
  Sparkles,
  Timer,
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
  annotateForPractice,
  createDemoSong,
  noteName,
  parseMidiFile,
} from "./lib/music";
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

function describeKeyboard(keyCount: number) {
  const commonFormats: Record<number, string> = {
    25: "Mini-clavier 25 touches",
    32: "Clavier 32 touches",
    37: "Clavier 37 touches",
    44: "Clavier 44 touches",
    49: "Clavier 49 touches",
    54: "Clavier 54 touches",
    61: "Clavier 61 touches",
    73: "Clavier 73 touches",
    76: "Clavier 76 touches",
    88: "Piano 88 touches",
  };
  return commonFormats[keyCount] ?? `Clavier ${keyCount} touches`;
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
  const groups = new Map<number, PracticeNote[]>();
  for (const note of [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi)) {
    const key = Math.round(note.time * 40);
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  return Array.from(groups.values()).sort((a, b) => a[0].time - b[0].time);
}

function trackHandLabel(hint: HandHint) {
  if (hint === "left") return "G";
  if (hint === "right") return "D";
  if (hint === "both") return "2M";
  return "Auto";
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(72);
  const [loadingStatus, setLoadingStatus] = useState("Initialisation de la scène 3D…");
  const [song, setSong] = useState<SongData>(() => createDemoSong());
  const [tracks, setTracks] = useState<TrackInfo[]>(song.tracks);
  const [handMode, setHandMode] = useState<HandMode>("both");
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("tempo");
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [tempoPercent, setTempoPercent] = useState(100);
  const [showHands, setShowHands] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStartBar, setLoopStartBar] = useState(1);
  const [loopEndBar, setLoopEndBar] = useState(2);
  const [score, setScore] = useState<ScoreState>(EMPTY_SCORE);
  const [activeMidi, setActiveMidi] = useState<Set<number>>(new Set());
  const [waitIndex, setWaitIndex] = useState(0);
  const [waitHits, setWaitHits] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [midiPlaybackEnabled, setMidiPlaybackEnabled] = useState(true);
  const [masterVolume, setMasterVolumeState] = useState(72);
  const [volumePanelOpen, setVolumePanelOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"perspective" | "flat">("perspective");
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveryStep, setDiscoveryStep] = useState<DiscoveryStep>("low");
  const [discoveryLowNote, setDiscoveryLowNote] = useState<number | null>(null);
  const [keyboardCalibration, setKeyboardCalibration] =
    useState<KeyboardCalibration | null>(null);
  const [performanceSummary, setPerformanceSummary] =
    useState<PerformanceSummaryData | null>(null);
  const [loopFeedback, setLoopFeedback] = useState<LoopFeedback | null>(null);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [metronomePanelOpen, setMetronomePanelOpen] = useState(false);
  const [previewTrackId, setPreviewTrackId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playheadRef = useRef(playhead);
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
  const {
    noteOn,
    noteOff,
    tap,
    stopAll,
    setMasterVolume,
    metronomeClick,
    ensureContext,
  } = usePianoSynth();

  useEffect(() => {
    const stages = [
      window.setTimeout(() => {
        setLoadingProgress(84);
        setLoadingStatus("Préparation du moteur MIDI…");
      }, 120),
      window.setTimeout(() => {
        setLoadingProgress(94);
        setLoadingStatus("Calcul des premiers doigtés…");
      }, 360),
      window.setTimeout(() => {
        setLoadingProgress(100);
        setLoadingStatus("Prêt");
      }, 650),
      window.setTimeout(() => setShowSplash(false), 920),
    ];
    return () => stages.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
        setVolumePanelOpen(false);
        setMetronomePanelOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
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
      if (!preservePlayback) setPlaying(false);
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
      setPlaying(false);
      const trackNotes = song.rawNotes
        .filter((note) => note.trackId === trackId)
        .sort((a, b) => a.time - b.time || a.midi - b.midi);
      if (trackNotes.length === 0) {
        showNotice("Cette piste ne contient aucune note à écouter.");
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
    ],
  );

  useEffect(
    () => () => {
      for (const timer of previewTimersRef.current) window.clearTimeout(timer);
      previewTimersRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

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
    const precision = calculatePerformanceMetrics(attempt).precision;
    const passed = precision >= 95;

    if (passed && tempoPercent < 100) {
      const nextTempo = Math.min(100, tempoPercent + 5);
      setTempoPercent(nextTempo);
      setLoopFeedback({
        passed: true,
        score: precision,
        title: "Excellent, palier réussi !",
        detail: `Précision ${precision}/100 · passage au tempo ${nextTempo} %.`,
      });
    } else if (passed) {
      setLoopFeedback({
        passed: true,
        score: precision,
        title: "Boucle maîtrisée à 100 % !",
        detail: `Précision ${precision}/100 · vous maîtrisez ce passage au tempo réel.`,
      });
    } else {
      setLoopFeedback({
        passed: false,
        score: precision,
        title: "Encore un effort",
        detail: `Précision ${precision}/100 · objectif 95, recommencez au même tempo.`,
      });
    }
    window.setTimeout(() => setLoopFeedback(null), 3800);
    resetAttempt(loopStart, true);
  }, [loopStart, resetAttempt, tempoPercent]);

  const finishPerformance = useCallback(() => {
    const finalScore = { ...scoreRef.current };
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
          metronomeClick(beatIndex % song.timeSignature[0] === 0);
        }
        beat += beatDuration;
      }
      nextMetronomeBeatRef.current = beat;
    },
    [beatDuration, metronomeClick, metronomeEnabled, song.timeSignature],
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
          showNotice("La touche aiguë doit être plus haute que la touche grave.");
          return;
        }

        const keyCount = event.note - discoveryLowNote + 1;
        const calibration: KeyboardCalibration = {
          lowNote: discoveryLowNote,
          highNote: event.note,
          keyCount,
          label: describeKeyboard(keyCount),
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
    ],
  );

  const midi = useMidiInput(handleMidiEvent);

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
        stopTrackPreview();
        ensureContext();
        setPlaying((current) => {
          if (current) stopAll();
          else {
            syncAudioCursor(playheadRef.current);
            syncMetronome(playheadRef.current);
          }
          return !current;
        });
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
    ensureContext,
    registerNoteOff,
    registerNoteOn,
    stopAll,
    stopTrackPreview,
    syncAudioCursor,
    syncMetronome,
  ]);

  const currentTargets = useMemo(() => {
    if (practiceMode === "wait") return onsetGroups[waitIndex] ?? [];
    const upcoming = onsetGroups.find(
      (group) => group[0].time >= playhead - 0.16,
    );
    return upcoming ?? [];
  }, [onsetGroups, playhead, practiceMode, waitIndex]);

  const handleFile = useCallback(
    async (file?: File) => {
      if (!file) return;
      if (!/\.(mid|midi)$/i.test(file.name)) {
        showNotice("Choisissez un fichier .mid ou .midi");
        return;
      }
      setLoadingFile(true);
      stopTrackPreview();
      try {
        const parsed = await parseMidiFile(file);
        if (parsed.tracks.length === 0) throw new Error("empty");
        setSong(parsed);
        setTracks(parsed.tracks);
        setLoopStartBar(1);
        setLoopEndBar(Math.min(2, Math.max(1, Math.ceil(parsed.duration / 2))));
        setTempoPercent(100);
        syncAudioCursor(0);
        syncMetronome(0);
        setPlaying(false);
        setPlayhead(0);
        showNotice(`${parsed.rawNotes.length} notes MIDI chargées`);
      } catch {
        showNotice("Ce fichier MIDI ne contient aucune piste lisible.");
      } finally {
        setLoadingFile(false);
      }
    },
    [showNotice, stopTrackPreview, syncAudioCursor, syncMetronome],
  );

  const toggleTrack = (trackId: number) => {
    setTracks((current) => {
      const target = current.find((track) => track.id === trackId);
      if (!target) return current;
      const selectedCount = current.filter((track) => track.selected).length;
      if (!target.selected && selectedCount >= 2) {
        showNotice("Deux pistes maximum peuvent être travaillées ensemble.");
        return current;
      }
      if (target.selected && selectedCount === 1) {
        showNotice("Gardez au moins une piste active.");
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

  const togglePlayback = () => {
    stopTrackPreview();
    ensureContext();
    if (playheadRef.current >= effectiveEnd - 0.03) {
      resetAttempt(loopEnabled ? loopStart : 0, true);
    }
    setPlaying((current) => {
      if (current) stopAll();
      else {
        syncAudioCursor(playheadRef.current);
        syncMetronome(playheadRef.current);
      }
      return !current;
    });
  };

  const changeLoopEnabled = (enabled: boolean) => {
    setLoopEnabled(enabled);
    if (enabled) {
      setTempoPercent(50);
      showNotice("Boucle progressive démarrée à 50 %");
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
  const applyTempoBpm = (nextBpm: number) => {
    if (loopEnabled) return;
    const boundedBpm = Math.max(
      Math.round(song.bpm * 0.25),
      Math.min(Math.round(song.bpm * 2), nextBpm),
    );
    setTempoPercent(Math.round((boundedBpm / song.bpm) * 100));
    syncMetronome(playheadRef.current);
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
          aria-label="Ouvrir les réglages"
        >
          <Menu size={19} />
        </button>
        <div className="brand">
          <div className="brand-mark"><Music2 size={19} /></div>
          <span>PLAYALONG</span><b>3D</b>
        </div>
        <div className="song-summary">
          <div className="song-icon"><Music2 size={17} /></div>
          <div>
            <strong>{song.name}</strong>
            <span>
              {song.bpm} BPM · {song.timeSignature.join("/")} ·{" "}
              {practiceNotes.length} notes
            </span>
          </div>
          <ChevronDown size={16} />
        </div>
        <div className="top-actions">
          {midi.connected ? (
            <>
              <label className="midi-select connected">
                <span className="status-pulse" />
                <select
                  value={midi.selectedId}
                  onChange={(event) => midi.setSelectedId(event.target.value)}
                  aria-label="Entrée MIDI"
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
                  setPlaying(false);
                  stopAll();
                  setDiscoveryLowNote(null);
                  setDiscoveryStep("low");
                  setDiscoveryOpen(true);
                }}
                title="Découvrir l’étendue du piano"
              >
                <KeyboardMusic size={15} />
                <span>
                  {keyboardCalibration
                    ? `${keyboardCalibration.keyCount} touches`
                    : "Découvrir"}
                </span>
              </button>
            </>
          ) : (
            <button className="midi-connect" onClick={midi.requestAccess}>
              <PlugZap size={17} />
              <span>Connecter MIDI</span>
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Ouvrir l’aide"
            title="Aide"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={19} />
          </button>
          <button className="avatar" aria-label="Profil">SF</button>
        </div>
      </header>

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-mobile-head">
          <strong>Réglages</strong>
          <button className="icon-button" onClick={() => setSidebarOpen(false)}>
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
            <span>{loadingFile ? "Analyse du MIDI…" : "Importer un MIDI"}</span>
          </button>
          <small>ou déposez le fichier dans la fenêtre</small>
        </section>

        <section className="control-section">
          <div className="section-title">
            <span><Hand size={16} />Main à travailler</span>
          </div>
          <div className="segmented three">
            {(
              [
                ["left", "Gauche"],
                ["right", "Droite"],
                ["both", "Les deux"],
              ] as [HandMode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={handMode === value ? "active" : ""}
                onClick={() => setHandMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="control-section">
          <div className="section-title">
            <span><Gauge size={16} />Mode d’entraînement</span>
          </div>
          <div className="mode-cards">
            <button
              className={practiceMode === "tempo" ? "active" : ""}
              onClick={() => setPracticeMode("tempo")}
            >
              <span className="mode-icon"><Gauge size={18} /></span>
              <span><strong>En rythme</strong><small>Le tempo continue</small></span>
              <i />
            </button>
            <button
              className={practiceMode === "wait" ? "active" : ""}
              onClick={() => setPracticeMode("wait")}
            >
              <span className="mode-icon"><Hand size={18} /></span>
              <span><strong>Attendre la note</strong><small>Avance à votre rythme</small></span>
              <i />
            </button>
          </div>
        </section>

        <section className="control-section">
          <div className="section-title">
            <span><Layers3 size={16} />Pistes MIDI</span>
            <em>{tracks.filter((track) => track.selected).length}/2</em>
          </div>
          <div className="track-list">
            {tracks.slice(0, 8).map((track, index) => (
              <div
                className={`track-row ${track.selected ? "selected" : ""} ${
                  previewTrackId === track.id ? "previewing" : ""
                }`}
                key={track.id}
              >
                <button
                  className="track-check"
                  onClick={() => toggleTrack(track.id)}
                  aria-label={`${track.selected ? "Désactiver" : "Activer"} ${track.name}`}
                >
                  {track.selected && <span />}
                </button>
                <div className={`track-color color-${index % 4}`} />
                <button className="track-main" onClick={() => toggleTrack(track.id)}>
                  <strong>{track.name}</strong>
                  <small>{track.instrument} · {track.noteCount} notes</small>
                </button>
                <button
                  className="track-preview"
                  onClick={() => previewTrack(track.id)}
                  aria-label={
                    previewTrackId === track.id
                      ? `Arrêter l’aperçu de ${track.name}`
                      : `Écouter un aperçu de ${track.name}`
                  }
                  title={
                    previewTrackId === track.id
                      ? "Arrêter l’aperçu"
                      : "Écouter cette piste seule"
                  }
                >
                  {previewTrackId === track.id ? (
                    <Pause size={12} fill="currentColor" />
                  ) : (
                    <Play size={12} fill="currentColor" />
                  )}
                </button>
                <label className="hand-select" title="Attribution de la main">
                  <select
                    value={track.handHint}
                    disabled={!track.selected}
                    onChange={(event) =>
                      setTrackHand(track.id, event.target.value as HandHint)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="left">Gauche</option>
                    <option value="right">Droite</option>
                    <option value="both">Deux mains</option>
                  </select>
                  <span>{trackHandLabel(track.handHint)}</span>
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className="control-section toggles-section">
          <button
            className={`toggle-row ${showHands ? "enabled" : ""}`}
            onClick={() => setShowHands((current) => !current)}
          >
            <span><Sparkles size={16} /><span><strong>Mains virtuelles</strong><small>Position 3D complète</small></span></span>
            <i><b /></i>
          </button>
          <button
            className={`toggle-row ${loopEnabled ? "enabled" : ""}`}
            onClick={() => changeLoopEnabled(!loopEnabled)}
          >
            <span><Repeat2 size={16} /><span><strong>Boucle progressive</strong><small>50 → 100 % par 5 %</small></span></span>
            <i><b /></i>
          </button>
          {loopEnabled && (
            <div className="loop-settings">
              <label>
                Début
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
                      Mesure {index + 1}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fin
                <select
                  value={loopEndBar}
                  onChange={(event) =>
                    setLoopEndBar(Math.max(loopStartBar, Number(event.target.value)))
                  }
                >
                  {Array.from({ length: totalBars }, (_, index) => (
                    <option value={index + 1} key={index + 1}>
                      Mesure {index + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </section>

        <div className="analysis-card">
          <div><Sparkles size={15} /><span>Analyse harmonique</span></div>
          <strong>{tonalWindow?.label ?? "Do majeur"}</strong>
          <small>
            Confiance {Math.round((tonalWindow?.confidence ?? 1) * 100)} % ·
            doigtés recalculés
          </small>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Fermer les réglages"
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
                ? "Passer en vue 2D"
                : "Passer en vue perspective"
            }
            title={
              viewMode === "perspective"
                ? "Passer en vue 2D"
                : "Passer en vue perspective"
            }
          >
            <Layers3 size={15} />
            <span>
              {viewMode === "perspective" ? "Vue perspective" : "Vue 2D"}
            </span>
          </button>
          <div className="bar-indicator">
            MESURE{" "}
            <strong>
              {Math.min(totalBars, Math.floor(playhead / measureDuration) + 1)}
            </strong>
            <span>/ {totalBars}</span>
          </div>
          <div className="shortcut-hint">
            <KeyboardMusic size={15} />
            <span>Test clavier : A–P</span>
          </div>
        </div>

        <PianoStage
          notes={practiceNotes}
          playhead={playhead}
          activeMidi={activeMidi}
          currentTargets={currentTargets}
          showHands={showHands}
          viewMode={viewMode}
          score={score}
          onKeyDown={registerNoteOn}
          onKeyUp={registerNoteOff}
        />

        <div className="transport">
          <div className="transport-left">
            <button
              className="transport-icon"
              onClick={() => {
                stopTrackPreview();
                resetAttempt(loopEnabled ? loopStart : 0);
              }}
              aria-label="Recommencer"
              title="Recommencer"
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="play-button"
              onClick={togglePlayback}
              aria-label={playing ? "Pause" : "Lecture"}
            >
              {playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
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
              aria-label="Mesure suivante"
              title="Mesure suivante"
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
              aria-label="Position dans la partition"
              style={
                {
                  "--progress": `${
                    (playhead / Math.max(effectiveEnd, 0.01)) * 100
                  }%`,
                } as React.CSSProperties
              }
            />
            <div className="timeline-labels">
              <span>{practiceMode === "wait" ? "MODE ATTENTE" : "TEMPO LIBRE"}</span>
              {loopEnabled && <b>BOUCLE {loopStartBar}–{loopEndBar}</b>}
            </div>
          </div>

          <div className="transport-right">
            <div className="metric">
              <span>Précision</span>
              <strong>{performanceMetrics.precision}</strong><small>/100</small>
            </div>
            <div className="metric">
              <span>Notes</span>
              <strong>{score.correct}</strong><small>/{targetNoteCount}</small>
            </div>
            <label className="tempo-control">
              <span><SlidersHorizontal size={14} />Tempo</span>
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
                aria-label="Régler le métronome et le tempo"
                aria-expanded={metronomePanelOpen}
                title="Métronome et tempo"
              >
                <Timer size={17} />
              </button>
              {metronomePanelOpen && (
                <div className="metronome-popover">
                  <div className="metronome-head">
                    <span>Métronome</span>
                    <button
                      className={`mini-toggle ${metronomeEnabled ? "enabled" : ""}`}
                      onClick={() => {
                        ensureContext();
                        syncMetronome(playheadRef.current);
                        setMetronomeEnabled((current) => !current);
                      }}
                    >
                      <i />
                      {metronomeEnabled ? "Activé" : "Désactivé"}
                    </button>
                  </div>
                  <div className="bpm-display">
                    <button
                      onClick={() => applyTempoBpm(effectiveBpm - 5)}
                      disabled={loopEnabled}
                      aria-label="Ralentir de 5 BPM"
                    >
                      <Minus size={14} />
                    </button>
                    <div><strong>{effectiveBpm}</strong><span>BPM</span></div>
                    <button
                      onClick={() => applyTempoBpm(effectiveBpm + 5)}
                      disabled={loopEnabled}
                      aria-label="Accélérer de 5 BPM"
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
                    aria-label="Tempo de la musique"
                  />
                  <div className="tempo-scale">
                    <span>25 %</span>
                    <strong>{tempoPercent} % du tempo original</strong>
                    <span>200 %</span>
                  </div>
                  {loopEnabled && (
                    <p>Le tempo est piloté automatiquement par la boucle progressive.</p>
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
                aria-label="Régler le volume"
                aria-expanded={volumePanelOpen}
                title="Volume"
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
                    <span>Volume général</span>
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
                      aria-label="Volume général"
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
                      <><VolumeX size={14} />Couper le son</>
                    ) : (
                      <><Volume2 size={14} />Rétablir le son</>
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
      {performanceSummary && !loopEnabled && (
        <div
          className="summary-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="summary-title"
        >
          <div className="summary-panel">
            <span className="summary-kicker">FIN DE LA PARTITION</span>
            <h2 id="summary-title">
              {performanceSummary.metrics.precision >= 95
                ? "Magnifique prestation !"
                : performanceSummary.metrics.precision >= 80
                  ? "Très belle progression"
                  : "Chaque passage vous fait progresser"}
            </h2>
            <p>
              Votre précision combine le respect du rythme, les fausses notes
              et les notes manquées.
            </p>
            <div className="summary-score-ring">
              <strong>{performanceSummary.metrics.precision}</strong>
              <span>/100</span>
            </div>
            <div className="summary-stats">
              <div><span>Timing</span><strong>{performanceSummary.metrics.timing}%</strong></div>
              <div><span>Correctes</span><strong>{performanceSummary.score.correct}</strong></div>
              <div><span>Manquées</span><strong>{performanceSummary.score.missed}</strong></div>
              <div><span>Fausses</span><strong>{performanceSummary.score.wrong}</strong></div>
              <div><span>Meilleure série</span><strong>{performanceSummary.score.bestStreak}</strong></div>
            </div>
            <div className="summary-actions">
              <button
                className="secondary-action"
                onClick={() => setPerformanceSummary(null)}
              >
                Fermer
              </button>
              <button
                className="primary-action"
                onClick={() => {
                  resetAttempt(0, true);
                  setPlaying(true);
                }}
              >
                <RotateCcw size={14} /> Rejouer
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
              aria-label="Fermer la découverte du piano"
            >
              <X size={18} />
            </button>
            <div className="discovery-icon">
              <KeyboardMusic size={25} />
            </div>
            {discoveryStep !== "result" ? (
              <>
                <span className="discovery-kicker">
                  DÉCOUVERTE DU PIANO · ÉTAPE {discoveryStep === "low" ? "1" : "2"} SUR 2
                </span>
                <h2 id="discovery-title">
                  {discoveryStep === "low"
                    ? "Jouez la touche la plus grave"
                    : "Jouez maintenant la touche la plus aiguë"}
                </h2>
                <p>
                  {discoveryStep === "low"
                    ? "Appuyez une seule fois sur la toute première touche à gauche de votre clavier."
                    : `Première limite détectée : ${noteName(discoveryLowNote ?? 21)} · MIDI ${discoveryLowNote ?? 21}.`}
                </p>
                <div className={`discovery-keyboard ${discoveryStep}`}>
                  {Array.from({ length: 18 }, (_, index) => (
                    <i key={index} className={index % 7 === 2 || index % 7 === 5 ? "black-hint" : ""} />
                  ))}
                  <b />
                </div>
                <div className="discovery-listening">
                  <span className="status-pulse" />
                  En attente d’une note MIDI…
                </div>
              </>
            ) : (
              <>
                <span className="discovery-kicker">DÉCOUVERTE TERMINÉE</span>
                <h2 id="discovery-title">{keyboardCalibration?.label}</h2>
                <p>
                  Étendue détectée de{" "}
                  <strong>{noteName(keyboardCalibration?.lowNote ?? 21)}</strong>{" "}
                  à{" "}
                  <strong>{noteName(keyboardCalibration?.highNote ?? 108)}</strong>.
                </p>
                <div className="discovery-result">
                  <div><span>Touches</span><strong>{keyboardCalibration?.keyCount}</strong></div>
                  <div><span>Note grave</span><strong>{keyboardCalibration?.lowNote}</strong></div>
                  <div><span>Note aiguë</span><strong>{keyboardCalibration?.highNote}</strong></div>
                </div>
                <div className="discovery-actions">
                  <button
                    className="secondary-action"
                    onClick={() => {
                      setDiscoveryLowNote(null);
                      setDiscoveryStep("low");
                    }}
                  >
                    Recommencer
                  </button>
                  <button
                    className="primary-action"
                    onClick={() => setDiscoveryOpen(false)}
                  >
                    Terminer
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
                <span className="help-kicker">CENTRE D’AIDE</span>
                <h2 id="help-title">Bien démarrer</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setHelpOpen(false)}
                aria-label="Fermer l’aide"
              >
                <X size={19} />
              </button>
            </div>
            <div className="help-body">
              <section className="quick-start">
                <h3>Votre première session</h3>
                <ol>
                  <li><b>1</b><span><strong>Importez un fichier MIDI</strong><small>Utilisez le bouton à gauche ou déposez un fichier dans la fenêtre.</small></span></li>
                  <li><b>2</b><span><strong>Connectez votre piano</strong><small>Autorisez l’accès puis jouez ses touches extrêmes pour découvrir son étendue.</small></span></li>
                  <li><b>3</b><span><strong>Choisissez les pistes et les mains</strong><small>Activez une ou deux pistes, puis attribuez-les automatiquement ou manuellement.</small></span></li>
                  <li><b>4</b><span><strong>Lancez la lecture</strong><small>Suivez les barres colorées et jouez quand elles atteignent le clavier.</small></span></li>
                </ol>
              </section>
              <div className="help-grid">
                <section>
                  <div className="help-section-icon"><Gauge size={18} /></div>
                  <h3>En rythme</h3>
                  <p>Le morceau avance au tempo choisi. Votre score mesure l’écart entre votre frappe et la note attendue.</p>
                </section>
                <section>
                  <div className="help-section-icon"><Hand size={18} /></div>
                  <h3>Mode attente</h3>
                  <p>Le rouleau s’arrête sur chaque note ou accord et reprend lorsque toutes les bonnes touches sont jouées.</p>
                </section>
                <section>
                  <div className="help-section-icon"><Repeat2 size={18} /></div>
                  <h3>Boucle progressive</h3>
                  <p>Commence à 50 %, puis accélère de 5 % après chaque réussite jusqu’au tempo réel.</p>
                </section>
                <section>
                  <div className="help-section-icon"><Volume2 size={18} /></div>
                  <h3>Son et volume</h3>
                  <p>L’icône haut-parleur ouvre le volume général. En mode attente, les notes à travailler sont jouées par vous.</p>
                </section>
                <section>
                  <div className="help-section-icon"><Timer size={18} /></div>
                  <h3>Métronome et tempo</h3>
                  <p>L’icône chronomètre active les temps sonores et permet de ralentir ou accélérer toute la musique.</p>
                </section>
                <section>
                  <div className="help-section-icon"><Layers3 size={18} /></div>
                  <h3>Vues 3D et 2D</h3>
                  <p>Le bouton en haut du rouleau bascule entre la perspective immersive et une lecture verticale à plat.</p>
                </section>
              </div>
              <section className="shortcuts">
                <div>
                  <h3>Raccourcis</h3>
                  <p><kbd>Espace</kbd> Lecture / pause</p>
                  <p><kbd>A–P</kbd> Piano de test</p>
                  <p><kbd>Échap</kbd> Fermer les panneaux</p>
                </div>
                <div className="browser-note">
                  <Maximize2 size={17} />
                  <span><strong>Compatibilité MIDI</strong>Utilisez Chrome ou Edge sur une page HTTPS ou sur localhost.</span>
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
            <p>Votre piano. Votre rythme.</p>
            <div className="splash-progress" aria-label={`Chargement ${loadingProgress} %`}>
              <i style={{ width: `${loadingProgress}%` }} />
            </div>
            <div className="splash-meta">
              <span>{loadingStatus}</span>
              <strong>{loadingProgress}%</strong>
            </div>
          </div>
          <small className="splash-version">MIDI LEARNING STUDIO · v0.1</small>
        </div>
      )}
    </div>
  );
}
