import { Midi } from "@tonejs/midi";
import type {
  Hand,
  HandHint,
  HarmonicWindow,
  PracticeNote,
  RawNote,
  SongData,
  TrackInfo,
} from "../types";

const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];

const FRENCH_KEYS = [
  "Do",
  "Do♯",
  "Ré",
  "Mi♭",
  "Mi",
  "Fa",
  "Fa♯",
  "Sol",
  "La♭",
  "La",
  "Si♭",
  "Si",
];

const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

export function noteName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function correlation(a: number[], b: number[]) {
  const avgA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const avgB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let numerator = 0;
  let denA = 0;
  let denB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const da = a[index] - avgA;
    const db = b[index] - avgB;
    numerator += da * db;
    denA += da * da;
    denB += db * db;
  }
  return numerator / Math.sqrt(Math.max(denA * denB, 0.0001));
}

function rotatedProfile(profile: number[], tonic: number) {
  return Array.from({ length: 12 }, (_, pitchClass) => {
    const profileIndex = (pitchClass - tonic + 12) % 12;
    return profile[profileIndex];
  });
}

/**
 * Harmonic analysis uses four-measure windows and a duration-weighted
 * Krumhansl–Schmuckler pitch-class profile. Small overlaps keep modulations
 * from producing abrupt, implausible hand changes.
 */
export function analyzeHarmony(
  notes: RawNote[],
  ppq: number,
  beatsPerMeasure = 4,
): HarmonicWindow[] {
  if (notes.length === 0) {
    return [
      {
        startTick: 0,
        endTick: ppq * beatsPerMeasure * 4,
        tonic: 0,
        mode: "major",
        label: "Do majeur",
        confidence: 1,
        scalePitchClasses: new Set(MAJOR_INTERVALS),
      },
    ];
  }

  const windowTicks = ppq * beatsPerMeasure * 4;
  const lastTick = Math.max(
    ...notes.map((note) => note.ticks + note.durationTicks),
  );
  const windows: HarmonicWindow[] = [];

  for (let startTick = 0; startTick <= lastTick; startTick += windowTicks) {
    const endTick = startTick + windowTicks;
    const histogram = Array(12).fill(0) as number[];
    for (const note of notes) {
      const overlap = Math.max(
        0,
        Math.min(note.ticks + note.durationTicks, endTick) -
          Math.max(note.ticks, startTick),
      );
      if (overlap > 0) {
        histogram[note.midi % 12] += overlap * (0.6 + note.velocity * 0.4);
      }
    }

    if (histogram.every((value) => value === 0)) continue;

    const candidates = Array.from({ length: 12 }, (_, tonic) => [
      {
        tonic,
        mode: "major" as const,
        score: correlation(histogram, rotatedProfile(MAJOR_PROFILE, tonic)),
      },
      {
        tonic,
        mode: "minor" as const,
        score: correlation(histogram, rotatedProfile(MINOR_PROFILE, tonic)),
      },
    ]).flat();
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const second = candidates[1];
    const intervals =
      best.mode === "major" ? MAJOR_INTERVALS : MINOR_INTERVALS;
    const scalePitchClasses = new Set(
      intervals.map((interval) => (interval + best.tonic) % 12),
    );

    windows.push({
      startTick,
      endTick,
      tonic: best.tonic,
      mode: best.mode,
      label: `${FRENCH_KEYS[best.tonic]} ${
        best.mode === "major" ? "majeur" : "mineur"
      }`,
      confidence: Math.max(0, Math.min(1, (best.score - second.score) * 2 + 0.5)),
      scalePitchClasses,
    });
  }

  return windows;
}

function windowForNote(note: RawNote, windows: HarmonicWindow[]) {
  return (
    windows.find(
      (window) =>
        note.ticks >= window.startTick && note.ticks < window.endTick,
    ) ?? windows[windows.length - 1]
  );
}

