import { useCallback, useEffect, useRef } from "react";

function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function usePianoSynth(initialVolume = 0.72) {
  const contextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const volumeRef = useRef(Math.max(0, Math.min(1, initialVolume)));
  const activeRef = useRef(
    new Map<
      number,
      { oscillators: OscillatorNode[]; gain: GainNode; token: symbol }
    >(),
  );
  const timersRef = useRef(new Set<number>());

  const ensureContext = useCallback(() => {
    const AudioContextClass =
      window.AudioContext ??
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!contextRef.current) {
      contextRef.current = new AudioContextClass();
      const masterGain = contextRef.current.createGain();
      masterGain.gain.value = volumeRef.current;
      masterGain.connect(contextRef.current.destination);
      masterGainRef.current = masterGain;
    }
    if (contextRef.current.state === "suspended") void contextRef.current.resume();
    return contextRef.current;
  }, []);

  const noteOn = useCallback(
    (midi: number, velocity = 0.75) => {
      const context = ensureContext();
      if (!context) return;
      const existing = activeRef.current.get(midi);
      if (existing) {
        existing.gain.gain.cancelScheduledValues(context.currentTime);
        existing.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.025);
        existing.oscillators.forEach((oscillator) =>
          oscillator.stop(context.currentTime + 0.12),
        );
      }

      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      const master = Math.max(0.025, velocity * 0.16);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(master, context.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(
        master * 0.46,
        context.currentTime + 0.25,
      );
      filter.type = "lowpass";
      filter.frequency.value = 2600;
      filter.Q.value = 0.7;
      gain.connect(filter).connect(masterGainRef.current ?? context.destination);

      const oscillators = [1, 2, 3].map((harmonic, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = index === 0 ? "triangle" : "sine";
        oscillator.frequency.value = midiToFrequency(midi) * harmonic;
        oscillator.detune.value = index === 0 ? 0 : index * 1.8;
        const partialGain = context.createGain();
        partialGain.gain.value = index === 0 ? 0.9 : 0.16 / index;
        oscillator.connect(partialGain).connect(gain);
        oscillator.start();
        return oscillator;
      });
      const token = Symbol(`voice-${midi}`);
      activeRef.current.set(midi, { oscillators, gain, token });
      return token;
    },
    [ensureContext],
  );

  const releaseVoice = useCallback((midi: number, expectedToken?: symbol) => {
    const context = contextRef.current;
    const voice = activeRef.current.get(midi);
    if (!context || !voice) return;
    if (expectedToken && voice.token !== expectedToken) return;
    voice.gain.gain.cancelScheduledValues(context.currentTime);
    voice.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.08);
    voice.oscillators.forEach((oscillator) =>
      oscillator.stop(context.currentTime + 0.5),
    );
    activeRef.current.delete(midi);
  }, []);

  const noteOff = useCallback(
    (midi: number) => releaseVoice(midi),
    [releaseVoice],
  );

  const tap = useCallback(
    (midi: number, velocity = 0.72, duration = 0.32) => {
      const token = noteOn(midi, velocity);
      if (!token) return;
      const timer = window.setTimeout(() => {
        timersRef.current.delete(timer);
        releaseVoice(midi, token);
      }, duration * 1000);
      timersRef.current.add(timer);
    },
    [noteOn, releaseVoice],
  );

  const stopAll = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current.clear();
    const context = contextRef.current;
    for (const [midi, voice] of activeRef.current) {
      if (context) {
        voice.gain.gain.cancelScheduledValues(context.currentTime);
        voice.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.018);
        voice.oscillators.forEach((oscillator) =>
          oscillator.stop(context.currentTime + 0.08),
        );
      } else {
        voice.oscillators.forEach((oscillator) => oscillator.stop());
      }
      activeRef.current.delete(midi);
    }
  }, []);

  const setMasterVolume = useCallback(
    (volume: number) => {
      const normalized = Math.max(0, Math.min(1, volume));
      volumeRef.current = normalized;
      const context = ensureContext();
      const masterGain = masterGainRef.current;
      if (!context || !masterGain) return;
      masterGain.gain.cancelScheduledValues(context.currentTime);
      masterGain.gain.setTargetAtTime(normalized, context.currentTime, 0.025);
    },
    [ensureContext],
  );

  const metronomeClick = useCallback(
    (accent = false, volume = 0.75) => {
      const context = ensureContext();
      const destination = masterGainRef.current;
      if (!context || !destination) return;

      const oscillator = context.createOscillator();
      const oscillatorGain = context.createGain();
      const level = Math.max(0, Math.min(1, volume));
      oscillator.type = "triangle";
      oscillator.frequency.value = accent ? 1760 : 1180;
      oscillatorGain.gain.setValueAtTime(
        Math.max(0.0001, level * (accent ? 0.3 : 0.22)),
        context.currentTime,
      );
      oscillatorGain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + (accent ? 0.08 : 0.06),
      );
      oscillator.connect(oscillatorGain).connect(destination);
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.09);

      // A very short noise transient gives the beat a clear acoustic "tac"
      // that remains audible over sustained piano notes.
      const noiseLength = Math.max(1, Math.floor(context.sampleRate * 0.018));
      const noiseBuffer = context.createBuffer(
        1,
        noiseLength,
        context.sampleRate,
      );
      const noise = noiseBuffer.getChannelData(0);
      for (let index = 0; index < noise.length; index += 1) {
        noise[index] = Math.random() * 2 - 1;
      }
      const noiseSource = context.createBufferSource();
      const noiseFilter = context.createBiquadFilter();
      const noiseGain = context.createGain();
      noiseSource.buffer = noiseBuffer;
      noiseFilter.type = "highpass";
      noiseFilter.frequency.value = accent ? 1500 : 1100;
      noiseGain.gain.setValueAtTime(
        Math.max(0.0001, level * (accent ? 0.24 : 0.17)),
        context.currentTime,
      );
      noiseGain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.022,
      );
      noiseSource.connect(noiseFilter).connect(noiseGain).connect(destination);
      noiseSource.start(context.currentTime);
    },
    [ensureContext],
  );

  useEffect(
    () => () => {
      stopAll();
      void contextRef.current?.close();
    },
    [stopAll],
  );

  return {
    noteOn,
    noteOff,
    tap,
    stopAll,
    setMasterVolume,
    metronomeClick,
    ensureContext,
  };
}
