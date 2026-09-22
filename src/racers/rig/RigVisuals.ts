import * as THREE from 'three';
import type { RacerDefinition } from '../Racer';
import type { RacerVisual, VisualContext } from '../RacerVisual';
import { loft } from '../Loft';
import { AnimalVisual, type AnimalAssetConfig } from './AnimalVisual';
import { AXIS_X, AXIS_Y, AXIS_Z, rotateBoneModelSpace } from './BoneTools';
import { CHOPPER_POSE, RiderRig } from './RiderRig';
import { HORSE_ASSET, ELEPHANT_ASSET, COW_ASSET, GIRAFFE_ASSET, ZEBRA_ASSET, RIDER_ASSET_CFG } from './AssetConfigs';

const damp = (cur: number, target: number, k: number, dt: number) => THREE.MathUtils.lerp(cur, target, 1 - Math.exp(-k * dt));

function std(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
}

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ================================================================ 8. 클래식 호스
export class HorseRig extends AnimalVisual {
  constructor(def: RacerDefinition, fallback: RacerVisual, cfg: AnimalAssetConfig = HORSE_ASSET) {
    super(def, cfg, fallback);
  }
  protected updateSpecial(_ctx: VisualContext, _ph: number): void {}
}

// ================================================================ 8. 제브라 다니오 (얼룩말)
export class ZebraRig extends AnimalVisual {
  constructor(def: RacerDefinition, fallback: RacerVisual) {
    super(def, ZEBRA_ASSET, fallback);
  }

  protected buildDecor(): void {
    // 경주용 안장 (작은 가죽 안장)
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.34), std(0x3a2416, { roughness: 0.5 }));
    saddle.castShadow = true;
    this.socket('chest', saddle, [-0.1, 0.18, 0]);
  }

  protected updateSpecial(_ctx: VisualContext, _ph: number): void {}
}

// ================================================================ 9. 서커스 스타
export class CircusRig extends HorseRig {
  private perform = 0;
  private beat = 0;
  private plume?: THREE.Group;
  private hoofTmp = new THREE.Vector3();

  protected buildRider(): void {
    // 서커스 기수: 흰 의상에 금장식, 금색 헬멧
    this.riderColors = { silks: 0xffffff, sleeves: 0xfdfaf0, helmet: 0xffd700, breeches: 0xffffff, boots: 0xffd700 };
    super.buildRider();
  }

