import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RacerDefinition } from './Racer';
import type { RaceEventType } from '../events/RaceEvent';
import { loft } from './Loft';
import { solveLeg } from './Gait';
import {
  PlaceholderVisual,
  box,
  capsule,
  sphere,
  toon,
  makeNumberCloths,
  makeRider,
  makeMane,
  makeBridle,
  type RacerVisual,
  type VisualContext,
} from './RacerVisual';
import { RIDER_ASSET } from './rig/AnimalVisual';
import { RIDER_ASSET_CFG } from './rig/AssetConfigs';
import { HorseRig, CircusRig, MotorRig, LongbodyRig, ElephantRig, CowRig, GiraffeRig } from './rig/RigVisuals';
import { CostumeRig, HumanRig, TrojanRig } from './rig/CrewVisuals';

/** 리깅 GLB 캐릭터 사용 (false 면 절차 생성 placeholder 만) */
export const USE_RIG_ASSETS = true;
RIDER_ASSET.cfg = RIDER_ASSET_CFG;

const damp = (cur: number, target: number, k: number, dt: number) => THREE.MathUtils.lerp(cur, target, 1 - Math.exp(-k * dt));

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- 공통 말 파츠

interface HorseParts {
  chest: THREE.Mesh;
  rump: THREE.Mesh;
  neck: THREE.Group;
  head: THREE.Group;
  barrel: THREE.Mesh;
  tail: THREE.Mesh;
}

interface HorseOpts {
  hide: THREE.Material;
  mane: THREE.Material;
  bodyLen?: number;
  bodyR?: number;
  neckLen?: number;
  headScale?: number;
  ears?: boolean;
  bridle?: boolean;
}

/** 말 몸통(캡슐) + 가슴/엉덩이(구) + 목 + 머리 + 꼬리. 다리/기수는 호출자가 배치. */
function buildHorse(parent: THREE.Object3D, o: HorseOpts): HorseParts {
  const bodyLen = o.bodyLen ?? 1.2;
  const R = o.bodyR ?? 0.5;
  const y = 1.45;
  const L = bodyLen / 2;
  // 몸통: 꼬리 밑 → 엉덩이 → 배 → 가슴 → 목 밑동으로 이어지는 한 덩어리 실루엣
  const barrel = new THREE.Mesh(
    loft([
      { p: [-L - R * 0.95, y + 0.12, 0], r: R * 0.5, s: [0.9, 1.0] },
      { p: [-L - R * 0.35, y + 0.1, 0], r: R * 0.98, s: [0.95, 1.08] },
      { p: [-L * 0.3, y - 0.02, 0], r: R * 1.02, s: [1.0, 1.02] },
      { p: [L * 0.45, y, 0], r: R * 0.97, s: [0.95, 1.05] },
      { p: [L + R * 0.45, y + 0.02, 0], r: R * 0.82, s: [0.88, 1.0] },
      { p: [L + R * 0.95, y - 0.05, 0], r: R * 0.45, s: [0.85, 0.9] },
    ]),
    o.hide,
  );
  barrel.castShadow = true;
  parent.add(barrel);
  for (const side of [-1, 1]) {
    for (const [x, ry, rx] of [[L + 0.12, 0.47, 0.3], [-L - 0.08, 0.46, 0.36]]) {
      const muscle = sphere(1, o.hide, rx, ry, R * 0.47);
      muscle.position.set(x, y - 0.15, side * R * 0.57);
      muscle.rotation.z = x > 0 ? -0.22 : 0.18;
      barrel.add(muscle);
    }
  }
  const chest = barrel;
  const rump = barrel;
  // 목: 밑동은 굵고 머리 쪽으로 가늘어짐 (그룹 로컬 +y 방향, 그룹을 앞으로 기울임)
  const neck = new THREE.Group();
  neck.position.set(L + R * 0.5, y + R * 0.5, 0);
  neck.rotation.z = -0.85;
  const neckLen = o.neckLen ?? 0.7;
  const neckM = new THREE.Mesh(
    loft([
      { p: [0, -0.1, 0], r: R * 0.55, s: [0.85, 1.1] },
      { p: [0.02, neckLen * 0.45, 0], r: R * 0.42, s: [0.8, 1.15] },
      { p: [0.06, neckLen * 0.95, 0], r: R * 0.33, s: [0.8, 1.1] },
      { p: [0.08, neckLen + 0.3, 0], r: R * 0.27, s: [0.85, 1.0] },
    ]),
    o.hide,
  );
  neckM.castShadow = true;
  neck.add(neckM);
  neck.add(makeMane(neckLen, o.mane, -R * 0.5, 7, 0.55));
  // 머리: 이마 → 콧등 → 주둥이로 가늘어지는 쐐기형
  const head = new THREE.Group();
  head.position.set(0.05, neckLen + 0.35, 0);
  head.rotation.z = 0.95;
  const hs = o.headScale ?? 1;
  const skull = new THREE.Mesh(
    loft([
      { p: [-0.12 * hs, 0.02, 0], r: 0.2 * hs, s: [0.95, 1.15] },
      { p: [0.18 * hs, 0.04, 0], r: 0.21 * hs, s: [0.95, 1.1] },
      { p: [0.5 * hs, 0.0, 0], r: 0.165 * hs, s: [0.9, 1.0] },
      { p: [0.8 * hs, -0.05, 0], r: 0.13 * hs, s: [0.95, 0.95] },
      { p: [0.98 * hs, -0.08, 0], r: 0.09 * hs, s: [1.0, 0.85] },
    ]),
    o.hide,
  );
  skull.castShadow = true;
  head.add(skull);
  // 아래턱
  const jaw = new THREE.Mesh(
    loft([
      { p: [0.05 * hs, -0.15, 0], r: 0.14 * hs, s: [0.85, 0.7] },
      { p: [0.45 * hs, -0.16, 0], r: 0.1 * hs, s: [0.85, 0.6] },
      { p: [0.8 * hs, -0.14, 0], r: 0.07 * hs, s: [0.9, 0.6] },
    ]),
    o.hide,
  );
  jaw.name = 'graze_mouth';
  jaw.castShadow = true;
  head.add(jaw);
  for (const sgn of [-1, 1]) {
    const nostril = sphere(0.032, toon(0x2a1a12));
    nostril.position.set(0.93 * hs, -0.02, sgn * 0.07);
    head.add(nostril);
    const eye = sphere(0.05, toon(0x111111));
    eye.position.set(0.24 * hs, 0.1, sgn * 0.19 * hs);
    head.add(eye);
    if (o.ears !== false) {
      const ear = new THREE.Mesh(
        loft([
          { p: [0, 0, 0], r: 0.05, s: [0.6, 1] },
          { p: [-0.02, 0.12, 0], r: 0.045, s: [0.5, 1] },
          { p: [-0.03, 0.22, 0], r: 0.015, s: [0.5, 1] },
        ]),
        o.hide,
      );
      ear.position.set(-0.05 * hs, 0.17, sgn * 0.11 * hs);
      ear.rotation.x = sgn * 0.35;
      ear.rotation.z = -0.15;
      ear.castShadow = true;
      head.add(ear);
    }
  }
  // 앞머리 술 + 굴레
  const forelock = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 3, 8), o.mane);
  forelock.position.set(0.1 * hs, 0.24, 0);
  forelock.rotation.z = 1.1;
  head.add(forelock);
  if (o.bridle !== false) makeBridle(head, hs, toon(0x3a2416));
  neck.add(head);
  parent.add(neck);
  // 꼬리: 밑동에서 흘러내리는 술
  const tail = new THREE.Mesh(
    loft([
      { p: [0, 0, 0], r: 0.06 },
      { p: [-0.25, -0.25, 0], r: 0.09 },
      { p: [-0.45, -0.6, 0], r: 0.08 },
      { p: [-0.55, -0.95, 0], r: 0.035 },
    ]),
    o.mane,
  );
  tail.position.set(-L - R * 0.85, y + 0.25, 0);
  tail.castShadow = true;
  parent.add(tail);
  return { chest, rump, neck, head, barrel, tail };
}

function addSaddle(parent: THREE.Object3D, x: number, y: number, width: number, cloth: number): void {
  const pad = box(0.9, 0.1, width + 0.15, toon(cloth));
  pad.position.set(x, y, 0);
  parent.add(pad);
  const saddle = box(0.55, 0.16, width * 0.7, toon(0x4a2a12));
  saddle.position.set(x, y + 0.1, 0);
  parent.add(saddle);
  const girth = box(0.12, 0.08, width + 0.2, toon(0x3a2a1a));
  girth.position.set(x, y - 0.05, 0);
  parent.add(girth);
}

// ================================================================ 1. 말탈 브라더스 (말 탈을 쓴 두 사람)
class CostumeVisual extends PlaceholderVisual {
  private collapse = 0;
  private carry = 0;
  private liftT = 99;
  private carryFinishPose = false;

  onEvent(type: RaceEventType, ctx: VisualContext): void {
    super.onEvent(type, ctx);
    if (type === 'COSTUME_COLLAPSE') this.carryFinishPose = false;
    if (type === 'COSTUME_CARRY') {
      this.liftT = 0;
      this.carryFinishPose = true;
    }
  }

  reset(): void {
    super.reset();
    this.collapse = 0;
    this.carry = 0;
    this.liftT = 99;
    this.carryFinishPose = false;
    this.shell.position.set(0, 0, 0);
    this.shell.rotation.set(0, 0, 0);
    this.shell.scale.set(1, 1, 1);
    this.persons.forEach((p) => {
      p.visible = false;
      p.position.y = 0;
      p.position.z = 0;
      p.rotation.set(0, 0, 0);
    });
    this.heads.forEach((h) => (h.visible = false));
  }

  /** 두 사람 달리기: 앞사람 좌/우 반대 위상, 뒷사람은 앞사람과 어긋나게 */
  protected gaitPhases(): number[] {
    return [0.0, 0.5, 0.3, 0.8];
  }
  protected gaitAmps(): number[] {
    return [1, 1, 1, 1];
  }
  private declare shell: THREE.Group;
  private declare heads: THREE.Group[];
  private declare persons: THREE.Group[];
  private declare arms: THREE.Group[];
  private declare parts: HorseParts;

