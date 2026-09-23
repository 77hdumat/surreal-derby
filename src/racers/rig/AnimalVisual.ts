import * as THREE from 'three';
import { storybookify } from './Storybookify';
import { toonify } from '../../track/Storybook';

/** 말 옆 번호판 표시 여부 */
export const SHOW_NUMBER_CLOTH = false;
import type { RacerDefinition } from '../Racer';
import type { RaceEventType } from '../../events/RaceEvent';
import type { RacerVisual, VisualContext } from '../RacerVisual';
import { instantiate, findBone, findClip, dumpSkeleton } from './Assets';
import { rotateBoneModelSpace, translateBoneModelSpace, BoneSocket, AXIS_X, AXIS_Y, AXIS_Z } from './BoneTools';
import { RiderRig, JOCKEY_POSE, type RiderAssetConfig, type RiderPose, type RiderColors } from './RiderRig';

/**
 * 리깅 GLB 동물 공통 비주얼.
 *  - 기본 동작: GLB 클립(idle/walk/run) 을 속도에 따라 블렌딩, timeScale = 속도/보폭.
 *  - 그 위에 절차 레이어(additive): 코너 기울기, 목 끄덕임, 충격 흔들림, 넘어짐/잠듦/풀 뜯기/머리 박힘,
 *    캐릭터별 특수 연출(서브클래스 updateSpecial) 을 뼈에 모델 공간 회전으로 얹는다.
 *  - 기수는 RiderRig 를 안장 소켓에 붙인다.
 * 로드 전/실패 시에는 fallback(절차 생성 비주얼)을 그대로 보여준다.
 */
export type RigBone =
  | 'root'
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck0'
  | 'neck1'
  | 'neck2'
  | 'head'
  | 'jaw'
  | 'tail0'
  | 'tail1'
  | 'earL'
  | 'earR'
  | 'legFL_upper'
  | 'legFL_lower'
  | 'legFL_foot'
  | 'legFR_upper'
  | 'legFR_lower'
  | 'legFR_foot'
  | 'legBL_upper'
  | 'legBL_lower'
  | 'legBL_foot'
  | 'legBR_upper'
  | 'legBR_lower'
  | 'legBR_foot'
  | 'trunk0'
  | 'trunk1'
  | 'trunk2';

export interface AnimalAssetConfig {
  url: string;
  /** 바인드 포즈 바운딩 박스 높이를 이 값(m)에 맞춰 자동 스케일 */
  fitHeight: number;
  /** 모델이 +x 를 보도록 하는 Y 회전 */
  yaw: number;
  /** 자동 정렬(발바닥 y=0, 박스 중심 x=0) 뒤 추가 보정 (m) */
  offset?: [number, number, number];
  /** run 이 없으면 절차 보행(뼈 IK)으로 다리를 움직인다 */
  clips: { run?: string | RegExp; walk?: string | RegExp; idle?: string | RegExp; rear?: string | RegExp; sleep?: string | RegExp; fallen?: string | RegExp; eat?: string | RegExp };
  /** 절차 보행 위상 [FL, FR, BL, BR] */
  gaitPhases?: [number, number, number, number];
  /** 뻣뻣한 조형물(트로이 목마): 클립·보행·목 끄덕임 없음, 바인드 포즈 고정 */
  rigid?: boolean;
  /** 발굽/발끝 뼈 이름 (지면 보정용). 없으면 leg*_foot 뼈 사용 */
  feetTips?: (string | RegExp)[];
  /** run 클립 한 루프당 이동 거리(m) — timeScale 계산 */
  runStride: number;
  walkStride?: number;
  bones: Partial<Record<RigBone, string | RegExp>>;
  /** 숨길 메쉬 이름 패턴 (예: 딸려온 안장) */
  hideMeshes?: (string | RegExp)[];
  /** 몸통 색 틴트 (레이서 bodyColor 를 곱할지) */
  tint?: boolean;
  /** 어깨(기갑) 높이 m — 카메라/기수 기준 */
  height: number;
  /** 안장 위치: chest/spine 뼈 소켓 기준 오프셋 (m, 바인드 포즈 모델 공간) */
  seat: { bone: RigBone; offset: [number, number, number] };
  /** 재갈 위치: head 뼈 기준 오프셋 */
  bit?: [number, number, number];
  /** 목 끄덕임 진폭 */
  neckBob?: number;
  /** 사이드 라벨(번호천) 위치·크기 */
  numberCloth?: { bone: RigBone; offset: [number, number, number]; size: number; halfWidth: number };
}