  protected buildDecor(): void {
    // 백마: 얼룩 텍스처 대신 흰 털 (노멀맵은 유지해 결 살림), 갈기·꼬리도 흰색
    this.model!.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.name === 'Horse' || mat.name === 'Hair') {
        mat.map = null;
        mat.color.set(mat.name === 'Horse' ? 0xf3efe6 : 0xfaf7f0);
        mat.roughness = 0.75;
        mat.needsUpdate = true;
      }
    });
    // 깃털 장식 (머리)
    const plume = new THREE.Group();
    const colors = [0xff2a2a, 0xffd700, 0x2a7bff, 0xff2a2a, 0xffd700];
    colors.forEach((c, i) => {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.4, 3, 8), std(c, { roughness: 0.8 }));
      f.position.set(0.02 * i - 0.04, 0.25, (i - 2) * 0.06);
      f.rotation.z = -0.25 + i * 0.12;
      f.rotation.x = (i - 2) * 0.25;
      f.castShadow = true;
      plume.add(f);
    });
    plume.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), std(0xffd700, { metalness: 0.6, roughness: 0.3 })));
    this.plume = plume;
    this.socket('head', plume, [0.02, 0.1, 0]);
    // 반짝이 담요
    const seq = canvasTex(128, 128, (ctx) => {
      ctx.fillStyle = '#c41e3a';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#ffd700';
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          ctx.beginPath();
          ctx.arc(8 + x * 16 + (y % 2) * 8, 8 + y * 16, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 122, 122);
    });
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 1.0), std(0xffffff, { map: seq, roughness: 0.55 }));
    blanket.castShadow = true;
    this.socket('chest', blanket, [-0.3, 0.38, 0]);
  }

  protected updateSpecial(ctx: VisualContext, _ph: number): void {
    const { dt, time, speedNorm } = ctx;
    this.perform = damp(this.perform, ctx.state === 'PERFORMING' ? 1 : 0, 4, dt);
    const p = this.perform;
    if (p < 0.01) {
      if (this.plume) this.plume.rotation.z = Math.sin(time * 5) * 0.07 * speedNorm;
      return;
    }
    // 서커스: 뒷발로 서서 두 발로 깡충깡충 전진. 박자 1.5~4Hz.
    const hopHz = THREE.MathUtils.clamp(ctx.speed / 4.5, 1.5, 4);
    this.beat += hopHz * dt * p;
    const beat = this.beat;
    const hop = Math.abs(Math.sin(Math.PI * beat));
    const angle = p * 1.0;
    // 골반(root 뼈)을 축으로 몸 전체를 세우고, 뒷다리는 수직으로 되돌린다
    this.rot('root', AXIS_Z, angle);
    this.rot('root', AXIS_X, Math.sin(Math.PI * beat) * 0.08 * p);
    // 뒷발 위치는 아래에서 실제 발굽 뼈로 재서 지면에 맞춘다
    for (const [up, lo, sideSign] of [['legBL_upper', 'legBL_lower', 0], ['legBR_upper', 'legBR_lower', 0.5]] as const) {
      const ph = Math.PI * 2 * (beat * 0.5 + sideSign);
      const lift = Math.max(0, Math.sin(ph));
      this.rot(up, AXIS_Z, -angle + 0.12 * Math.cos(ph) * p + lift * 0.35 * p);
      this.rot(lo, AXIS_Z, lift * 0.5 * p);
    }
    for (const [up, lo, i] of [['legFL_upper', 'legFL_lower', 0], ['legFR_upper', 'legFR_lower', 1]] as const) {
      const ph = Math.PI * beat + i * Math.PI;
      this.rot(up, AXIS_Z, (0.9 + Math.sin(ph) * 0.45) * p);
      this.rot(lo, AXIS_Z, (-1.4 + Math.cos(ph) * 0.3) * p);
    }
    // 뒷발굽이 땅에 닿도록: 회전된 자세에서 가장 낮은 뒷발굽 뼈 높이를 재서 몸을 들어 올림 + 깡충 뛰기
    this.body.updateWorldMatrix(true, true);
    let minY = Infinity;
    for (const name of ['BN_L_Toe_2_055_0_059', 'BN_R_Toe_2_059_0_065']) {
      const b = this.model?.getObjectByName(name);
      if (!b) continue;
      b.getWorldPosition(this.hoofTmp);
      this.body.worldToLocal(this.hoofTmp);
      minY = Math.min(minY, this.hoofTmp.y);
    }
    if (isFinite(minY)) this.body.position.y += (0.03 - minY) * p;
    this.body.position.y += hop * 0.22 * p;
    // 머리 좌우 까딱, 목은 자랑스럽게, 꼬리 박자
    this.rot('head', AXIS_Y, Math.sin(Math.PI * beat) * 0.3 * p);
    this.rot('neck0', AXIS_Z, (0.25 + Math.sin(Math.PI * 2 * beat) * 0.08) * p);
    this.rot('tail0', AXIS_Z, Math.sin(Math.PI * 2 * beat) * 0.35 * p);
    if (this.plume) this.plume.rotation.z = Math.sin(Math.PI * 2 * beat) * 0.25 * p;
  }

  reset(): void {
    super.reset();
    this.perform = 0;
    this.beat = 0;
  }
}

// ================================================================ 5. 모터 스탤리온
export class MotorRig extends HorseRig {
  private wheelie = 0;
  private failShake = 0;
  private flames: THREE.Mesh[] = [];
  private pompadour?: THREE.Mesh;
  exhaustPoints: THREE.Vector3[] = [];
  backfiring = false;

  constructor(def: RacerDefinition, fallback: RacerVisual) {
    super(def, fallback, { ...HORSE_ASSET, hideMeshes: ['Saddle', 'Horseshoe'], tint: true, seat: { bone: 'chest', offset: [-0.45, 0.5, 0] } });
    this.riderPose = CHOPPER_POSE;
  }

