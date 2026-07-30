import { useCallback, useEffect, useRef, useState } from "react";
import type { MidiDevice, MidiInputEvent } from "../types";

interface MidiMessages {
  defaultDevice: string;
  unsupported: string;
  denied: string;
}

export function useMidiInput(
  onMidiEvent: (event: MidiInputEvent) => void,
  messages: MidiMessages,
) {
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const callbackRef = useRef(onMidiEvent);
  callbackRef.current = onMidiEvent;

  const supported = typeof navigator !== "undefined" && !!navigator.requestMIDIAccess;

  const getInputs = useCallback((midiAccess: MIDIAccess) => {
    const inputs: MIDIInput[] = [];
    midiAccess.inputs.forEach((input) => inputs.push(input));
    return inputs;
  }, []);

  const refreshDevices = useCallback((midiAccess: MIDIAccess) => {
    const nextDevices = getInputs(midiAccess).map((input) => ({
        id: input.id,
        name: input.name || messages.defaultDevice,
        manufacturer: input.manufacturer || "",
      }));
    setDevices(nextDevices);
    setSelectedId((current) => {
      if (current && nextDevices.some((device) => device.id === current)) {
        return current;
      }
      return nextDevices[0]?.id ?? "";
    });
  }, [getInputs, messages.defaultDevice]);

  const requestAccess = useCallback(async () => {
    if (!navigator.requestMIDIAccess) {
      setError(messages.unsupported);
      return;
    }
    try {
      const midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      setAccess(midiAccess);
      refreshDevices(midiAccess);
      midiAccess.onstatechange = () => refreshDevices(midiAccess);
      setError("");
    } catch {
      setError(messages.denied);
    }
  }, [messages.denied, messages.unsupported, refreshDevices]);

  useEffect(() => {
    if (!access) return;
    const inputs = getInputs(access);
    for (const input of inputs) input.onmidimessage = null;
    const selectedInput = inputs.find((input) => input.id === selectedId);
    if (!selectedInput) return;

    selectedInput.onmidimessage = (message) => {
      if (!message.data) return;
      const [status, note, velocity = 0] = message.data;
      const command = status & 0xf0;
      if (command === 0x90 && velocity > 0) {
        callbackRef.current({ note, velocity: velocity / 127, type: "on" });
      } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
        callbackRef.current({ note, velocity: 0, type: "off" });
      }
    };

    return () => {
      selectedInput.onmidimessage = null;
    };
  }, [access, getInputs, selectedId]);

  useEffect(
    () => () => {
      if (access) access.onstatechange = null;
    },
    [access],
  );

  return {
    supported,
    devices,
    selectedId,
    setSelectedId,
    requestAccess,
    connected:
      !!access &&
      getInputs(access).some((input) => input.id === selectedId),
    error,
  };
}
