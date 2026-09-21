import * as THREE from 'three';
import { instantiate, findBone } from './Assets';
import { rotateBoneModelSpace, BoneSocket, AXIS_X, AXIS_Y, AXIS_Z } from './BoneTools';

/**
 * 리깅된 인체 GLB 로 만든 기수.
 * - 베이스 바디 위에 셰이더로 실크(상의)·승마바지·부츠·장갑 색 밴드를 입힌다 (텍스처 UV 무관, 바인드 포즈 높이 기준).
 * - 자세는 뼈 이름 맵 + 모델 공간 회전으로 잡아 리그 축 방향에 의존하지 않는다.
 * - 헬멧·고글은 절차 생성 메쉬를 머리 뼈 소켓에 붙인다.
 */
export interface RiderAssetConfig {
  url: string;
  /** 모델 단위 → m */
  scale: number;
  /** 모델이 +x 를 보도록 하는 Y 회전 */
  yaw: number;
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

export interface RiderColors {
  silks: number;
  sleeves: number;
  helmet: number;
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
  lean: 0.95,
  thigh: 1.55,
  knee: 2.05,
  armForward: 0.85,
  armDown: 1.15,
  elbow: 1.35,
  headUp: 0.9,
  thighSpread: 0.28,
};

/** 초퍼 바이크 자세: 뒤로 젖히고 팔을 위로 뻗어 에이프행어 핸들 */
export const CHOPPER_POSE: RiderPose = {
  lean: -0.35,
  thigh: 1.2,
  knee: 1.3,
  armForward: 1.35,
  armDown: 0.55,
  elbow: 0.35,
  headUp: -0.1,
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
    bands: { value: new THREE.Vector4(0.13, 0.5, 0.87, 0.42) },
    bodyMin: { value: 0 },
    bodyHeight: { value: 1 },
  };
  private helmetMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32 });
  private pose: RiderPose = JOCKEY_POSE;
  /** 손 위치 (그룹 로컬) — 고삐 끝점 */
  readonly handL = new THREE.Vector3(0.55, 0.35, -0.2);
  readonly handR = new THREE.Vector3(0.55, 0.35, 0.2);
  readonly headTop = new THREE.Vector3(0.3, 0.9, 0);
  loaded = false;
  private tmpV = new THREE.Vector3();
  private flail = 0;

  constructor(readonly cfg: RiderAssetConfig, colors: RiderColors) {
    this.group.name = 'rider';
    this.setColors(colors);
    void this.load();
  }

  setColors(colors: RiderColors): void {
    this.uniforms.silks.value.set(colors.silks);
    this.uniforms.sleeves.value.set(colors.sleeves);
    this.helmetMat.color.set(colors.helmet);
  }

  setPose(p: RiderPose): void {
    this.pose = p;
  }

  private async load(): Promise<void> {
    const asset = await instantiate(this.cfg.url);
    const model = asset.scene;
    model.scale.setScalar(this.cfg.scale);
    model.rotation.y = this.cfg.yaw;
    // 바인드 포즈 높이 범위 (셰이더 밴드 기준)
    const box = new THREE.Box3().setFromObject(model);
    const inv = 1 / this.cfg.scale;
    this.uniforms.bodyMin.value = box.min.y * inv;
    this.uniforms.bodyHeight.value = (box.max.y - box.min.y) * inv;
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
uniform vec4 bands;
uniform float bodyMin;
uniform float bodyHeight;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
{
  float t = (vBind.y - bodyMin) / bodyHeight;
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  float shade = 0.55 + 0.9 * lum;
  float lateral = abs(vBind.x) / bodyHeight;
  vec3 c = diffuseColor.rgb;
  float r = 0.6;
  if (t < bands.x) { c = vec3(0.05, 0.04, 0.035) * shade; r = 0.3; }
  else if (t < bands.y) { c = vec3(0.93, 0.91, 0.86) * shade; r = 0.75; }
  else if (t < bands.z) {
    // T 포즈: 손은 몸통에서 멀리 (lateral 큼) → 장갑, 팔은 소매색, 몸통은 실크색
    if (lateral > bands.w) { c = vec3(0.12, 0.09, 0.08) * shade; r = 0.45; }
    else if (lateral > 0.14) { c = sleeves * shade; r = 0.7; }
    else { c = silks * shade; r = 0.7; }
  }
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
    if (!this.bones) return;
    const g = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.128, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), this.helmetMat);
    cap.scale.set(1.05, 0.9, 1);
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
    if (!this.bones || !this.model) return;
    const B = this.bones;
    const root = this.group;
    // 바인드 포즈로 리셋
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone && o.userData.bindQuat) o.quaternion.copy(o.userData.bindQuat as THREE.Quaternion);
      else if ((o as THREE.Bone).isBone) o.userData.bindQuat = o.quaternion.clone();
    });
    root.updateWorldMatrix(true, true);
    const P = this.pose;
    if (!riding) {
      // 낙마: 사지를 휘저음
      this.flail += 0.016;
      const f = this.flail;
      rotateBoneModelSpace(B.spine[0], root, AXIS_Z, 0.4 + Math.sin(f * 9) * 0.3);
      for (let s = 0; s < 2; s++) {
        const sgn = s === 0 ? -1 : 1;
        rotateBoneModelSpace(B.upperArm[s], root, AXIS_X, sgn * -0.6);
        rotateBoneModelSpace(B.upperArm[s], root, AXIS_Z, -0.9 + Math.sin(f * 11 + s) * 0.8);
        rotateBoneModelSpace(B.foreArm[s], root, AXIS_Z, -0.8);
        rotateBoneModelSpace(B.thigh[s], root, AXIS_Z, -0.6 + Math.sin(f * 8 + s * 2) * 0.7);
        rotateBoneModelSpace(B.shin[s], root, AXIS_Z, 0.9);
      }
      this.updateSockets();
      return;
    }
    const pump = Math.sin(Math.PI * 2 * ph) * energy;
    const bob = Math.cos(Math.PI * 2 * (ph - 0.15)) * energy;
    // 몸통: 앞으로 숙이고(−Z 회전 = 코가 아래) 보폭에 맞춰 살짝 출렁
    const lean = P.lean + bob * 0.06;
    B.spine.forEach((s) => rotateBoneModelSpace(s, root, AXIS_Z, -lean / B.spine.length));
    // 고개는 앞을 보도록 되돌림 + 좌우 살짝
    if (B.neck) rotateBoneModelSpace(B.neck, root, AXIS_Z, P.headUp * 0.4);
    rotateBoneModelSpace(B.head, root, AXIS_Z, P.headUp * 0.6 - bob * 0.04);
    rotateBoneModelSpace(B.head, root, AXIS_Y, Math.sin(time * 0.7) * 0.08);
    for (let s = 0; s < 2; s++) {
      const sgn = s === 0 ? -1 : 1; // L = -z
      // 다리: 허벅지 앞으로 올리고 벌림, 무릎 접어 종아리 뒤로, 발끝은 등자에
      rotateBoneModelSpace(B.thigh[s], root, AXIS_Z, P.thigh);
      rotateBoneModelSpace(B.thigh[s], root, AXIS_X, -sgn * P.thighSpread);
      rotateBoneModelSpace(B.shin[s], root, AXIS_Z, -P.knee);
      if (B.foot[s]) rotateBoneModelSpace(B.foot[s]!, root, AXIS_Z, 0.35);
      // 팔: T 포즈에서 내리고(X축), 앞으로 뻗고(Z축), 팔꿈치 접기 + 고삐 펌핑
      const pumpArm = pump * 0.12 * (s === 0 ? 1 : -1) + Math.sin(time * 1.3 + s) * 0.03;
      rotateBoneModelSpace(B.upperArm[s], root, AXIS_X, sgn * P.armDown);
      rotateBoneModelSpace(B.upperArm[s], root, AXIS_Z, P.armForward + pumpArm);
      rotateBoneModelSpace(B.foreArm[s], root, AXIS_Z, P.elbow - pumpArm * 0.5);
      if (B.hand[s]) rotateBoneModelSpace(B.hand[s]!, root, AXIS_Z, 0.25);
    }
    root.updateWorldMatrix(true, true);
    // 손·머리 위치 갱신 (고삐·카메라용)
    const hl = B.hand[0] ?? B.foreArm[0];
    const hr = B.hand[1] ?? B.foreArm[1];
    hl.getWorldPosition(this.tmpV);
    this.handL.copy(root.worldToLocal(this.tmpV));
    hr.getWorldPosition(this.tmpV);
    this.handR.copy(root.worldToLocal(this.tmpV));
    B.head.getWorldPosition(this.tmpV);
    this.headTop.copy(root.worldToLocal(this.tmpV));
    this.updateSockets();
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
