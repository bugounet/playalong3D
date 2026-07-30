import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Component,
  useMemo,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { calculatePerformanceMetrics } from "../lib/scoring";
import type { Hand, PracticeNote, ScoreState } from "../types";

interface PianoStageProps {
  notes: PracticeNote[];
  playhead: number;
  activeMidi: Set<number>;
  currentTargets: PracticeNote[];
  showHands: boolean;
  viewMode: "perspective" | "flat";
  score: ScoreState;
  onKeyDown: (midi: number) => void;
  onKeyUp: (midi: number) => void;
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
}: {
  viewMode: PianoStageProps["viewMode"];
}) {
  const { camera } = useThree();
  const initialized = useRef(false);

  useMemo(() => {
    camera.position.set(0, 8.8, 12.7);
    camera.lookAt(0, 0.25, -5.6);
  }, [camera]);

  useFrame(() => {
    const flat = viewMode === "flat";
    const targetPosition = flat
      ? new THREE.Vector3(0, 18.5, 3.4)
      : new THREE.Vector3(0, 8.8, 12.7);
    const lookAt = flat
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
      camera.fov = THREE.MathUtils.lerp(camera.fov, flat ? 53 : 46, 0.11);
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
}: Pick<
  PianoStageProps,
  "activeMidi" | "currentTargets" | "onKeyDown" | "onKeyUp"
>) {
  const targetedMidi = useMemo(
    () => new Set(currentTargets.map((note) => note.midi)),
    [currentTargets],
  );
  return (
    <group>
      <mesh position={[0, -0.02, 3.45]} receiveShadow>
        <boxGeometry args={[20.2, 0.22, 2.16]} />
        <meshStandardMaterial color="#080b0f" metalness={0.4} roughness={0.55} />
      </mesh>
      {KEYBOARD.filter((key) => !key.black).map((key) => (
        <PianoKey
          key={key.midi}
          layout={key}
          active={activeMidi.has(key.midi)}
          targeted={targetedMidi.has(key.midi)}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
        />
      ))}
      {KEYBOARD.filter((key) => key.black).map((key) => (
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
}: Pick<PianoStageProps, "notes" | "playhead">) {
  const visible = useMemo(
    () =>
      notes.filter(
        (note) =>
          note.time + note.duration >= playhead - 0.8 &&
          note.time <= playhead + 7.6,
      ),
    [notes, playhead],
  );
  return (
    <group>
      {visible.map((note) => (
        <NoteBlock key={note.id} note={note} playhead={playhead} />
      ))}
    </group>
  );
}

function VirtualHand({
  hand,
  notes,
}: {
  hand: Hand;
  notes: PracticeNote[];
}) {
  const handNotes = notes.filter((note) => note.hand === hand);
  if (handNotes.length === 0) return null;
  const centerMidi =
    handNotes.reduce((sum, note) => sum + note.midi, 0) / handNotes.length;
  const centerX = KEY_BY_MIDI.get(Math.round(centerMidi))?.x ?? 0;
  const color = hand === "right" ? "#b5ff61" : "#8fc7ff";
  const direction = hand === "right" ? 1 : -1;
  const targetedFingers = new Set(handNotes.map((note) => note.finger));

  return (
    <group position={[centerX, 1.05, 3.02]} rotation={[0.02, 0, -direction * 0.05]}>
      <mesh position={[-direction * 0.26, 0.2, 0.42]} castShadow>
        <sphereGeometry args={[0.62, 24, 14]} />
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
        const spread = (finger - 3) * 0.31 * direction;
        const length = finger === 3 ? 1.24 : finger === 1 ? 0.8 : 1.08;
        const highlighted = targetedFingers.has(finger);
        return (
          <group key={finger} position={[spread, 0, -0.12]}>
            <mesh
              position={[0, 0.05, -length / 2]}
              rotation-x={Math.PI / 2}
              castShadow
            >
              <capsuleGeometry args={[0.09, length, 6, 12]} />
              <meshPhysicalMaterial
                color={color}
                transparent
                opacity={highlighted ? 0.72 : 0.3}
                emissive={color}
                emissiveIntensity={highlighted ? 0.85 : 0.12}
                roughness={0.28}
              />
            </mesh>
            <mesh position={[0, 0, -length - 0.08]}>
              <sphereGeometry args={[highlighted ? 0.15 : 0.11, 16, 10]} />
              <meshStandardMaterial
                color={highlighted ? "#ffffff" : color}
                emissive={color}
                emissiveIntensity={highlighted ? 1.5 : 0.2}
                transparent
                opacity={0.82}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Scene(props: PianoStageProps) {
  return (
    <>
      <SceneCamera viewMode={props.viewMode} />
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
      <NoteRoll notes={props.notes} playhead={props.playhead} />
      <Keyboard
        activeMidi={props.activeMidi}
        currentTargets={props.currentTargets}
        onKeyDown={props.onKeyDown}
        onKeyUp={props.onKeyUp}
      />
      {props.showHands && (
        <>
          <VirtualHand hand="left" notes={props.currentTargets} />
          <VirtualHand hand="right" notes={props.currentTargets} />
        </>
      )}
    </>
  );
}

class StageErrorBoundary extends Component<
  { children: ReactNode },
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
          <span>La scène 3D n’a pas pu démarrer.</span>
          <small>Activez WebGL ou essayez un navigateur récent.</small>
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
      <StageErrorBoundary>
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
        <span><i className="legend-dot left" />Main gauche</span>
        <span><i className="legend-dot right" />Main droite</span>
      </div>
      <div className="score-float">
        <div>
          <span>Précision</span>
          <strong>{performance.precision}%</strong>
        </div>
        <div>
          <span>Série</span>
          <strong>{props.score.streak}</strong>
        </div>
      </div>
    </div>
  );
}
