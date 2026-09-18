import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { RacerDefinition } from './Racer';
import type { RacerStatus } from '../game/RaceState';
import type { RaceEventType } from '../events/RaceEvent';
import { furBumpTexture, loft } from './Loft';

/**
 * 모델 로컬 좌표 규약: +x 전방, +y 위, +z 오른쪽.
 * RacerManager 가 root 를 트랙 위에 배치하고, 여기서는 몸통/다리/기수 연출만 담당.
 */
export interface VisualContext {
  dt: number;
  time: number;
  /** 0..1 (최고속 대비) */
  speedNorm: number;
  speed: number;
  /** m/s² */
  accel: number;
  state: RacerStatus;
  stateTimer: number;
  cornerWeight: number;
  boost: number;
  bump: number;
  bumpDir: number;
  riderless: boolean;
  distanceToFinish: number;
  /** 옆 선수 방향 (목 공격 등), -1 왼쪽 / +1 오른쪽 */
  sideHint: number;
  /** 몸 늘어남 등 0..1 (엔진이 계산) */
  extension: number;
  /** 횡방향 속도 m/s (+ = 오른쪽) */
  lateralVel: number;
  /** 늘어남 최대 길이(m) */
  extensionMax: number;
}

export interface RacerVisual {
  readonly root: THREE.Group;
  readonly def: RacerDefinition;
  readonly hoofPoints: THREE.Vector3[];
  readonly height: number;
  update(ctx: VisualContext): void;
  onEvent(type: RaceEventType, ctx: VisualContext): void;
  reset(): void;
  setWorldForward(tan: THREE.Vector3): void;
  dispose(): void;
}

// ---------------------------------------------------------------- 재질 (툰 램프 + 잉크 외곽선, 복싱 앱 스타일)

