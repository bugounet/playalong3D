export const MOBILE_PIANO_KEY_COUNT = 8;

export function compactMidiRangeAround(midi: number) {
  const minimumMidi = 21;
  const maximumStart = 108 - MOBILE_PIANO_KEY_COUNT + 1;
  const start = Math.max(
    minimumMidi,
    Math.min(maximumStart, Math.round(midi) - 3),
  );
  return Array.from(
    { length: MOBILE_PIANO_KEY_COUNT },
    (_, index) => start + index,
  );
}
