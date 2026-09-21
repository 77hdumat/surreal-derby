import * as THREE from 'three';
import { instantiate, findBone } from './Assets';
import { rotateBoneModelSpace, aimBoneModelSpace, BoneSocket, AXIS_Y, AXIS_Z } from './BoneTools';

/**
 * 리깅된 인체 GLB 로 만든 기수.
 * - 베이스 바디 위에 셰이더로 실크(상의)·승마바지·부츠·장갑 색 밴드를 입힌다 (텍스처 UV 무관, 바인드 포즈 높이 기준).
 * - 자세는 뼈 이름 맵 + 모델 공간 회전으로 잡아 리그 축 방향에 의존하지 않는다.
 * - 헬멧·고글은 절차 생성 메쉬를 머리 뼈 소켓에 붙인다.
 */
export interface RiderAssetConfig {
  url: string;
  /** 바인드 포즈 키(m) — 바운딩 박스 높이를 이 값에 맞춰 스케일 */
  fitHeight: number;
  /** 모델이 +x 를 보도록 하는 Y 회전 */
  yaw: number;
  /** 숨길 메쉬 (LOD 중복 등) */
  hideMeshes?: (string | RegExp)[];
  bones: {
    hips: string | RegExp;
    spine: (string | RegExp)[];
    neck?: string | RegExp;
    head: string | RegExp;
    upperArmL: string | RegExp;
    upperArmR: string | RegExp;
    foreArmL: string | RegExp;
    foreArmR: string | RegExp;
    handL?: string | RegExp;
    handR?: string | RegExp;
    thighL: string | RegExp;
    thighR: string | RegExp;
    shinL: string | RegExp;
    shinR: string | RegExp;
    footL?: string | RegExp;
    footR?: string | RegExp;
  };
  /** 바인드 포즈 기준 색 밴드 경계 (0=발바닥, 1=정수리) */
  bands?: { boot: number; breech: number; collar: number; hand: number };
  /** 헬멧 오프셋 (m, 머리 뼈 기준 모델 공간) */
  helmetOffset?: [number, number, number];
}

export type HumanMode = 'ride' | 'run' | 'crawl' | 'lift' | 'push' | 'lie' | 'flail';

export interface RiderColors {
  silks: number;
  sleeves: number;
  helmet: number;
  /** 승마바지 (기본 흰색) */
  breeches?: number;
  /** 부츠 (기본 검정) */
  boots?: number;
  /** 헬멧 없이 맨머리 */
  bareHead?: boolean;
}

/** 자세 파라미터 — 모든 각도는 라디안, 모델 공간(+x 전방, +y 위, +z 오른쪽) 기준 */
export interface RiderPose {
  /** 몸통 앞으로 숙임 */
  lean: number;
  /** 허벅지 앞으로 (0 = 수직 아래) */
  thigh: number;
  /** 무릎 굽힘 */
  knee: number;
  /** 팔 앞으로 뻗기 */
  armForward: number;
  /** 팔 몸쪽으로 붙이기 (T포즈에서 내림) */
  armDown: number;
  /** 팔꿈치 굽힘 */
  elbow: number;
  /** 고개 들기 */
  headUp: number;
  /** 좌우 벌림 (허벅지) */
  thighSpread: number;
}

export const JOCKEY_POSE: RiderPose = {
  lean: 0.8,
  thigh: 1.45,
  knee: 2.0,
  armForward: 0.9,
  armDown: 0.12,
  elbow: 1.2,
  headUp: 0.55,
  thighSpread: 0.28,
};

/** 초퍼 바이크 자세: 뒤로 젖히고 팔을 위로 뻗어 에이프행어 핸들 */
export const CHOPPER_POSE: RiderPose = {
  lean: 0.12,
  thigh: 1.15,
  knee: 1.55,
  armForward: 1.75,
  armDown: 0.12,
  elbow: 0.25,
  headUp: 0.15,
  thighSpread: 0.35,
};