  protected buildDecor(): void {
    const chrome = std(0xe8ecf2, { roughness: 0.2, metalness: 0.95 });
    const hair = std(0x0a0a0c, { roughness: 0.35, metalness: 0.1 });
    // 리젠트: 일본 양아치식 — 앞머리를 크게 부풀려 높이 세운 검은 뽕머리
    const pomp = new THREE.Mesh(
      loft(
        [
          { p: [-0.32, 0.02, 0], r: 0.1, s: [1.4, 0.7] },
          { p: [-0.15, 0.16, 0], r: 0.16, s: [1.3, 0.9] },
          { p: [0.0, 0.36, 0], r: 0.2, s: [1.25, 1.0] },
          { p: [0.12, 0.58, 0], r: 0.21, s: [1.15, 1.0] },
          { p: [0.3, 0.7, 0], r: 0.19, s: [1.05, 0.95] },
          { p: [0.52, 0.62, 0], r: 0.15, s: [0.95, 0.9] },
          { p: [0.64, 0.42, 0], r: 0.09, s: [0.9, 0.9] },
        ],
        40,
        22,
      ),
      hair,
    );
    pomp.castShadow = true;
    pomp.scale.setScalar(0.72);
    this.pompadour = pomp;
    this.socket('head', pomp, [0.04, 0.12, 0]);
    // 옆머리 (짧게 밀어붙인 사이드)
    for (const sgn of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
      side.scale.set(1.6, 0.5, 0.9);
      side.position.set(-0.12, 0.05, sgn * 0.13);
      side.rotation.z = sgn * 0.0;
      side.rotation.x = sgn * 1.2;
      pomp.add(side);
    }
    // 선글라스
    const glasses = new THREE.Group();
    for (const sgn of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.16), std(0x111111, { roughness: 0.15, metalness: 0.6 }));
      lens.position.set(0, 0, sgn * 0.17);
      glasses.add(lens);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.2), chrome);
    glasses.add(bridge);
    this.socket('head', glasses, [0.14, -0.02, 0]);
    // 에이프행어 핸들 + 배기관 + 탱크 + 시트 (기갑/등 소켓)
    const frame = new THREE.Group();
    for (const sgn of [-1, 1]) {
      const bar = new THREE.Mesh(
        loft(
          [
            { p: [0.35, 0.05, sgn * 0.12], r: 0.035 },
            { p: [0.4, 0.45, sgn * 0.22], r: 0.032 },
            { p: [0.15, 0.75, sgn * 0.24], r: 0.03 },
            { p: [-0.25, 0.81, sgn * 0.22], r: 0.03 },
          ],
          16,
          10,
        ),
        chrome,
      );
      bar.castShadow = true;
      frame.add(bar);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10), std(0x1a1a1a));
      grip.position.set(-0.36, 0.79, sgn * 0.21);
      grip.rotation.z = Math.PI / 2;
      frame.add(grip);
    }
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), std(0xc41e1e, { roughness: 0.25, metalness: 0.4 }));
    tank.scale.set(1.3, 0.55, 0.9);
    tank.position.set(0.05, 0.05, 0);
    tank.castShadow = true;
    frame.add(tank);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.12, 0.5), std(0x111111));
    seat.position.set(-0.7, 0.02, 0);
    frame.add(seat);
    this.socket('chest', frame, [0.15, 0.05, 0]);
    // 배기관: 배 아래 소켓
    const pipes = new THREE.Group();
    for (const sgn of [-1, 1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1.5, 10), chrome);
      pipe.rotation.z = Math.PI / 2 + 0.08;
      pipe.position.set(-0.3, 0, sgn * 0.5);
      pipe.castShadow = true;
      pipes.add(pipe);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.25, 12), chrome);
      tip.rotation.z = Math.PI / 2;
      tip.position.set(-1.13, -0.06, sgn * 0.5);
      pipes.add(tip);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.1, 10), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9 }));
      flame.rotation.z = Math.PI / 2;
      flame.position.set(-1.75, -0.06, sgn * 0.5);
      flame.visible = false;
      pipes.add(flame);
      this.flames.push(flame);
    }
    const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), std(0xfff1c8, { emissive: 0xffe9a8, emissiveIntensity: 0.45, roughness: 0.3 }));
    headlight.position.set(1.0, 0.2, 0);
    pipes.add(headlight);
    this.socket('spine', pipes, [-0.15, -0.55, 0]);
    this.pipesGroup = pipes;
  }
  private pipesGroup?: THREE.Group;

  protected updateSpecial(ctx: VisualContext, _ph: number): void {
    const { dt, time } = ctx;
    const boosting = ctx.state === 'BOOSTING';
    this.wheelie = damp(this.wheelie, boosting ? 1 : 0, boosting ? 6 : 3, dt);
    const wh = this.wheelie;
    if (wh > 0.02) {
      // 윌리: 골반 축으로 앞을 들고, 앞다리는 접어 올리고, 뒷다리는 번갈아 땅을 찬다
      this.rot('root', AXIS_Z, wh * 0.28);
      this.body.position.y += 0.55 * Math.sin(wh * 0.28);
      this.rot('legFL_upper', AXIS_Z, (0.7 + Math.sin(time * 9) * 0.15) * wh);
      this.rot('legFR_upper', AXIS_Z, (0.65 + Math.cos(time * 9) * 0.15) * wh);
      this.rot('legFL_lower', AXIS_Z, -1.0 * wh);
      this.rot('legFR_lower', AXIS_Z, -1.0 * wh);
      this.rot('legBL_upper', AXIS_Z, -wh * 0.28);
      this.rot('legBR_upper', AXIS_Z, -wh * 0.28);
    }
    // 와리가리: 횡속도 방향으로 몸을 눕힘
    this.body.rotation.x += THREE.MathUtils.clamp(ctx.lateralVel * 0.12, -0.5, 0.5);
    this.flames.forEach((f) => {
      f.visible = boosting;
      const sc = 0.7 + Math.random() * 0.8;
      f.scale.set(sc, sc * 1.4, sc);
    });
    if (this.pompadour) this.pompadour.rotation.z = Math.sin(time * 6) * 0.05 * ctx.speedNorm - wh * 0.2;
    this.updateEngineFailure(ctx);
    // 엔진 드르릉
    this.body.position.y += Math.sin(time * 52) * 0.008 * (0.4 + ctx.speedNorm * 0.6) * (1 - this.failShake);
    // 배기 포인트 갱신 (body 로컬)
    if (this.pipesGroup) {
      this.exhaustPoints.length = 0;
      for (const sgn of [-1, 1]) this.exhaustPoints.push(new THREE.Vector3(-1.9, -0.06, sgn * 0.5).applyMatrix4(this.pipesGroup.matrix));
    }
  }

  private updateEngineFailure(ctx: VisualContext): void {
    const { dt, time } = ctx;
    const fail = ctx.state === 'ENGINE_FAILURE';
    this.failShake = damp(this.failShake, fail ? 1 : 0, fail ? 12 : 5, dt);
    this.backfiring = false;
    if (this.failShake < 0.01) return;
    const k = this.failShake;
    const elapsed = fail ? 4.5 - ctx.stateTimer : 4.5;
    const sputter = THREE.MathUtils.clamp(1 - elapsed / 1.1, 0, 1);
    const restart = THREE.MathUtils.clamp((elapsed - 3.9) / 0.6, 0, 1);
    const stalled = THREE.MathUtils.clamp((elapsed - 0.9) / 0.5, 0, 1) * (1 - restart);
    const kick = Math.pow(Math.max(0, Math.sin(elapsed * Math.PI * 2)), 12) * stalled;
    const jolt = (sputter + restart * 0.8 + kick * 0.6) * k;
    const miss = Math.sin(time * 17) * Math.sin(time * 5.3) * 0.5 + Math.sin(time * 41) * 0.5;
    this.body.rotation.z += miss * 0.07 * jolt + sputter * 0.1 * k;
    this.body.rotation.x += Math.sin(time * 23) * 0.05 * jolt;
    this.body.position.y += Math.abs(Math.sin(time * 31)) * 0.05 * jolt - stalled * k * 0.1;
    // 시동 꺼짐: 고개 축 처짐, 뒷다리 굽혀 주저앉음
    this.rot('neck0', AXIS_Z, -0.35 * stalled * k);
    this.rot('neck1', AXIS_Z, -0.3 * stalled * k);
    this.rot('head', AXIS_Z, (-0.2 + Math.sin(time * 2.1) * 0.05) * stalled * k);
    this.rot('legBL_upper', AXIS_Z, -0.3 * stalled * k);
    this.rot('legBR_upper', AXIS_Z, -0.3 * stalled * k);
    this.rot('legBL_lower', AXIS_Z, 0.4 * stalled * k);
    this.rot('legBR_lower', AXIS_Z, 0.4 * stalled * k);
    if (this.pompadour) this.pompadour.rotation.z -= 0.35 * stalled * k;
    const flash = (sputter > 0.05 && Math.random() < 0.18) || (restart > 0.2 && Math.random() < 0.35) || kick > 0.85;
    this.backfiring = flash;
    if (flash) {
      this.flames.forEach((f) => {
        f.visible = true;
        const sc = 0.4 + Math.random() * 0.5;
        f.scale.set(sc, sc * 0.8, sc);
      });
    }
  }
}