function scaleFingerCost(
  midi: number,
  finger: number,
  hand: Hand,
  harmonicWindow: HarmonicWindow,
) {
  const pitchClass = midi % 12;
  const intervals =
    harmonicWindow.mode === "major" ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const scaleIndex = intervals.findIndex(
    (interval) => (interval + harmonicWindow.tonic) % 12 === pitchClass,
  );

  if (scaleIndex < 0) return finger === 1 ? 0.65 : 0.22;

  const rightPattern = [1, 2, 3, 1, 2, 3, 4];
  const leftPattern = [5, 4, 3, 2, 1, 3, 2];
  const expected = hand === "right" ? rightPattern[scaleIndex] : leftPattern[scaleIndex];
  return Math.abs(expected - finger) * 0.16;
}

function anchorFor(midi: number, finger: number, hand: Hand) {
  const direction = hand === "right" ? 1 : -1;
  return midi - direction * (finger - 1) * 1.75;
}

function transitionCost(
  previous: RawNote,
  current: RawNote,
  previousFinger: number,
  finger: number,
  hand: Hand,
) {
  const pitchDelta = current.midi - previous.midi;
  const fingerDelta = finger - previousFinger;
  const handDirection = hand === "right" ? 1 : -1;
  const sameOnset = Math.abs(current.time - previous.time) < 0.045;
  let cost =
    Math.abs(
      anchorFor(current.midi, finger, hand) -
        anchorFor(previous.midi, previousFinger, hand),
    ) * 0.32;

  if (pitchDelta === 0) {
    cost += finger === previousFinger ? -0.35 : 0.45;
  } else if (finger === previousFinger) {
    cost += 2.3 + Math.min(Math.abs(pitchDelta), 12) * 0.12;
  }

  const naturalDirection = Math.sign(pitchDelta) === Math.sign(fingerDelta * handDirection);
  if (!naturalDirection && pitchDelta !== 0 && fingerDelta !== 0) {
    const thumbPass =
      Math.abs(pitchDelta) <= 4 &&
      ((previousFinger === 3 && finger === 1) ||
        (previousFinger === 1 && finger === 3));
    cost += thumbPass ? 0.15 : 1.45;
  }

  const comfortableSpan = Math.abs(fingerDelta) * 2.3 + 1;
  if (Math.abs(pitchDelta) > comfortableSpan) {
    cost += (Math.abs(pitchDelta) - comfortableSpan) * 0.55;
  }
  if (sameOnset && finger === previousFinger) cost += 12;

  return cost;
}

function assignSequentialFingers(
  notes: RawNote[],
  hand: Hand,
  windows: HarmonicWindow[],
) {
  if (notes.length === 0) return new Map<string, number>();
  const sorted = [...notes].sort(
    (a, b) => a.time - b.time || a.midi - b.midi,
  );
  const costs = sorted.map(() => Array(5).fill(Number.POSITIVE_INFINITY));
  const backPointers = sorted.map(() => Array(5).fill(0));

  for (let finger = 1; finger <= 5; finger += 1) {
    const window = windowForNote(sorted[0], windows);
    const blackKeyPenalty =
      [1, 3, 6, 8, 10].includes(sorted[0].midi % 12) && finger === 1 ? 0.7 : 0;
    costs[0][finger - 1] =
      scaleFingerCost(sorted[0].midi, finger, hand, window) + blackKeyPenalty;
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const harmonicWindow = windowForNote(current, windows);
    for (let finger = 1; finger <= 5; finger += 1) {
      const blackKeyPenalty =
        [1, 3, 6, 8, 10].includes(current.midi % 12) && finger === 1 ? 0.7 : 0;
      const localCost =
        scaleFingerCost(current.midi, finger, hand, harmonicWindow) +
        blackKeyPenalty;
      for (let previousFinger = 1; previousFinger <= 5; previousFinger += 1) {
        const candidate =
          costs[index - 1][previousFinger - 1] +
          localCost +
          transitionCost(
            sorted[index - 1],
            current,
            previousFinger,
            finger,
            hand,
          );
        if (candidate < costs[index][finger - 1]) {
          costs[index][finger - 1] = candidate;
          backPointers[index][finger - 1] = previousFinger - 1;
        }
      }
    }
  }

  const result = new Map<string, number>();
  let fingerIndex = costs[costs.length - 1].indexOf(
    Math.min(...costs[costs.length - 1]),
  );
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    result.set(sorted[index].id, fingerIndex + 1);
    fingerIndex = backPointers[index][fingerIndex];
  }

  // Chords need distinct, ordered fingers. The DP above still supplies the
  // hand-position context; this pass enforces playable simultaneous shapes.
  const onsetGroups = new Map<number, RawNote[]>();
  for (const note of sorted) {
    const onset = Math.round(note.time * 50);
    onsetGroups.set(onset, [...(onsetGroups.get(onset) ?? []), note]);
  }
  for (const group of onsetGroups.values()) {
    if (group.length < 2) continue;
    const chord = [...group].sort((a, b) => a.midi - b.midi).slice(0, 5);
    chord.forEach((note, index) => {
      const distributedFinger =
        chord.length === 2
          ? [1, 5][index]
          : Math.round(1 + (index * 4) / (chord.length - 1));
      result.set(
        note.id,
        hand === "right" ? distributedFinger : 6 - distributedFinger,
      );
    });
  }

  return result;
}