  /** 꼬질꼬질한 골판지 텍스처: 골 무늬 + 얼룩 + 테이프 + 낙서 */
  private cardboardTex(label: string): THREE.CanvasTexture {
    return canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#b8894f';
      ctx.fillRect(0, 0, 256, 256);
      let seed = 5;
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      // 골판지 골
      ctx.strokeStyle = 'rgba(80,50,20,0.28)';
      ctx.lineWidth = 2;
      for (let y = 2; y < 256; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
      }
      // 얼룩·때
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(${40 + rnd() * 40},${25 + rnd() * 25},${10},${0.08 + rnd() * 0.18})`;
        ctx.beginPath();
        ctx.ellipse(rnd() * 256, rnd() * 256, 8 + rnd() * 30, 6 + rnd() * 18, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // 눌린 자국
      ctx.strokeStyle = 'rgba(60,35,10,0.5)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(rnd() * 256, rnd() * 256);
        ctx.lineTo(rnd() * 256, rnd() * 256);
        ctx.stroke();
      }
      // 박스테이프
      ctx.fillStyle = 'rgba(214,196,150,0.85)';
      ctx.fillRect(96, 0, 34, 256);
      ctx.fillRect(0, 150, 256, 26);
      // 낙서
      ctx.fillStyle = '#2b1a0a';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, 128, 70);
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('↑ 이쪽이 위 ↑', 128, 225);
    });
  }

  protected buildBody(): void {
    this.heads = [];
    const d = this.def;
    // 꼬질꼬질한 골판지 박스로 만든 말: 각진 상자만으로 조립
    const mkCard = (label: string) => {
      const m = new THREE.MeshStandardMaterial({ map: this.cardboardTex(label), roughness: 1, metalness: 0 });
      return m;
    };
    const cardBody = mkCard('취급주의');
    const cardHead = mkCard('말');
    const cardPlain = mkCard('');
    const sharp = (w: number, h: number, dp: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), mat);
      m.castShadow = true;
      return m;
    };
    this.shell = new THREE.Group();
    this.shell.name = 'costume_shell';
    // 몸통 상자 (살짝 찌그러짐)
    const torso = sharp(2.5, 1.15, 1.0, cardBody);
    torso.position.set(0, 1.5, 0);
    torso.rotation.z = 0.03;
    this.shell.add(torso);
    // 열린 뚜껑 날개 (덜 붙은 덮개)
    for (const sgn of [-1, 1]) {
      const flap = sharp(1.1, 0.04, 0.5, cardPlain);
      flap.position.set(sgn * 0.6, 2.1, sgn * 0.25);
      flap.rotation.x = sgn * 0.5;
      this.shell.add(flap);
    }
    // 목 상자 (작은 상자를 비스듬히)
    const neck = new THREE.Group();
    neck.position.set(1.1, 1.85, 0);
    neck.rotation.z = -0.75;
    const neckBox = sharp(0.6, 1.0, 0.55, cardPlain);
    neckBox.position.y = 0.45;
    neck.add(neckBox);
    // 머리 상자 (작은 택배 상자) + 종이 귀 + 그린 눈
    const head = new THREE.Group();
    head.position.set(0.05, 0.95, 0);
    head.rotation.z = 0.95;
    const headBox = sharp(1.0, 0.55, 0.6, cardHead);
    headBox.position.x = 0.35;
    head.add(headBox);
    const snout = sharp(0.35, 0.4, 0.45, cardPlain);
    snout.position.set(0.95, -0.05, 0);
    head.add(snout);
    for (const sgn of [-1, 1]) {
      const ear = sharp(0.05, 0.4, 0.18, cardPlain);
      ear.position.set(0.05, 0.45, sgn * 0.22);
      ear.rotation.x = sgn * 0.3;
      head.add(ear);
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      eye.position.set(0.55, 0.12, sgn * 0.301);
      eye.rotation.y = sgn > 0 ? 0 : Math.PI;
      eye.userData.noOutline = true;
      head.add(eye);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      pupil.position.set(0.58, 0.1, sgn * 0.302);
      pupil.rotation.y = sgn > 0 ? 0 : Math.PI;
      pupil.userData.noOutline = true;
      head.add(pupil);
    }
    neck.add(head);
    this.shell.add(neck);
    // 꼬리: 찢은 종이 끈
    const tail = sharp(0.05, 0.7, 0.12, cardPlain);
    tail.position.set(-1.35, 1.5, 0);
    tail.rotation.z = 0.5;
    this.shell.add(tail);
    // 아래 열린 상자 테두리 (사람 다리가 나오는 곳)
    const skirt = sharp(2.3, 0.25, 1.0, cardPlain);
    skirt.position.set(0, 0.98, 0);
    this.shell.add(skirt);
    // 부품 참조 (기존 코드 호환: head/neck 만 실제 사용)
    this.parts = { chest: torso, rump: torso, barrel: torso, tail, neck, head };
    const cloth = makeNumberCloths(d.number, d.clothColor, 0.6, 0.51);
    cloth.position.set(-0.4, 1.45, 0);
    this.shell.add(cloth);
    this.body.add(this.shell);
    // 안의 두 사람 머리 (붕괴 시 상자 위로 튀어나옴)
    for (const x of [0.55, -0.6]) {
      const hg = new THREE.Group();
      hg.add(sphere(0.19, toon(0xf0caad)));
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(x > 0 ? 0x222222 : 0x6b3a1e));
      hair.position.y = 0.03;
      hg.add(hair);
      hg.position.set(x, 1.5, 0);
      hg.visible = false;
      this.shell.add(hg);
      this.heads.push(hg);
    }
    // 상자를 들어올릴 때 보이는 두 사람의 상체 + 팔
    this.persons = [];
    this.arms = [];
    [0.6, -0.65].forEach((x, i) => {
      const p = new THREE.Group();
      p.name = `costume_person_${i}`;
      const shirt = toon(i === 0 ? 0xe84c3d : 0x3d7be8);
      const torso = capsule(0.2, 0.32, shirt);
      torso.position.y = 1.32;
      p.add(torso);
      const head = sphere(0.19, toon(0xf0caad));
      head.position.y = 1.85;
      p.add(head);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(i === 0 ? 0x222222 : 0x6b3a1e));
      hair.position.y = 1.88;
      p.add(hair);
      for (const sgn of [-1, 1]) {
        const arm = new THREE.Group();
        arm.position.set(0, 1.55, sgn * 0.27);
        const a = capsule(0.06, 0.5, toon(0xf0caad));
        a.position.y = 0.32;
        arm.add(a);
        const hand = sphere(0.075, toon(0xf0caad));
        hand.position.y = 0.66;
        arm.add(hand);
        arm.rotation.x = sgn * 0.25;
        p.add(arm);
        this.arms.push(arm);
      }
      p.position.set(x, 0, 0);
      p.visible = false;
      this.body.add(p);
      this.persons.push(p);
    });
    // 사람 다리: 청바지 + 운동화
    const jeans = toon(0x3b5ba5);
    this.addLegs([
      { x: 0.7, z: -0.22, w: 0.2, len: 0.98, mat: jeans, y: 0.98, hoof: 0xffffff },
      { x: 0.7, z: 0.22, w: 0.2, len: 0.98, mat: jeans, y: 0.98, hoof: 0xffffff },
      { x: -0.75, z: -0.22, w: 0.2, len: 0.98, mat: jeans, y: 0.98, hoof: 0xffffff },
      { x: -0.75, z: 0.22, w: 0.2, len: 0.98, mat: jeans, y: 0.98, hoof: 0xffffff },
    ]);
    this.legs.forEach((l) => {
      const knee = l.children.find((c) => c.name.endsWith('_lower'));
      if (!knee) return;
      const shoe = box(0.34, 0.12, 0.2, toon(0xffffff));
      shoe.position.set(0.08, -0.46, 0);
      knee.add(shoe);
    });
    // 말탈 브라더스는 기수 없음 — 탈 속 두 사람이 곧 선수.
    this.neckBase = -0.75;
    this.gaitBounce = false; // 말 갤럽이 아니라 사람 두 명의 발걸음으로 흔들림
    this.bounceAmp = 0;
    this.legAmp = 0.55;
    this.kneeFold = 1.2;
    this.height = 2.6;
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { time, speedNorm, dt } = ctx;
    const target = ctx.state === 'COLLAPSED' ? 1 : ctx.state === 'RECOVERING' ? 0.35 : 0;
    this.collapse = damp(this.collapse, target, ctx.state === 'COLLAPSED' ? 9 : 3, dt);
    const carryingToFinish = ctx.state === 'CARRYING' || (ctx.state === 'FINISHED' && this.carryFinishPose);
    this.carry = damp(this.carry, carryingToFinish ? 1 : 0, 6, dt);
    const c = this.collapse;
    const k = this.carry;
    this.liftT += dt;
    if (k > 0.02) {
      // 1단계(~0.9초): 멈춰 서서 팔을 번쩍 들어 탈을 머리 위로 → 2단계: 상체 드러낸 채 전력질주
      const lift = THREE.MathUtils.smoothstep(this.liftT, 0, 0.9);
      this.shell.position.y = k * lift * 1.55;
      this.shell.rotation.z = k * 0.12 + Math.sin(time * 9) * 0.03 * k;
      this.shell.rotation.x = Math.sin(time * 14) * 0.08 * k;
      this.shell.rotation.y = 0;
      this.shell.scale.set(1, 1, 1);
      this.heads.forEach((h) => (h.visible = false));
      this.persons.forEach((p, i) => {
        p.visible = true;
        p.position.y = Math.abs(Math.sin(time * 11 + i * 1.3)) * 0.08 * k;
        p.position.z = 0;
        p.rotation.x = 0;
        p.rotation.z = 0.12 * k; // 살짝 앞으로 숙이고 달림
        p.scale.setScalar(THREE.MathUtils.lerp(0.001, 1, Math.min(1, k * 1.5)));
      });
      this.legs.forEach((l, i) => {
        l.position.y = 0.98;
        l.position.z = i % 2 === 0 ? -0.22 : 0.22;
      });
      this.arms.forEach((a, i) => {
        const s = i % 2 ? 1 : -1;
        // 팔: 내려간 상태(2.6rad) → 번쩍 위로(-0.15rad)
        a.rotation.z = THREE.MathUtils.lerp(2.6, -0.15, lift) + Math.sin(time * 11 + i) * 0.06 * lift;
        a.rotation.x = s * 0.22;
      });
      // 들어올리는 동안 몸을 살짝 숙였다 편다
      this.persons.forEach((p) => (p.rotation.z += (1 - lift) * 0.35));
      this.parts.head.rotation.z = 0.95 + k * 0.6;
      return;
    }
    const wob = speedNorm * (1 - c);
    // 사람 두 명이 탈을 쓰고 뛰는 흔들림: 앞사람/뒷사람 발걸음(보폭당 2보)이 어긋나 탈이 위아래·앞뒤로 출렁
    const step = this.stridePhase * 2;
    const frontBob = Math.abs(Math.sin(Math.PI * step)) * 0.1 * wob;
    const rearBob = Math.abs(Math.sin(Math.PI * (step + 0.3))) * 0.1 * wob;
    const runningBob = (frontBob + rearBob) * 0.5;
    // 옆으로 누운 상자의 회전된 바닥면이 지면(y=0)에 닿도록 피벗을 올린다.
    this.shell.position.y = THREE.MathUtils.lerp(runningBob, 0.3, c);
    // 붕괴 시 말처럼 몸을 구부리거나 찌그러뜨리지 않고, 완성된 상자 탈이
    // 옆으로 넘어져 바닥에 그대로 널브러진다.
    this.shell.rotation.z = (rearBob - frontBob) * 0.55 + Math.sin(time * 2.1 + this.seed) * 0.02 * wob + c * 0.06;
    this.shell.rotation.x = Math.sin(Math.PI * 2 * step) * 0.045 * wob + Math.sin(time * 1.7) * 0.015 * wob + c * 1.34;
    this.shell.rotation.y = Math.sin(Math.PI * 2 * step + 0.6) * 0.02 * wob - c * 0.08;
    this.shell.scale.set(1, 1, 1);
    // 목·머리 상자도 원래 각진 형태를 유지한 채 연결부만 살짝 처진다.
    this.parts.head.rotation.z = 0.95 + Math.sin(Math.PI * 2 * step - 0.9) * 0.14 * wob + c * 0.18;
    this.parts.neck.rotation.z = -0.75 + Math.sin(Math.PI * 2 * step - 1.2) * 0.06 * wob - c * 0.12;
    // 쓰러지면 머리만 따로 튀어나오는 대신 두 사람의 상체·머리·팔을 전부
    // 드러내고, 각자의 두 다리와 이어지는 방향으로 바닥에 널브러뜨린다.
    this.persons.forEach((p, i) => {
      p.visible = c > 0.08;
      p.position.y = c * 0.16;
      p.position.z = -c * 0.58;
      p.rotation.x = (i === 0 ? -0.12 : 0.12) * c;
      p.rotation.z = (i === 0 ? 1.25 : -1.25) * c;
      p.scale.setScalar(1);
    });
    this.arms.forEach((a, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      a.rotation.x = side * (0.25 + c * 0.35);
      a.rotation.z = side * c * 0.55;
    });
    this.legs.forEach((l, i) => {
      if (c > 0.05) {
        const lie = (i < 2 ? 1.5 : -1.5) * c;
        l.rotation.z = THREE.MathUtils.lerp(l.rotation.z, lie + Math.sin(time * 3 + i) * 0.08 * c, Math.min(1, c * 1.5));
        l.position.y = 0.98 - c * 0.62;
        l.position.z = (i % 2 === 0 ? -0.22 : 0.22) - c * 0.58;
        const knee = l.children.find((ch) => ch.name.endsWith('_lower'));
        if (knee) knee.rotation.z = THREE.MathUtils.lerp(knee.rotation.z, 0, Math.min(1, c * 1.5));
      } else {
        l.position.y = 0.98;
        l.position.z = i % 2 === 0 ? -0.22 : 0.22;
      }
    });
    this.riders.forEach((r, i) => {
      if (r.parent === this.riderParent[i]) r.position.y += -c * 1.1;
    });
    this.heads.forEach((h, i) => {
      // 상자 안에 달린 임시 머리는 숨기고 완전한 person 리그만 사용한다.
      h.visible = false;
      h.position.y = 1.5 + c * 0.25;
      h.rotation.y = Math.sin(time * 4 + i * 2) * 0.6;
      h.scale.setScalar(1);
    });
  }
}

// ================================================================ 2. 롱바디 익스프레스 (결승선에서 쭈우욱)
const LB_HALF = 1.25;
const LB_MAX_EXT = 8.5;

class LongbodyVisual extends PlaceholderVisual {
  private declare front: THREE.Group;
  private declare rear: THREE.Group;
  private declare mid: THREE.Mesh;
  private declare midCloths: THREE.Group[];
  private ext = 0;

  protected buildBody(): void {
    const d = this.def;
    const hide = toon(d.bodyColor);
    const mane = toon(0x2a170c);
    this.front = new THREE.Group();
    this.rear = new THREE.Group();
    this.midCloths = [];
    const R = 0.5;
    const y = 1.45;
    // 중간 몸통 — x 스케일로 늘어남
    {
      const g = new THREE.CylinderGeometry(R, R, 2.0, 18, 1, true);
      g.rotateZ(Math.PI / 2);
      g.scale(1, 1.02, 1.0);
      this.mid = new THREE.Mesh(g, hide);
      this.mid.castShadow = true;
    }
    this.mid.position.set(0, y, 0);
    this.body.add(this.mid);
    // 앞부분: 가슴 로프트(뒤쪽은 중간 몸통 속에 묻힘) + 목 + 머리 + 앞다리 + 앞기수
    const parts = buildHorse(this.front, { hide, mane, bodyLen: 0.6, bodyR: R });
    parts.barrel.visible = false;
    parts.tail.visible = false;
    const chestLoft = new THREE.Mesh(
      loft([
        { p: [-1.0, y, 0], r: R * 1.0, s: [1.0, 1.02] },
        { p: [-0.2, y, 0], r: R * 1.0, s: [1.0, 1.02] },
        { p: [0.45, y + 0.02, 0], r: R * 0.85, s: [0.9, 1.0] },
        { p: [0.85, y - 0.05, 0], r: R * 0.45, s: [0.85, 0.9] },
      ]),
      hide,
    );
    chestLoft.castShadow = true;
    this.front.add(chestLoft);
    parts.neck.position.set(0.55, y + R * 0.5, 0);
    this.neckBob = parts.neck;
    this.neckBase = -0.85;
    this.front.position.x = LB_HALF;
    // 뒷부분: 엉덩이 로프트(앞쪽은 중간 몸통 속에 묻힘) + 꼬리 + 뒷다리 + 뒷기수
    const rumpLoft = new THREE.Mesh(
      loft([
        { p: [-0.95, y + 0.12, 0], r: R * 0.5, s: [0.9, 1.0] },
        { p: [-0.45, y + 0.1, 0], r: R * 0.98, s: [0.95, 1.08] },
        { p: [0.2, y, 0], r: R * 1.0, s: [1.0, 1.02] },
        { p: [1.0, y, 0], r: R * 1.0, s: [1.0, 1.02] },
      ]),
      hide,
    );
    rumpLoft.castShadow = true;
    this.rear.add(rumpLoft);
    const tail = new THREE.Mesh(
      loft([
        { p: [0, 0, 0], r: 0.06 },
        { p: [-0.25, -0.25, 0], r: 0.09 },
        { p: [-0.45, -0.6, 0], r: 0.08 },
        { p: [-0.55, -0.95, 0], r: 0.035 },
      ]),
      mane,
    );
    tail.position.set(-0.85, y + 0.25, 0);
    tail.castShadow = true;
    this.rear.add(tail);
    this.rear.position.x = -LB_HALF;
    this.body.add(this.front, this.rear);
    this.addLegs(
      [
        { x: 0.15, z: -0.28, w: 0.2, len: 1.2, mat: hide, y: 1.22 },
        { x: 0.15, z: 0.28, w: 0.2, len: 1.2, mat: hide, y: 1.22 },
      ],
      this.front,
    );
    this.addLegs(
      [
        { x: -0.25, z: -0.28, w: 0.2, len: 1.2, mat: hide, y: 1.22 },
        { x: -0.25, z: 0.28, w: 0.2, len: 1.2, mat: hide, y: 1.22 },
      ],
      this.rear,
    );
    addSaddle(this.front, -0.2, 1.95, 0.9, d.clothColor);
    addSaddle(this.rear, 0.05, 1.95, 0.9, d.clothColor);
    for (const g of [this.front, this.rear]) {
      const c = makeNumberCloths(d.number, d.clothColor, 0.55, 0.53);
      c.position.set(g === this.front ? -0.2 : 0.05, 1.4, 0);
      g.add(c);
      this.midCloths.push(c);
    }
    this.addRider(new THREE.Vector3(-0.2, 2.1, 0));
    this.addRider(new THREE.Vector3(0.05, 2.1, 0));
    this.reparentRider(0, this.front);
    this.reparentRider(1, this.rear);
    this.attachReins(parts.head, new THREE.Vector3(0.62, -0.05, 0.16), 0, this.front);
    this.bounceAmp = 0.11;
    this.height = 2.5;
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { dt } = ctx;
    this.ext = damp(this.ext, ctx.extension * (ctx.extensionMax > 0 ? ctx.extensionMax : LB_MAX_EXT), 5, dt);
    const L = this.ext;
    this.front.position.x = LB_HALF + L;
    this.mid.scale.set((LB_HALF * 2 + L) / 2, 1, 1);
    this.mid.position.x = (this.front.position.x + this.rear.position.x) / 2;
    // A long rigid spine magnifies even tiny pitch/roll into metres of hoof lift.
    // Keep all three sections on one plane; gait lives in the limbs and neck.
    this.body.rotation.z *= 1 / (1 + L * 2);
    this.body.rotation.y = 0;
    this.front.rotation.set(0, 0, 0);
    this.rear.rotation.set(0, 0, 0);
  }

  reset(): void {
    super.reset();
    this.ext = 0;
    this.front.position.x = LB_HALF;
    this.rear.position.x = -LB_HALF;
    this.front.rotation.set(0, 0, 0);
    this.rear.rotation.set(0, 0, 0);
    this.mid.scale.set(LB_HALF, 1, 1);
    this.mid.position.x = 0;
  }
}

// ================================================================ 3. 코끼리
class ElephantVisual extends PlaceholderVisual {
  /** 코끼리는 갤럽하지 않는다 — 측대 보행(같은 쪽 앞·뒤 다리가 이어서), 네 발이 4분의 1 보폭씩 어긋남 */
  protected gaitPhases(): number[] {
    return [0.25, 0.75, 0.0, 0.5];
  }
  protected gaitAmps(): number[] {
    return [0.75, 0.75, 0.8, 0.8];
  }
  private declare trunk: THREE.Group[];
  private declare head: THREE.Group;
  private declare ears: THREE.Mesh[];
  private charge = 0;
  private spray = 0;
  private grab = 0;

  protected buildBody(): void {
    this.trunk = [];
    this.ears = [];
    const d = this.def;
    const skin = toon(d.bodyColor);
    const skinDark = toon(0x6f6e76);
    const bodyM = sphere(1.4, skin, 1.55, 1.12, 1.1);
    bodyM.position.set(-0.15, 2.2, 0);
    this.body.add(bodyM);
    const shoulder = sphere(1.0, skin, 1.05, 1.1, 1.05);
    shoulder.position.set(1.15, 2.25, 0);
    this.body.add(shoulder);
    this.head = new THREE.Group();
    this.head.name = 'elephant_head';
    this.head.position.set(1.95, 2.55, 0);
    const skull = sphere(0.85, skin, 1.05, 1.1, 0.95);
    this.head.add(skull);
    const dome = sphere(0.5, skin, 1, 0.8, 1.3);
    dome.position.set(-0.05, 0.55, 0);
    this.head.add(dome);
    for (const s of [-1, 1]) {
      const ear = box(0.14, 1.25, 1.05, skinDark);
      ear.position.set(-0.25, 0.1, s * 0.95);
      ear.rotation.y = s * 0.55;
      this.head.add(ear);
      this.ears.push(ear);
      const eye = sphere(0.09, toon(0x1a1410));
      eye.position.set(0.62, 0.32, s * 0.5);
      this.head.add(eye);
      const tusk = capsule(0.08, 0.8, toon(0xf7f1dc));
      tusk.position.set(0.85, -0.35, s * 0.36);
      tusk.rotation.z = -Math.PI / 2 + 0.55;
      this.head.add(tusk);
    }
    let parent: THREE.Object3D = this.head;
    let off = new THREE.Vector3(0.8, -0.25, 0);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.name = `elephant_trunk_${i}`;
      seg.position.copy(off);
      const r = 0.24 - i * 0.045;
      const geo = new THREE.CapsuleGeometry(r, 0.5, 4, 10);
      geo.translate(0, -0.3, 0);
      const m = new THREE.Mesh(geo, skin);
      m.castShadow = true;
      seg.add(m);
      seg.rotation.z = 0.28;
      parent.add(seg);
      this.trunk.push(seg);
      parent = seg;
      off = new THREE.Vector3(0, -0.58, 0);
    }
    this.body.add(this.head);
    this.addLegs([
      { x: 1.05, z: -0.7, w: 0.62, len: 1.5, mat: skin, y: 1.5, hoof: 0xcfc8bd },
      { x: 1.05, z: 0.7, w: 0.62, len: 1.5, mat: skin, y: 1.5, hoof: 0xcfc8bd },
      { x: -1.25, z: -0.7, w: 0.62, len: 1.5, mat: skin, y: 1.5, hoof: 0xcfc8bd },
      { x: -1.25, z: 0.7, w: 0.62, len: 1.5, mat: skin, y: 1.5, hoof: 0xcfc8bd },
    ]);
    const tail = capsule(0.05, 0.7, skinDark);
    tail.position.set(-2.35, 2.3, 0);
    tail.rotation.z = 0.5;
    this.body.add(tail);
    const tuft = sphere(0.09, toon(0x333333));
    tuft.position.set(-2.6, 1.95, 0);
    this.body.add(tuft);
    const blanket = box(1.9, 0.18, 3.0, toon(d.clothColor));
    blanket.position.set(-0.15, 3.35, 0);
    this.body.add(blanket);
    const cloth = makeNumberCloths(d.number, d.clothColor, 1.0, 1.58);
    cloth.position.set(-0.15, 2.4, 0);
    this.body.add(cloth);
    this.addRider(new THREE.Vector3(-0.15, 3.45, 0), 1.0);
    this.bounceAmp = 0.12;
    this.wobbleFreq = 1.0;
    this.legAmp = 0.42;
    this.kneeFold = 0.5;
    this.height = 3.8;
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { time, dt, speedNorm } = ctx;
    this.charge = damp(this.charge, ctx.state === 'CHARGING' ? 1 : 0, 4, dt);
    this.spray = damp(this.spray, ctx.state === 'SPRAYING' ? 1 : 0, 6, dt);
    this.grab = damp(this.grab, ctx.extension, 10, dt);
    const c = this.charge;
    const g = this.grab;
    const sp = this.spray;
    this.head.rotation.z = -c * 0.4 + Math.sin(time * 6) * 0.04 * speedNorm - g * 0.3 + sp * 0.35;
    this.head.rotation.y = Math.sin(time * 4.5 + this.seed) * 0.08 * speedNorm;
    this.trunk.forEach((seg, i) => {
      const sway = Math.sin(time * (5 + i) + i * 0.8) * (0.18 + 0.08 * i) * speedNorm * (1 - g);
      // 돌진 중에는 첫 관절을 뒤로 크게 젖히고 나머지는 작은 국소각으로 이어
      // 전체 코가 몸 뒤로 길게 흐른다. 각 마디에 위상차를 둬 채찍처럼 휘날린다.
      const streamWave = Math.sin(time * 9 - i * 1.05) * (0.1 + i * 0.045);
      const streamTarget = i === 0 ? -1.18 + streamWave : -0.08 + streamWave;
      const normal = 0.28 + sway;
      seg.rotation.z = THREE.MathUtils.lerp(normal, streamTarget, c) + g * (i === 0 ? 1.25 : 0.05) - sp * (i === 0 ? 1.4 : 0.35);
      seg.rotation.x = Math.sin(time * (5.5 + i * 0.35) - i) * (0.1 + c * (0.08 + i * 0.025)) * speedNorm * (1 - g);
      const trunkScale = ctx.extensionMax > 3 ? ctx.extensionMax / 2.4 : 3.2;
      const lengthScale = 1 + c * 0.18 + g * trunkScale;
      seg.scale.y = lengthScale;
      // 늘어난 마디 끝에 다음 마디가 붙도록 위치 보정
      if (i > 0) seg.position.y = -0.58 * lengthScale;
      seg.visible = true;
    });
    this.ears.forEach((e, i) => {
      const s = i === 0 ? -1 : 1;
      e.rotation.y = s * (0.55 + Math.sin(time * 8 + i) * (0.15 + c * 0.4 + sp * 0.3) * (0.3 + speedNorm));
    });
    this.bounceAmp = 0.12 + c * 0.2;
    if (c > 0.1) this.body.rotation.z += -c * 0.12;
  }

  /** 코 끝 월드 좌표 (물대포 파티클) */
  trunkTip(out = new THREE.Vector3()): THREE.Vector3 {
    const last = this.trunk[this.trunk.length - 1];
    last.updateWorldMatrix(true, false);
    return out.set(0, -0.6 * last.scale.y, 0).applyMatrix4(last.matrixWorld);
  }
}

// ================================================================ 4. 소
class CowVisual extends PlaceholderVisual {
  /** 소: 무거운 갤럽 — 뒷다리 쌍이 거의 함께 차고, 앞다리는 반 보폭 뒤에 번갈아 착지 */
  protected gaitPhases(): number[] {
    return [0.5, 0.68, 0.0, 0.1];
  }
  private declare head: THREE.Group;
  private declare eyes: THREE.Mesh[];
  private declare bell: THREE.Mesh;
  private rage = 0;
  declare nostrils: THREE.Vector3[];

  private spotTexture(): THREE.CanvasTexture {
    return canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#f6f2ea';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#1a1a1a';
      let seed = 7;
      const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      for (let i = 0; i < 11; i++) {
        ctx.beginPath();
        const cx = rnd() * 256;
        const cy = rnd() * 256;
        ctx.moveTo(cx + 30, cy);
        for (let a = 0; a < Math.PI * 2; a += 0.5) {
          const r = 22 + rnd() * 22;
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  protected buildBody(): void {
    this.eyes = [];
    this.nostrils = [];
    const d = this.def;
    const hide = toon(0xffffff, { map: this.spotTexture() });
    const pink = toon(0xf0a6a6);
    const y = 1.35;
    // 소 몸통: 등이 평평하고 넓적하며 배가 깊게 처진 각진 통 — 말보다 낮고 굵다
    const barrel = new THREE.Mesh(
      loft([
        { p: [-1.35, y + 0.15, 0], r: 0.42, s: [1.15, 0.95] },
        { p: [-0.9, y + 0.08, 0], r: 0.62, s: [1.2, 1.05] },
        { p: [-0.2, y - 0.05, 0], r: 0.66, s: [1.22, 1.08] },
        { p: [0.55, y, 0], r: 0.62, s: [1.18, 1.02] },
        { p: [1.05, y + 0.05, 0], r: 0.55, s: [1.1, 0.95] },
        { p: [1.35, y + 0.05, 0], r: 0.38, s: [1.0, 0.85] },
      ]),
      hide,
    );
    barrel.castShadow = true;
    this.body.add(barrel);
    // 어깨 위 융기(혹)와 골반 뼈가 살짝 튀어나온 느낌
    const hump = sphere(0.36, hide, 1.2, 0.55, 1.0);
    hump.position.set(0.85, y + 0.5, 0);
    this.body.add(hump);
    // 목: 짧고 굵으며 아래로 처짐, 턱밑 늘어진 살(듀랩)
    const neck = new THREE.Group();
    neck.position.set(1.35, y + 0.15, 0);
    neck.rotation.z = -1.25;
    const neckM = new THREE.Mesh(
      loft([
        { p: [0, -0.1, 0], r: 0.38, s: [1.05, 1.15] },
        { p: [0.02, 0.25, 0], r: 0.33, s: [1.0, 1.15] },
        { p: [0.04, 0.5, 0], r: 0.29, s: [0.95, 1.05] },
      ]),
      hide,
    );
    neckM.castShadow = true;
    neck.add(neckM);
    const dewlap = new THREE.Mesh(
      loft([
        { p: [0.2, -0.15, 0], r: 0.14, s: [0.6, 1] },
        { p: [0.3, 0.2, 0], r: 0.16, s: [0.6, 1] },
        { p: [0.35, 0.5, 0], r: 0.1, s: [0.6, 1] },
      ]),
      hide,
    );
    dewlap.castShadow = true;
    neck.add(dewlap);
    // 머리: 넓적한 이마, 큰 주둥이, 분홍 코, 큰 처진 귀, 뿔
    const head = new THREE.Group();
    head.position.set(0.05, 0.55, 0);
    head.rotation.z = 1.05;
    const skull = new THREE.Mesh(
      loft([
        { p: [-0.1, 0.05, 0], r: 0.27, s: [1.1, 1.0] },
        { p: [0.25, 0.05, 0], r: 0.26, s: [1.1, 0.95] },
        { p: [0.55, 0.0, 0], r: 0.22, s: [1.05, 0.9] },
        { p: [0.8, -0.03, 0], r: 0.2, s: [1.05, 0.85] },
      ]),
      hide,
    );
    skull.castShadow = true;
    head.add(skull);
    const muzzle = sphere(0.22, pink, 1.05, 0.75, 1.15);
    muzzle.name = 'graze_mouth';
    muzzle.position.set(0.9, -0.06, 0);
    head.add(muzzle);
    for (const sgn of [-1, 1]) {
      const horn = new THREE.Mesh(
        loft([
          { p: [0, 0, 0], r: 0.06 },
          { p: [0.05, 0.22, 0], r: 0.05 },
          { p: [0.15, 0.4, 0], r: 0.02 },
        ]),
        toon(0xe8dcc0),
      );
      horn.position.set(-0.05, 0.2, sgn * 0.22);
      horn.rotation.x = sgn * 0.9;
      horn.castShadow = true;
      head.add(horn);
      const ear = new THREE.Mesh(
        loft([
          { p: [0, 0, 0], r: 0.06, s: [1, 0.5] },
          { p: [0, 0.02, sgn * 0.18], r: 0.09, s: [1, 0.45] },
          { p: [0, -0.04, sgn * 0.34], r: 0.05, s: [1, 0.4] },
        ]),
        hide,
      );
      ear.position.set(-0.02, 0.08, sgn * 0.24);
      ear.castShadow = true;
      head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      eye.position.set(0.3, 0.12, sgn * 0.27);
      head.add(eye);
      this.eyes.push(eye);
      this.nostrils.push(new THREE.Vector3(1.05, -0.06, sgn * 0.09));
    }
    neck.add(head);
    this.body.add(neck);
    this.head = head;
    this.neckBob = neck;
    this.neckBase = -1.25;
    this.grazeDrop = 0.9;
    // 방울 + 목걸이
    this.bell = sphere(0.1, toon(0xf5c400));
    this.bell.position.set(1.55, 1.05, 0);
    this.body.add(this.bell);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.03, 6, 16), toon(0x8a1a1a));
    strap.position.set(1.5, 1.35, 0);
    strap.rotation.y = Math.PI / 2;
    this.body.add(strap);
    // 젖통 + 젖꼭지
    const udder = sphere(0.3, pink, 1.15, 0.8, 1.05);
    udder.position.set(-0.55, 0.85, 0);
    this.body.add(udder);
    for (const [ox, oz] of [
      [-0.1, -0.1],
      [-0.1, 0.1],
      [0.12, -0.1],
      [0.12, 0.1],
    ]) {
      const teat = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.12, 6), pink);
      teat.position.set(-0.55 + ox, 0.62, oz);
      this.body.add(teat);
    }
    // 꼬리: 가늘고 끝에 털 뭉치
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.9, 6), hide);
    tail.position.set(-1.45, y - 0.2, 0);
    tail.rotation.z = -0.15;
    this.body.add(tail);
    const tuft = sphere(0.08, toon(0x1a1a1a), 0.8, 1.3, 0.8);
    tuft.position.set(-1.5, y - 0.7, 0);
    this.body.add(tuft);
    addSaddle(this.body, -0.15, y + 0.62, 1.15, d.clothColor);
    const cloth = makeNumberCloths(d.number, d.clothColor, 0.62, 0.72);
    cloth.position.set(-0.2, y - 0.05, 0);
    this.body.add(cloth);
    // 다리: 짧고 굵음
    this.addLegs([
      { x: 0.85, z: -0.36, w: 0.22, len: 1.0, mat: hide, y: 1.0 },
      { x: 0.85, z: 0.36, w: 0.22, len: 1.0, mat: hide, y: 1.0 },
      { x: -0.85, z: -0.36, w: 0.22, len: 1.0, mat: hide, y: 1.0 },
      { x: -0.85, z: 0.36, w: 0.22, len: 1.0, mat: hide, y: 1.0 },
    ]);
    this.addRider(new THREE.Vector3(-0.15, y + 0.8, 0));
    this.attachReins(this.head, new THREE.Vector3(0.85, -0.05, 0.2));
    this.bounceAmp = 0.1;
    this.wobbleFreq = 1.0;
    this.legAmp = 0.55;
    this.height = 2.4;
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { time, dt, speedNorm } = ctx;
    this.rage = damp(this.rage, ctx.state === 'RAGING' ? 1 : 0, 5, dt);
    const r = this.rage;
    this.head.rotation.y = Math.sin(time * 26) * 0.45 * r + Math.sin(time * 3 + this.seed) * 0.06 * speedNorm;
    this.head.rotation.z = 1.05 - r * 0.55 + Math.sin(time * 7) * 0.05 * speedNorm;
    const eyeColor = r > 0.5 ? 0xff2020 : 0x111111;
    this.eyes.forEach((e) => (e.material as THREE.MeshBasicMaterial).color.setHex(eyeColor));
    this.bell.position.x = 1.55 + Math.sin(time * 12) * 0.05 * speedNorm;
    this.bounceAmp = 0.12 + r * 0.14;
  }
}

// ================================================================ 5. 모터 스탤리온 (리젠트 머리 검은 말 + 할리 핸들)
class MotorcycleVisual extends PlaceholderVisual {
  private declare wheels: THREE.Mesh[];
  private declare flames: THREE.Mesh[];
  private declare frame: THREE.Group;
  private declare parts: HorseParts;
  private declare pompadour: THREE.Mesh;
  private wheelie = 0;
  private failShake = 0;
  declare exhaustPoints: THREE.Vector3[];

  protected buildBody(): void {
    this.wheels = [];
    this.flames = [];
    this.exhaustPoints = [];
    const d = this.def;
    const black = toon(0x151316);
    (black as THREE.MeshStandardMaterial).roughness = 0.55; // 윤기 나는 검은 털
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.2, metalness: 0.95 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.35, metalness: 0.1 });
    this.frame = new THREE.Group();
    this.frame.name = 'motor_frame';
    // 검은 말 본체
    this.parts = buildHorse(this.frame, { hide: black, mane: hairMat, bodyLen: 1.25, bodyR: 0.52, bridle: false });
    this.neckBob = this.parts.neck;
    this.neckBase = -0.85;
    // 리젠트(폼파도르): 이마에서 앞으로 크게 말아 올린 머리
    this.pompadour = new THREE.Mesh(
      loft([
        { p: [-0.3, 0.12, 0], r: 0.14, s: [1.2, 0.8] },
        { p: [-0.05, 0.3, 0], r: 0.2, s: [1.25, 1.0] },
        { p: [0.35, 0.42, 0], r: 0.22, s: [1.2, 1.05] },
        { p: [0.75, 0.4, 0], r: 0.19, s: [1.1, 1.0] },
        { p: [1.0, 0.22, 0], r: 0.11, s: [0.9, 0.9] },
      ]),
      hairMat,
    );
    this.pompadour.castShadow = true;
    this.parts.head.add(this.pompadour);
    // 구레나룻
    for (const sgn of [-1, 1]) {
      const sideburn = box(0.12, 0.28, 0.04, hairMat);
      sideburn.position.set(0.05, -0.02, sgn * 0.21);
      this.parts.head.add(sideburn);
      // 선글라스
      const lens = box(0.06, 0.1, 0.16, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.15, metalness: 0.6 }));
      lens.position.set(0.3, 0.1, sgn * 0.17);
      this.parts.head.add(lens);
    }
    const bridge = box(0.03, 0.02, 0.2, chrome);
    bridge.position.set(0.31, 0.12, 0);
    this.parts.head.add(bridge);
    // 이빨 쑤시개(?) — 입에 문 지푸라기
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 5), toon(0xd8c070));
    straw.position.set(1.0, -0.14, 0.05);
    straw.rotation.z = -0.4;
    this.parts.head.add(straw);
    // 할리 에이프행어 핸들: 기갑(어깨) 위 크롬 파이프가 위로 솟아 그립까지
    for (const sgn of [-1, 1]) {
      const bar = new THREE.Mesh(
        loft(
          [
            { p: [0.55, 2.0, sgn * 0.12], r: 0.035 },
            { p: [0.6, 2.4, sgn * 0.22], r: 0.032 },
            { p: [0.35, 2.7, sgn * 0.24], r: 0.03 },
            { p: [-0.05, 2.76, sgn * 0.22], r: 0.03 },
          ],
          16,
          10,
        ),
        chrome,
      );
      bar.castShadow = true;
      this.frame.add(bar);
      // 그립은 기수 손 위치(약 x -0.18, y 2.72)에 맞춤
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10), toon(0x1a1a1a));
      grip.position.set(-0.16, 2.74, sgn * 0.21);
      grip.rotation.z = Math.PI / 2;
      this.frame.add(grip);
      // 배기관: 옆구리 아래 크롬 파이프
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1.5, 10), chrome);
      pipe.rotation.z = Math.PI / 2 + 0.08;
      pipe.position.set(-0.55, 1.02, sgn * 0.58);
      pipe.castShadow = true;
      this.frame.add(pipe);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.25, 12), chrome);
      tip.rotation.z = Math.PI / 2;
      tip.position.set(-1.38, 0.96, sgn * 0.58);
      this.frame.add(tip);
      this.exhaustPoints.push(new THREE.Vector3(-1.52, 0.96, sgn * 0.58));
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 1.1, 10),
        new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9 }),
      );
      flame.rotation.z = Math.PI / 2;
      flame.position.set(-2.0, 0.96, sgn * 0.58);
      flame.visible = false;
      flame.userData.noOutline = true;
      this.frame.add(flame);
      this.flames.push(flame);
    }
    // 가슴 헤드라이트 + 크롬 연료탱크 느낌의 등 커버
    const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffe9a8, emissiveIntensity: 0.45, roughness: 0.3 }));
    headlight.position.set(1.62, 1.45, 0);
    headlight.userData.noOutline = true;
    this.frame.add(headlight);
    const lightRim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 16), chrome);
    lightRim.position.set(1.62, 1.45, 0);
    lightRim.rotation.y = Math.PI / 2;
    this.frame.add(lightRim);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), new THREE.MeshStandardMaterial({ color: 0xc41e1e, roughness: 0.25, metalness: 0.4 }));
    tank.scale.set(1.3, 0.55, 0.9);
    tank.position.set(0.35, 2.0, 0);
    tank.castShadow = true;
    this.frame.add(tank);
    const cloth = makeNumberCloths(d.number, d.clothColor, 0.6, 0.55);
    cloth.position.set(-0.3, 1.42, 0);
    this.frame.add(cloth);
    // 안장은 바이크 시트
    const seat = box(0.75, 0.12, 0.5, toon(0x111111));
    seat.position.set(-0.45, 2.0, 0);
    this.frame.add(seat);
    this.body.add(this.frame);
    this.addLegs(
      [
        { x: 0.85, z: -0.3, w: 0.18, len: 1.2, mat: black, y: 1.2, hoof: 0x111111 },
        { x: 0.85, z: 0.3, w: 0.18, len: 1.2, mat: black, y: 1.2, hoof: 0x111111 },
        { x: -0.85, z: -0.3, w: 0.18, len: 1.2, mat: black, y: 1.2, hoof: 0x111111 },
        { x: -0.85, z: 0.3, w: 0.18, len: 1.2, mat: black, y: 1.2, hoof: 0x111111 },
      ],
      this.frame,
    );
    // 기수: 뒤로 젖혀 앉아 에이프행어를 잡는 초퍼 자세
    this.addRider(new THREE.Vector3(-0.35, 2.1, 0));
    this.reparentRider(0, this.frame, 0.75);
    this.bounceAmp = 0.12;
    this.height = 2.9;
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { dt, time } = ctx;
    const boosting = ctx.state === 'BOOSTING';
    // 부스트: 앞다리 들고 뒷발로 튀어나감(윌리)
    this.wheelie = damp(this.wheelie, boosting ? 1 : 0, boosting ? 6 : 3, dt);
    // 본체·다리·기수가 같은 프레임을 공유하므로 윌리 중 관절이 분리되지 않는다.
    this.frame.rotation.z = this.wheelie * 0.24;
    this.frame.position.y = this.wheelie * 0.18;
    if (this.wheelie > 0.05) {
      this.legs[0].rotation.z = THREE.MathUtils.lerp(this.legs[0].rotation.z, 0.78 + Math.sin(time * 9) * 0.18, this.wheelie);
      this.legs[1].rotation.z = THREE.MathUtils.lerp(this.legs[1].rotation.z, 0.72 + Math.cos(time * 9) * 0.18, this.wheelie);
      for (let i = 0; i < 2; i++) {
        const knee = this.legs[i].children.find((ch) => ch.name.endsWith('_lower'));
        if (knee) knee.rotation.z = THREE.MathUtils.lerp(knee.rotation.z, -1.05, this.wheelie);
      }
      // 뒷다리는 차체 아래에서 번갈아 지면을 밀어 급가속의 추진력을 표현한다.
      this.legs[2].rotation.z = THREE.MathUtils.lerp(this.legs[2].rotation.z, -0.32 + Math.sin(time * 10) * 0.14, this.wheelie * 0.65);
      this.legs[3].rotation.z = THREE.MathUtils.lerp(this.legs[3].rotation.z, -0.32 + Math.cos(time * 10) * 0.14, this.wheelie * 0.65);
    }
    // 와리가리: 횡속도 방향으로 몸을 눕힘
    this.frame.rotation.x = THREE.MathUtils.clamp(ctx.lateralVel * 0.12, -0.5, 0.5);
    this.frame.rotation.y = -THREE.MathUtils.clamp(ctx.lateralVel * 0.05, -0.25, 0.25);
    this.flames.forEach((f) => {
      f.visible = boosting;
      const sc = 0.7 + Math.random() * 0.8;
      f.scale.set(sc, sc * 1.4, sc);
    });
    // 리젠트는 바람에 살짝 출렁
    this.pompadour.rotation.z = Math.sin(time * 6) * 0.05 * ctx.speedNorm - this.wheelie * 0.2;
    this.updateEngineFailure(ctx);
    // 엔진 드르릉 (말인데 엔진 소리가 남) — 고장 중엔 멈춘다
    this.frame.position.y += Math.sin(time * 52) * 0.008 * (0.4 + ctx.speedNorm * 0.6) * (1 - this.failShake);
  }

  /** 역화 불꽃 파티클을 뿜어야 하는 순간 (RacerManager 가 읽음) */
  backfiring = false;

  /**
   * 엔진 고장 4.5초 연출:
   *  0.0~1.1s 털털거림 — 격렬한 덜컹·역화·앞으로 고꾸라짐
   *  1.1~3.9s 시동 꺼짐 — 축 처짐, 고개 떨굼, 기수가 1초마다 킥스타트 시도(꿈틀)
   *  3.9~4.5s 재시동 — 진동 커지고 불꽃 터지며 뒤로 살짝 눌림
   */
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
    // 킥스타트: 1초 주기로 짧은 충격
    const kick = Math.pow(Math.max(0, Math.sin(elapsed * Math.PI * 2)), 12) * stalled;
    const jolt = (sputter + restart * 0.8 + kick * 0.6) * k;
    // 실린더 미스파이어: 불규칙한 저주파 덜컹 + 고주파 진동
    const miss = Math.sin(time * 17) * Math.sin(time * 5.3) * 0.5 + Math.sin(time * 41) * 0.5;
    this.frame.rotation.z += miss * 0.09 * jolt + sputter * 0.12 * k; // 고꾸라짐(코 아래)
    this.frame.rotation.x += Math.sin(time * 23) * 0.06 * jolt;
    this.frame.position.y += Math.abs(Math.sin(time * 31)) * 0.05 * jolt - stalled * k * 0.12;
    // 시동 꺼짐: 고개 축 처지고 폼파도르가 앞으로 흘러내림
    this.parts.neck.rotation.z += -0.55 * stalled * k;
    this.parts.head.rotation.z = -0.25 * stalled * k + Math.sin(time * 2.1) * 0.05 * stalled * k;
    this.pompadour.rotation.z += -0.35 * stalled * k;
    // 다리: 앞다리 살짝 벌리고(버팀), 뒷다리 굽혀 주저앉음
    if (stalled > 0.01) {
      const lr = stalled * k;
      this.legs[0].rotation.z = THREE.MathUtils.lerp(this.legs[0].rotation.z, 0.22, lr);
      this.legs[1].rotation.z = THREE.MathUtils.lerp(this.legs[1].rotation.z, 0.22, lr);
      for (const i of [2, 3]) {
        this.legs[i].rotation.z = THREE.MathUtils.lerp(this.legs[i].rotation.z, -0.35, lr);
        const knee = this.legs[i].getObjectByName(this.legs[i].name + '_lower');
        if (knee) knee.rotation.z = THREE.MathUtils.lerp(knee.rotation.z, 0.45, lr);
      }
    }
    // 기수: 털털거릴 때 튕기고, 꺼지면 앞으로 숙여 핸들 흔들고, 킥스타트 때 몸 들썩
    const r = this.riders[0];
    if (r.parent === this.frame) {
      r.position.y += Math.abs(Math.sin(time * 19)) * 0.12 * jolt + kick * 0.16 * k;
      r.rotation.z += -0.45 * stalled * k + Math.sin(time * 9) * 0.06 * stalled * k;
    }
    // 역화: 털털거림·재시동 때 불규칙하게 불꽃, 킥스타트 순간 펑
    const flash = (sputter > 0.05 && Math.random() < 0.18) || (restart > 0.2 && Math.random() < 0.35) || kick > 0.85;
    this.backfiring = flash;
    this.flames.forEach((f) => {
      if (!flash) return;
      f.visible = true;
      const sc = 0.4 + Math.random() * 0.5;
      f.scale.set(sc, sc * 0.8, sc);
    });
  }
}

// ================================================================ 6. 인간 말
class HumanVisual extends PlaceholderVisual {
  /** 네발 기기: 대각선 교차 (왼팔+오른다리, 오른팔+왼다리) */
  protected gaitPhases(): number[] {
    return [0.0, 0.5, 0.5, 0.0];
  }
  protected gaitAmps(): number[] {
    return [1, 1, 1, 1];
  }
  private declare torso: THREE.Group;
  private declare headRig: THREE.Group;
  private declare headMesh: THREE.Mesh;
  private declare lowers: THREE.Object3D[];
  private declare shoes: THREE.Object3D[];
  private upright = 0;
  private tired = 0;
  sweatPoint = new THREE.Vector3(0.8, 1.2, 0);

  protected buildBody(): void {
    this.lowers = [];
    this.shoes = [];
    const d = this.def;
    const skin = toon(d.bodyColor);
    const shirt = toon(0xf4f4f4);
    const shorts = toon(0x2255aa);
    this.torso = new THREE.Group();
    this.torso.name = 'human_torso';
    const chest = capsule(0.26, 0.55, shirt, 'x');
    chest.position.set(0.1, 0.95, 0);
    this.torso.add(chest);
    const hip = capsule(0.24, 0.2, shorts, 'x');
    hip.position.set(-0.5, 0.92, 0);
    this.torso.add(hip);
    // 얼굴 전체를 하나의 관절에 묶어 달릴 때 머리·머리카락·표정이 분리되지 않는다.
    this.headRig = new THREE.Group();
    this.headRig.name = 'human_head';
    this.headRig.position.set(0.82, 1.05, 0);
    this.headMesh = sphere(0.24, skin);
    this.headRig.add(this.headMesh);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.255, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x222222));
    hair.position.set(-0.02, 0.05, 0);
    hair.rotation.z = -0.6;
    hair.castShadow = true;
    this.headRig.add(hair);
    // 얼굴: 눈 + 이 악문 입
    for (const s of [-1, 1]) {
      const eye = sphere(0.035, toon(0x111111));
      eye.position.set(0.2, 0.05, s * 0.09);
      this.headRig.add(eye);
    }
    const mouth = box(0.05, 0.05, 0.14, toon(0x7a2a2a));
    mouth.position.set(0.2, -0.1, 0);
    this.headRig.add(mouth);
    // 말 장비: 굴레와 안장, 번호
    const bridle = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.03, 6, 14), toon(0x6b3a1e));
    bridle.rotation.y = Math.PI / 2;
    this.headRig.add(bridle);
    this.torso.add(this.headRig);
    addSaddle(this.torso, -0.05, 1.18, 0.5, d.clothColor);
    const cloth = makeNumberCloths(d.number, d.clothColor, 0.4, 0.3);
    cloth.position.set(-0.15, 0.95, 0);
    this.torso.add(cloth);
    this.body.add(this.torso);
    this.addLegs(
      [
        { x: 0.45, z: -0.25, w: 0.14, len: 0.82, mat: skin, y: 0.85, hoof: 0xf4f4f4 },
        { x: 0.45, z: 0.25, w: 0.14, len: 0.82, mat: skin, y: 0.85, hoof: 0xf4f4f4 },
        { x: -0.6, z: -0.2, w: 0.18, len: 0.86, mat: skin, y: 0.85, hoof: 0xff3030 },
        { x: -0.6, z: 0.2, w: 0.18, len: 0.86, mat: skin, y: 0.85, hoof: 0xff3030 },
      ],
      this.torso,
    );
    this.legs.forEach((limb, i) => {
      const lower = limb.children.find((c) => c.name.endsWith('_lower'));
      if (!lower) return;
      this.lowers.push(lower);
      // 말 발굽 형태는 숨기고, 팔 끝에는 손을, 다리 끝에는 운동화를 붙인다.
      const hoof = lower.children[lower.children.length - 1];
      if (hoof) hoof.visible = false;
      const lowerLen = (i < 2 ? 0.82 : 0.86) * 0.48;
      if (i < 2) {
        const hand = sphere(0.1, skin, 0.9, 1.05, 0.9);
        hand.name = `human_hand_${i}`;
        hand.position.set(0, -lowerLen, 0);
        lower.add(hand);
      } else {
        const shoe = box(0.34, 0.13, 0.2, toon(0xff3030));
        shoe.name = `human_shoe_${i - 2}`;
        shoe.position.set(0.12, -lowerLen, 0);
        lower.add(shoe);
        this.shoes.push(shoe);
      }
    });
    this.addRider(new THREE.Vector3(-0.1, 1.28, 0), 0.9);
    this.reparentRider(0, this.torso);
    // 네발/두발 전환의 높이 변화는 아래 전용 러닝 리그에서 처리한다.
    this.gaitBounce = false;
    this.bounceAmp = 0;
    this.wobbleFreq = 1.0;
    this.legAmp = 0.8;
    this.kneeFold = 1.2;
    this.height = 1.6;
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { dt, time, speedNorm } = ctx;
    const bip = ctx.state === 'BIPEDAL';
    const shoelace = ctx.state === 'SHOELACE';
    // 신발끈: 반쯤 일어나 앉아 앞다리(팔)로 발을 만지작
    this.upright = damp(this.upright, bip ? 1 : shoelace ? 0.55 : 0, 5, dt);
    if (shoelace) {
      this.legs[0].rotation.z = -0.9 + Math.sin(time * 6) * 0.25;
      this.legs[1].rotation.z = -0.8 + Math.cos(time * 6) * 0.25;
    }
    this.tired = damp(this.tired, ctx.state === 'EXHAUSTED' ? 1 : 0, 3, dt);
    const u = this.upright;
    // 실제 단거리 달리기의 한 보폭은 초당 약 2~3회다. 속도가 올라도 다리가
    // 프로펠러처럼 돌지 않도록 물리 속도와 분리한 일정한 케이던스를 쓴다.
    const cadence = THREE.MathUtils.lerp(2.15, 2.75, THREE.MathUtils.clamp(speedNorm, 0, 1));
    const cycle = time * Math.PI * 2 * cadence;
    const run = Math.sin(cycle);
    const stepBounce = Math.abs(Math.sin(cycle)) * 0.085 * speedNorm;
    const crawlBounce = Math.abs(Math.sin(this.stridePhase * Math.PI * 2)) * 0.07 * speedNorm;
    const uprightAngle = 1.4;
    this.torso.position.set(0.75 * u, THREE.MathUtils.lerp(crawlBounce, 1.3 + stepBounce, u), 0);
    this.torso.rotation.z = u * uprightAngle;
    this.torso.rotation.x = Math.sin(cycle) * 0.035 * u;
    if (u > 0.05) {
      // 팔은 반대쪽 다리와 교차하고, 다리는 엉덩이 아래 수직축을 기준으로
      // 앞뒤로 흔든다. 회복 구간에서만 무릎을 깊게 접어 실제 달리기 실루엣을 만든다.
      for (let side = 0; side < 2; side++) {
        const sideSign = side === 0 ? 1 : -1;
        const legWave = run * sideSign;
        const armWave = -legWave;
        const recovery = Math.max(0, Math.cos(cycle) * sideSign);
        const arm = this.legs[side];
        const leg = this.legs[side + 2];
        const elbow = this.lowers[side];
        const knee = this.lowers[side + 2];
        arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, -uprightAngle + 0.08 + armWave * 0.58, u);
        elbow.rotation.z = THREE.MathUtils.lerp(elbow.rotation.z, -1.02 - Math.max(0, armWave) * 0.22, u);
        leg.rotation.z = THREE.MathUtils.lerp(leg.rotation.z, -uprightAngle + legWave * 0.62, u);
        knee.rotation.z = THREE.MathUtils.lerp(knee.rotation.z, -0.12 - recovery * 0.95 - Math.max(0, legWave) * 0.14, u);
        // 운동화는 정강이 각도를 상쇄해 착지할 때 지면과 평행하게 보인다.
        const shoe = this.shoes[side];
        shoe.rotation.z = THREE.MathUtils.lerp(shoe.rotation.z, -(uprightAngle + leg.rotation.z + knee.rotation.z), u);
      }

      // 기수는 사람의 등 뒤에 붙이고 상체 회전을 정확히 상쇄한다. 기수의 손은
      // 양쪽 어깨, 접힌 다리는 허리 높이에 오도록 해 실제 업힌 자세를 만든다.
      const rider = this.riders[0];
      if (rider?.parent === this.torso) {
        const mounted = this.riderBase[0];
        rider.position.set(
          THREE.MathUtils.lerp(mounted.x, 0.05 + stepBounce * 0.18, u),
          THREE.MathUtils.lerp(mounted.y, 1.55, u),
          mounted.z,
        );
        rider.rotation.z = THREE.MathUtils.lerp(rider.rotation.z, -uprightAngle + 0.08 - run * 0.025, u);
      }
    }
    const headBob = Math.sin(cycle * 2) * 0.018 * speedNorm;
    this.headRig.position.x = 0.82 + headBob * u;
    this.headRig.position.y = 1.05 - this.tired * 0.28 * (1 - u) + headBob * (1 - u);
    this.torso.rotation.y = Math.sin(cycle) * 0.045 * u + Math.sin(time * 3.2) * 0.14 * this.tired;
    this.headRig.rotation.z = -this.tired * 0.6 * (1 - u) - run * 0.035 * u;
    this.height = THREE.MathUtils.lerp(1.6, 2.45, u);
  }

  get isTired(): boolean {
    return this.tired > 0.5;
  }
}

// ================================================================ 7. 기린
class GiraffeVisual extends PlaceholderVisual {
  /** 기린 특유의 측대 페이스: 같은 쪽 앞·뒤 다리가 함께, 좌우가 반 보폭 어긋남 */
  protected gaitPhases(): number[] {
    return [0.1, 0.6, 0.0, 0.5];
  }
  private declare neck: THREE.Group;
  private declare neckSegs: THREE.Group[];
  private dance = 0;
  private declare head: THREE.Group;
  private attack = 0;
  private attackSide = 1;
  private stretch = 0;

  private spotTexture(): THREE.CanvasTexture {
    return canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#efd28a';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#9a5a1e';
      for (let y = 0; y < 6; y++)
        for (let x = 0; x < 6; x++) {
          ctx.beginPath();
          const cx = 22 + x * 42 + (y % 2) * 20;
          const cy = 22 + y * 42;
          ctx.moveTo(cx + 16, cy);
          for (let a = 0; a < Math.PI * 2; a += 0.9) ctx.lineTo(cx + Math.cos(a) * (13 + ((x * 3 + y * 5) % 5)), cy + Math.sin(a) * (12 + ((x + y * 2) % 4)));
          ctx.closePath();
          ctx.fill();
        }
    });
  }

  protected buildBody(): void {
    const d = this.def;
    this.body.name = 'giraffe_body';
    const tex = this.spotTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const hide = toon(0xffffff, { map: tex });
    // 기린 몸통: 엉덩이가 낮고 어깨가 높은 경사진 등
    const barrel = new THREE.Mesh(
      loft([
        { p: [-1.05, 2.05, 0], r: 0.3, s: [0.9, 1.0] },
        { p: [-0.7, 2.15, 0], r: 0.5, s: [0.95, 1.1] },
        { p: [-0.1, 2.3, 0], r: 0.55, s: [1.0, 1.05] },
        { p: [0.55, 2.45, 0], r: 0.55, s: [0.95, 1.1] },
        { p: [1.0, 2.55, 0], r: 0.4, s: [0.85, 1.0] },
        { p: [1.2, 2.6, 0], r: 0.22, s: [0.8, 0.9] },
      ]),
      hide,
    );
    barrel.castShadow = true;
    this.body.add(barrel);
    this.neck = new THREE.Group();
    this.neck.position.set(0.95, 2.85, 0);
    const neckLen = 3.4;
    // 목은 8마디 체인: 평소엔 일직선, 목 댄스 때 ~~~ 물결로 흔들림
    this.neckSegs = [];
    const segN = 8;
    const segLen = neckLen / segN;
    let parentSeg: THREE.Object3D = this.neck;
    const maneMat = toon(0x6b3a1e);
    for (let i = 0; i < segN; i++) {
      const g = new THREE.Group();
      g.name = `giraffe_neck_${i}`;
      g.position.y = i === 0 ? 0 : segLen;
      const r0 = 0.26 - (i / segN) * 0.08;
      const r1 = 0.26 - ((i + 1) / segN) * 0.08;
      const geo = new THREE.CylinderGeometry(r1, r0, segLen * 1.06, 12);
      geo.translate(0, segLen / 2, 0);
      const m = new THREE.Mesh(geo, hide);
      m.castShadow = true;
      g.add(m);
      const joint = new THREE.Mesh(new THREE.SphereGeometry(r0, 12, 8), hide);
      g.add(joint);
      // 마디마다 갈기 술
      const tuft = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 3, 8), maneMat);
      tuft.position.set(-r0 * 0.85, segLen * 0.5, 0);
      tuft.rotation.z = 0.5;
      g.add(tuft);
      parentSeg.add(g);
      this.neckSegs.push(g);
      parentSeg = g;
    }
    this.head = new THREE.Group();
    this.head.position.set(0, segLen + 0.1, 0);
    const skull = capsule(0.2, 0.45, hide, 'x');
    skull.position.x = 0.32;
    this.head.add(skull);
    const muzzle = sphere(0.16, toon(0x6b4a2e), 1.1, 0.8, 1);
    muzzle.position.set(0.68, -0.04, 0);
    this.head.add(muzzle);
    for (const s of [-1, 1]) {
      const oss = capsule(0.04, 0.3, toon(0x6b3a1e));
      oss.position.set(0.05, 0.38, s * 0.12);
      this.head.add(oss);
      const knob = sphere(0.07, toon(0x3d2313));
      knob.position.set(0.05, 0.56, s * 0.12);
      this.head.add(knob);
      const eye = sphere(0.06, toon(0x111111));
      eye.position.set(0.4, 0.12, s * 0.2);
      this.head.add(eye);
      const ear = capsule(0.04, 0.2, hide);
      ear.position.set(0.02, 0.25, s * 0.3);
      ear.rotation.x = s * 1.1;
      this.head.add(ear);
    }
    parentSeg.add(this.head);
    this.neck.rotation.z = -0.35;
    this.body.add(this.neck);
    addSaddle(this.body, -0.2, 2.8, 0.95, d.clothColor);
    const cloth = makeNumberCloths(d.number, d.clothColor, 0.6, 0.55);
    cloth.position.set(-0.25, 2.25, 0);
    this.body.add(cloth);
    const tail = capsule(0.05, 0.9, toon(0x3d2313));
    tail.position.set(-1.05, 2.4, 0);
    tail.rotation.z = 0.6;
    this.body.add(tail);
    this.addLegs([
      { x: 0.65, z: -0.3, w: 0.18, len: 2.02, mat: hide, y: 2.02 },
      { x: 0.65, z: 0.3, w: 0.18, len: 2.02, mat: hide, y: 2.02 },
      { x: -0.7, z: -0.3, w: 0.18, len: 2.02, mat: hide, y: 2.02 },
      { x: -0.7, z: 0.3, w: 0.18, len: 2.02, mat: hide, y: 2.02 },
    ]);
    this.addRider(new THREE.Vector3(-0.2, 3.05, 0));
    this.attachReins(this.head, new THREE.Vector3(0.6, -0.05, 0.15));
    this.bounceAmp = 0.14;
    this.wobbleFreq = 1.0;
    this.legAmp = 0.5;
    this.kneeFold = 0.7;
    this.height = 3.3;
  }

  onEvent(type: RaceEventType, ctx: VisualContext): void {
    super.onEvent(type, ctx);
    if (type === 'GIRAFFE_NECK_ATTACK') {
      this.attack = 1;
      this.attackSide = ctx.sideHint || 1;
    }
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { dt, time, speedNorm } = ctx;
    this.stretch = damp(this.stretch, ctx.extension, 5, dt);
    this.attack = Math.max(0, this.attack - dt * 0.9);
    const a = Math.sin(this.attack * Math.PI);
    const sway = Math.sin(time * 4.2 + this.seed) * 0.3 * speedNorm;
    const side = Math.sin(time * 2.7) * 0.2 * speedNorm;
    // 목 뻗기: 최대 수평보다 살짝 위(약 -1.35rad)까지만 — 그 이상 숙이면 땅에 납작 붙어 보임
    const st = this.stretch;
    this.neck.rotation.z = -0.35 + sway * (1 - st) - st * 1.0;
    this.neck.rotation.x = side * (1 - st * 0.7) + a * this.attackSide * 1.1;
    // 목 길이: 결승 스트레치 때 extensionMax(m) 만큼 (기본 6.5m, 피날레 34m)
    const mega = ctx.extensionMax > 0 ? Math.max(1, ctx.extensionMax / 3.4) : 1;
    this.neck.scale.y = 1 + st * (mega - 1);
    // 머리는 항상 앞을 보도록 목 기울기를 상쇄
    this.head.rotation.z = Math.sin(time * 6) * 0.1 * speedNorm + st * 0.9;
    // 목 댄스: 멈춰 서서 옆모습이 명확한 ~~~~ 파형을 만들도록 각 마디를
    // z축으로 크게 번갈아 굽히고, x축에는 작은 깊이 흔들림만 더한다.
    this.dance = damp(this.dance, ctx.state === 'DANCING' ? 1 : 0, 5, dt);
    const dn = this.dance;
    this.neckSegs.forEach((seg, i) => {
      const wave = time * 5.2 - i * 1.08;
      seg.rotation.z = Math.sin(wave) * 0.3 * dn;
      seg.rotation.x = Math.cos(wave) * 0.12 * dn;
    });
    if (dn > 0.05) {
      this.neck.rotation.z = -0.42 + Math.sin(time * 2.6) * 0.08 * dn;
      this.body.position.y += Math.abs(Math.sin(time * 5.2)) * 0.09 * dn;
      this.body.rotation.x += Math.sin(time * 5.2) * 0.06 * dn;
      this.head.rotation.z += Math.sin(time * 5.2 - 7.5) * 0.38 * dn;
    }
  }
}

// ================================================================ 8. 정상적인 말
class ClassicVisual extends PlaceholderVisual {
  private declare head: THREE.Group;
  private declare neck: THREE.Group;

  protected buildBody(): void {
    const d = this.def;
    const hide = toon(d.bodyColor);
    const parts = buildHorse(this.body, { hide, mane: toon(0x1f120a) });
    this.head = parts.head;
    this.neck = parts.neck;
    this.neckBob = parts.neck;
    this.neckBase = -0.85;
    // 흰 얼굴 무늬
    const blaze = box(0.5, 0.08, 0.1, toon(0xf5f0e8));
    blaze.position.set(0.45, 0.2, 0);
    this.head.add(blaze);
    addSaddle(this.body, -0.15, 1.98, 0.95, d.clothColor);
    const cloth = makeNumberCloths(d.number, d.clothColor, 0.6, 0.53);
    cloth.position.set(-0.2, 1.4, 0);
    this.body.add(cloth);
    this.addLegs([
      { x: 0.85, z: -0.3, w: 0.17, len: 1.2, mat: hide, y: 1.2 },
      { x: 0.85, z: 0.3, w: 0.17, len: 1.2, mat: hide, y: 1.2 },
      { x: -0.85, z: -0.3, w: 0.17, len: 1.2, mat: hide, y: 1.2 },
      { x: -0.85, z: 0.3, w: 0.17, len: 1.2, mat: hide, y: 1.2 },
    ]);
    this.addRider(new THREE.Vector3(-0.15, 2.15, 0));
    this.attachReins(parts.head, new THREE.Vector3(0.62, -0.05, 0.16));
    this.bounceAmp = 0.13;
    this.height = 2.4;
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { time, speedNorm } = ctx;
    this.neck.rotation.z += -this.stumble * 0.4;
    void speedNorm;
    this.head.rotation.z = 0.95 + Math.sin(time * 7 + this.seed + 1) * 0.05 * speedNorm;
  }
}

// ================================================================ 9. 서커스 스타
class CircusVisual extends PlaceholderVisual {
  private declare parts: HorseParts;
  private declare plume: THREE.Group;
  private perform = 0;
  private beat = 0;

  private sequinTexture(): THREE.CanvasTexture {
    return canvasTex(128, 128, (ctx) => {
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
  }

  protected buildBody(): void {
    const d = this.def;
    this.body.name = 'circus_body';
    const hide = toon(d.bodyColor);
    this.parts = buildHorse(this.body, { hide, mane: toon(0xf7f0dc), bodyLen: 1.2, bodyR: 0.5 });
    this.neckBob = this.parts.neck;
    this.neckBase = -0.85;
    // 깃털 장식
    this.plume = new THREE.Group();
    this.plume.position.set(-0.05, 0.42, 0);
    const colors = [0xff2a2a, 0xffd700, 0x2a7bff, 0xff2a2a, 0xffd700];
    colors.forEach((c, i) => {
      const f = capsule(0.05, 0.4, toon(c));
      f.position.set(0.02 * i, 0.25, (i - 2) * 0.06);
      f.rotation.z = -0.25 + i * 0.12;
      f.rotation.x = (i - 2) * 0.25;
      this.plume.add(f);
    });
    const base = sphere(0.09, toon(0xffd700));
    this.plume.add(base);
    this.parts.head.add(this.plume);
    // 반짝이 담요 + 안장
    const blanket = box(1.5, 0.12, 1.25, toon(0xffffff, { map: this.sequinTexture() }));
    blanket.position.set(-0.1, 1.98, 0);
    this.body.add(blanket);
    addSaddle(this.body, -0.15, 2.05, 0.9, d.clothColor);
    const cloth = makeNumberCloths(d.number, d.clothColor, 0.6, 0.64);
    cloth.position.set(-0.2, 1.45, 0);
    this.body.add(cloth);
    // 다리 장식 밴드
    this.addLegs([
      { x: 0.85, z: -0.3, w: 0.17, len: 1.2, mat: hide, y: 1.2, hoof: 0xffd700 },
      { x: 0.85, z: 0.3, w: 0.17, len: 1.2, mat: hide, y: 1.2, hoof: 0xffd700 },
      { x: -0.85, z: -0.3, w: 0.17, len: 1.2, mat: hide, y: 1.2, hoof: 0xffd700 },
      { x: -0.85, z: 0.3, w: 0.17, len: 1.2, mat: hide, y: 1.2, hoof: 0xffd700 },
    ]);
    for (const l of this.legs) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 6, 12), toon(0xc41e3a));
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.2;
      l.add(band);
    }
    this.addRider(new THREE.Vector3(-0.15, 2.2, 0));
    this.attachReins(this.parts.head, new THREE.Vector3(0.62, -0.05, 0.16));
    this.bounceAmp = 0.13;
    this.height = 2.5;
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { dt, time, speedNorm } = ctx;
    this.perform = damp(this.perform, ctx.state === 'PERFORMING' ? 1 : 0, 4, dt);
    const p = this.perform;
    // 서커스 퍼포먼스: 뒷발로 일어서서 두 발로 깡충깡충 춤추며 빠르게 전진.
    // 박자(hop)는 속도에 비례하되 1.5~4Hz 로 제한해 춤처럼 보이게 한다.
    const hopHz = THREE.MathUtils.clamp(ctx.speed / 4.5, 1.5, 4);
    this.beat += hopHz * dt * p;
    const beat = this.beat;
    const hop = Math.abs(Math.sin(Math.PI * beat)); // 0(착지)…1(공중), 1회/박자
    const angle = p * 1.05;
    const pivotX = -0.85;
    // Rear around the hind-hoof contact instead of rotating around the body origin.
    this.body.rotation.set(
      Math.sin(Math.PI * beat) * 0.09 * p, // 좌우 흔들기
      Math.sin(Math.PI * beat * 0.5) * 0.05 * p,
      angle + Math.sin(Math.PI * 2 * beat) * 0.04 * p,
    );
    this.body.position.set(pivotX * (1 - Math.cos(angle)), -pivotX * Math.sin(angle) + hop * 0.24 * p, 0);
    this.legs.forEach((leg, i) => {
      leg.rotation.x = 0;
      const knee = leg.getObjectByName(leg.name + '_lower');
      if (i < 2) {
        // 앞다리: 번갈아 허공을 긁듯 흔들기 (i=0 왼쪽, i=1 오른쪽 반박자 차이)
        const ph = Math.PI * beat + i * Math.PI;
        leg.rotation.z = THREE.MathUtils.lerp(leg.rotation.z, 0.55 + Math.sin(ph) * 0.5, p);
        if (knee) knee.rotation.z = THREE.MathUtils.lerp(knee.rotation.z, -1.55 + Math.cos(ph) * 0.35, p);
      } else {
        // 뒷다리: 한 발씩 번갈아 뛰는 프랜스 — 든 발은 무릎을 접고, 딛는 발은 골반을 받친다.
        const ph = Math.PI * 2 * (beat * 0.5 + (i === 2 ? 0 : 0.5));
        const lift = Math.max(0, Math.sin(ph));
        const startZ = leg.rotation.z;
        const startKnee = knee?.rotation.z ?? 0;
        solveLeg(leg, 0.12 * Math.cos(ph) * p, 1.17 - lift * 0.3 * p, 1);
        leg.rotation.z = THREE.MathUtils.lerp(startZ, leg.rotation.z - angle, p);
        if (knee) knee.rotation.z = THREE.MathUtils.lerp(startKnee, knee.rotation.z, p);
      }
    });
    // 머리: 좌우로 까딱, 목은 자랑스럽게 세움. 꼬리는 박자 맞춰 흔들기.
    this.parts.head.rotation.y = Math.sin(Math.PI * beat) * 0.32 * p;
    this.parts.neck.rotation.z = THREE.MathUtils.lerp(this.parts.neck.rotation.z, this.neckBase + 0.4 + Math.sin(Math.PI * 2 * beat) * 0.1, p);
    this.parts.tail.rotation.z = Math.sin(Math.PI * 2 * beat) * 0.35 * p;
    this.plume.rotation.z = Math.sin(time * 5) * 0.07 * speedNorm + Math.sin(Math.PI * 2 * beat) * 0.25 * p;
    const r = this.riders[0];
    if (r.parent === this.body) {
      r.rotation.z -= angle * 0.6;
      r.position.y += hop * 0.05 * p;
    }
  }

  reset(): void {
    super.reset();
    this.perform = 0;
    this.beat = 0;
    this.legs.forEach((leg) => { leg.rotation.x = 0; });
    this.parts.head.rotation.y = 0;
    this.parts.tail.rotation.z = 0;
  }
}

// ================================================================ 10. 트로이 목마 (발에 바퀴)
class TrojanVisual extends PlaceholderVisual {
  private declare wheels: THREE.Mesh[];
  private looseWheel: { obj: THREE.Object3D; vel: THREE.Vector3; spin: number } | null = null;
  private broken = 0;
  private declare hatch: THREE.Mesh;
  private declare soldiers: THREE.Group[];
  private declare soldierLegs: THREE.Group[][];
  private declare soldierArms: THREE.Group[][];
  private declare commandSword: THREE.Group;
  private declare parts: HorseParts;
  private ambush = 0;
  private pushToFinish = false;

  private plankTexture(): THREE.CanvasTexture {
    return canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#9a6b3c';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#8b5e30' : '#a8763f';
        ctx.fillRect(0, i * 32, 256, 30);
        ctx.fillStyle = 'rgba(60,30,10,0.5)';
        ctx.fillRect(0, i * 32 + 30, 256, 2);
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = '#4a2a10';
          ctx.beginPath();
          ctx.arc(20 + k * 44, i * 32 + 15, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }

  protected buildBody(): void {
    this.wheels = [];
    this.soldiers = [];
    this.soldierLegs = [];
    this.soldierArms = [];
    const d = this.def;
    const tex = this.plankTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const wood = toon(0xffffff, { map: tex });
    (wood as THREE.MeshStandardMaterial).roughness = 0.9;
    const woodDark = toon(0x5a3a1c);
    // 각진 목마 몸통 (상자) + 실제 목마처럼 목이 길고 머리가 작음
    const torso = box(2.8, 1.5, 1.2, wood);
    torso.position.set(0, 2.05, 0);
    this.body.add(torso);
    this.parts = buildHorse(this.body, { hide: wood, mane: woodDark, bodyLen: 1.2, bodyR: 0.55, neckLen: 1.2, headScale: 0.9 });
    this.parts.barrel.visible = false;
    this.parts.rump.visible = false;
    // 목 밑동은 몸통 상자 안에 파묻고, 상자에서 목으로 이어지는 나무 블록을 덧댄다
    this.parts.neck.position.set(1.1, 2.55, 0);
    this.parts.neck.rotation.z = -0.55;
    const neckBlock = box(0.9, 1.0, 0.9, wood);
    neckBlock.position.set(1.3, 2.75, 0);
    neckBlock.rotation.z = -0.55;
    this.body.add(neckBlock);
    this.parts.tail.position.set(-1.6, 2.2, 0);
    // 배 쪽 해치 (이벤트 때 열림)
    this.hatch = box(1.2, 0.08, 0.9, woodDark);
    this.hatch.position.set(-0.2, 1.3, 0);
    this.body.add(this.hatch);
    // 뻣뻣한 나무 다리 + 바퀴
    const legSpecs = [
      [1.0, -0.45],
      [1.0, 0.45],
      [-1.0, -0.45],
      [-1.0, 0.45],
    ];
    for (const [x, z] of legSpecs) {
      const leg = box(0.28, 1.25, 0.28, wood);
      leg.position.set(x, 0.95, z);
      this.body.add(leg);
      const w = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 14), woodDark);
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      w.add(tire);
      for (let k = 0; k < 4; k++) {
        const spoke = box(0.6, 0.05, 0.06, toon(0xc9b037));
        spoke.rotation.z = (k * Math.PI) / 4;
        w.add(spoke);
      }
      w.position.set(x, 0.34, z);
      this.body.add(w);
      this.wheels.push(w as unknown as THREE.Mesh);
      this.hoofPoints.push(new THREE.Vector3(x, 0, z));
    }
    // 병사들 (숨어 있다가 이벤트 때 실제 사람 크기로 뒤에서 밀기)
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      g.name = `trojan_soldier_${i}`;
      const uniform = toon(i < 3 ? 0xb03030 : [0xb03030, 0x2a4a9a, 0x8a6a1a][i % 3]);
      const skin = toon(0xf0caad);
      const bodyM = capsule(0.19, 0.55, uniform);
      bodyM.position.y = 1.08;
      g.add(bodyM);
      const head = sphere(0.18, skin);
      head.position.y = 1.65;
      g.add(head);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xc9b037));
      helm.position.y = 1.7;
      g.add(helm);
      const crest = box(0.38, 0.18, 0.06, toon(0xd02020));
      crest.position.y = 1.9;
      g.add(crest);
      const legs: THREE.Group[] = [];
      const arms: THREE.Group[] = [];
      for (const side of [-1, 1]) {
        const hip = new THREE.Group();
        hip.position.set(0, 0.78, side * 0.12);
        const thigh = capsule(0.075, 0.36, uniform);
        thigh.position.y = -0.25;
        hip.add(thigh);
        const knee = new THREE.Group();
        knee.position.y = -0.52;
        const shin = capsule(0.06, 0.32, skin);
        shin.position.y = -0.23;
        knee.add(shin);
        const boot = box(0.22, 0.1, 0.14, toon(0x3a2416));
        boot.position.set(0.06, -0.48, 0);
        knee.add(boot);
        hip.add(knee);
        g.add(hip);
        legs.push(hip);

        const shoulder = new THREE.Group();
        shoulder.position.set(0, 1.34, side * 0.23);
        shoulder.rotation.z = 1.18;
        const arm = capsule(0.06, 0.43, uniform);
        arm.position.y = -0.29;
        shoulder.add(arm);
        const hand = sphere(0.075, skin);
        hand.position.y = -0.57;
        shoulder.add(hand);
        g.add(shoulder);
        arms.push(shoulder);
      }
      const row = Math.floor(i / 3);
      const baseX = -1.75 - row * 0.68;
      const baseZ = ((i % 3) - 1) * 0.55 + (row % 2) * 0.14;
      g.position.set(baseX, 0, baseZ);
      g.userData.pushBaseX = baseX;
      g.userData.pushBaseZ = baseZ;
      g.visible = false;
      this.body.add(g);
      this.soldiers.push(g);
      this.soldierLegs.push(legs);
      this.soldierArms.push(arms);
    }
    addSaddle(this.body, -0.3, 2.85, 1.2, d.clothColor);
    const cloth = makeNumberCloths(d.number, d.clothColor, 0.7, 0.62);
    cloth.position.set(-0.4, 2.0, 0);
    this.body.add(cloth);
    const commander = this.addRider(new THREE.Vector3(-0.3, 2.95, 0));
    // 나폴레옹식 지휘 자세: 오른손 위치에서 검을 전방으로 곧게 겨눈다.
    this.commandSword = new THREE.Group();
    this.commandSword.name = 'trojan_sword';
    this.commandSword.position.set(0.53, 0.35, 0.2);
    this.commandSword.rotation.z = 0.1;
    const steel = new THREE.MeshStandardMaterial({ color: 0xe9edf5, roughness: 0.18, metalness: 0.92 });
    const blade = capsule(0.025, 0.9, steel, 'x');
    blade.position.x = 0.48;
    this.commandSword.add(blade);
    const guard = box(0.05, 0.3, 0.06, toon(0xc9a227));
    guard.position.x = 0.02;
    this.commandSword.add(guard);
    const pommel = sphere(0.05, toon(0xc9a227));
    pommel.position.x = -0.09;
    this.commandSword.add(pommel);
    commander.add(this.commandSword);
    const bicorne = box(0.34, 0.08, 0.28, toon(0x16151a));
    bicorne.position.set(0.39, 0.82, 0);
    bicorne.rotation.z = -0.08;
    commander.add(bicorne);
    this.attachReins(this.parts.head, new THREE.Vector3(0.56, -0.05, 0.15));
    this.wheeled = true;
    this.bounceAmp = 0;
    this.height = 3.4;
  }

  onEvent(type: RaceEventType, ctx: VisualContext): void {
    super.onEvent(type, ctx);
    if (type === 'TWIST_WHEEL_OFF' && !this.looseWheel) {
      this.pushToFinish = true;
      // 앞바퀴 하나가 빠져 굴러감
      const w = this.wheels[0];
      const scene = this.root.parent;
      if (!scene) return;
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      w.getWorldPosition(pos);
      w.getWorldQuaternion(quat);
      w.parent?.remove(w);
      scene.add(w);
      w.position.copy(pos);
      w.quaternion.copy(quat);
      const vel = this.worldForward.clone().multiplyScalar(9);
      vel.y = 2.5;
      vel.addScaledVector(new THREE.Vector3(-this.worldForward.z, 0, this.worldForward.x), 3);
      this.looseWheel = { obj: w, vel, spin: 12 };
    }
  }

  reset(): void {
    super.reset();
    if (this.looseWheel) {
      const w = this.looseWheel.obj;
      w.parent?.remove(w);
      this.body.add(w);
      w.position.set(1.0, 0.34, -0.45);
      w.rotation.set(0, 0, 0);
      this.looseWheel = null;
    }
    this.broken = 0;
    this.ambush = 0;
    this.pushToFinish = false;
  }

  protected updateSpecial(ctx: VisualContext): void {
    const { dt, time, speed } = ctx;
    const rot = (speed * dt) / 0.34;
    this.wheels.forEach((w) => (w.rotation.z -= rot));
    // 빠진 바퀴는 굴러가다 쓰러짐
    if (this.looseWheel) {
      const lw = this.looseWheel;
      lw.vel.y -= 12 * dt;
      lw.obj.position.addScaledVector(lw.vel, dt);
      if (lw.obj.position.y < 0.34) {
        lw.obj.position.y = 0.34;
        lw.vel.y = Math.abs(lw.vel.y) * 0.3;
        lw.vel.x *= 0.96;
        lw.vel.z *= 0.96;
      }
      lw.obj.rotateZ(-lw.spin * dt * Math.min(1, lw.vel.length() / 6));
      if (lw.vel.length() < 0.8) lw.obj.rotation.x = THREE.MathUtils.lerp(lw.obj.rotation.x, 0, dt * 2);
    }
    // 바퀴 빠진 뒤: 몸이 앞으로 기울어 멈춤
    this.broken = damp(this.broken, ctx.state === 'BROKEN' ? 1 : 0, 4, dt);
    this.body.rotation.z += this.broken * 0.12;
    this.body.rotation.x += -this.broken * 0.1;
    const pushedFinish = ctx.state === 'AMBUSH' || (ctx.state === 'FINISHED' && this.pushToFinish);
    this.ambush = damp(this.ambush, pushedFinish ? 1 : 0, 5, dt);
    const a = this.ambush;
    this.hatch.rotation.x = a * 1.4;
    this.hatch.position.y = 1.3 - a * 0.3;
    const army = ctx.extension > 0.5 ? 12 : 6;
    this.soldiers.forEach((s, i) => {
      s.visible = a > 0.1 && i < army;
      const stride = Math.sin(time * 10 + i * 0.72);
      const baseX = s.userData.pushBaseX as number;
      const baseZ = s.userData.pushBaseZ as number;
      // 상체를 앞으로 기울이고 두 손을 목마 뒤판에 댄 채 보폭을 맞춘다.
      s.position.x = baseX - Math.max(0, 1 - a) * 0.75 + Math.abs(stride) * 0.04 * a;
      s.position.z = baseZ;
      s.position.y = Math.abs(stride) * 0.055 * a;
      s.rotation.z = -0.18 * a;
      this.soldierLegs[i].forEach((leg, side) => {
        leg.rotation.z = stride * (side === 0 ? 0.55 : -0.55) * a;
        const knee = leg.children.find((ch) => ch.type === 'Group');
        if (knee) knee.rotation.z = -Math.max(0, stride * (side === 0 ? 1 : -1)) * 0.7 * a;
      });
      this.soldierArms[i].forEach((arm, side) => {
        arm.rotation.z = 1.18 + Math.sin(time * 10 + i + side) * 0.08 * a;
        arm.rotation.x = (side === 0 ? -1 : 1) * 0.08 * a;
      });
    });
    const commander = this.riders[0];
    if (commander?.parent === this.body) commander.rotation.z += a * 0.14;
    this.commandSword.rotation.z = 0.1 + Math.sin(time * 5) * 0.035 * (0.3 + a);
    // 목마는 갤럽 없이 고정, 바퀴만 굴러감 + 나무 덜컹거림(바퀴 회전 주파수의 미세 진동)
    const rattle = ctx.speedNorm * (0.6 + a * 0.6);
    this.body.position.y += Math.sin(time * 23) * 0.012 * rattle + Math.sin(time * 37 + 1) * 0.006 * rattle;
    this.body.rotation.x += Math.sin(time * 19) * 0.01 * rattle;
    this.body.rotation.z += -a * 0.05 + Math.sin(time * 29) * 0.006 * rattle;
  }
}

// ================================================================ GLTF (향후 교체용)
export class GltfRacerVisual implements RacerVisual {
  readonly root = new THREE.Group();
  readonly def: RacerDefinition;
  readonly hoofPoints: THREE.Vector3[] = [new THREE.Vector3(0.8, 0, 0), new THREE.Vector3(-0.8, 0, 0)];
  height = 2.4;
  private fallback: RacerVisual;
  private mixer?: THREE.AnimationMixer;
  private action?: THREE.AnimationAction;
  private model?: THREE.Group;
  private loaded = false;

  constructor(def: RacerDefinition, fallback: RacerVisual) {
    this.def = def;
    this.fallback = fallback;
    this.root.add(fallback.root);
    new GLTFLoader().load(
      def.modelUrl!,
      (gltf) => {
        this.model = gltf.scene;
        this.model.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.frustumCulled = false; // 스키닝 애니메이션은 바운드가 갱신되지 않아 컬링되면 사라짐
          }
        });
        this.model.scale.setScalar(def.modelScale ?? 1);
        this.model.rotation.y = def.modelYaw ?? 0;
        console.info(`[GLTF] ${def.id} 로드 완료 — 클립:`, gltf.animations.map((a) => a.name));
        this.root.remove(fallback.root);
        this.root.add(this.model);
        if (gltf.animations.length) {
          this.mixer = new THREE.AnimationMixer(this.model);
          const clip = THREE.AnimationClip.findByName(gltf.animations, def.runClipName ?? '') ?? gltf.animations[0];
          this.action = this.mixer.clipAction(clip);
          this.action.play();
        }
        this.loaded = true;
      },
      undefined,
      (err) => console.warn(`[GLTF] ${def.id} 로드 실패, placeholder 사용`, err),
    );
  }

  update(ctx: VisualContext): void {
    if (!this.loaded) {
      this.fallback.update(ctx);
      return;
    }
    if (this.action && this.mixer) {
      this.action.timeScale = THREE.MathUtils.lerp(0.7, 2.0, ctx.speedNorm);
      this.mixer.update(ctx.dt);
    }
    if (this.model) {
      this.model.rotation.x = -ctx.cornerWeight * 0.25;
      this.model.position.y = Math.abs(Math.sin(((ctx.time * ctx.speed) / this.def.strideLength) * Math.PI)) * 0.1 * ctx.speedNorm;
    }
  }

  onEvent(type: RaceEventType, ctx: VisualContext): void {
    if (!this.loaded) this.fallback.onEvent(type, ctx);
  }

  reset(): void {
    this.fallback.reset();
  }

  setWorldForward(tan: THREE.Vector3): void {
    this.fallback.setWorldForward(tan);
  }

  dispose(): void {
    this.fallback.dispose();
  }
}

// ================================================================ Factory
export class RacerFactory {
  static createVisual(def: RacerDefinition, allowRig = USE_RIG_ASSETS): RacerVisual {
    let placeholder: RacerVisual;
    switch (def.specialAbility) {
      case 'COSTUME':
        placeholder = new CostumeVisual(def);
        break;
      case 'LONGBODY':
        placeholder = new LongbodyVisual(def);
        break;
      case 'ELEPHANT':
        placeholder = new ElephantVisual(def);
        break;
      case 'COW':
        placeholder = new CowVisual(def);
        break;
      case 'MOTORCYCLE':
        placeholder = new MotorcycleVisual(def);
        break;
      case 'HUMAN':
        placeholder = new HumanVisual(def);
        break;
      case 'GIRAFFE':
        placeholder = new GiraffeVisual(def);
        break;
      case 'CIRCUS':
        placeholder = new CircusVisual(def);
        break;
      case 'TROJAN':
        placeholder = new TrojanVisual(def);
        break;
      default:
        placeholder = new ClassicVisual(def);
    }
    if (def.modelUrl) return new GltfRacerVisual(def, placeholder);
    if (!allowRig) return placeholder;
    // 리깅 GLB 가 있는 캐릭터는 로드 전/실패 시 placeholder 를 폴백으로 쓴다
    switch (def.specialAbility) {
      case 'CLASSIC':
        return new HorseRig(def, placeholder);
      case 'CIRCUS':
        return new CircusRig(def, placeholder);
      case 'MOTORCYCLE':
        return new MotorRig(def, placeholder);
      case 'LONGBODY':
        return new LongbodyRig(def, placeholder);
      case 'ELEPHANT':
        return new ElephantRig(def, placeholder);
      case 'COW':
        return new CowRig(def, placeholder);
      case 'GIRAFFE':
        return new GiraffeRig(def, placeholder);
      case 'COSTUME':
        return new CostumeRig(def, placeholder);
      case 'HUMAN':
        return new HumanRig(def, placeholder);
      case 'TROJAN':
        return new TrojanRig(def, placeholder);
      default:
        return placeholder;
    }
  }

  static exhaustPoints(v: RacerVisual): THREE.Vector3[] {
    return v instanceof MotorcycleVisual || v instanceof MotorRig ? v.exhaustPoints : [];
  }

  static backfiring(v: RacerVisual): boolean {
    return (v instanceof MotorcycleVisual || v instanceof MotorRig) && v.backfiring;
  }

  /** 소 콧구멍 (분노 시 김) — body 로컬 */
  static nostrilPoints(v: RacerVisual): THREE.Vector3[] {
    if (v instanceof CowRig) return v.nostrils;
    if (!(v instanceof CowVisual)) return [];
    // head 로컬 → body 로컬 근사 (머리 위치 기준)
    return v.nostrils.map((p) => new THREE.Vector3(1.9 + p.x * 0.5, 1.75, p.z));
  }

  static trunkTip(v: RacerVisual): THREE.Vector3 | null {
    if (v instanceof ElephantRig) return v.trunkTip(v.trunkTmp);
    return v instanceof ElephantVisual ? v.trunkTip() : null;
  }

  static sweatPoint(v: RacerVisual): THREE.Vector3 | null {
    if (v instanceof HumanRig) return v.isTired ? v.sweatPoint : null;
    return v instanceof HumanVisual && v.isTired ? v.sweatPoint : null;
  }

  static makeStandaloneRider(silks: number, helmet: number): THREE.Group {
    return makeRider(silks, helmet);
  }
}
