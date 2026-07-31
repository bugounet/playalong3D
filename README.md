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

Web MIDI requires a secure context and a compatible browser. Use the HTTPS
address above, or `localhost` during development. Chrome and Edge are the
recommended browsers when connecting a real keyboard.

## Getting started

Prerequisite: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`. The C major scale is loaded by default. The
score picker also includes G major, F major, and A minor exercises. Use
**Import MIDI** to open a `.mid` or `.midi` file.

To connect a piano, select **Connect MIDI**, grant browser access, and use the
keyboard discovery assistant to play its lowest and highest keys. You can also
test the app without hardware by clicking the 3D keyboard or using the `A`–`P`
computer keys.

## Typical practice workflow

1. Open the score picker to select a built-in scale, reopen a locally saved
   MIDI file, or import another file.
2. Enable one or two MIDI tracks. Each imported track has an audio preview so
   it can be identified even when the embedded track name is unhelpful.
3. Choose the left hand, right hand, or both hands, and select **In time** or
   **Wait for note** mode. A single MIDI track can be analysed as a two-hand
   piano part.
4. Optionally enable the virtual hands, metronome, or progressive loop, then
   start playback. Every start uses an animated, tempo-synchronized 3–2–1
   count-in with metronome clicks. The metronome control changes both the music
   tempo and its own independent click volume.
5. At the end of a normal run, review the timing, correct notes, missed notes,
   wrong notes, and best streak. Progressive loops show shorter pass/retry
   feedback instead of the full summary.

## Features

- Standard MIDI File import and parsing;
- four built-in scale exercises: C major, G major, F major, and A minor;
- a private browser-local MIDI library for reopening imported files without
  uploading them to a server;
- per-song persistence for tempo, score, practiced hands, virtual hands,
  progressive loops, metronome state and volume, plus global persistence for
  language, 2D/3D view, master volume, and the last opened score;
- a storage settings panel that can reset preferences separately or clear all
  locally saved data;
- selection of one or two tracks, with automatic or manual left/right-hand
  assignment;
- support for a single piano track containing both hands;
- left hand, right hand, or both-hands practice;
- 3D perspective and flat 2D piano-roll views;
- colored falling notes, finger numbers, active keys, and optional virtual
  hands with independently articulated fingers;
- **In time** mode with timing-distance scoring;
- **Wait for note** mode, including chord handling;
- progressive measure loops from 50% to 100% tempo in 5% steps, requiring a
  score of 95/100 before advancing;
- Web MIDI input, an on-screen piano, and Web Audio MIDI playback;
- per-track audio previews to help identify poorly named MIDI tracks;
- MIDI keyboard range discovery;
- an accented metronome with an independent volume control and music-tempo
  control from 25% to 200%;
- an animated 3–2–1 count-in before every start or resume, using the
  metronome click at the selected tempo;
- automatic pause when the page becomes hidden, followed by a fresh count-in
  when it becomes visible again;
- performance summaries combining timing, wrong notes, and missed notes;
- a responsive, localized interface and static deployment through GitHub
  Pages.

On phone-sized screens, the keyboard follows the next notes using at most eight
visible MIDI keys, and practice is limited to one hand at a time. The
both-hands control is disabled automatically.

The play/pause button and the Space key can cancel the count-in before playback
starts. The playhead remains at its paused position.

## Scoring and progressive loops

Precision combines timing quality with note accuracy:

```text
precision = timing quality × correct notes / (correct + missed + wrong)
```

This means a perfectly timed performance cannot receive 100/100 if it contains
wrong or missed notes. In progressive-loop mode, the selected measures start at
50% of the original tempo. A score of at least 95/100 advances the next pass by
5%; a lower score repeats the same tempo. The loop stops accelerating at 100%.

## Local data and reset controls

Playalong 3D has no application server. Data remains in the current browser
profile and is not synchronized to another browser or device.

| Storage | Data |
| --- | --- |
| `localStorage`, global | Language, 2D/3D view, master volume, sound state, and last opened score |
| `localStorage`, per score | Tempo, latest completed score, practiced hand, practice mode, virtual hands, progressive-loop range/state, and metronome state/volume |
| `localStorage`, per MIDI device | Discovered lowest/highest key and keyboard size |
| IndexedDB | The original bytes and metadata of imported MIDI files |

The cog button in the top bar opens **Settings and storage**. **Reset
preferences** removes Playalong settings, scores, and MIDI keyboard
calibrations while retaining imported MIDI files. **Clear all local data**
also removes the browser-local MIDI library. Both actions require an additional
confirmation.

## Key and fingering analysis

MIDI files generally contain no fingering data. The engine performs harmonic
analysis before assigning fingers:

1. The selected score is divided into four-measure windows.
2. A twelve-pitch-class histogram is weighted by note duration and velocity.
3. All 24 major and minor keys are compared using Krumhansl–Schmuckler
   profiles. The closest profile determines the local key and confidence.
4. Automatic tracks are assigned by register. A mixed piano track uses
   onset-based hand assignment with pitch ownership and short-phrase memory,
   preventing rapid left/right flicker around middle C.
5. Dynamic programming evaluates all five fingers for each hand and minimizes
   a cost combining hand-position movement, reach, same-finger repetition,
   crossings, thumb passages, thumb use on black keys, and conventional
   fingerings for the detected scale.
6. Crossings are limited to two finger positions. During a passage such as
   `3 → 1`, the current hand anchor is held for the crossing and the palm moves
   to its new anchor immediately afterwards.
7. A chord-specific pass ensures distinct, ordered fingers for simultaneous
   notes, with a maximum thumb-to-pinky span of one octave.

The calculation is deterministic: the same file and selected tracks always
produce the same fingerings. Possible future improvements include configurable
hand-size profiles and an editor for locking preferred fingerings.

## Architecture

- React, TypeScript, and Vite for the interface;
- Three.js through React Three Fiber for the 3D scene;
- `@tonejs/midi` for file parsing;
- Web MIDI API for hardware input;
- Web Audio API for playback, previews, and the metronome;
- `localStorage` for global and per-score preferences;
- IndexedDB for imported MIDI files;
- pure music and scoring logic in `src/lib`, tested with Vitest.

## Validation and production build

```bash
npm test
npm run build
```

The production files are generated in `dist/`.

Pushes to `main` automatically trigger the workflow in
`.github/workflows/deploy-pages.yml`, which builds and publishes the app to
GitHub Pages. The production build uses `/playalong3D/` as its Vite base path;
the development server continues to use `/`.