function resolveTrackHands(
  tracks: TrackInfo[],
): Map<number, Hand | "split"> {
  const selected = tracks.filter((track) => track.selected);
  const result = new Map<number, Hand | "split">();
  const automatic = selected.filter((track) => track.handHint === "auto");

  for (const track of selected) {
    if (track.handHint === "both") result.set(track.id, "split");
    else if (track.handHint !== "auto") result.set(track.id, track.handHint);
  }

  if (automatic.length === 1) {
    const track = automatic[0];
    const spansBothRegisters =
      track.minPitch <= 55 &&
      track.maxPitch >= 64 &&
      track.maxPitch - track.minPitch >= 12;
    if (selected.length === 1 && spansBothRegisters) {
      result.set(track.id, "split");
    } else {
      result.set(track.id, track.averagePitch < 60 ? "left" : "right");
    }
  } else if (automatic.length > 1) {
    const sorted = [...automatic].sort((a, b) => a.averagePitch - b.averagePitch);
    sorted.forEach((track, index) => {
      result.set(track.id, index < sorted.length / 2 ? "left" : "right");
    });
  }

  return result;
}

export function annotateForPractice(
  rawNotes: RawNote[],
  tracks: TrackInfo[],
  ppq: number,
  beatsPerMeasure = 4,
) {
  const selectedIds = new Set(
    tracks.filter((track) => track.selected).map((track) => track.id),
  );
  const selectedNotes = rawNotes.filter((note) => selectedIds.has(note.trackId));
  const windows = analyzeHarmony(selectedNotes, ppq, beatsPerMeasure);
  const trackHands = resolveTrackHands(tracks);

  const handed = selectedNotes.map((note) => {
    const assignment = trackHands.get(note.trackId) ?? "split";
    const hand: Hand =
      assignment === "split" ? (note.midi < 60 ? "left" : "right") : assignment;
    return { note, hand };
  });
  const leftFingers = assignSequentialFingers(
    handed.filter(({ hand }) => hand === "left").map(({ note }) => note),
    "left",
    windows,
  );
  const rightFingers = assignSequentialFingers(
    handed.filter(({ hand }) => hand === "right").map(({ note }) => note),
    "right",
    windows,
  );

  const notes: PracticeNote[] = handed.map(({ note, hand }) => {
    const harmonicWindow = windowForNote(note, windows);
    return {
      ...note,
      hand,
      finger:
        (hand === "left" ? leftFingers : rightFingers).get(note.id) ?? 1,
      harmonicKey: harmonicWindow.label,
      inScale: harmonicWindow.scalePitchClasses.has(note.midi % 12),
    };
  });

  return { notes, windows };
}

