import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Component,
  useMemo,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { MAX_HAND_SPAN_SEMITONES } from "../lib/music";
import { compactMidiRangeAround } from "../lib/responsive";
import { calculatePerformanceMetrics } from "../lib/scoring";
import type { Hand, PracticeNote, ScoreState } from "../types";

interface PianoStageProps {
  notes: PracticeNote[];
  playhead: number;
  activeMidi: Set<number>;
  currentTargets: PracticeNote[];
  showHands: boolean;
  compactKeyboard?: boolean;
  viewMode: "perspective" | "flat";
  score: ScoreState;
  onKeyDown: (midi: number) => void;
  onKeyUp: (midi: number) => void;
  labels: {
    failed: string;
    failedHint: string;
    left: string;
    right: string;
    precision: string;
    streak: string;
  };
}

interface KeyLayout {
  midi: number;
  x: number;
  black: boolean;
  width: number;
}

const WHITE_WIDTH = 0.38;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const STRIKE_Z = 2.28;
const UNITS_PER_SECOND = 3.15;
const HAND_Y = 1.04;
const HAND_Z = 3.43;
const SEGMENT_AXIS = new THREE.Vector3(0, 1, 0);

function createKeyboardLayout(): KeyLayout[] {
  const provisional: KeyLayout[] = [];
  let whiteIndex = 0;
  for (let midi = 21; midi <= 108; midi += 1) {
    const black = BLACK_PITCH_CLASSES.has(midi % 12);
    if (!black) {
      provisional.push({
        midi,
        x: whiteIndex * WHITE_WIDTH,
        black,
        width: WHITE_WIDTH * 0.96,
      });
      whiteIndex += 1;
    } else {
      provisional.push({
        midi,
        x: (whiteIndex - 0.5) * WHITE_WIDTH,
        black,
        width: WHITE_WIDTH * 0.58,
      });
    }
  }
  const center = ((whiteIndex - 1) * WHITE_WIDTH) / 2;
  return provisional.map((key) => ({ ...key, x: key.x - center }));
}

const KEYBOARD = createKeyboardLayout();
const KEY_BY_MIDI = new Map(KEYBOARD.map((key) => [key.midi, key]));

function xForMidi(midi: number) {
  const bounded = Math.max(21, Math.min(108, midi));
  const low = Math.floor(bounded);
  const high = Math.ceil(bounded);
  const lowX = KEY_BY_MIDI.get(low)?.x ?? 0;
  const highX = KEY_BY_MIDI.get(high)?.x ?? lowX;
  return THREE.MathUtils.lerp(lowX, highX, bounded - low);
}

function compactKeysAround(midi: number) {
  const visibleMidi = new Set(compactMidiRangeAround(midi));
  return KEYBOARD.filter((key) => visibleMidi.has(key.midi));
}