interface Clips {
  run?: THREE.AnimationAction;
  walk?: THREE.AnimationAction;
  idle?: THREE.AnimationAction;
  rear?: THREE.AnimationAction;
  sleep?: THREE.AnimationAction;
  fallen?: THREE.AnimationAction;
  eat?: THREE.AnimationAction;
}

export const RIDER_ASSET: { cfg: RiderAssetConfig | null } = { cfg: null };

export abstract class AnimalVisual implements RacerVisual {
  readonly root = new THREE.Group();
  /** meters, +x 전방. 바운스/기울기/누움은 여기에 */
  readonly body = new THREE.Group();
  readonly def: RacerDefinition;
  readonly hoofPoints: THREE.Vector3[] = [];
  height: number;
  protected model?: THREE.Group;
  protected bones: Partial<Record<RigBone, THREE.Bone>> = {};
  protected allBones: THREE.Bone[] = [];
  protected mixer?: THREE.AnimationMixer;
  protected clips?: Clips;
  protected sockets: BoneSocket[] = [];
  protected rider?: RiderRig;
  protected riderSocket?: BoneSocket;
  protected riderPose: RiderPose = JOCKEY_POSE;
  /** 기수 동작 모드 (기본 기승; 서브클래스가 바꿀 수 있음) */
  protected riderMode: 'ride' | 'matador' = 'ride';
  /** 기수 의상 색 (기본: 레이서 정의의 실크/클로스 색) */
  protected riderColors?: RiderColors;
  protected riderDropped = false;
  protected fallenRider: { vel: THREE.Vector3; landed: boolean; spin: number } | null = null;
  protected fallback: RacerVisual;
  protected loaded = false;
  protected failed = false;
  protected stridePhase = 0;
  protected worldForward = new THREE.Vector3(1, 0, 0);
  protected seed = Math.random() * 100;
  protected downPose = 0;
  protected grazePose = 0;
  protected planted = 0;
  protected stumble = 0;
  protected impactAge = 10;
  protected impactStrength = 0;
  protected impactSide = 1;
  protected reinSegments: THREE.Mesh[][] = [];
  protected reinBit = new THREE.Vector3();
  protected sleepZ?: THREE.Sprite;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private lastCtx?: VisualContext;

  constructor(def: RacerDefinition, readonly cfg: AnimalAssetConfig, fallback: RacerVisual) {
    this.def = def;
    this.fallback = fallback;
    this.height = cfg.height;
    this.root.add(fallback.root);
    this.root.add(this.body);
    this.body.visible = false;
    void this.load();
  }

  // ---------------------------------------------------------------- 로드