// ================================================================ 2. 롱바디 익스프레스
const LB_MAX_EXT = 8.5;
/** 기본 허리 연장(m) — 원래 몸통 길이의 약 0.5배 */
const LB_BASE = 1.2;
export class LongbodyRig extends HorseRig {
  private ext = 0;
  private rider2?: RiderRig;

  constructor(def: RacerDefinition, fallback: RacerVisual) {
    super(def, fallback, { ...HORSE_ASSET, seat: { bone: 'chest', offset: [-0.25, 0.42, 0] } });
  }

  protected buildDecor(): void {
    // 뒷기수: 골반 소켓
    this.rider2 = new RiderRig(RIDER_ASSET_CFG, { silks: this.def.clothColor, sleeves: this.def.silksColor, helmet: this.def.silksColor });
    this.socket('hips', this.rider2.group, [-0.05, 0.38, 0]);
  }

  protected updateSpecial(ctx: VisualContext, ph: number): void {
    const { dt, time } = ctx;
    this.ext = damp(this.ext, ctx.extension * (ctx.extensionMax > 0 ? ctx.extensionMax : LB_MAX_EXT), 5, dt);
    // 평소에도 허리가 다른 말보다 1.5배 길다 (몸통 약 1.2m 추가) + 늘어남
    const L = LB_BASE + this.ext;
    if (L > 0.01) {
      // 가슴 이후(목·머리·앞다리) 전체를 앞으로 밀어 허리를 늘린다
      this.move('chest', new THREE.Vector3(L, 0, 0));
      // 긴 허리가 출렁이지 않게 몸통 피치는 줄인다
      this.body.rotation.z *= 1 / (1 + L * 2);
    }
    if (this.rider2) this.rider2.update(ph, ctx.speedNorm, time + 0.3, true);
  }

