# Playalong 3D

Playalong 3D is a browser-based piano learning app for Standard MIDI files and
MIDI keyboards. Its Synthesia-inspired interface combines a vertical piano
roll, calculated fingerings, an interactive keyboard, and optional virtual
hands in a WebGL scene.

The interface is available in French, English, German, and Spanish. It selects
the browser language on the first visit and remembers later changes.

## Live version

The production build is deployed with GitHub Pages:

<https://bugounet.github.io/playalong3D/>

Web MIDI requires a secure context, so use the HTTPS address above, `localhost`,
Chrome, or Edge when connecting a real keyboard.

## Getting started

Prerequisite: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`. A C major demo is loaded by default. Use
**Import MIDI** to open a `.mid` or `.midi` file.

To connect a piano, select **Connect MIDI**, grant browser access, and use the
keyboard discovery assistant to play its lowest and highest keys. You can also
test the app without hardware by clicking the 3D keyboard or using the `A`–`P`
computer keys.

## Features

- Standard MIDI File import and parsing;
- selection of one or two tracks, with automatic or manual left/right-hand
  assignment;
- support for a single piano track containing both hands;
- left hand, right hand, or both-hands practice;
- 3D perspective and flat 2D piano-roll views;
- colored falling notes, finger numbers, active keys, and optional virtual
  hands;
- **In time** mode with timing-distance scoring;
- **Wait for note** mode, including chord handling;
- progressive measure loops from 50% to 100% tempo in 5% steps, requiring a
  score of 95/100 before advancing;
- Web MIDI input, an on-screen piano, and Web Audio MIDI playback;
- per-track audio previews to help identify poorly named MIDI tracks;
- MIDI keyboard range discovery;
- an accented metronome and music-tempo control from 25% to 200%;
- performance summaries combining timing, wrong notes, and missed notes;
- a responsive, localized interface and static deployment through GitHub
  Pages.

## Key and fingering analysis

MIDI files generally contain no fingering data. The engine performs harmonic
analysis before assigning fingers:

1. The selected score is divided into four-measure windows.
2. A twelve-pitch-class histogram is weighted by note duration and velocity.
3. All 24 major and minor keys are compared using Krumhansl–Schmuckler
   profiles. The closest profile determines the local key and confidence.
4. Automatic tracks are assigned by register. A mixed piano track is split
   around middle C.
5. Dynamic programming evaluates all five fingers for each hand and minimizes
   a cost combining hand-position movement, reach, same-finger repetition,
   crossings, thumb passages, thumb use on black keys, and conventional
   fingerings for the detected scale.
6. A chord-specific pass ensures distinct, ordered fingers for simultaneous
   notes.

The calculation is deterministic: the same file and selected tracks always
produce the same fingerings. Possible future improvements include configurable
biomechanical constraints such as hand size and maximum reach, plus an editor
for locking preferred fingerings.

## Architecture

- React, TypeScript, and Vite for the interface;
- Three.js through React Three Fiber for the 3D scene;
- `@tonejs/midi` for file parsing;
- Web MIDI API for hardware input;
- Web Audio API for playback, previews, and the metronome;
- pure music and scoring logic in `src/lib`, tested with Vitest.

## Validation and production build

```bash
npm test
npm run build
```

The production files are generated in `dist/`.

Pushes to `main` automatically trigger the workflow in
`.github/workflows/deploy-pages.yml`, which builds and publishes the app to
GitHub Pages.
