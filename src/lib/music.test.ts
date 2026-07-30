import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import {
  analyzeHarmony,
  annotateForPractice,
  createDemoSong,
  parseMidiFile,
} from "./music";

describe("harmonic analysis and fingering", () => {
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