  reset(): void {
    super.reset();
    this.ext = 0;
  }
}

// ================================================================ 3. 킹 엘리펀트
export class ElephantRig extends AnimalVisual {
  private charge = 0;
  private spray = 0;
  private grab = 0;
  private tipTmp = new THREE.Vector3();

  constructor(def: RacerDefinition, fallback: RacerVisual) {
    super(def, ELEPHANT_ASSET, fallback);
  }

  protected buildDecor(): void {
    // 왕관 + 안장 담요
    const gold = std(0xf5c400, { metalness: 0.7, roughness: 0.3 });
    const crown = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.16, 12, 1, true), gold);
    ring.material.side = THREE.DoubleSide;
    crown.add(ring);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), gold);
      spike.position.set(Math.cos((i / 6) * Math.PI * 2) * 0.28, 0.14, Math.sin((i / 6) * Math.PI * 2) * 0.28);
      crown.add(spike);
    }
    this.socket('head', crown, [0.15, 0.55, 0]);
  }

  protected updateSpecial(ctx: VisualContext, _ph: number): void {
    const { time, dt, speedNorm } = ctx;
    this.charge = damp(this.charge, ctx.state === 'CHARGING' ? 1 : 0, 4, dt);
    this.spray = damp(this.spray, ctx.state === 'SPRAYING' ? 1 : 0, 6, dt);
    this.grab = damp(this.grab, ctx.extension, 10, dt);
    const c = this.charge;
    const g = this.grab;
    const sp = this.spray;
    // 돌진: 머리 숙이고 몸 앞으로 기울임, 귀 펄럭
    this.rot('head', AXIS_Z, -c * 0.35 - g * 0.25 + sp * 0.3 + Math.sin(time * 6) * 0.03 * speedNorm);
    this.rot('head', AXIS_Y, Math.sin(time * 4.5 + this.seed) * 0.06 * speedNorm);
    if (c > 0.05) this.body.rotation.z += -c * 0.08;
    // 코: 달릴 땐 흔들, 돌진 땐 뒤로 흘러가고, 물뿌리기 땐 위로 말아 올림, 잡기 땐 앞으로 뻗음
    const trunk: ['trunk0', 'trunk1', 'trunk2'] = ['trunk0', 'trunk1', 'trunk2'];
    trunk.forEach((b, i) => {
      const sway = Math.sin(time * (5 + i) + i * 0.8) * (0.12 + 0.06 * i) * speedNorm * (1 - g);
      const stream = Math.sin(time * 9 - i * 1.05) * (0.08 + i * 0.04);
      const base = sway + c * (i === 0 ? -0.5 : -0.15 + stream) + sp * (i === 0 ? 0.9 : 0.35) + g * (i === 0 ? 0.6 : 0.05);
      this.rot(b, AXIS_Z, base);
      this.rot(b, AXIS_X, Math.sin(time * (5.5 + i * 0.35) - i) * (0.06 + c * 0.05) * speedNorm * (1 - g));
    });
    for (const [ear, s] of [['earL', -1], ['earR', 1]] as const) {
      this.rot(ear, AXIS_Y, s * Math.sin(time * 8 + s) * (0.1 + c * 0.3 + sp * 0.25) * (0.3 + speedNorm));
    }
  }

  /** 코 끝 월드 좌표 (물대포 파티클) */
  trunkTip(out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.bones.trunk2;
    if (!b) return out.set(0, 0, 0);
    return b.getWorldPosition(out);
  }
  get trunkTmp(): THREE.Vector3 {
    return this.tipTmp;
  }
}

