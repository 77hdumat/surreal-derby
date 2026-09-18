import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { RacerDefinition } from './Racer';
import type { RacerStatus } from '../game/RaceState';
import type { RaceEventType } from '../events/RaceEvent';

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
  const params: THREE.MeshStandardMaterialParameters = { color, roughness: 0.72, metalness: 0.0 };
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
  const geo = new THREE.CapsuleGeometry(w / 2, Math.max(0.05, upperLen - w * 0.6), 4, 10);
  geo.translate(0, -upperLen / 2, 0);
  const upper = new THREE.Mesh(geo, mat);
  upper.name = name;
  upper.castShadow = true;
  const knee = new THREE.Group();
  knee.name = name + '_lower';
  knee.position.y = -upperLen;
  const lgeo = new THREE.CapsuleGeometry(w * 0.42, Math.max(0.05, lowerLen - w * 0.5), 4, 10);
  lgeo.translate(0, -lowerLen / 2 + w * 0.1, 0);
  const lower = new THREE.Mesh(lgeo, mat);
  lower.castShadow = true;
  knee.add(lower);
  const hoof = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.58, w * 0.45, 10), toon(hoofColor));
  hoof.position.y = -lowerLen + w * 0.2;
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
export function makeRider(silks: number, helmet: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const silk = toon(silks);
  const skin = toon(0xf0caad);
  const torso = capsule(0.16, 0.26, silk);
  torso.position.set(0.08, 0.5, 0);
  torso.rotation.z = -0.65; // 앞으로 숙임
  g.add(torso);
  const head = sphere(0.16, skin);
  head.position.set(0.3, 0.74, 0);
  g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(helmet));
  cap.position.set(0.29, 0.76, 0);
  cap.rotation.z = -0.25;
  cap.castShadow = true;
  g.add(cap);
  const visor = box(0.16, 0.06, 0.3, toon(0x111111));
  visor.position.set(0.44, 0.78, 0);
  g.add(visor);
  const goggles = box(0.06, 0.09, 0.3, toon(0x1b3a6b));
  goggles.position.set(0.44, 0.72, 0);
  g.add(goggles);
  for (const s of [-1, 1]) {
    const arm = capsule(0.05, 0.3, silk);
    arm.position.set(0.36, 0.45, s * 0.2);
    arm.rotation.z = Math.PI / 2 - 0.5;
    g.add(arm);
    const glove = sphere(0.06, toon(0xffffff));
    glove.position.set(0.55, 0.35, s * 0.2);
    g.add(glove);
    const thigh = capsule(0.07, 0.22, toon(0xf6f6f6));
    thigh.position.set(0.0, 0.2, s * 0.22);
    thigh.rotation.x = s * 0.55;
    thigh.rotation.z = -0.3;
    g.add(thigh);
    const boot = box(0.2, 0.09, 0.09, toon(0x222222));
    boot.position.set(0.1, -0.06, s * 0.32);
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
export function makeMane(neckLen: number, mat: THREE.Material, xOff: number, count = 7): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const tuft = new THREE.Mesh(new THREE.CapsuleGeometry(0.06 - t * 0.015, 0.2, 3, 8), mat);
    tuft.castShadow = true;
    tuft.position.set(xOff - 0.02 * i, 0.15 + t * (neckLen + 0.15), 0);
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
  protected reins: ReinRig | null = null;
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
    const grounded = ctx.state === 'COLLAPSED' || ctx.state === 'ENGINE_FAILURE';
    const animSpeed = grounded ? 0 : speedNorm;
    const stride = Math.max(1, this.def.strideLength);
    // 보폭 주파수(Hz) — 실제 말은 16m/s 에서 약 2.3~2.5 보폭/초
    const strideHz = grounded ? 0 : (ctx.speed / stride) * this.wobbleFreq;
    if (this.action && this.mixer) {
      this.action.timeScale = ctx.speed < 0.3 ? 0 : strideHz;
      this.mixer.update(dt);
      this.stridePhase = this.action.time % 1;
    } else {
      this.stridePhase = (this.stridePhase + strideHz * dt) % 1;
    }
    const ph = this.stridePhase;
    const gait = this.wheeled ? 0 : 1;
    // 뒷다리가 차고(ph≈0.1) 공중(ph≈0.3) → 앞다리 착지(ph≈0.5): 바운스 1회/보폭
    const air = Math.max(0, Math.sin(Math.PI * 2 * (ph - 0.05))) * gait;
    const bounce = air * this.bounceAmp * (0.5 + animSpeed * 0.9);
    const jitter = (Math.sin(time * 13.1 + this.seed) * 0.5 + Math.sin(time * 7.3 + this.seed * 2)) * 0.01 * animSpeed * gait;
    this.body.position.set(0, this.baseY + bounce + jitter, 0);
    const lean = -ctx.cornerWeight * Math.atan((ctx.speed * ctx.speed) / (60 * 9.8)) * 1.25;
    const roll = lean + Math.sin(time * 9 + this.seed) * 0.02 * animSpeed * gait + ctx.bump * ctx.bumpDir * 0.35 * Math.sin(ctx.bump * 20);
    // 차고 나갈 때 코가 들리고, 앞다리 착지 때 코가 내려감
    const gallopPitch = Math.cos(Math.PI * 2 * (ph - 0.15)) * 0.085 * (0.3 + animSpeed) * gait;
    const pitch = gallopPitch - ctx.accel * 0.012 - this.stumble * 0.6;
    this.body.rotation.set(roll, Math.sin(time * 5.3 + this.seed) * 0.015 * animSpeed * gait, pitch);
    if (this.neckBob) this.neckBob.rotation.z = this.neckBase - Math.cos(Math.PI * 2 * (ph - 0.35)) * 0.12 * (0.3 + animSpeed);
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
    if (type === 'RIDER_FALL') this.dropRider(0);
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
