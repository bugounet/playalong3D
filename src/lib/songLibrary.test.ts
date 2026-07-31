import { describe, expect, it } from "vitest";
import { storedMidiId } from "./songLibrary";

describe("local MIDI library", () => {
  it("uses stable file metadata to deduplicate repeated imports", () => {
    const metadata = {
      name: "practice.mid",
      size: 72_768,
      lastModified: 1_721_000_000_000,
    };

    expect(storedMidiId(metadata)).toBe(storedMidiId({ ...metadata }));
    expect(
      storedMidiId({ ...metadata, lastModified: metadata.lastModified + 1 }),
    ).not.toBe(storedMidiId(metadata));
  });
});