  private async load(): Promise<void> {
    try {
      const asset = await instantiate(this.cfg.url);
      const model = asset.scene;
      // 동화책·카툰 톤: 실사 모델은 텍스처를 평균색으로 납작하게, 그 뒤 전부 셀 셰이딩
      if (!this.cfg.url.includes('/storybook/')) storybookify(model);
      toonify(model);
      model.rotation.y = this.cfg.yaw;
      // updateMatrixWorld 여야 SkinnedMesh 가 bindMatrixInverse 를 갱신한다 (updateWorldMatrix 는 건너뜀)
      model.updateMatrixWorld(true);
      // 스킨 메쉬는 바인드 포즈를 스키닝한 박스를 써야 실제 크기가 나온다
      model.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) return;
        sm.skeleton.update(); // 렌더 전에는 boneMatrices 가 0 이라 먼저 갱신
        sm.computeBoundingBox();
      });
      // 자동 정렬: 뼈 위치 범위(스킨 박스는 일부 에셋에서 어긋남)로 높이 → fitHeight, 발바닥 y=0, 중심 x/z=0
      const box = new THREE.Box3();
      const bp = new THREE.Vector3();
      model.traverse((o) => {
        if ((o as THREE.Bone).isBone) box.expandByPoint(o.getWorldPosition(bp));
      });
      if (box.isEmpty()) box.setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = this.cfg.fitHeight / Math.max(1e-6, size.y);
      model.scale.setScalar(scale);
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      if (this.cfg.offset) model.position.add(new THREE.Vector3(...this.cfg.offset));
      if (import.meta.env.DEV) {
        model.traverse((o) => {
          const sm = o as THREE.SkinnedMesh;
          if (!sm.isSkinnedMesh) return;
          sm.geometry.computeBoundingBox();
          const g = sm.geometry.boundingBox!.getSize(new THREE.Vector3());
          const b = sm.boundingBox!.getSize(new THREE.Vector3());
          const ws = new THREE.Vector3();
          sm.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
          let sum = 0;
          for (let i = 0; i < 16; i++) sum += Math.abs(sm.skeleton.boneMatrices[i]);
          console.info(`[rig-dbg] ${this.def.id} ${sm.name} geoBox=${g.toArray().map((v) => v.toFixed(2))} skinBox=${b.toArray().map((v) => v.toFixed(2))} worldScale=${ws.toArray().map((v) => v.toFixed(3))} bones=${sm.skeleton.bones.length} bm0=${sum.toFixed(2)} bindMode=${sm.bindMode}`);
        });
      }
      if (import.meta.env.DEV) console.info(`[rig] ${this.def.id} bbox(raw) size=${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)} scale=${scale.toFixed(4)}`);
      if (import.meta.env.DEV && !(window as unknown as { __rigDumped?: Set<string> }).__rigDumped?.has(this.cfg.url)) {
        const w = window as unknown as { __rigDumped?: Set<string> };
        (w.__rigDumped ??= new Set()).add(this.cfg.url);
        dumpSkeleton(model, this.cfg.url);
        console.info(`[rig] ${this.cfg.url} clips:`, asset.animations.map((a) => `${a.name} (${a.duration.toFixed(2)}s)`));
      }
      for (const key of Object.keys(this.cfg.bones) as RigBone[]) {
        const b = findBone(model, this.cfg.bones[key]!);
        if (b) this.bones[key] = b;
        else console.warn(`[rig] ${this.def.id}: bone ${key} (${this.cfg.bones[key]}) not found`);
      }
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // 노드 이름(Object_NN)뿐 아니라 재질 이름(Saddle, Hair …)으로도 숨김 판정
        const matName = (Array.isArray(m.material) ? m.material[0] : m.material)?.name ?? '';
        if (this.cfg.hideMeshes?.some((p) => (typeof p === 'string' ? m.name === p || matName === p : p.test(m.name) || p.test(matName)))) m.visible = false;
        if (this.cfg.tint) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) (mat as THREE.MeshStandardMaterial).color?.multiply(new THREE.Color(this.def.bodyColor));
        }
      });
      // 바인드 포즈 저장 — 클립에 트랙이 없는 뼈에 additive 회전이 누적되지 않도록 매 프레임 복원
      model.traverse((o) => {
        if (!(o as THREE.Bone).isBone) return;
        o.userData.bindQuat = o.quaternion.clone();
        o.userData.bindPos = o.position.clone();
        this.allBones.push(o as THREE.Bone);
      });
      this.model = model;
      this.body.add(model);
      // 클립
      this.mixer = new THREE.AnimationMixer(model);
      const mk = (c: THREE.AnimationClip | null) => (c ? this.mixer!.clipAction(c) : undefined);
      const C = this.cfg.clips;
      this.clips = {
        run: mk(findClip(asset.animations, C.run)),
        walk: mk(findClip(asset.animations, C.walk)),
        idle: mk(findClip(asset.animations, C.idle)),
        rear: mk(findClip(asset.animations, C.rear)),
        sleep: mk(findClip(asset.animations, C.sleep)),
        fallen: mk(findClip(asset.animations, C.fallen)),
        eat: mk(findClip(asset.animations, C.eat)),
      };
      for (const a of [this.clips.run, this.clips.walk, this.clips.idle, this.clips.sleep, this.clips.fallen, this.clips.eat]) {
        if (a) a.play().setEffectiveWeight(a === this.clips.run ? 1 : 0);
      }
      if (this.clips.rear) {
        this.clips.rear.setLoop(THREE.LoopOnce, 1);
        this.clips.rear.clampWhenFinished = true;
      }
      // 소켓 기준 자세: 리그의 rest 포즈는 클립 자세와 크게 다를 수 있어(예: 목이 접힘)
      // idle(없으면 run) 클립 0초 자세를 "중립" 으로 삼아 장식·기수 소켓을 만든다.
      const neutral = this.clips.idle ?? this.clips.run;
      if (neutral) {
        for (const a of [this.clips.run, this.clips.walk, this.clips.idle]) if (a) a.setEffectiveWeight(a === neutral ? 1 : 0);
        this.mixer.update(0);
      }
      this.body.updateMatrixWorld(true);
      this.buildDecor();
      this.buildRider();
      this.buildReins();
      this.buildSleepZ();
      this.buildNumberCloth();
      if (neutral) for (const a of [this.clips.run, this.clips.walk, this.clips.idle]) if (a) a.setEffectiveWeight(a === this.clips.run ? 1 : 0);
      this.calibrateGround();
      // 스킨 메쉬 컬링: 바인드 포즈 구를 2.5배 키워 두면 화면 밖 선수는 렌더·그림자 패스에서 빠진다
      model.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) return;
        sm.skeleton.update();
        sm.computeBoundingSphere();
        if (sm.boundingSphere) {
          sm.boundingSphere.radius *= 2.5;
          sm.frustumCulled = true;
        }
      });
      // 발굽 위치
      for (const k of ['legFL_foot', 'legFR_foot', 'legBL_foot', 'legBR_foot'] as RigBone[]) {
        if (this.bones[k]) this.hoofPoints.push(new THREE.Vector3());
      }
      this.root.remove(this.fallback.root);
      this.body.visible = true;
      this.loaded = true;
      if (this.lastCtx) this.update(this.lastCtx);
    } catch (e) {
      console.warn(`[rig] ${this.def.id} 로드 실패 — 절차 생성 비주얼 유지`, e);
      this.failed = true;
    }
  }

  /**
   * 지면 보정: 바인드 포즈 박스로 발바닥을 y=0 에 맞췄지만, 달리기 클립은 루트가 위로 떠 있거나
   * 발이 더 아래로 내려가는 경우가 있다. run 클립 한 사이클을 샘플링해 가장 낮은 발 높이가 0 이 되게 모델을 내린다.
   */
  private calibrateGround(): void {
    if (!this.mixer || !this.model) return;
    // GPU 스키닝은 뼈를 따르므로 발끝 뼈 위치로 잰다 (CPU 스킨 박스는 일부 에셋에서 어긋남)
    const tips = (this.cfg.feetTips ?? []).map((n) => findBone(this.model!, n)).filter(Boolean) as THREE.Bone[];
    const feet = tips.length ? tips : ((['legFL_foot', 'legFR_foot', 'legBL_foot', 'legBR_foot'] as RigBone[]).map((k) => this.bones[k]).filter(Boolean) as THREE.Bone[]);
    if (!feet.length) return;
    const run = this.clips?.run;
    const p = new THREE.Vector3();
    let minY = Infinity;
    const sample = () => {
      this.body.updateMatrixWorld(true);
      for (const f of feet) {
        f.getWorldPosition(p);
        this.body.worldToLocal(p);
        minY = Math.min(minY, p.y);
      }
    };
    if (run) {
      const dur = run.getClip().duration;
      for (let i = 0; i < 16; i++) {
        for (const b of this.allBones) {
          b.quaternion.copy(b.userData.bindQuat as THREE.Quaternion);
          b.position.copy(b.userData.bindPos as THREE.Vector3);
        }
        this.mixer.setTime((i / 16) * dur);
        sample();
      }
      this.mixer.setTime(0);
    } else sample();
    if (!isFinite(minY)) return;
    // 발끝 뼈는 발굽 바닥보다 조금 위 → 키의 1.5% 만큼 여유
    const pad = this.cfg.fitHeight * (tips.length ? 0.015 : 0.03);
    this.model.position.y -= minY - pad;
    if (import.meta.env.DEV) console.info(`[rig] ${this.def.id} ground calibrate: minTipY=${minY.toFixed(3)} → offset ${(-(minY - pad)).toFixed(3)}`);
  }

  /** 서브클래스: 장식(깃털·핸들·담요 등) 소켓 부착 */
  protected buildDecor(): void {}
  /** 서브클래스: 캐릭터별 연출 (뼈 additive) */
  protected abstract updateSpecial(ctx: VisualContext, ph: number): void;

  protected socket(bone: RigBone, obj: THREE.Object3D, offset: [number, number, number], baseQuat?: THREE.Quaternion): BoneSocket | null {
    const b = this.bones[bone];
    if (!b) return null;
    this.body.add(obj);
    const s = new BoneSocket(b, this.body, obj, new THREE.Vector3(...offset), baseQuat);
    this.sockets.push(s);
    return s;
  }

  protected buildRider(): void {
    if (!RIDER_ASSET.cfg) return;
    this.rider = new RiderRig(RIDER_ASSET.cfg, { ...(this.riderColors ?? { silks: this.def.silksColor, sleeves: this.def.clothColor, helmet: this.def.clothColor }), head: this.def.jockeyHead });
    this.rider.setPose(this.riderPose);
    const s = this.socket(this.cfg.seat.bone, this.rider.group, this.cfg.seat.offset);
    if (s) this.riderSocket = s;
  }

  protected buildReins(): void {
    if (!this.cfg.bit || !this.bones.head || !this.rider) return;
    this.reinBit.set(...this.cfg.bit);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.7 });
    for (let side = 0; side < 2; side++) {
      const list: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5), mat);
        m.castShadow = false;
        this.body.add(m);
        list.push(m);
      }
      this.reinSegments.push(list);
    }
  }

  protected buildSleepZ(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '900 74px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(18,24,54,0.95)';
    ctx.strokeText('zZzzzzZZ', 256, 66);
    ctx.fillStyle = '#fff3a6';
    ctx.fillText('zZzzzzZZ', 256, 66);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    sprite.scale.set(3.2, 0.8, 1);
    sprite.visible = false;
    sprite.renderOrder = 20;
    this.root.add(sprite);
    this.sleepZ = sprite;
  }

  protected buildNumberCloth(): void {
    const nc = this.cfg.numberCloth;
    // 대결 모드: 번호판 없음 (선수 구분은 HUD 순위·기수 유니폼색으로)
    if (!nc || !SHOW_NUMBER_CLOTH) return;
    const g = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#' + this.def.clothColor.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 16);
    ctx.fillRect(0, 112, 128, 16);
    ctx.font = 'bold 84px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(String(this.def.number), 64, 66);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(this.def.number), 64, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(nc.size, nc.size * 0.9), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
      m.rotation.y = side > 0 ? 0 : Math.PI;
      m.position.z = side * nc.halfWidth;
      g.add(m);
    }
    this.socket(nc.bone, g, nc.offset);
  }

  // ---------------------------------------------------------------- 매 프레임

  setWorldForward(tan: THREE.Vector3): void {
    this.worldForward.copy(tan);
    this.fallback.setWorldForward(tan);
  }

  protected rot(bone: RigBone, axis: THREE.Vector3, angle: number): void {
    const b = this.bones[bone];
    if (b) rotateBoneModelSpace(b, this.body, axis, angle);
  }

  protected move(bone: RigBone, delta: THREE.Vector3): void {
    const b = this.bones[bone];
    if (b) translateBoneModelSpace(b, this.body, delta);
  }

  update(ctx: VisualContext): void {
    this.lastCtx = ctx;
    if (!this.loaded || !this.mixer || !this.clips || !this.model) {
      this.fallback.update(ctx);
      return;
    }
    const { dt, time, speedNorm } = ctx;
    const st = ctx.state;
    this.impactAge += dt;
    const grounded =
      st === 'COLLAPSED' || st === 'ENGINE_FAILURE' || st === 'FALLEN' || st === 'SLEEPING' || st === 'STUBBORN' || st === 'SHOELACE' || st === 'BROKEN' || st === 'PLANTED' || st === 'DANCING';
    const speed = grounded ? 0 : Math.abs(ctx.speed);
    const stride = Math.max(1, this.cfg.runStride);
    // 클립 블렌딩: idle(<1m/s) → walk(<5) → run, 상태 클립(잠·넘어짐·풀뜯기)은 해당 상태에서 우선
    const wRun = THREE.MathUtils.clamp((speed - 3) / 4, 0, 1);
    const wWalk = this.clips.walk ? THREE.MathUtils.clamp(speed / 2, 0, 1) * (1 - wRun) : 0;
    const wIdle = this.clips.idle ? 1 - Math.max(wRun, wWalk) : 0;
    const wSleep = this.clips.sleep && st === 'SLEEPING' ? 1 : 0;
    const wFallen = this.clips.fallen && st === 'FALLEN' ? 1 : 0;
    const wEat = this.clips.eat && st === 'STUBBORN' ? 1 : 0;
    const special = Math.max(wSleep, wFallen, wEat);
    const k = 1 - Math.exp(-8 * dt);
    const w = (a: THREE.AnimationAction | undefined, target: number) => {
      if (!a) return;
      a.setEffectiveWeight(THREE.MathUtils.lerp(a.getEffectiveWeight(), target, k));
    };
    w(this.clips.run, (wRun || (!this.clips.walk && !this.clips.idle ? 1 : 0)) * (1 - special));
    w(this.clips.walk, wWalk * (1 - special));
    w(this.clips.idle, wIdle * (1 - special));
    w(this.clips.sleep, wSleep);
    w(this.clips.fallen, wFallen);
    w(this.clips.eat, wEat);
    // 보폭 주파수: 클립 1루프 = runStride m
    const hz = speed / stride;
    if (this.clips.run) this.clips.run.timeScale = speed < 0.3 ? 0 : (ctx.speed < 0 ? -1 : 1) * hz;
    if (this.clips.walk) this.clips.walk.timeScale = speed < 0.3 ? 0.001 : speed / (this.cfg.walkStride ?? stride * 0.45);
    for (const b of this.allBones) {
      b.quaternion.copy(b.userData.bindQuat as THREE.Quaternion);
      b.position.copy(b.userData.bindPos as THREE.Vector3);
    }
    this.mixer.update(dt);
    if (this.clips.run) this.stridePhase = (this.clips.run.time / this.clips.run.getClip().duration) % 1;
    else this.stridePhase = (this.stridePhase + (ctx.speed < 0 ? -hz : hz) * dt + 1) % 1;
    const ph = this.stridePhase;
    const animSpeed = this.cfg.rigid ? 0 : this.clips.run ? speedNorm * wRun : Math.min(1, speed / 6);
    // 절차 보행 (run 클립이 없는 에셋): 다리 뼈를 모델 공간에서 흔든다
    const procGait = !this.cfg.rigid && !this.clips.run && !grounded && speed > 0.3;
    // 잠·넘어짐 클립이 있으면 몸통 눕히기(downPose)는 생략하고 클립에 맡긴다
    const clipHandlesDown = (st === 'SLEEPING' && !!this.clips.sleep) || (st === 'FALLEN' && !!this.clips.fallen);

    // 몸통 그룹: 코너 기울기·충격·넘어짐 (뼈가 아니라 body 로)
    const downTarget = (st === 'FALLEN' || st === 'SLEEPING') && !clipHandlesDown ? 1 : 0;
    this.downPose = THREE.MathUtils.lerp(this.downPose, downTarget, 1 - Math.exp(-(downTarget ? 7 : 3) * dt));
    const grazeTarget = st === 'STUBBORN' && !this.clips.eat ? 1 : 0;
    this.grazePose = THREE.MathUtils.lerp(this.grazePose, grazeTarget, 1 - Math.exp(-4 * dt));
    // 갤럽 바운스 (절차 보행일 때만 — 클립은 자체 바운스 포함)
    const bounce = procGait ? Math.max(0, Math.sin(Math.PI * 2 * (ph - 0.05))) * 0.06 * animSpeed : 0;
    const lean = -ctx.cornerWeight * THREE.MathUtils.clamp((ctx.speed * ctx.speed) / (60 * 9.8), 0, 1) * 0.3;
    const roll = lean + this.impactStrength * this.impactSide * Math.sin(this.impactAge * 12) * Math.exp(-this.impactAge * 7) * 0.13;
    const pitch = -THREE.MathUtils.clamp(ctx.accel, -8, 8) * 0.003 - this.stumble * 0.12;
    const dp = this.downPose;
    const reverse = st === 'REVERSING' ? 1 : 0;
    this.body.rotation.set(roll * (1 - dp) + dp * 1.5, Math.sin(time * 5.3 + this.seed) * 0.01 * animSpeed, pitch * (1 - dp) + reverse * 0.18);
    this.body.position.set(0, dp * 0.15 + Math.sin(time * 2.2) * 0.02 * dp + bounce, 0);
    if (st === 'LAUNCHED') {
      const t = THREE.MathUtils.clamp(1 - ctx.stateTimer / 2.6, 0, 1);
      this.body.position.y = 4 * t * (1 - t) * 9;
      this.body.rotation.z = -t * Math.PI * 2.5 - 0.3;
      this.body.rotation.x = Math.sin(t * Math.PI * 3) * 0.5;
      this.planted = 0;
    }
    const plantTarget = st === 'PLANTED' ? 1 : 0;
    this.planted = THREE.MathUtils.lerp(this.planted, plantTarget, 1 - Math.exp(-10 * dt));
    if (this.planted > 0.02) {
      const p = this.planted;
      this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -Math.PI / 2 - 0.15, p);
      this.body.rotation.x = Math.sin(time * 1.3) * 0.05 * p;
      this.body.position.y = 1.35 * p * (this.height / 2.4);
    }
    this.stumble = Math.max(0, this.stumble - dt * 1.2);

    // ---- 뼈 additive 레이어 (클립 위에 얹음). 부모→자식 순서.
    this.body.updateWorldMatrix(true, true);
    if (procGait) this.proceduralGait(ph, animSpeed);
    const bob = this.cfg.rigid ? 0 : (this.cfg.neckBob ?? 0.05);
    // 목: 갤럽에 맞춰 끄덕임 + 풀 뜯기 때 아래로
    const neckDown = this.grazePose * 0.55 + (Math.cos(Math.PI * 2 * (ph - 0.35)) * bob * animSpeed);
    const neckChain: RigBone[] = ['neck0', 'neck1', 'neck2'];
    const neckBones = neckChain.filter((n) => this.bones[n]);
    for (const n of neckBones) this.rot(n, AXIS_Z, -neckDown / neckBones.length - Math.sin(time * 6.5) * 0.03 * this.grazePose);
    if (this.grazePose > 0.01) this.rot('head', AXIS_Z, -this.grazePose * 0.45);
    if (this.bones.jaw) this.rot('jaw', AXIS_Z, -(0.5 + 0.5 * Math.sin(time * 13)) * 0.12 * this.grazePose);
    // 꼬리: 속도에 따라 흩날림
    this.rot('tail0', AXIS_Z, Math.sin(time * 7 + this.seed) * 0.12 * animSpeed + animSpeed * 0.25);
    this.rot('tail1', AXIS_X, Math.sin(time * 9 + this.seed) * 0.2 * animSpeed);
    // 넘어져 누웠을 때 다리 축 늘어짐
    if (dp > 0.3) {
      const legs: RigBone[] = ['legFL_upper', 'legFR_upper', 'legBL_upper', 'legBR_upper'];
      legs.forEach((l, i) => this.rot(l, AXIS_Z, ((i % 2 ? 0.25 : -0.2) + Math.sin(time * 1.7 + i) * 0.08) * dp));
    }
    if (this.planted > 0.05) {
      const legs: RigBone[] = ['legFL_upper', 'legFR_upper', 'legBL_upper', 'legBR_upper'];
      legs.forEach((l, i) => this.rot(l, AXIS_Z, Math.sin(time * 7 + i * 1.4) * 0.5 * this.planted));
    }
    this.updateSpecial(ctx, ph);

    // ---- 소켓·기수·고삐
    this.body.updateWorldMatrix(true, true);
    for (const s of this.sockets) s.update();
    if (this.rider) {
      const riding = !this.riderDropped;
      if (riding) this.rider.animate({ mode: this.riderMode, ph, energy: animSpeed, time });
      else this.rider.animate({ mode: 'flail', ph, energy: 0, time });
    }
    this.updateFallenRider(dt);
    this.updateReins();
    if (this.sleepZ) {
      const sleeping = st === 'SLEEPING';
      this.sleepZ.visible = sleeping && this.downPose > 0.04;
      if (this.sleepZ.visible) {
        const pulse = 1 + Math.sin(time * 3.2) * 0.08;
        this.sleepZ.position.set(-0.15 + Math.sin(time * 1.4) * 0.12, this.height + 0.72 + Math.sin(time * 2.1) * 0.1, 0);
        this.sleepZ.scale.set(3.2 * pulse, 0.8 * pulse, 1);
        (this.sleepZ.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.clamp(this.downPose * 1.6, 0, 1);
      }
    }
    // 발굽 샘플 (root 로컬)
    this.root.updateWorldMatrix(true, true);
    const feet: RigBone[] = ['legFL_foot', 'legFR_foot', 'legBL_foot', 'legBR_foot'];
    let hi = 0;
    for (const f of feet) {
      const b = this.bones[f];
      if (!b) continue;
      const p = this.hoofPoints[hi++];
      b.getWorldPosition(p);
      this.root.worldToLocal(p);
    }
  }

  /**
   * 절차 보행: 갤럽 위상에 따라 상완/대퇴(스윙)·전완/경골(접힘)·발(굴곡)을 모델 공간 Z축으로 회전.
   * 앞다리는 무릎이 뒤로 접히고(뒤로 회전), 뒷다리는 비절이 앞으로 접힌다.
   */
  protected proceduralGait(ph: number, amount: number): void {
    const phases = this.cfg.gaitPhases ?? [0.5, 0.65, 0.0, 0.15];
    const legs: [RigBone, RigBone, RigBone, number][] = [
      ['legFL_upper', 'legFL_lower', 'legFL_foot', phases[0]],
      ['legFR_upper', 'legFR_lower', 'legFR_foot', phases[1]],
      ['legBL_upper', 'legBL_lower', 'legBL_foot', phases[2]],
      ['legBR_upper', 'legBR_lower', 'legBR_foot', phases[3]],
    ];
    legs.forEach(([up, lo, ft, phase], i) => {
      const front = i < 2;
      const u = ((ph - phase) % 1 + 1) % 1;
      // stance 40%: 앞→뒤 직선, swing 60%: 뒤→앞 (무릎 접고)
      const stance = u < 0.4;
      const t = stance ? u / 0.4 : (u - 0.4) / 0.6;
      const ease = t * t * (3 - 2 * t);
      const swing = stance ? 0.5 - t : -0.5 + ease; // -0.5(뒤) … +0.5(앞)
      const fold = stance ? 0 : Math.sin(Math.PI * Math.min(1, t / 0.8)) ** 1.3;
      const a = 0.55 * amount;
      this.rot(up, AXIS_Z, swing * 2 * a + (front ? 0.05 : -0.05) * amount);
      this.rot(lo, AXIS_Z, (front ? -1 : 1) * fold * 1.1 * amount - (stance ? 0 : 0));
      this.rot(ft, AXIS_Z, (front ? -0.3 : 0.25) * fold * amount + (stance ? -0.15 * (1 - t) * amount : 0));
    });
  }

  private updateReins(): void {
    if (!this.reinSegments.length || !this.rider || !this.bones.head) return;
    const head = this.bones.head;
    const parent = this.body;
    const riderAttached = !this.riderDropped;
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? -1 : 1;
      const p0 = this.tmpA.copy(this.reinBit);
      p0.z = this.reinBit.z * s;
      // reinBit 은 바인드 포즈 head 기준 모델 공간 오프셋 → 현재 head 회전 반영
      head.getWorldPosition(this.tmpD);
      parent.worldToLocal(this.tmpD);
      p0.add(this.tmpD);
      const p2 = this.tmpB;
      if (riderAttached) {
        p2.copy(side === 0 ? this.rider.handL : this.rider.handR);
        this.rider.group.localToWorld(p2);
        parent.worldToLocal(p2);
      } else {
        p2.copy(p0).add(this.tmpD.set(-0.6, -0.5, s * 0.15));
      }
      const mid = this.tmpC.addVectors(p0, p2).multiplyScalar(0.5);
      mid.y -= 0.16 + (riderAttached ? 0 : 0.2);
      const list = this.reinSegments[side];
      const n = list.length;
      const prev = p0.clone();
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / n;
        const pt = this.tmpD.set(0, 0, 0).addScaledVector(p0, (1 - t) * (1 - t)).addScaledVector(mid, 2 * (1 - t) * t).addScaledVector(p2, t * t);
        const seg = list[i];
        seg.position.addVectors(prev, pt).multiplyScalar(0.5);
        const len = prev.distanceTo(pt);
        seg.scale.set(1, Math.max(0.01, len), 1);
        seg.quaternion.setFromUnitVectors(AXIS_Y, pt.clone().sub(prev).normalize());
        prev.copy(pt);
      }
    }
  }

  // ---------------------------------------------------------------- 낙마

  dropRider(): void {
    if (!this.rider || this.riderDropped) return;
    const scene = this.root.parent;
    if (!scene) return;
    const r = this.rider.group;
    r.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    r.getWorldPosition(pos);
    r.getWorldQuaternion(quat);
    this.body.remove(r);
    scene.add(r);
    r.position.copy(pos);
    r.quaternion.copy(quat);
    const vel = this.worldForward.clone().multiplyScalar(-2 + Math.random() * 2);
    vel.y = 5 + Math.random() * 3;
    vel.x += (Math.random() - 0.5) * 2;
    vel.z += (Math.random() - 0.5) * 2;
    this.fallenRider = { vel, landed: false, spin: 6 + Math.random() * 6 };
    this.riderDropped = true;
    this.sockets = this.sockets.filter((s) => s !== this.riderSocket);
  }

  private updateFallenRider(dt: number): void {
    const f = this.fallenRider;
    if (!f || f.landed || !this.rider) return;
    const obj = this.rider.group;
    f.vel.y -= 16 * dt;
    obj.position.addScaledVector(f.vel, dt);
    obj.rotation.z += f.spin * dt;
    obj.rotation.x += f.spin * 0.5 * dt;
    if (obj.position.y <= 0.25) {
      obj.position.y = 0.25;
      obj.rotation.set(0, obj.rotation.y, Math.PI / 2 + (Math.random() - 0.5) * 0.4);
      f.landed = true;
    }
  }

  onEvent(type: RaceEventType, ctx: VisualContext): void {
    if (!this.loaded) {
      this.fallback.onEvent(type, ctx);
      return;
    }
    if (type === 'RIDER_FALL' || type === 'TWIST_FALL' || type === 'LAUNCHED') this.dropRider();
    if (type === 'TRIP' || type === 'COLLISION' || type === 'BUMP') {
      this.impactAge = 0;
      this.impactStrength = type === 'BUMP' ? 0.45 : 1;
      this.impactSide = ctx.bumpDir || ctx.sideHint || 1;
      this.stumble = type === 'TRIP' ? 0.8 : 0.18;
    }
  }

  reset(): void {
    this.fallback.reset();
    if (this.rider && this.riderDropped && this.riderSocket) {
      this.rider.group.parent?.remove(this.rider.group);
      this.body.add(this.rider.group);
      this.rider.group.rotation.set(0, 0, 0);
      this.sockets.push(this.riderSocket);
      this.riderDropped = false;
      this.fallenRider = null;
    }
    this.stumble = 0;
    this.downPose = this.grazePose = this.planted = this.stridePhase = 0;
    this.impactAge = 10;
    this.mixer?.setTime(0);
    this.clips?.rear?.stop();
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    if (this.sleepZ) this.sleepZ.visible = false;
  }

  dispose(): void {
    this.fallback.dispose();
    this.rider?.dispose();
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