// ================================================================ 4. 레이지 불
export class CowRig extends AnimalVisual {
  private rage = 0;
  private stand = 0;
  private toss = 0;
  private cape?: THREE.Mesh;
  private capeGeo?: THREE.PlaneGeometry;
  private capeBase?: Float32Array;
  private seatBaseY = 0;
  nostrils: THREE.Vector3[] = [new THREE.Vector3(0.95, 0.9, -0.08), new THREE.Vector3(0.95, 0.9, 0.08)];
  private eyes: THREE.Mesh[] = [];

  constructor(def: RacerDefinition, fallback: RacerVisual) {
    super(def, COW_ASSET, fallback);
  }

  protected buildDecor(): void {
    // 방울
    const bell = new THREE.Group();
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 6, 20), std(0x6b3a1e, { roughness: 0.8 }));
    strap.rotation.y = Math.PI / 2;
    bell.add(strap);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), std(0xd4af37, { metalness: 0.8, roughness: 0.3 }));
    b.position.set(0, -0.27, 0);
    bell.add(b);
    this.socket('neck1', bell, [0.05, -0.05, 0]);
    // 붉은 눈 (분노)
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0 }));
      this.eyes.push(eye);
      this.socket('head', eye, [0.28, 0.12, s * 0.16]);
    }
    // 투우사의 빨간 천 (물레타): 기수 오른손에서 늘어지는 천, 정점을 흔들어 펄럭임
    this.capeGeo = new THREE.PlaneGeometry(0.95, 1.15, 10, 12);
    this.capeGeo.translate(0.475, -0.575, 0); // 원점 = 왼쪽 위 모서리(손)
    this.capeBase = Float32Array.from(this.capeGeo.attributes.position.array as Float32Array);
    this.cape = new THREE.Mesh(this.capeGeo, new THREE.MeshStandardMaterial({ color: 0xd8101c, roughness: 0.85, side: THREE.DoubleSide }));
    this.cape.castShadow = true;
    this.cape.visible = false;
    this.seatBaseY = this.cfg.seat.offset[1];
  }

  onEvent(type: Parameters<AnimalVisual['onEvent']>[0], ctx: VisualContext): void {
    super.onEvent(type, ctx);
    if (type === 'BULL_TOSS') this.toss = 1;
  }

  reset(): void {
    super.reset();
    this.rage = this.stand = this.toss = 0;
    if (this.cape) this.cape.visible = false;
  }

  protected updateSpecial(ctx: VisualContext, _ph: number): void {
    const { time, dt, speedNorm } = ctx;
    // 부스트(RAGING) 동안 투우: 빠르게 일어서고, 끝나도 천천히 앉는다
    this.rage = damp(this.rage, ctx.state === 'RAGING' ? 1 : 0, ctx.state === 'RAGING' ? 9 : 2.5, dt);
    const r = this.rage;
    // 들이받기: 머리를 숙였다가 위로 확 퍼올림 (0.5초)
    this.toss = Math.max(0, this.toss - dt * 2.0);
    const tossU = 1 - this.toss;
    const tossLift = this.toss > 0 ? (tossU < 0.3 ? -0.6 * (tossU / 0.3) : 1.0 * Math.exp(-(tossU - 0.3) * 3) * Math.sin(((tossU - 0.3) / 0.7) * Math.PI * 0.5 + 0.2)) : 0;
    // 분노: 머리를 좌우로 세차게 흔들고 낮춘다 (들이받을 땐 퍼올림)
    this.rot('head', AXIS_Y, Math.sin(time * 26) * 0.4 * r * (1 - this.toss) + Math.sin(time * 3 + this.seed) * 0.05 * speedNorm);
    this.rot('neck0', AXIS_Z, -0.4 * r + tossLift * 0.5);
    this.rot('neck1', AXIS_Z, tossLift * 0.4);
    this.rot('head', AXIS_Z, Math.sin(time * 7) * 0.04 * speedNorm - 0.1 * r + tossLift * 0.5);
    if (this.toss > 0.6) this.body.position.y += (this.toss - 0.6) * 0.3; // 앞다리 살짝 들림
    for (const e of this.eyes) (e.material as THREE.MeshBasicMaterial).opacity = r;
    // 투우사 기수: 분노 중엔 등 위에 일어서서 빨간 천을 흔든다
    this.stand = damp(this.stand, r > 0.3 ? 1 : 0, 7, dt);
    const st = this.stand;
    if (this.rider && this.riderSocket) {
      this.riderSocket.offset.y = this.seatBaseY + 0.62 * st; // 골반이 서 있는 높이로
      this.riderMode = st > 0.5 ? 'matador' : 'ride';
      for (const list of this.reinSegments) for (const seg of list) seg.visible = st < 0.5; // 서 있을 땐 고삐 놓음
      if (this.cape) {
        this.cape.visible = st > 0.05;
        if (this.cape.parent !== this.rider.group) this.rider.group.add(this.cape);
        this.cape.position.copy(this.rider.handR);
        this.cape.rotation.set(0, 0.4, 0.15 * Math.sin(time * 5.2));
        this.cape.scale.setScalar(THREE.MathUtils.clamp(st * 1.8, 0.001, 1.45)); // 큰 천, 멀리서도 보이게
        this.flapCape(time, speedNorm);
      }
    }
  }

  /** 천 펄럭임: 손(원점)에서 멀어질수록 크게 물결 */
  private flapCape(time: number, speedNorm: number): void {
    if (!this.capeGeo || !this.capeBase) return;
    const pos = this.capeGeo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const wind = 0.5 + speedNorm;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.capeBase[i * 3];
      const by = this.capeBase[i * 3 + 1];
      const d = Math.hypot(bx, by) / 1.4; // 손에서의 거리 0..1
      const w = d * d;
      arr[i * 3] = bx + Math.sin(time * 9 + by * 4) * 0.08 * w * wind;
      arr[i * 3 + 1] = by + Math.sin(time * 7 + bx * 5) * 0.05 * w;
      arr[i * 3 + 2] = Math.sin(time * 8 + bx * 3 + by * 2) * 0.22 * w * wind + Math.sin(time * 5.2) * 0.15 * d;
    }
    pos.needsUpdate = true;
    this.capeGeo.computeVertexNormals();
  }
}