function fingerTexture(finger: number, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 128, 128);
  context.beginPath();
  context.arc(64, 64, 47, 0, Math.PI * 2);
  context.fillStyle = "rgba(8, 12, 17, 0.82)";
  context.fill();
  context.lineWidth = 7;
  context.strokeStyle = color;
  context.stroke();
  context.font = "800 65px Inter, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#ffffff";
  context.fillText(String(finger), 64, 67);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function SceneCamera({
  viewMode,
  compact,
  focusX,
}: {
  viewMode: PianoStageProps["viewMode"];
  compact: boolean;
  focusX: number;
}) {
  const { camera } = useThree();
  const initialized = useRef(false);

  useMemo(() => {
    camera.position.set(0, 8.8, 12.7);
    camera.lookAt(0, 0.25, -5.6);
  }, [camera]);

  useFrame(() => {
    const flat = viewMode === "flat";
    const targetPosition = compact
      ? flat
        ? new THREE.Vector3(focusX, 8.6, 3.2)
        : new THREE.Vector3(focusX, 4.4, 7.4)
      : flat
        ? new THREE.Vector3(0, 18.5, 3.4)
        : new THREE.Vector3(0, 8.8, 12.7);
    const lookAt = compact
      ? flat
        ? new THREE.Vector3(focusX, 0, -0.8)
        : new THREE.Vector3(focusX, 0.28, -0.45)
      : flat
        ? new THREE.Vector3(0, 0, -5.8)
        : new THREE.Vector3(0, 0.25, -5.6);

    if (!initialized.current) {
      camera.position.copy(targetPosition);
      initialized.current = true;
    } else {
      camera.position.lerp(targetPosition, 0.11);
    }
    camera.lookAt(lookAt);

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = compact ? (flat ? 49 : 44) : flat ? 53 : 46;
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.11);
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

function LaneGrid() {
  const verticalLines = useMemo(() => {
    const lines: { x: number; strong: boolean }[] = [];
    for (const key of KEYBOARD.filter((entry) => !entry.black)) {
      lines.push({ x: key.x - WHITE_WIDTH / 2, strong: key.midi % 12 === 0 });
    }
    return lines;
  }, []);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.08, -7.4]} receiveShadow>
        <planeGeometry args={[20.4, 20.5]} />
        <meshStandardMaterial color="#111820" roughness={0.94} />
      </mesh>
      {verticalLines.map(({ x, strong }, index) => (
        <mesh key={index} position={[x, 0.012, -7.4]}>
          <boxGeometry args={[strong ? 0.018 : 0.008, 0.012, 20.4]} />
          <meshBasicMaterial
            color={strong ? "#41505e" : "#26323d"}
            transparent
            opacity={strong ? 0.65 : 0.42}
          />
        </mesh>
      ))}
      {Array.from({ length: 10 }, (_, index) => (
        <mesh key={index} position={[0, 0.016, STRIKE_Z - index * 2.4]}>
          <boxGeometry args={[20.2, 0.012, index === 0 ? 0.035 : 0.018]} />
          <meshBasicMaterial
            color={index === 0 ? "#ff5267" : "#34414c"}
            transparent
            opacity={index === 0 ? 1 : 0.52}
          />
        </mesh>
      ))}
    </group>
  );
}

function PianoKey({
  layout,
  active,
  targeted,
  onKeyDown,
  onKeyUp,
}: {
  layout: KeyLayout;
  active: boolean;
  targeted: boolean;
  onKeyDown: (midi: number) => void;
  onKeyUp: (midi: number) => void;
}) {
  const depth = layout.black ? 1.2 : 1.88;
  const z = layout.black ? 3.05 : 3.36;
  const height = layout.black ? 0.31 : 0.22;
  const baseColor = layout.black ? "#10151b" : "#e9edf0";
  const activeColor = active ? "#d9ff69" : targeted ? "#76e0d0" : baseColor;

  return (
    <mesh
      castShadow
      receiveShadow
      position={[layout.x, layout.black ? 0.27 : 0.13, z]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onKeyDown(layout.midi);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        onKeyUp(layout.midi);
      }}
      onPointerOut={() => onKeyUp(layout.midi)}
    >
      <boxGeometry args={[layout.width, height, depth]} />
      <meshStandardMaterial
        color={activeColor}
        emissive={active ? "#96d52d" : targeted ? "#1f6d68" : "#000000"}
        emissiveIntensity={active ? 1.3 : targeted ? 0.55 : 0}
        roughness={layout.black ? 0.25 : 0.48}
        metalness={layout.black ? 0.2 : 0.02}
      />
    </mesh>
  );
}