let gradientMap: THREE.DataTexture | null = null;
function getGradient(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([96, 150, 205, 240, 255]);
  gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

/** 실사풍: 부드러운 표준 재질 (툰 램프는 USE_TOON 으로 전환 가능) */
export const USE_TOON = false;
export function toon(color: number, opts: Partial<THREE.MeshToonMaterialParameters> = {}): THREE.MeshStandardMaterial | THREE.MeshToonMaterial {
  if (USE_TOON) return new THREE.MeshToonMaterial({ color, gradientMap: getGradient(), ...opts });
  // 미세 범프로 플라스틱 광택을 죽여 가죽/천 느낌
  const params: THREE.MeshStandardMaterialParameters = { color, roughness: 0.8, metalness: 0.0, bumpMap: furBumpTexture(), bumpScale: 0.01 };
  if (opts.map) params.map = opts.map;
  if (opts.transparent !== undefined) params.transparent = opts.transparent;
  if (opts.opacity !== undefined) params.opacity = opts.opacity;
  return new THREE.MeshStandardMaterial(params);
}

/** 호환용 별칭 — 예전 코드에서 lambert() 를 쓰던 자리 */
export const lambert = toon;

const OUTLINE_VERT = `
uniform float thickness;
void main() {
  vec3 p = position + normalize(normal) * thickness;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const OUTLINE_FRAG = `
uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }`;

let outlineMat: THREE.ShaderMaterial | null = null;
export function getOutlineMaterial(): THREE.ShaderMaterial {
  if (!outlineMat) {
    outlineMat = new THREE.ShaderMaterial({
      uniforms: { thickness: { value: 0.028 }, color: { value: new THREE.Color(0x14100e) } },
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      side: THREE.BackSide,
    });
  }
  return outlineMat;
}

/** 메쉬 자식으로 뒷면 확장 외곽선 추가 */
export function addOutlines(root: THREE.Object3D): void {
  if (!USE_TOON) return;
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.noOutline || m.userData.isOutline) return;
    const mat = m.material as THREE.Material;
    if (mat.transparent || (m.geometry as THREE.PlaneGeometry).type === 'PlaneGeometry') return;
    targets.push(m);
  });
  for (const m of targets) {
    const o = new THREE.Mesh(m.geometry, getOutlineMaterial());
    o.userData.isOutline = true;
    o.castShadow = false;
    m.add(o);
  }
}

// ---------------------------------------------------------------- 지오메트리 헬퍼 (둥근 형태)

export function box(w: number, h: number, d: number, mat: THREE.Material, name = ''): THREE.Mesh {
  const r = Math.min(w, h, d) * 0.3;
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
  m.castShadow = true;
  m.name = name;
  return m;
}

export function sphere(r: number, mat: THREE.Material, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

/** 캡슐. axis: 'x' 는 전후 방향으로 눕힘 */
export function capsule(radius: number, length: number, mat: THREE.Material, axis: 'x' | 'y' | 'z' = 'y'): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(radius, length, 6, 14);
  if (axis === 'x') geo.rotateZ(Math.PI / 2);
  if (axis === 'z') geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

/**
 * 위쪽 끝이 피벗인 2관절 다리: 허벅지(name) → 무릎 그룹(name_lower) → 정강이 + 발굽.
 * 갤럽 클립이 허벅지/무릎 회전을 함께 구동한다.
 */
export function makeLeg(w: number, len: number, mat: THREE.Material, name: string, hoofColor = 0x2a211c): THREE.Mesh {
  const upperLen = len * 0.52;
  const lowerLen = len - upperLen;
  // 허벅지: 위가 굵고 무릎 쪽으로 가늘어지는 원뿔대 + 무릎 관절 구
  const geo = new THREE.CylinderGeometry(w * 0.34, w * 0.62, upperLen, 12);
  geo.translate(0, -upperLen / 2, 0);
  const upper = new THREE.Mesh(geo, mat);
  upper.name = name;
  upper.castShadow = true;
  // 엉덩이/어깨 관절: 몸통 속에 파묻히도록 크게
  const hipCap = new THREE.Mesh(new THREE.SphereGeometry(w * 0.95, 12, 8), mat);
  hipCap.scale.set(1.1, 0.8, 1.1);
  hipCap.position.y = 0.04;
  upper.add(hipCap);
  const knee = new THREE.Group();
  knee.name = name + '_lower';
  knee.position.y = -upperLen;
  const kneeBall = new THREE.Mesh(new THREE.SphereGeometry(w * 0.36, 10, 8), mat);
  knee.add(kneeBall);
  // 정강이: 가늘고 발목(구절)에서 살짝 굵어짐
  const lgeo = new THREE.CylinderGeometry(w * 0.26, w * 0.31, lowerLen - w * 0.3, 10);
  lgeo.translate(0, -(lowerLen - w * 0.3) / 2, 0);
  const lower = new THREE.Mesh(lgeo, mat);
  lower.castShadow = true;
  knee.add(lower);
  const fetlock = new THREE.Mesh(new THREE.SphereGeometry(w * 0.3, 10, 8), mat);
  fetlock.position.y = -(lowerLen - w * 0.3);
  knee.add(fetlock);
  const hoof = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.5, w * 0.4, 12), toon(hoofColor));
  hoof.position.y = -lowerLen + w * 0.18;
  hoof.castShadow = true;
  knee.add(hoof);
  upper.add(knee);
  return upper;
}

export function makeNumberTexture(n: number, cloth: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#' + cloth.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 16);
  ctx.fillRect(0, 112, 128, 16);
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(String(n), 64, 66);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(n), 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeNumberCloths(n: number, cloth: number, size: number, halfWidth: number): THREE.Group {
  const g = new THREE.Group();
  const tex = makeNumberTexture(n, cloth);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.9), new THREE.MeshBasicMaterial({ map: tex }));
    m.rotation.y = side > 0 ? 0 : Math.PI;
    m.position.z = side * halfWidth;
    m.userData.noOutline = true;
    g.add(m);
  }
  return g;
}

/** 기수 (안장 위 피벗) — 둥근 몸, 헬멧, 고글, 채찍 */
/** 기수 실크 무늬 (가로 줄무늬 + 소매 배색) */
function silksTexture(silks: number, trim: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#' + silks.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#' + trim.toString(16).padStart(6, '0');
  for (let y = 8; y < 128; y += 32) ctx.fillRect(0, y, 128, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeRider(silks: number, helmet: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const silk = new THREE.MeshStandardMaterial({ map: silksTexture(silks, helmet), roughness: 0.85, metalness: 0 });
  const skin = toon(0xf0caad);
  // 상체: 어깨 넓고 허리 좁은 몸통, 앞으로 깊이 숙인 경마 기수 자세
  const torso = new THREE.Mesh(
    loft([
      { p: [0, -0.02, 0], r: 0.11, s: [1.1, 0.8] },
      { p: [0.02, 0.14, 0], r: 0.14, s: [1.2, 0.85] },
      { p: [0.05, 0.3, 0], r: 0.16, s: [1.35, 0.85] },
      { p: [0.07, 0.4, 0], r: 0.12, s: [1.1, 0.8] },
    ]),
    silk,
  );
  torso.position.set(0.06, 0.34, 0);
  torso.rotation.z = -0.95;
  torso.castShadow = true;
  g.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin);
  neck.position.set(0.32, 0.6, 0);
  neck.rotation.z = -0.9;
  g.add(neck);
  const head = sphere(0.14, skin, 0.95, 1.05, 0.9);
  head.position.set(0.4, 0.66, 0);
  g.add(head);
  // 헬멧: 반구 + 챙 + 고글, 색 커버
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(helmet));
  cap.position.set(0.39, 0.7, 0);
  cap.rotation.z = -0.6;
  cap.castShadow = true;
  g.add(cap);
  const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16, 1, false, -0.5, 1.6), toon(helmet));
  peak.position.set(0.44, 0.7, 0);
  peak.rotation.z = -0.6;
  g.add(peak);
  const goggles = box(0.05, 0.07, 0.26, toon(0x1b3a6b));
  goggles.position.set(0.52, 0.66, 0);
  g.add(goggles);
  for (const s of [-1, 1]) {
    // 팔: 어깨에서 앞으로 뻗어 고삐를 잡음 (팔꿈치 살짝 굽힘)
    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.2, 8), silk);
    upperArm.position.set(0.28, 0.52, s * 0.19);
    upperArm.rotation.z = Math.PI / 2 - 0.3;
    g.add(upperArm);
    const foreArm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 8), silk);
    foreArm.position.set(0.45, 0.42, s * 0.2);
    foreArm.rotation.z = Math.PI / 2 + 0.35;
    g.add(foreArm);
    const glove = sphere(0.05, toon(0xf4f4f4));
    glove.position.set(0.55, 0.34, s * 0.2);
    g.add(glove);
    // 다리: 무릎을 높이 올려 접은 몽키 자세
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.24, 8), toon(0xf6f6f6));
    thigh.position.set(0.06, 0.2, s * 0.22);
    thigh.rotation.x = s * 0.5;
    thigh.rotation.z = -0.55;
    g.add(thigh);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.24, 8), toon(0x1c1c1c));
    shin.position.set(0.05, 0.02, s * 0.3);
    shin.rotation.z = 0.35;
    g.add(shin);
    const boot = box(0.18, 0.07, 0.08, toon(0x151515));
    boot.position.set(0.1, -0.09, s * 0.31);
    g.add(boot);
  }
  const whip = capsule(0.012, 0.5, toon(0x3a2a1a));
  whip.position.set(0.5, 0.55, 0.28);
  whip.rotation.z = 0.9;
  g.add(whip);
  g.scale.setScalar(scale);
  g.name = 'rider';
  return g;
}

/** 갈기: 목을 따라 겹치는 부드러운 술 — 속도에 따라 흩날림 */
export function makeMane(neckLen: number, mat: THREE.Material, xOff: number, count = 7, taper = 0.55): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const tuft = new THREE.Mesh(new THREE.CapsuleGeometry(0.06 - t * 0.015, 0.2, 3, 8), mat);
    tuft.castShadow = true;
    // 목이 위로 갈수록 가늘어지므로 갈기도 목 표면을 따라 안쪽으로 붙임
    tuft.position.set(THREE.MathUtils.lerp(xOff, xOff * taper, t), 0.15 + t * (neckLen + 0.15), 0);
    tuft.rotation.z = 0.55 + Math.sin(i * 1.7) * 0.15;
    tuft.userData.baseRot = tuft.rotation.z;
    g.add(tuft);
  }
  g.name = 'mane';
  return g;
}

/** 굴레(코끈·볼끈)와 고삐 앵커. 고삐는 매 프레임 머리→기수 손을 잇는 곡선으로 갱신 */
export interface ReinRig {
  head: THREE.Object3D;
  /** 재갈(bit) 위치 — head 로컬 */
  bit: THREE.Vector3;
  riderIndex: number;
  segments: THREE.Mesh[][];
}

export function makeBridle(head: THREE.Object3D, hs: number, mat: THREE.Material): void {
  // 코끈: 주둥이 둘레
  const nose = new THREE.Mesh(new THREE.TorusGeometry(0.19 * hs, 0.018, 6, 16), mat);
  nose.position.set(0.55 * hs, -0.02, 0);
  nose.rotation.y = Math.PI / 2;
  head.add(nose);
  // 이마끈
  const brow = new THREE.Mesh(new THREE.TorusGeometry(0.24 * hs, 0.016, 6, 16), mat);
  brow.position.set(0.02 * hs, 0.06, 0);
  brow.rotation.y = Math.PI / 2;
  head.add(brow);
  // 볼끈 (양쪽)
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.5 * hs, 3, 6), mat);
    cheek.position.set(0.28 * hs, 0.03, s * 0.21 * hs);
    cheek.rotation.z = Math.PI / 2 - 0.15;
    head.add(cheek);
  }
}

interface FallenRider {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  landed: boolean;
  spin: number;
}

/**
 * Placeholder 공통 베이스. 새 캐릭터는 이 클래스를 상속해 buildBody / updateSpecial 만 구현.
 */
export abstract class PlaceholderVisual implements RacerVisual {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly def: RacerDefinition;
  readonly hoofPoints: THREE.Vector3[] = [];
  height = 2;
  protected legs: THREE.Object3D[] = [];
  protected riders: THREE.Group[] = [];
  protected riderBase: THREE.Vector3[] = [];
  protected riderParent: THREE.Object3D[] = [];
  protected riderTilt: number[] = [];
  protected mixer?: THREE.AnimationMixer;
  protected action?: THREE.AnimationAction;
  protected baseY = 0;
  protected bounceAmp = 0.12;
  protected wobbleFreq = 1;
  protected fallen: FallenRider[] = [];
  protected worldForward = new THREE.Vector3(1, 0, 0);
  protected stumble = 0;
  protected seed = Math.random() * 100;
  protected legAmp = 0.72;
  protected kneeFold = 1.05;
  /** 목/머리 끄덕임 콜백용 — 서브클래스가 neck 을 두면 갤럽에 맞춰 흔든다 */
  protected neckBob: THREE.Object3D | null = null;
  protected neckBase = 0;
  protected stridePhase = 0;
  /** 바퀴 달린 선수: 몸통 바운스/피치 없음, 바퀴만 회전 */
  protected wheeled = false;
  /** 갤럽식 몸통 바운스/피치를 쓸지 (사람이 뛰는 캐릭터는 자체 처리) */
  protected gaitBounce = true;
  protected reins: ReinRig | null = null;
  /** 넘어짐/잠듦 자세 0..1 */
  protected downPose = 0;
  protected grazePose = 0;
  protected planted = 0;
  private reinTmpA = new THREE.Vector3();
  private reinTmpB = new THREE.Vector3();
  private reinTmpC = new THREE.Vector3();
  private reinTmpD = new THREE.Vector3();

  constructor(def: RacerDefinition) {
    this.def = def;
    this.root.add(this.body);
    this.buildBody();
    this.setupMixer();
    addOutlines(this.body);
  }

  protected abstract buildBody(): void;
  protected abstract updateSpecial(ctx: VisualContext): void;

  protected addRider(pos: THREE.Vector3, scale = 1): THREE.Group {
    const r = makeRider(this.def.silksColor, this.def.clothColor, scale);
    r.position.copy(pos);
    this.body.add(r);
    this.riders.push(r);
    this.riderBase.push(pos.clone());
    this.riderParent.push(this.body);
    this.riderTilt.push(0);
    return r;
  }

  protected reparentRider(index: number, parent: THREE.Object3D, tilt = 0): void {
    const r = this.riders[index];
    parent.add(r);
    this.riderParent[index] = parent;
    this.riderTilt[index] = tilt;
  }

  protected addLegs(
    specs: { x: number; z: number; w: number; len: number; mat: THREE.Material; y: number; hoof?: number }[],
    parent: THREE.Object3D = this.body,
  ): void {
    const names = ['legFL', 'legFR', 'legBL', 'legBR', 'leg4', 'leg5', 'leg6', 'leg7'];
    specs.forEach((s, i) => {
      const leg = makeLeg(s.w, s.len, s.mat, names[this.legs.length] ?? `leg${i}`, s.hoof);
      leg.position.set(s.x, s.y, s.z);
      parent.add(leg);
      this.legs.push(leg);
      this.hoofPoints.push(new THREE.Vector3(s.x, 0, s.z));
    });
  }

  /** 다리별 위상 (보폭 내 최대 앞뻗기 시점). 기본: 횡단 갤럽 — 앞다리(FL, FR)는 뒷다리보다 반 보폭 뒤 */
  protected gaitPhases(): number[] {
    return [0.45, 0.58, 0.0, 0.12, 0.45, 0.58, 0.0, 0.12];
  }
  protected gaitAmps(): number[] {
    return [1.0, 1.0, 0.95, 0.95, 1.0, 1.0, 0.95, 0.95];
  }

  /**
   * 갤럽 클립(1초 = 한 보폭)을 AnimationMixer 로 재생.
   * timeScale = 속도 / 보폭 (Hz) 이므로 빠를수록 다리가 빨리 움직이고, 바운스도 같은 위상을 쓴다.
   * 횡단 갤럽: 뒷다리 왼→오른, 앞다리 왼→오른 순서, 앞으로 뻗을 때 무릎이 접힌다.
   */
  protected setupMixer(): void {
    if (this.legs.length === 0) return;
    const tracks: THREE.KeyframeTrack[] = [];
    const phases = this.gaitPhases();
    const amps = this.gaitAmps();
    const N = 24;
    this.legs.forEach((leg, i) => {
      const ph = phases[i % phases.length];
      const amp = this.legAmp * amps[i % amps.length];
      const times: number[] = [];
      const upper: number[] = [];
      const lower: number[] = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        times.push(t);
        // 실제 갤럽: 지면을 딛는 구간(stance)은 길고 느리게 뒤로, 공중 스윙은 짧고 빠르게 앞으로
        const u = (t - ph + 10) % 1;
        const warped = u < 0.42 ? (u / 0.42) * 0.5 : 0.5 + ((u - 0.42) / 0.58) * 0.5;
        const a = Math.PI * 2 * warped;
        const pos = Math.cos(a);
        upper.push(amp * (pos >= 0 ? pos * 1.05 : pos * 0.85));
        // 스윙 구간에서 무릎(앞다리)·비절(뒷다리)이 크게 접혔다가 착지 직전에 펴짐
        const vel = -Math.sin(a);
        const swing = Math.max(0, vel);
        lower.push(-Math.pow(swing, 0.7) * this.kneeFold - 0.06);
      }
      tracks.push(new THREE.NumberKeyframeTrack(`${leg.name}.rotation[z]`, times, upper));
      tracks.push(new THREE.NumberKeyframeTrack(`${leg.name}_lower.rotation[z]`, times, lower));
    });
    const clip = new THREE.AnimationClip('gallop', 1, tracks);
    this.mixer = new THREE.AnimationMixer(this.body);
    this.action = this.mixer.clipAction(clip);
    this.action.play();
  }

  setWorldForward(tan: THREE.Vector3): void {
    this.worldForward.copy(tan);
  }

  /** 고삐 부착: head 로컬 bit 위치에서 기수 손까지 양쪽 두 줄 */
  protected attachReins(head: THREE.Object3D, bit: THREE.Vector3, riderIndex = 0, parent: THREE.Object3D = this.body): void {
    const mat = toon(0x3a2416);
    const segments: THREE.Mesh[][] = [];
    for (let side = 0; side < 2; side++) {
      const list: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 5), mat);
        m.castShadow = false;
        parent.add(m);
        list.push(m);
      }
      segments.push(list);
    }
    this.reins = { head, bit, riderIndex, segments };
  }

  private updateReins(): void {
    const rig = this.reins;
    if (!rig) return;
    const rider = this.riders[rig.riderIndex];
    const parent = rig.segments[0][0].parent!;
    const riderAttached = rider && rider.parent === this.riderParent[rig.riderIndex];
    rig.head.updateWorldMatrix(true, false);
    parent.updateWorldMatrix(true, false);
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? -1 : 1;
      // 재갈 → parent 로컬
      const p0 = this.reinTmpA.copy(rig.bit);
      p0.z = rig.bit.z * s;
      rig.head.localToWorld(p0);
      parent.worldToLocal(p0);
      // 기수 손 → parent 로컬
      const p2 = this.reinTmpB;
      if (riderAttached) {
        p2.set(0.55, 0.35, s * 0.2).multiplyScalar(rider.scale.x);
        rider.localToWorld(p2);
        parent.worldToLocal(p2);
      } else {
        // 기수가 없으면 고삐가 늘어져 흔들림
        p2.copy(p0).add(this.reinTmpD.set(-0.6, -0.5, s * 0.15));
      }
      const mid = this.reinTmpC.addVectors(p0, p2).multiplyScalar(0.5);
      mid.y -= 0.16 + (riderAttached ? 0 : 0.2);
      const list = rig.segments[side];
      const n = list.length;
      let prev = p0.clone();
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / n;
        // 2차 베지어
        const pt = this.reinTmpD.set(0, 0, 0)
          .addScaledVector(p0, (1 - t) * (1 - t))
          .addScaledVector(mid, 2 * (1 - t) * t)
          .addScaledVector(p2, t * t);
        const seg = list[i];
        seg.position.addVectors(prev, pt).multiplyScalar(0.5);
        const len = prev.distanceTo(pt);
        seg.scale.set(1, Math.max(0.01, len), 1);
        seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pt.clone().sub(prev).normalize());
        prev.copy(pt);
      }
    }
  }

  update(ctx: VisualContext): void {
    const { dt, time, speedNorm } = ctx;
    const st = ctx.state;
    const grounded =
      st === 'COLLAPSED' || st === 'ENGINE_FAILURE' || st === 'FALLEN' || st === 'SLEEPING' || st === 'STUBBORN' || st === 'SHOELACE' || st === 'BROKEN' || st === 'PLANTED' || st === 'DANCING';
    const animSpeed = grounded ? 0 : speedNorm;
    const stride = Math.max(1, this.def.strideLength);
    // 보폭 주파수(Hz) — 실제 말은 16m/s 에서 약 2.3~2.5 보폭/초
    const strideHz = grounded ? 0 : (ctx.speed / stride) * this.wobbleFreq;
    const downTarget = st === 'FALLEN' || st === 'SLEEPING' ? 1 : 0;
    this.downPose = THREE.MathUtils.lerp(this.downPose, downTarget, 1 - Math.exp(-(downTarget ? 7 : 3) * dt));
    const grazeTarget = st === 'STUBBORN' ? 1 : 0;
    this.grazePose = THREE.MathUtils.lerp(this.grazePose, grazeTarget, 1 - Math.exp(-4 * dt));
    if (this.action && this.mixer) {
      this.action.timeScale = Math.abs(ctx.speed) < 0.3 ? 0 : strideHz; // 음수면 뒷걸음질(문워크)
      this.mixer.update(dt);
      this.stridePhase = this.action.time % 1;
    } else {
      this.stridePhase = (this.stridePhase + strideHz * dt) % 1;
    }
    const ph = this.stridePhase;
    const gait = this.wheeled || !this.gaitBounce ? 0 : 1;
    // 뒷다리가 차고(ph≈0.1) 공중(ph≈0.3) → 앞다리 착지(ph≈0.5): 바운스 1회/보폭
    const air = Math.max(0, Math.sin(Math.PI * 2 * (ph - 0.05))) * gait;
    const bounce = air * this.bounceAmp * (0.5 + animSpeed * 0.9);
    const jitter = (Math.sin(time * 13.1 + this.seed) * 0.5 + Math.sin(time * 7.3 + this.seed * 2)) * 0.01 * animSpeed * gait;
    this.body.position.set(0, this.baseY + bounce + jitter, 0);
    // 코너 기울기: 속도가 아무리 높아도 최대 ~20° (부스트/폭주 때 옆으로 눕지 않게)
    const lean = -ctx.cornerWeight * THREE.MathUtils.clamp((ctx.speed * ctx.speed) / (60 * 9.8), 0, 1) * 0.35;
    const roll = lean + Math.sin(time * 9 + this.seed) * 0.02 * animSpeed * gait + ctx.bump * ctx.bumpDir * 0.35 * Math.sin(ctx.bump * 20);
    // 차고 나갈 때 코가 들리고, 앞다리 착지 때 코가 내려감
    const gallopPitch = Math.cos(Math.PI * 2 * (ph - 0.15)) * 0.085 * (0.3 + animSpeed) * gait;
    const pitch = gallopPitch - THREE.MathUtils.clamp(ctx.accel, -8, 8) * 0.012 - this.stumble * 0.6;
    // 넘어짐/잠듦: 옆으로 누움 (원점이 발밑이라 몸이 바닥에 눕는다), 뒷걸음질: 몸이 뒤로 젖힘
    const dp = this.downPose;
    const reverse = st === 'REVERSING' ? 1 : 0;
    this.body.rotation.set(roll * (1 - dp) + dp * 1.5, Math.sin(time * 5.3 + this.seed) * 0.015 * animSpeed * gait, pitch * (1 - dp) + reverse * 0.18 + this.grazePose * 0.12);
    if (dp > 0.02) this.body.position.y = this.baseY + dp * 0.15 + Math.sin(time * 2.2) * 0.02 * dp;
    // 코끼리에게 받힘: 포물선으로 날아올라 빙글 돌다 머리부터 땅에 꽂힘
    if (st === 'LAUNCHED') {
      const t = THREE.MathUtils.clamp(1 - ctx.stateTimer / 2.6, 0, 1);
      const h = 4 * t * (1 - t) * 9;
      this.body.position.y = this.baseY + h;
      this.body.rotation.z = -t * Math.PI * 2.5 - 0.3; // 앞으로 공중제비
      this.body.rotation.x = Math.sin(t * Math.PI * 3) * 0.5;
      this.planted = 0;
    }
    const plantTarget = st === 'PLANTED' ? 1 : 0;
    this.planted = THREE.MathUtils.lerp(this.planted, plantTarget, 1 - Math.exp(-10 * dt));
    if (this.planted > 0.02) {
      const p = this.planted;
      // 머리가 땅속, 다리는 하늘로 허우적
      // 원점(발밑)을 축으로 코를 아래로 돌리면 머리는 땅속(-0.8m), 엉덩이·다리는 하늘로
      this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -Math.PI / 2 - 0.15, p);
      this.body.rotation.x = Math.sin(time * 1.3) * 0.05 * p;
      this.body.position.y = this.baseY + 1.35 * p;
      this.legs.forEach((l, i) => {
        l.rotation.z = Math.sin(time * 7 + i * 1.4) * 0.5 * p;
      });
    }
    if (this.neckBob) {
      const bob = this.neckBase - Math.cos(Math.PI * 2 * (ph - 0.35)) * 0.12 * (0.3 + animSpeed);
      // 풀 뜯기: 목을 바닥으로
      this.neckBob.rotation.z = THREE.MathUtils.lerp(bob, this.neckBase + 1.15, this.grazePose);
    }
    // 누웠을 때 다리는 축 늘어지고 가끔 움찔
    if (dp > 0.3) {
      this.legs.forEach((l, i) => {
        l.rotation.z = THREE.MathUtils.lerp(l.rotation.z, (i % 2 ? 0.25 : -0.2) + Math.sin(time * 1.7 + i) * 0.08, Math.min(1, dp));
      });
    }
    this.stumble = Math.max(0, this.stumble - dt * 1.2);
    this.riders.forEach((r, i) => {
      if (!r.parent || r.parent !== this.riderParent[i]) return;
      const b = this.riderBase[i];
      // 기수는 말보다 살짝 늦게 따라 오르내림
      const lag = Math.max(0, Math.sin(Math.PI * 2 * (ph - 0.18))) * gait;
      r.position.set(b.x + Math.cos(Math.PI * 2 * ph) * 0.03 * animSpeed * gait, b.y + lag * 0.07 * animSpeed, b.z);
      r.rotation.z = this.riderTilt[i] - Math.cos(Math.PI * 2 * (ph - 0.2)) * 0.1 * animSpeed * gait - ctx.accel * 0.02;
    });
    this.updateFallen(dt);
    this.updateSpecial(ctx);
    this.updateMane(time, animSpeed);
    this.updateReins();
  }

  /** 갈기 흩날림 */
  private updateMane(time: number, speed: number): void {
    this.body.traverse((o) => {
      if (o.name !== 'mane') return;
      o.children.forEach((t, i) => {
        const base = (t.userData.baseRot as number) ?? 0.55;
        t.rotation.z = base - speed * 0.35 + Math.sin(time * 11 + i * 0.9) * 0.12 * speed;
        t.rotation.x = Math.sin(time * 7 + i) * 0.08 * speed;
      });
    });
  }

  protected updateFallen(dt: number): void {
    for (const f of this.fallen) {
      if (f.landed) continue;
      f.vel.y -= 16 * dt;
      f.obj.position.addScaledVector(f.vel, dt);
      f.obj.rotation.z += f.spin * dt;
      f.obj.rotation.x += f.spin * 0.5 * dt;
      if (f.obj.position.y <= 0.25) {
        f.obj.position.y = 0.25;
        f.obj.rotation.set(0, f.obj.rotation.y, Math.PI / 2 + (Math.random() - 0.5) * 0.4);
        f.landed = true;
      }
    }
  }

  dropRider(index = 0): void {
    const r = this.riders[index];
    if (!r || r.parent !== this.riderParent[index]) return;
    const scene = this.root.parent;
    if (!scene) return;
    r.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    r.getWorldPosition(pos);
    r.getWorldQuaternion(quat);
    this.riderParent[index].remove(r);
    scene.add(r);
    r.position.copy(pos);
    r.quaternion.copy(quat);
    const vel = this.worldForward.clone().multiplyScalar(-2 + Math.random() * 2);
    vel.y = 5 + Math.random() * 3;
    vel.x += (Math.random() - 0.5) * 2;
    vel.z += (Math.random() - 0.5) * 2;
    this.fallen.push({ obj: r, vel, landed: false, spin: 6 + Math.random() * 6 });
  }

  onEvent(type: RaceEventType, _ctx: VisualContext): void {
    if (type === 'RIDER_FALL' || type === 'TWIST_FALL' || type === 'LAUNCHED') this.dropRider(0);
    if (type === 'TRIP' || type === 'COLLISION' || type === 'BUMP') this.stumble = type === 'BUMP' ? 0.4 : 1;
  }

  reset(): void {
    for (const f of this.fallen) f.obj.parent?.remove(f.obj);
    this.fallen = [];
    this.riders.forEach((r, i) => {
      if (r.parent !== this.riderParent[i]) {
        this.riderParent[i].add(r);
        r.position.copy(this.riderBase[i]);
        r.rotation.set(0, 0, 0);
      }
    });
    this.stumble = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    this.body.position.set(0, this.baseY, 0);
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.userData.isOutline) return;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat && mat !== outlineMat) mat.dispose();
    });
  }
}