interface Bones {
  hips: THREE.Bone;
  spine: THREE.Bone[];
  neck: THREE.Bone | null;
  head: THREE.Bone;
  upperArm: [THREE.Bone, THREE.Bone];
  foreArm: [THREE.Bone, THREE.Bone];
  hand: [THREE.Bone | null, THREE.Bone | null];
  thigh: [THREE.Bone, THREE.Bone];
  shin: [THREE.Bone, THREE.Bone];
  foot: [THREE.Bone | null, THREE.Bone | null];
}

export class RiderRig {
  /** 기수 전체 (meters, +x 전방). 안장 위치에 배치한다. */
  readonly group = new THREE.Group();
  private model?: THREE.Group;
  private bones?: Bones;
  private sockets: BoneSocket[] = [];
  private uniforms = {
    silks: { value: new THREE.Color() },
    sleeves: { value: new THREE.Color() },
    breeches: { value: new THREE.Color(0xeee9dd) },
    boots: { value: new THREE.Color(0x0d0a09) },
    bands: { value: new THREE.Vector4(0.13, 0.5, 0.87, 0.42) },
    bodyMin: { value: 0 },
    bodyHeight: { value: 1 },
    upAxis: { value: new THREE.Vector3(0, 1, 0) },
    sideAxis: { value: new THREE.Vector3(1, 0, 0) },
    sideCenter: { value: 0 },
  };
  private helmetMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32 });
  private bareHead = false;
  private pose: RiderPose = JOCKEY_POSE;
  /** 손 위치 (그룹 로컬) — 고삐 끝점 */
  readonly handL = new THREE.Vector3(0.55, 0.35, -0.2);
  readonly handR = new THREE.Vector3(0.55, 0.35, 0.2);
  readonly headTop = new THREE.Vector3(0.3, 0.9, 0);
  /** 발 위치 (그룹 로컬) — 먼지 파티클 */
  readonly footL = new THREE.Vector3(0, 0, -0.15);
  readonly footR = new THREE.Vector3(0, 0, 0.15);
  loaded = false;
  private tmpV = new THREE.Vector3();
  private dirTmp = new THREE.Vector3();
  private flail = 0;

  /**
   * @param pivot 그룹 원점 기준: 'hips' = 골반(안장에 앉히기), 'feet' = 발바닥(땅에 세우기)
   */
  constructor(readonly cfg: RiderAssetConfig, colors: RiderColors, readonly pivot: 'hips' | 'feet' = 'hips') {
    this.group.name = 'rider';
    this.setColors(colors);
    void this.load();
  }

  setColors(colors: RiderColors): void {
    this.uniforms.silks.value.set(colors.silks);
    this.uniforms.sleeves.value.set(colors.sleeves);
    if (colors.breeches !== undefined) this.uniforms.breeches.value.set(colors.breeches);
    if (colors.boots !== undefined) this.uniforms.boots.value.set(colors.boots);
    this.bareHead = !!colors.bareHead;
    this.helmetMat.color.set(colors.helmet);
  }

  setPose(p: RiderPose): void {
    this.pose = p;
  }

  private async load(): Promise<void> {
    const asset = await instantiate(this.cfg.url);
    const model = asset.scene;
    model.rotation.y = this.cfg.yaw;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && this.cfg.hideMeshes?.some((p) => (typeof p === 'string' ? m.name === p : p.test(m.name)))) m.visible = false;
    });
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) return;
        sm.skeleton.update(); // 렌더 전에는 boneMatrices 가 0 이라 먼저 갱신
        sm.computeBoundingBox();
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = this.cfg.fitHeight / Math.max(1e-6, size.y);
    model.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    if (import.meta.env.DEV) console.info(`[rig] rider bbox(raw) size=${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)} scale=${scale.toFixed(4)}`);
    // 셰이더 밴드는 지오메트리(바인드 포즈, T 포즈) 좌표 기준. 축 방향은 뼈의 바인드 위치로 알아낸다:
    // 지오메트리 공간 위치 = bindMatrix^-1 · boneInverse^-1 · 원점
    let skinned: THREE.SkinnedMesh | null = null;
    model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh && sm.visible && !skinned) skinned = sm;
    });
    const geoPos = (name: string): THREE.Vector3 => {
      const sm = skinned!;
      const idx = sm.skeleton.bones.findIndex((b) => b.name === name);
      const m = new THREE.Matrix4().copy(sm.skeleton.boneInverses[idx]).invert().premultiply(new THREE.Matrix4().copy(sm.bindMatrix).invert());
      return new THREE.Vector3().setFromMatrixPosition(m);
    };
    const c0 = this.cfg.bones;
    const nameOf = (pat: string | RegExp) => (typeof pat === 'string' ? pat : findBone(model, pat)!.name);
    const gHips = geoPos(nameOf(c0.hips));
    const gHead = geoPos(nameOf(c0.head));
    const gL = geoPos(nameOf(c0.upperArmL));
    const gR = geoPos(nameOf(c0.upperArmR));
    const up = gHead.clone().sub(gHips).normalize();
    const side = gL.clone().sub(gR).normalize();
    // 골반 = 0.53, 머리 뼈 = 0.93 이 되도록 정규화
    const H = (gHead.dot(up) - gHips.dot(up)) / 0.4;
    this.uniforms.upAxis.value.copy(up);
    this.uniforms.sideAxis.value.copy(side);
    this.uniforms.bodyMin.value = gHips.dot(up) - 0.53 * H;
    this.uniforms.bodyHeight.value = H;
    this.uniforms.sideCenter.value = gHips.dot(side);
    const b = this.cfg.bands ?? { boot: 0.13, breech: 0.5, collar: 0.87, hand: 0.42 };
    this.uniforms.bands.value.set(b.boot, b.breech, b.collar, b.hand);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) this.patchMaterial(mat as THREE.MeshStandardMaterial);
    });
    const c = this.cfg.bones;
    const req = (p: string | RegExp) => {
      const bone = findBone(model, p);
      if (!bone) throw new Error(`rider bone not found: ${p}`);
      return bone;
    };
    const opt = (p?: string | RegExp) => (p ? findBone(model, p) : null);
    this.bones = {
      hips: req(c.hips),
      spine: c.spine.map(req),
      neck: opt(c.neck),
      head: req(c.head),
      upperArm: [req(c.upperArmL), req(c.upperArmR)],
      foreArm: [req(c.foreArmL), req(c.foreArmR)],
      hand: [opt(c.handL), opt(c.handR)],
      thigh: [req(c.thighL), req(c.thighR)],
      shin: [req(c.shinL), req(c.shinR)],
      foot: [opt(c.footL), opt(c.footR)],
    };
    if (this.pivot === 'hips') {
      // 골반 뼈가 그룹 원점에 오도록 내린다 (안장 위치 = 골반)
      model.updateMatrixWorld(true);
      const hip = new THREE.Vector3();
      this.bones.hips.getWorldPosition(hip);
      model.position.y -= hip.y;
    }
    this.model = model;
    this.group.add(model);
    this.buildHelmet();
    this.loaded = true;
  }

  private patchMaterial(mat: THREE.MeshStandardMaterial): void {
    mat.roughness = 0.6;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vBind;
uniform vec3 silks;
uniform vec3 sleeves;
uniform vec3 breeches;
uniform vec3 boots;
uniform vec4 bands;
uniform float bodyMin;
uniform float bodyHeight;
uniform vec3 upAxis;
uniform vec3 sideAxis;
uniform float sideCenter;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
{
  float t = (dot(vBind, upAxis) - bodyMin) / bodyHeight;
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  float shade = 0.55 + 0.9 * lum;
  float lateral = abs(dot(vBind, sideAxis) - sideCenter) / bodyHeight;
  vec3 c = diffuseColor.rgb;
  float r = 0.6;
  if (t > 0.62 && t < bands.z && lateral > 0.13) {
    // T 포즈: 어깨 바깥 = 팔 (손목 너머는 장갑, 그 안쪽은 소매)
    if (lateral > bands.w) { c = vec3(0.12, 0.09, 0.08) * shade; r = 0.45; }
    else { c = sleeves * shade; r = 0.7; }
  }
  else if (t < bands.x) { c = boots * shade; r = 0.3; }
  else if (t < bands.y) { c = breeches * shade; r = 0.75; }
  else if (t < bands.z) { c = silks * shade; r = 0.7; }
  diffuseColor.rgb = c;
  vBandRough = r;
}`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vBandRough;')
        .replace('void main() {', 'float vBandRough = 0.6;\nvoid main() {');
    };
    mat.needsUpdate = true;
  }

  private buildHelmet(): void {
    if (!this.bones || this.bareHead) return;
    const g = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.118, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), this.helmetMat);
    cap.scale.set(1.08, 0.92, 1);
    cap.castShadow = true;
    g.add(cap);
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.012, 20, 1, false, -0.7, 1.4), this.helmetMat);
    peak.position.set(0.02, -0.005, 0);
    peak.rotation.y = -Math.PI / 2;
    peak.scale.set(1.15, 1, 1.15);
    g.add(peak);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.007, 6, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
    strap.rotation.set(0, Math.PI / 2, Math.PI);
    strap.position.y = -0.02;
    g.add(strap);
    const goggles = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.022, 8, 24, Math.PI * 0.9),
      new THREE.MeshPhysicalMaterial({ color: 0x2b3a44, roughness: 0.15, metalness: 0.3, clearcoat: 1 }),
    );
    goggles.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.2);
    goggles.position.set(0.02, -0.06, 0);
    goggles.scale.set(1, 0.6, 1);
    g.add(goggles);
    this.group.add(g);
    const off = this.cfg.helmetOffset ?? [0, 0.1, 0];
    this.sockets.push(new BoneSocket(this.bones.head, this.group, g, new THREE.Vector3(...off)));
  }

  /**
   * 매 프레임 자세 적용. 모델은 바인드 포즈에서 시작하므로 매번 리셋 후 회전을 쌓는다.
   * @param ph 보폭 위상 0..1
   * @param energy 0..1 속도 비례 팔 펌핑·상하 움직임
   */
  update(ph: number, energy: number, time: number, riding: boolean): void {
    this.animate({ mode: riding ? 'ride' : 'flail', ph, energy, time });
  }

  /**
   * 인체 동작 모드.
   *  ride  기승(2점 자세)      run   두 발 달리기        crawl 네발 기기(기수 태움)
   *  lift  탈을 머리 위로 들고 달리기   push  앞으로 밀며 달리기   lie   널브러짐   flail 낙마 허우적
   * 반환값: 골반 높이 보정(m) — 호출자가 group.position.y 에 더한다.
   */
  animate(o: { mode: HumanMode; ph: number; energy: number; time: number; lean?: number }): number {
    if (!this.bones || !this.model) return 0;
    const B = this.bones;
    const root = this.group;
    this.model.traverse((b) => {
      if ((b as THREE.Bone).isBone && b.userData.bindQuat) b.quaternion.copy(b.userData.bindQuat as THREE.Quaternion);
      else if ((b as THREE.Bone).isBone) b.userData.bindQuat = b.quaternion.clone();
    });
    root.updateWorldMatrix(true, true);
    const { ph, energy, time } = o;
    const R = (bone: THREE.Bone | null, axis: THREE.Vector3, angle: number) => bone && rotateBoneModelSpace(bone, root, axis, angle);
    const A = (bone: THREE.Bone | null, tip: THREE.Bone | null, dir: THREE.Vector3) => bone && tip && aimBoneModelSpace(bone, tip, root, dir);
    const v = this.dirTmp;
    // 방향 헬퍼 (모델 공간: +x 전방, +y 위, +z 오른쪽). a = 수직 아래에서 앞으로 잰 각
    const down = (a: number, z = 0) => v.set(Math.sin(a), -Math.cos(a), z);
    const up = (a: number, z = 0) => v.set(Math.sin(a), Math.cos(a), z);
    // 몸통: 골반→머리 방향. 첫 척추 뼈로 대부분 굽히고 나머지는 살짝 (허리에서 꺾이지 않게)
    const torso = (lean: number) => {
      // 척추 뼈 사이 오프셋이 몸통 축과 어긋나 있어, 척추 밑동→머리 벡터 하나로 조준한다
      A(B.spine[0], B.head, up(lean));
    };
    // 다리: 허벅지 각(a, 앞+), 무릎 접힘(k) → 정강이는 허벅지에서 k 만큼 뒤로
    const leg = (s: number, a: number, k: number, spread = 0.05, footFlex = 0) => {
      const sgn = s === 0 ? -1 : 1;
      A(B.thigh[s], B.shin[s], down(a, sgn * spread));
      A(B.shin[s], B.foot[s] ?? B.shin[s], down(a - k, sgn * spread));
      if (B.foot[s]) R(B.foot[s], AXIS_Z, footFlex);
    };
    // 팔: 상완 각(a, 수직 아래 기준 앞+), 팔꿈치 굽힘(e) → 전완은 상완에서 e 만큼 앞으로
    const arm = (s: number, a: number, e: number, spread = 0.12) => {
      const sgn = s === 0 ? -1 : 1;
      A(B.upperArm[s], B.foreArm[s], down(a, sgn * spread));
      A(B.foreArm[s], B.hand[s] ?? B.foreArm[s], down(a + e, sgn * spread * 0.6));
    };
    let lift = 0;
    switch (o.mode) {
      case 'flail': {
        this.flail += 0.016;
        const f = this.flail;
        torso(0.4 + Math.sin(f * 9) * 0.3);
        for (let s = 0; s < 2; s++) {
          arm(s, -0.9 + Math.sin(f * 11 + s) * 0.8, 0.8, 0.6);
          leg(s, -0.6 + Math.sin(f * 8 + s * 2) * 0.7, 0.9, 0.2);
        }
        break;
      }
      case 'lie': {
        torso(0);
        for (let s = 0; s < 2; s++) {
          arm(s, 0.3 + Math.sin(time * 1.7 + s) * 0.05, 0.2, 0.9);
          leg(s, 0.25 + Math.sin(time * 1.3 + s * 2) * 0.06, 0.5, 0.25);
        }
        R(B.head, AXIS_Y, Math.sin(time * 0.9) * 0.3);
        break;
      }
      case 'ride': {
        const P = this.pose;
        const pump = Math.sin(Math.PI * 2 * ph) * energy;
        const bob = Math.cos(Math.PI * 2 * (ph - 0.15)) * energy;
        torso(P.lean + bob * 0.06);
        if (B.neck) R(B.neck, AXIS_Z, P.headUp * 0.4);
        R(B.head, AXIS_Z, P.headUp * 0.6 - bob * 0.04);
        R(B.head, AXIS_Y, Math.sin(time * 0.7) * 0.08);
        for (let s = 0; s < 2; s++) {
          leg(s, P.thigh, P.knee, P.thighSpread, 0.35);
          const pumpArm = pump * 0.12 * (s === 0 ? 1 : -1) + Math.sin(time * 1.3 + s) * 0.03;
          arm(s, P.armForward + pumpArm, P.elbow - pumpArm * 0.5, P.armDown);
          R(B.hand[s], AXIS_Z, 0.25);
        }
        break;
      }
      case 'run':
      case 'lift':
      case 'push': {
        // 두 발 달리기: 한 보폭 = 두 걸음. 다리는 반 보폭 어긋나고 팔은 같은 쪽 다리와 반대.
        const e = Math.max(0.15, energy);
        const lean = o.lean ?? (o.mode === 'push' ? 0.55 : o.mode === 'lift' ? 0.12 : 0.3);
        torso(lean);
        R(B.head, AXIS_Z, lean * 0.7);
        lift = Math.abs(Math.sin(Math.PI * 2 * ph)) * 0.05 * e;
        for (let s = 0; s < 2; s++) {
          const p = ph + s * 0.5;
          const thigh = 0.75 * e * Math.cos(Math.PI * 2 * p);
          const kneeFold = 0.2 + 1.25 * e * Math.max(0, Math.sin(Math.PI * 2 * p + 0.5));
          leg(s, thigh, kneeFold, 0.06, 0.35 * Math.max(0, Math.sin(Math.PI * 2 * p + 0.5)) * e);
          if (o.mode === 'run') arm(s, 0.2 - 0.8 * e * Math.cos(Math.PI * 2 * p), 1.35, 0.15);
          else if (o.mode === 'lift') arm(s, 2.9 + Math.sin(time * 11 + s) * 0.05, 0.15, 0.25); // 머리 위로
          else arm(s, 1.55 + Math.sin(time * 10 + s) * 0.06 * e, 0.3, 0.1); // 앞으로 수평
        }
        break;
      }
      case 'crawl': {
        // 베어 크롤: 상체를 거의 수평으로 눕히고 팔로 땅을 짚는다. 대각선 교차 (왼팔+오른다리).
        const e = Math.max(0.1, energy);
        torso(1.35);
        R(B.head, AXIS_Z, 1.1 + Math.sin(time * 5) * 0.04 * e);
        lift = Math.abs(Math.sin(Math.PI * 2 * ph)) * 0.04 * e;
        for (let s = 0; s < 2; s++) {
          const pl = ph + s * 0.5;
          const pa = ph + (1 - s) * 0.5;
          const legSwing = 0.45 * e * Math.cos(Math.PI * 2 * pl);
          const legFold = 1.2 + 0.5 * e * Math.max(0, Math.sin(Math.PI * 2 * pl + 0.4));
          leg(s, 0.85 + legSwing, legFold, 0.12, 0.5);
          // 팔: 어깨에서 거의 수직으로 땅을 향해, 스윙 시 앞뒤로
          const armSwing = 0.45 * e * Math.cos(Math.PI * 2 * pa);
          const armFold = 0.15 + 0.6 * e * Math.max(0, Math.sin(Math.PI * 2 * pa + 0.4));
          arm(s, 0.25 + armSwing, -armFold, 0.1);
          R(B.hand[s], AXIS_Z, 0.6);
        }
        break;
      }
    }
    root.updateWorldMatrix(true, true);
    const hl = B.hand[0] ?? B.foreArm[0];
    const hr = B.hand[1] ?? B.foreArm[1];
    hl.getWorldPosition(this.tmpV);
    this.handL.copy(root.worldToLocal(this.tmpV));
    hr.getWorldPosition(this.tmpV);
    this.handR.copy(root.worldToLocal(this.tmpV));
    B.head.getWorldPosition(this.tmpV);
    this.headTop.copy(root.worldToLocal(this.tmpV));
    const fl = B.foot[0] ?? B.shin[0];
    const fr = B.foot[1] ?? B.shin[1];
    fl.getWorldPosition(this.tmpV);
    this.footL.copy(root.worldToLocal(this.tmpV));
    fr.getWorldPosition(this.tmpV);
    this.footR.copy(root.worldToLocal(this.tmpV));
    this.updateSockets();
    return lift;
  }

  private updateSockets(): void {
    for (const s of this.sockets) s.update();
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