function Keyboard({
  activeMidi,
  currentTargets,
  onKeyDown,
  onKeyUp,
  keys = KEYBOARD,
}: Pick<
  PianoStageProps,
  "activeMidi" | "currentTargets" | "onKeyDown" | "onKeyUp"
> & { keys?: KeyLayout[] }) {
  const targetedMidi = useMemo(
    () => new Set(currentTargets.map((note) => note.midi)),
    [currentTargets],
  );
  const keyboardBounds = useMemo(() => {
    const first = keys[0] ?? KEYBOARD[0];
    const last = keys[keys.length - 1] ?? KEYBOARD[KEYBOARD.length - 1];
    return {
      center: (first.x + last.x) / 2,
      width: Math.max(WHITE_WIDTH, last.x - first.x + WHITE_WIDTH * 1.4),
    };
  }, [keys]);
  return (
    <group>
      <mesh position={[keyboardBounds.center, -0.02, 3.45]} receiveShadow>
        <boxGeometry args={[keyboardBounds.width, 0.22, 2.16]} />
        <meshStandardMaterial color="#080b0f" metalness={0.4} roughness={0.55} />
      </mesh>
      {keys.filter((key) => !key.black).map((key) => (
        <PianoKey
          key={key.midi}
          layout={key}
          active={activeMidi.has(key.midi)}
          targeted={targetedMidi.has(key.midi)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
        />
      ))}
      {keys.filter((key) => key.black).map((key) => (
        <PianoKey
          key={key.midi}
          layout={key}
          active={activeMidi.has(key.midi)}
          targeted={targetedMidi.has(key.midi)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
        />
      ))}
    </group>
  );
}

function NoteBlock({
  note,
  playhead,
}: {
  note: PracticeNote;
  playhead: number;
}) {
  const layout = KEY_BY_MIDI.get(note.midi);
  const meshRef = useRef<THREE.Mesh>(null);
  const spriteRef = useRef<THREE.Sprite>(null);
  const color = note.hand === "right" ? "#9ee755" : "#80a9d5";
  const fingerMap = useMemo(
    () => fingerTexture(note.finger, note.hand === "right" ? "#b8ff6a" : "#9ac8f8"),
    [note.finger, note.hand],
  );
  const depth = Math.max(0.2, note.duration * UNITS_PER_SECOND);
  const width = (layout?.width ?? WHITE_WIDTH) * 0.88;

  useFrame(() => {
    /*
     * The front of a note may reach the strike line, but must never travel
     * across the keyboard. While the note is held, its front stays pinned to
     * the line and the remaining bar progressively shrinks behind it.
     */
    const naturalFront =
      STRIKE_Z - (note.time - playhead) * UNITS_PER_SECOND;
    const back =
      STRIKE_Z -
      (note.time + note.duration - playhead) * UNITS_PER_SECOND;
    const front = Math.min(STRIKE_Z, naturalFront);
    const visibleDepth = Math.max(0, front - back);
    const visible =
      playhead <= note.time + note.duration && visibleDepth > 0.008;

    if (meshRef.current) {
      meshRef.current.visible = visible;
      meshRef.current.position.z = (front + back) / 2;
      meshRef.current.scale.z = visibleDepth / depth;
    }
    if (spriteRef.current) {
      spriteRef.current.visible = visible;
      spriteRef.current.position.z =
        front - Math.min(0.16, visibleDepth * 0.24);
    }
  });

  if (!layout) return null;
  return (
    <group>
      <mesh
        ref={meshRef}
        position={[layout.x, 0.33, 0]}
        castShadow
      >
        <boxGeometry args={[width, 0.36, depth]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.28}
          roughness={0.38}
          metalness={0.05}
        />
      </mesh>
      <sprite
        ref={spriteRef}
        position={[layout.x, 0.56, 0]}
        scale={[width * 0.82, width * 0.82, 1]}
      >
        <spriteMaterial
          map={fingerMap}
          transparent
          depthWrite={false}
          depthTest={false}
        />
      </sprite>
    </group>
  );
}

function NoteRoll({
  notes,
  playhead,
  visibleMidi,
}: Pick<PianoStageProps, "notes" | "playhead"> & {
  visibleMidi?: Set<number>;
}) {
  const visible = useMemo(
    () =>
      notes.filter(
        (note) =>
          (!visibleMidi || visibleMidi.has(note.midi)) &&
          note.time + note.duration >= playhead - 0.8 &&
          note.time <= playhead + 7.6,
      ),
    [notes, playhead, visibleMidi],
  );
  return (
    <group>
      {visible.map((note) => (
        <NoteBlock key={note.id} note={note} playhead={playhead} />
      ))}
    </group>
  );
}

function placeFingerSegment(
  mesh: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
) {
  const direction = end.clone().sub(start);
  const length = Math.max(0.08, direction.length());
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(SEGMENT_AXIS, direction.normalize());
  mesh.scale.set(1, length, 1);
}

function IndependentFinger({
  finger,
  handDirection,
  color,
  target,
  highlighted,
  pressed,
}: {
  finger: number;
  handDirection: number;
  color: string;
  target: THREE.Vector3;
  highlighted: boolean;
  pressed: boolean;
}) {
  const proximalRef = useRef<THREE.Mesh>(null);
  const distalRef = useRef<THREE.Mesh>(null);
  const tipRef = useRef<THREE.Mesh>(null);
  const animatedTip = useRef(target.clone());
  const base = useMemo(
    () =>
      new THREE.Vector3(
        (finger - 3) * 0.22 * handDirection,
        finger === 1 ? 0.02 : 0.08,
        finger === 1 ? 0.18 : 0.02,
      ),
    [finger, handDirection],
  );

  useFrame((_, delta) => {
    const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 13);
    animatedTip.current.lerp(target, alpha);
    const joint = base.clone().lerp(animatedTip.current, 0.52);
    joint.y += finger === 1 ? 0.16 : highlighted ? 0.27 : 0.2;
    joint.z += finger === 1 ? 0.05 : 0.1;

    if (proximalRef.current) {
      placeFingerSegment(proximalRef.current, base, joint);
    }
    if (distalRef.current) {
      placeFingerSegment(distalRef.current, joint, animatedTip.current);
    }
    if (tipRef.current) {
      tipRef.current.position.copy(animatedTip.current);
      tipRef.current.scale.setScalar(pressed ? 1.18 : 1);
    }
  });

  return (
    <group>
      {[proximalRef, distalRef].map((ref, index) => (
        <mesh ref={ref} key={index} castShadow>
          <capsuleGeometry args={[finger === 1 ? 0.095 : 0.082, 1, 5, 10]} />
          <meshPhysicalMaterial
            color={color}
            transparent
            opacity={highlighted ? 0.7 : 0.32}
            emissive={color}
            emissiveIntensity={highlighted ? 0.68 : 0.12}
            roughness={0.28}
          />
        </mesh>
      ))}
      <mesh ref={tipRef}>
        <sphereGeometry args={[highlighted ? 0.135 : 0.105, 16, 10]} />
        <meshStandardMaterial
          color={highlighted ? "#ffffff" : color}
          emissive={color}
          emissiveIntensity={pressed ? 1.8 : highlighted ? 1.2 : 0.2}
          transparent
          opacity={0.86}
        />
      </mesh>
    </group>
  );
}

function VirtualHand({
  hand,
  notes,
  currentTargets,
  playhead,
  activeMidi,
}: {
  hand: Hand;
  notes: PracticeNote[];
  currentTargets: PracticeNote[];
  playhead: number;
  activeMidi: Set<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const initialized = useRef(false);
  const allHandNotes = useMemo(
    () =>
      notes
        .filter((note) => note.hand === hand)
        .sort((a, b) => a.time - b.time || a.midi - b.midi),
    [hand, notes],
  );
  const poseNotes = useMemo(() => {
    const current = currentTargets.filter((note) => note.hand === hand);
    if (current.length > 0) return current;

    const upcoming = allHandNotes.find((note) => note.time >= playhead - 0.08);
    if (upcoming) {
      return allHandNotes.filter(
        (note) => Math.abs(note.time - upcoming.time) < 0.045,
      );
    }

    const last = allHandNotes[allHandNotes.length - 1];
    return last
      ? allHandNotes.filter((note) => Math.abs(note.time - last.time) < 0.045)
      : [];
  }, [allHandNotes, currentTargets, hand, playhead]);

  const direction = hand === "right" ? 1 : -1;
  const color = hand === "right" ? "#b5ff61" : "#8fc7ff";
  const thumbAnchor =
    poseNotes.reduce((sum, note) => sum + note.handPosition, 0) /
    Math.max(1, poseNotes.length);
  const palmMidi = thumbAnchor + direction * 3.5;
  const palmX = xForMidi(palmMidi);
  const targetByFinger = new Map(
    poseNotes.slice(0, 5).map((note) => [note.finger, note]),
  );

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const desired = new THREE.Vector3(palmX, HAND_Y, HAND_Z);
    if (!initialized.current) {
      groupRef.current.position.copy(desired);
      initialized.current = true;
    } else {
      const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 8);
      groupRef.current.position.lerp(desired, alpha);
    }
  });

  if (poseNotes.length === 0) return null;

  return (
    <group ref={groupRef} rotation={[0.02, 0, -direction * 0.04]}>
      <mesh position={[-direction * 0.05, 0.18, 0.23]} castShadow>
        <sphereGeometry args={[0.63, 24, 14]} />
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={0.24}
          transmission={0.28}
          roughness={0.25}
          thickness={0.25}
          emissive={color}
          emissiveIntensity={0.16}
        />
      </mesh>
      {[1, 2, 3, 4, 5].map((finger) => {
        const note = targetByFinger.get(finger);
        const restIntervals = [0, 2, 4, 5, 7];
        const desiredMidi =
          note?.midi ?? thumbAnchor + direction * restIntervals[finger - 1];
        const minMidi =
          direction === 1
            ? thumbAnchor
            : thumbAnchor - MAX_HAND_SPAN_SEMITONES;
        const maxMidi =
          direction === 1
            ? thumbAnchor + MAX_HAND_SPAN_SEMITONES
            : thumbAnchor;
        const boundedMidi = THREE.MathUtils.clamp(
          desiredMidi,
          minMidi,
          maxMidi,
        );
        const layout = KEY_BY_MIDI.get(Math.round(boundedMidi));
        const pressed = !!note && activeMidi.has(note.midi);
        const target = new THREE.Vector3(
          xForMidi(boundedMidi) - palmX,
          (layout?.black ? 0.46 : pressed ? 0.24 : 0.34) - HAND_Y,
          (layout?.black ? 2.76 : 2.7) - HAND_Z,
        );
        return (
          <IndependentFinger
            key={finger}
            finger={finger}
            handDirection={direction}
            color={color}
            target={target}
            highlighted={!!note}
            pressed={pressed}
          />
        );
      })}
    </group>
  );
}

