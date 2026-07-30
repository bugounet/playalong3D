export type Hand = "left" | "right";
export type HandMode = "left" | "right" | "both";
export type PracticeMode = "tempo" | "wait";
export type HandHint = "auto" | Hand | "both";

export interface RawNote {
  id: string;
  midi: number;
  name: string;
  time: number;
  duration: number;
  velocity: number;
  ticks: number;
  durationTicks: number;
  trackId: number;
  trackName: string;
}

export interface PracticeNote extends RawNote {
  hand: Hand;
  finger: number;
  harmonicKey: string;
  inScale: boolean;
}

export interface TrackInfo {
  id: number;
  name: string;
  instrument: string;
  channel: number;
  noteCount: number;
  averagePitch: number;
  minPitch: number;
  maxPitch: number;
  selected: boolean;
  handHint: HandHint;
}

export interface HarmonicWindow {
  startTick: number;
  endTick: number;
  tonic: number;
  mode: "major" | "minor";
  label: string;
  confidence: number;
  scalePitchClasses: Set<number>;
}

export interface SongData {
  name: string;
  duration: number;
  bpm: number;
  ppq: number;
  timeSignature: [number, number];
  tracks: TrackInfo[];
  rawNotes: RawNote[];
}

export interface ScoreState {
  correct: number;
  missed: number;
  wrong: number;
  timingSum: number;
  streak: number;
  bestStreak: number;
}

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
}

export interface MidiInputEvent {
  note: number;
  velocity: number;
  type: "on" | "off";
}