// ================================================================ 7. 롱넥 미라클
/** 채찍 프로파일: u 0..1 — 반대로 감았다가(0~0.28) 급히 휘두르고(0.28~0.5) 되돌아오며 출렁(0.5~1) */
function whipProfile(u: number): number {
  if (u <= 0) return 0;
  if (u < 0.28) {
    const t = u / 0.28;
    return -0.4 * (t * t * (3 - 2 * t));
  }
  if (u < 0.5) {
    const t = (u - 0.28) / 0.22;
    return -0.4 + 1.4 * (1 - Math.pow(1 - t, 3));
  }
  if (u < 1) {
    const t = (u - 0.5) / 0.5;
    return Math.exp(-t * 3.2) * Math.cos(t * Math.PI * 2.2);
  }
  return 0;
}

export class GiraffeRig extends AnimalVisual {
  private stretch = 0;
  private dance = 0;
  private attack = 0;
  private attackSide = 1;
  /** 골반 위 척추부터 머리까지 목 전체 뼈 체인 (채찍 웨이브용) */
  private neckChain: THREE.Bone[] = [];

  constructor(def: RacerDefinition, fallback: RacerVisual) {
    super(def, GIRAFFE_ASSET, fallback);
  }

  protected buildDecor(): void {
    // 이 에셋의 목은 Bone033 → … → Bone005 로 이어진다 (머리 Bone006 은 별도)
    for (const name of ['Bone033_13', 'Bone002_12', 'Bone034_11', 'Bone003_10', 'Bone035_9', 'Bone004_8', 'Bone036_7', 'Bone005_6']) {
      const b = this.model?.getObjectByName(name) as THREE.Bone | undefined;
      if (b) this.neckChain.push(b);
    }
  }