export async function parseMidiFile(file: File): Promise<SongData> {
  const bytes = await file.arrayBuffer();
  const midi = new Midi(bytes);
  const usableTracks = midi.tracks
    .map((track, sourceIndex) => ({ track, sourceIndex }))
    .filter(({ track }) => track.notes.length > 0);

  const tracks: TrackInfo[] = usableTracks.map(({ track, sourceIndex }, index) => {
    const averagePitch =
      track.notes.reduce((sum, note) => sum + note.midi, 0) /
      track.notes.length;
    return {
      id: sourceIndex,
      name: track.name || `Piste ${sourceIndex + 1}`,
      instrument: track.instrument.name || "Piano",
      channel: track.channel + 1,
      noteCount: track.notes.length,
      averagePitch,
      minPitch: Math.min(...track.notes.map((note) => note.midi)),
      maxPitch: Math.max(...track.notes.map((note) => note.midi)),
      selected: index < 2,
      handHint: "auto",
    };
  });

  const rawNotes = usableTracks.flatMap(({ track, sourceIndex }) =>
    track.notes.map((note, noteIndex) => ({
      id: `${sourceIndex}-${noteIndex}-${note.ticks}`,
      midi: note.midi,
      name: note.name,
      time: note.time,
      duration: Math.max(note.duration, 0.06),
      velocity: note.velocity,
      ticks: note.ticks,
      durationTicks: note.durationTicks,
      trackId: sourceIndex,
      trackName: track.name || `Piste ${sourceIndex + 1}`,
    })),
  );

  const firstTempo = midi.header.tempos[0]?.bpm ?? 120;
  const firstTimeSignature = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];

  return {
    name: file.name.replace(/\.(midi?|smf)$/i, ""),
    duration: midi.duration,
    bpm: Math.round(firstTempo),
    ppq: midi.header.ppq,
    timeSignature: [firstTimeSignature[0], firstTimeSignature[1]],
    tracks,
    rawNotes,
  };
}

function makeScale(
  start: number,
  hand: Hand,
  trackId: number,
  timeOffset: number,
): RawNote[] {
  const ascending = [0, 2, 4, 5, 7, 9, 11, 12];
  const sequence = [...ascending, ...ascending.slice(0, -1).reverse()];
  return sequence.map((interval, index) => ({
    id: `demo-${trackId}-${index}-${timeOffset}`,
    midi: start + interval,
    name: noteName(start + interval),
    time: timeOffset + index * 0.48,
    duration: index === 7 ? 0.82 : 0.42,
    velocity: 0.78,
    ticks: Math.round((timeOffset + index * 0.48) * 960),
    durationTicks: index === 7 ? 788 : 403,
    trackId,
    trackName: hand === "left" ? "Main gauche" : "Main droite",
  }));
}

export function createDemoSong(): SongData {
  const right = makeScale(60, "right", 1, 1.2);
  const bassRoots = [48, 45, 41, 43, 48, 43, 45, 48];
  const left: RawNote[] = bassRoots.map((midi, index) => ({
    id: `demo-left-${index}`,
    midi,
    name: noteName(midi),
    time: 1.2 + index * 0.96,
    duration: 0.82,
    velocity: 0.72,
    ticks: Math.round((1.2 + index * 0.96) * 960),
    durationTicks: 788,
    trackId: 0,
    trackName: "Main gauche",
  }));

  return {
    name: "Gamme de Do — Démo",
    duration: 9.2,
    bpm: 125,
    ppq: 480,
    timeSignature: [4, 4],
    tracks: [
      {
        id: 0,
        name: "Main gauche",
        instrument: "Piano acoustique",
        channel: 1,
        noteCount: left.length,
        averagePitch: 45,
        minPitch: Math.min(...left.map((note) => note.midi)),
        maxPitch: Math.max(...left.map((note) => note.midi)),
        selected: true,
        handHint: "left",
      },
      {
        id: 1,
        name: "Main droite",
        instrument: "Piano acoustique",
        channel: 2,
        noteCount: right.length,
        averagePitch: 67,
        minPitch: Math.min(...right.map((note) => note.midi)),
        maxPitch: Math.max(...right.map((note) => note.midi)),
        selected: true,
        handHint: "right",
      },
    ],
    rawNotes: [...left, ...right],
  };
}