function Scene(props: PianoStageProps) {
  const compactKeyboard = props.compactKeyboard ?? false;
  const compactCenterMidi =
    props.currentTargets.length > 0
      ? props.currentTargets.reduce((sum, note) => sum + note.midi, 0) /
        props.currentTargets.length
      : 60;
  const visibleKeys = useMemo(
    () =>
      compactKeyboard
        ? compactKeysAround(compactCenterMidi)
        : KEYBOARD,
    [compactCenterMidi, compactKeyboard],
  );
  const visibleMidi = useMemo(
    () =>
      compactKeyboard
        ? new Set(visibleKeys.map((key) => key.midi))
        : undefined,
    [compactKeyboard, visibleKeys],
  );
  const focusX =
    visibleKeys.reduce((sum, key) => sum + key.x, 0) /
    Math.max(1, visibleKeys.length);

  return (
    <>
      <SceneCamera
        viewMode={props.viewMode}
        compact={compactKeyboard}
        focusX={focusX}
      />
      <color attach="background" args={["#080c11"]} />
      <fog attach="fog" args={["#080c11", 16, 31]} />
      <ambientLight intensity={0.95} />
      <directionalLight
        position={[3, 9, 6]}
        intensity={2.1}
        color="#e8f5ff"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[-6, 2.5, 1]} intensity={8} color="#458fc9" distance={9} />
      <pointLight position={[6, 2.5, 1]} intensity={8} color="#7fcf45" distance={9} />
      <LaneGrid />
      <NoteRoll
        notes={props.notes}
        playhead={props.playhead}
        visibleMidi={visibleMidi}
      />
      <Keyboard
        activeMidi={props.activeMidi}
        currentTargets={props.currentTargets}
        onKeyDown={props.onKeyDown}
        onKeyUp={props.onKeyUp}
        keys={visibleKeys}
      />
      {props.showHands && (
        <>
          <VirtualHand
            hand="left"
            notes={props.notes}
            currentTargets={props.currentTargets}
            playhead={props.playhead}
            activeMidi={props.activeMidi}
          />
          <VirtualHand
            hand="right"
            notes={props.notes}
            currentTargets={props.currentTargets}
            playhead={props.playhead}
            activeMidi={props.activeMidi}
          />
        </>
      )}
    </>
  );
}

class StageErrorBoundary extends Component<
  { children: ReactNode; failed: string; failedHint: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("WebGL stage failed", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="webgl-fallback">
          <span>{this.props.failed}</span>
          <small>{this.props.failedHint}</small>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PianoStage(props: PianoStageProps) {
  const performance = calculatePerformanceMetrics(props.score);

  return (
    <div className="stage-shell">
      <StageErrorBoundary
        failed={props.labels.failed}
        failedHint={props.labels.failedHint}
      >
        <Canvas
          shadows
          dpr={[1, 1.65]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          camera={{ fov: 46, near: 0.1, far: 60 }}
        >
          <Scene {...props} />
        </Canvas>
      </StageErrorBoundary>
      <div className="stage-vignette" />
      <div className="stage-legend" aria-hidden="true">
        <span><i className="legend-dot left" />{props.labels.left}</span>
        <span><i className="legend-dot right" />{props.labels.right}</span>
      </div>
      <div className="score-float">
        <div>
          <span>{props.labels.precision}</span>
          <strong>{performance.precision}%</strong>
        </div>
        <div>
          <span>{props.labels.streak}</span>
          <strong>{props.score.streak}</strong>
        </div>
      </div>
    </div>
  );
}