  protected updateSpecial(ctx: VisualContext, _ph: number): void {
    const { dt, time, speedNorm } = ctx;
    this.stretch = damp(this.stretch, ctx.extension, 5, dt);
    this.attack = Math.max(0, this.attack - dt * 0.8);
    const st = this.stretch;
    const neck: ['neck0', 'neck1', 'neck2'] = ['neck0', 'neck1', 'neck2'];
    // 목 뻗기(부스트): 목을 세운 채 마디를 목 방향(앞·위 대각선)으로 밀어 길이만 늘린다 — 앞을 보고 달린다
    const total = (ctx.extensionMax > 0 ? ctx.extensionMax : 6.5) * st;
    neck.forEach((b, i) => {
      this.rot(b, AXIS_Z, -st * 0.06 + Math.sin(time * 4.2 + this.seed + i) * 0.05 * speedNorm * (1 - st));
      if (total > 0.01) this.move(b, new THREE.Vector3((total / 3) * 0.66, (total / 3) * 0.75, 0));
    });
    // 목 공격: 채찍처럼 — 밑동부터 머리까지 파동이 지연되며 전달되고, 머리 쪽 마디가 가장 크게 휘어진다
    if (this.attack > 0) {
      const u = 1 - this.attack; // 0 → 1
      const N = this.neckChain.length || 3;
      const chain = this.neckChain.length ? this.neckChain : neck.map((n) => this.bones[n]).filter(Boolean) as THREE.Bone[];
      const wsum = chain.reduce((acc, _b, i) => acc + (0.5 + (i / N) * 1.5), 0);
      chain.forEach((b, i) => {
        const w = (0.5 + (i / N) * 1.5) / wsum;
        const f = whipProfile(u - i * 0.012); // 밑동→머리로 파동 전달 (짧은 지연)
        // 목이 거의 수직이라 옆으로 휘려면 전방(X)축 회전 (+x 축 회전은 +y 를 +z 오른쪽으로 보낸다)
        rotateBoneModelSpace(b, this.body, AXIS_X, this.attackSide * f * 3.1 * w);
        rotateBoneModelSpace(b, this.body, AXIS_Z, -Math.abs(f) * 0.3 * w); // 휘두를 때 살짝 숙임
      });
      const fh = whipProfile(u - N * 0.012);
      this.rot('head', AXIS_X, this.attackSide * fh * 0.8);
      // 몸도 반동: 감을 때 반대로, 휘두를 때 공격 방향으로 기울고 살짝 웅크림
      this.body.rotation.x += -this.attackSide * whipProfile(u) * 0.12;
      this.body.position.y -= Math.max(0, whipProfile(u)) * 0.12;
    }
    this.rot('head', AXIS_Z, st * 0.15 + Math.sin(time * 6) * 0.06 * speedNorm);
    // 목 댄스: 멈춰 서서 ~~~ 파형
    this.dance = damp(this.dance, ctx.state === 'DANCING' ? 1 : 0, 5, dt);
    const dn = this.dance;
    if (dn > 0.02) {
      neck.forEach((b, i) => {
        const wave = time * 5.2 - i * 1.1;
        this.rot(b, AXIS_Z, Math.sin(wave) * 0.35 * dn);
        this.rot(b, AXIS_X, Math.cos(wave) * 0.12 * dn);
      });
      this.rot('head', AXIS_Z, Math.sin(time * 5.2 - 4) * 0.35 * dn);
      this.body.position.y += Math.abs(Math.sin(time * 5.2)) * 0.09 * dn;
      this.body.rotation.x += Math.sin(time * 5.2) * 0.05 * dn;
    }
  }

  onEvent(type: Parameters<AnimalVisual['onEvent']>[0], ctx: VisualContext): void {
    super.onEvent(type, ctx);
    if (type === 'GIRAFFE_NECK_ATTACK') {
      this.attack = 1;
      this.attackSide = ctx.sideHint;
    }
  }
}
