import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import {
  DEMO_SONGS,
  MAX_CROSSING_FINGER_DISTANCE,
  analyzeHarmony,
  annotateForPractice,
  createDemoSong,
  parseMidiFile,
} from "./music";

describe("harmonic analysis and fingering", () => {
  it("provides several built-in major and minor scales", () => {
    expect(DEMO_SONGS.map((demo) => demo.id)).toEqual([
      "demo:c-major",
      "demo:g-major",
      "demo:f-major",
      "demo:a-minor",
    ]);

    for (const demo of DEMO_SONGS) {
      const song = createDemoSong(demo.id);
      const rightPitches = song.rawNotes
        .filter((note) => note.trackId === 1)
        .map((note) => (note.midi - demo.tonic + 12) % 12);
      const expectedPitchClasses = new Set(
        demo.intervals.map((interval) => interval % 12),
      );
      expect(new Set(rightPitches)).toEqual(expectedPitchClasses);
    }
  });

  it("recognises the demo as C major", () => {
    const song = createDemoSong();
    const harmony = analyzeHarmony(song.rawNotes, song.ppq);
    expect(harmony[0].label).toBe("Do majeur");
  });

  it("assigns valid finger numbers to every selected note", () => {
    const song = createDemoSong();
    const result = annotateForPractice(
      song.rawNotes,
      song.tracks,
      song.ppq,
    );
    expect(result.notes.length).toBe(song.rawNotes.length);
    expect(result.notes.every((note) => note.finger >= 1 && note.finger <= 5)).toBe(
      true,
    );
  });

  it("repositions the hand after crossings of at most two fingers", () => {
    const song = createDemoSong();
    const notes = annotateForPractice(
      song.rawNotes,
      song.tracks,
      song.ppq,
    ).notes
      .filter((note) => note.hand === "right")
      .sort((a, b) => a.time - b.time || a.midi - b.midi);

    const crossings = notes
      .slice(1)
      .map((note, index) => {
        const previous = notes[index];
        const pitchDelta = note.midi - previous.midi;
        const fingerDelta = note.finger - previous.finger;
        return {
          index: index + 1,
          distance: Math.abs(fingerDelta),
          crossing:
            pitchDelta !== 0 &&
            fingerDelta !== 0 &&
            Math.sign(pitchDelta) !== Math.sign(fingerDelta),
        };
      })
      .filter(({ crossing }) => crossing);

    expect(crossings.length).toBeGreaterThan(0);
    expect(
      crossings.every(
        ({ distance }) => distance <= MAX_CROSSING_FINGER_DISTANCE,
      ),
    ).toBe(true);
    for (const crossing of crossings) {
      expect(notes[crossing.index].handPosition).toBeCloseTo(
        notes[crossing.index - 1].handPosition,
      );
    }
    expect(
      crossings.some(
        ({ index }) =>
          index + 1 < notes.length &&
          Math.abs(
            notes[index + 1].handPosition - notes[index].handPosition,
          ) > 0.1,
      ),
    ).toBe(true);
  });

  it("uses distinct ordered fingers for a chord spanning one octave", () => {
    const song = createDemoSong();
    const pitches = [60, 64, 67, 72];
    const rawNotes = pitches.map((midi, index) => ({
      ...song.rawNotes[0],
      id: `octave-chord-${index}`,
      midi,
      time: 0,
      ticks: 0,
      trackId: 9,
      trackName: "Octave chord",
    }));
    const track = {
      ...song.tracks[1],
      id: 9,
      name: "Octave chord",
      noteCount: pitches.length,
      minPitch: 60,
      maxPitch: 72,
      averagePitch: 65.75,
      handHint: "right" as const,
    };
    const chord = annotateForPractice(rawNotes, [track], song.ppq).notes.sort(
      (a, b) => a.midi - b.midi,
    );

    expect(new Set(chord.map((note) => note.finger)).size).toBe(chord.length);
    expect(chord.map((note) => note.finger)).toEqual([1, 2, 4, 5]);
    expect(chord[3].midi - chord[0].midi).toBe(12);
  });

  it("splits a single two-hand track around middle C", () => {
    const song = createDemoSong();
    const combinedNotes = song.rawNotes.map((note, index) => ({
      ...note,
      id: `combined-${index}`,
      trackId: 0,
      trackName: "Piano complet",
    }));
    const combinedTrack = {
      ...song.tracks[0],
      name: "Piano complet",
      noteCount: combinedNotes.length,
      averagePitch: 59,
      minPitch: Math.min(...combinedNotes.map((note) => note.midi)),
      maxPitch: Math.max(...combinedNotes.map((note) => note.midi)),
      handHint: "both" as const,
    };

    const result = annotateForPractice(
      combinedNotes,
      [combinedTrack],
      song.ppq,
    );

    expect(new Set(result.notes.map((note) => note.hand))).toEqual(
      new Set(["left", "right"]),
    );
  });

  it("keeps the same pitch and short phrase on a stable hand", () => {
    const song = createDemoSong();
    const phrasePitches = [59, 60, 59, 60, 60, 59, 60];
    const rawNotes = phrasePitches.map((midi, index) => ({
      ...song.rawNotes[0],
      id: `stable-phrase-${index}`,
      midi,
      time: index * 0.22,
      ticks: index * 106,
      trackId: 11,
      trackName: "Mixed piano",
    }));
    const track = {
      ...song.tracks[0],
      id: 11,
      name: "Mixed piano",
      noteCount: rawNotes.length,
      minPitch: 40,
      maxPitch: 80,
      averagePitch: 60,
      handHint: "both" as const,
    };

    const phrase = annotateForPractice(rawNotes, [track], song.ppq).notes;
    expect(new Set(phrase.map((note) => note.hand)).size).toBe(1);
    for (const midi of new Set(phrasePitches)) {
      expect(
        new Set(
          phrase
            .filter((note) => note.midi === midi)
            .map((note) => note.hand),
        ).size,
      ).toBe(1);
    }
  });

  it("changes hands for a rapid jump between distant registers", () => {
    const song = createDemoSong();
    const rawNotes = [40, 79, 41, 81].map((midi, index) => ({
      ...song.rawNotes[0],
      id: `register-jump-${index}`,
      midi,
      time: index * 0.3,
      ticks: index * 144,
      trackId: 12,
      trackName: "Mixed registers",
    }));
    const track = {
      ...song.tracks[0],
      id: 12,
      name: "Mixed registers",
      noteCount: rawNotes.length,
      minPitch: 40,
      maxPitch: 81,
      averagePitch: 60,
      handHint: "both" as const,
    };

    const notes = annotateForPractice(rawNotes, [track], song.ppq).notes;
    expect(notes.filter((note) => note.midi < 60).every((note) => note.hand === "left")).toBe(true);
    expect(notes.filter((note) => note.midi > 60).every((note) => note.hand === "right")).toBe(true);
  });

  it("groups near-simultaneous chord events across timer boundaries", () => {
    const song = createDemoSong();
    const pitches = [45, 57, 61, 64];
    const rawNotes = pitches.map((midi, index) => ({
      ...song.rawNotes[0],
      id: `offset-chord-${index}`,
      midi,
      time: index * 0.006,
      ticks: index * 3,
      trackId: 13,
      trackName: "Offset chord",
    }));
    const track = {
      ...song.tracks[0],
      id: 13,
      name: "Offset chord",
      noteCount: rawNotes.length,
      minPitch: 45,
      maxPitch: 64,
      averagePitch: 56.75,
      handHint: "both" as const,
    };

    const notes = annotateForPractice(rawNotes, [track], song.ppq).notes;
    const left = notes.filter((note) => note.hand === "left");
    const right = notes.filter((note) => note.hand === "right");

    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(Math.max(...left.map((note) => note.midi))).toBeLessThan(
      Math.min(...right.map((note) => note.midi)),
    );
    for (const handNotes of [left, right]) {
      const pitchesForHand = handNotes.map((note) => note.midi);
      expect(
        Math.max(...pitchesForHand) - Math.min(...pitchesForHand),
      ).toBeLessThanOrEqual(12);
    }
  });

  it("parses a standard MIDI file into selectable tracks", async () => {
    const midi = new Midi();
    midi.header.setTempo(96);
    const track = midi.addTrack();
    track.name = "Piano test";
    track.addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 0.8 });
    track.addNote({ midi: 64, ticks: 480, durationTicks: 480, velocity: 0.7 });
    const midiBytes = midi.toArray();
    const file = new File([midiBytes.buffer as ArrayBuffer], "exercise.mid", {
      type: "audio/midi",
    });

    const result = await parseMidiFile(file);

    expect(result.name).toBe("exercise");
    expect(result.bpm).toBe(96);
    expect(result.tracks[0].name).toBe("Piano test");
    expect(result.rawNotes.map((note) => note.midi)).toEqual([60, 64]);
  });
});
