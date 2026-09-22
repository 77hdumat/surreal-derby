import * as THREE from 'three';
import type { RacerDefinition } from '../Racer';
import type { RacerVisual, VisualContext } from '../RacerVisual';
import type { RaceEventType } from '../../events/RaceEvent';
import { AnimalVisual } from './AnimalVisual';
import { BoneSocket, AXIS_Z } from './BoneTools';
import { RiderRig, type RiderColors, type RiderPose } from './RiderRig';
import { HORSE_ASSET, RIDER_ASSET_CFG } from './AssetConfigs';

const damp = (cur: number, target: number, k: number, dt: number) => THREE.MathUtils.lerp(cur, target, 1 - Math.exp(-k * dt));

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, seed = 7): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  draw(c.getContext('2d')!, rnd);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 실사풍 골판지: 골 무늬 + 얼룩 + 눌린 자국 + 테이프 + 인쇄 라벨 */
export function cardboardMaterial(label: string, seed = 11): THREE.MeshStandardMaterial {
  const map = canvasTex(
    512,
    512,
    (ctx, rnd) => {
      const g = ctx.createLinearGradient(0, 0, 512, 512);
      g.addColorStop(0, '#c49a62');
      g.addColorStop(1, '#a9804c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
      // 종이 섬유 노이즈
      for (let i = 0; i < 9000; i++) {
        const v = 150 + rnd() * 70;
        ctx.fillStyle = `rgba(${v},${v * 0.78},${v * 0.5},${0.12 + rnd() * 0.12})`;
        ctx.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 1);
      }
      // 골(플루트) — 옆면에서 보이는 줄무늬
      ctx.strokeStyle = 'rgba(90,60,25,0.16)';
      ctx.lineWidth = 2;
      for (let y = 1; y < 512; y += 7) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(512, y);
        ctx.stroke();
      }
      // 얼룩·때
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(${40 + rnd() * 40},${25 + rnd() * 25},10,${0.05 + rnd() * 0.14})`;
        ctx.beginPath();
        ctx.ellipse(rnd() * 512, rnd() * 512, 10 + rnd() * 60, 8 + rnd() * 30, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // 눌린 자국·긁힘
      ctx.strokeStyle = 'rgba(60,35,10,0.45)';
      for (let i = 0; i < 7; i++) {
        ctx.lineWidth = 1 + rnd() * 3;
        ctx.beginPath();
        ctx.moveTo(rnd() * 512, rnd() * 512);
        ctx.lineTo(rnd() * 512, rnd() * 512);
        ctx.stroke();
      }
      // 박스테이프 (반투명 갈색 테이프)
      ctx.fillStyle = 'rgba(150,105,55,0.55)';
      ctx.fillRect(210, 0, 62, 512);
      ctx.fillStyle = 'rgba(255,240,200,0.18)';
      ctx.fillRect(214, 0, 8, 512);
      ctx.fillStyle = 'rgba(150,105,55,0.5)';
      ctx.fillRect(0, 300, 512, 46);
      // 인쇄 라벨: 취급주의·화살표·바코드
      ctx.fillStyle = 'rgba(30,20,10,0.85)';
      ctx.font = 'bold 58px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, 256, 130);
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('FRAGILE  ·  THIS SIDE UP', 256, 175);
      ctx.font = 'bold 60px sans-serif';
      ctx.fillText('↑ ↑', 256, 440);
      for (let x = 40; x < 200; x += 4 + Math.floor(rnd() * 6)) ctx.fillRect(x, 380, 2 + rnd() * 3, 60);
      ctx.strokeStyle = 'rgba(30,20,10,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(330, 370, 140, 90);
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('SIXSHOP', 400, 405);
      ctx.font = '16px sans-serif';
      ctx.fillText('sixshop.com', 400, 432);
    },
    seed,
  );
  const bump = canvasTex(256, 256, (ctx, rnd) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 4) {
      ctx.fillStyle = y % 8 === 0 ? '#9a9a9a' : '#6a6a6a';
      ctx.fillRect(0, y, 256, 2);
    }
    for (let i = 0; i < 3000; i++) {
      const v = 100 + rnd() * 80;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rnd() * 256, rnd() * 256, 2, 1);
    }
  });
  bump.repeat.set(2, 2);
  return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.004, roughness: 0.96, metalness: 0 });
}

/** 낡은 목재: 판자 결 + 옹이 + 못 + 때 */
export function woodMaterial(seed = 3): THREE.MeshStandardMaterial {
  const map = canvasTex(
    1024,
    1024,
    (ctx, rnd) => {
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(0, 0, 1024, 1024);
      // 판자 띠 (수평)
      const plankH = 96;
      for (let y = 0; y < 1024; y += plankH) {
        const tone = 0.85 + rnd() * 0.3;
        ctx.fillStyle = `rgb(${Math.round(128 * tone)},${Math.round(86 * tone)},${Math.round(48 * tone)})`;
        ctx.fillRect(0, y, 1024, plankH - 3);
        // 나뭇결
        for (let i = 0; i < 40; i++) {
          ctx.strokeStyle = `rgba(${40 + rnd() * 30},${22 + rnd() * 18},8,${0.12 + rnd() * 0.25})`;
          ctx.lineWidth = 1 + rnd() * 2;
          ctx.beginPath();
          const yy = y + rnd() * plankH;
          ctx.moveTo(0, yy);
          for (let x = 0; x <= 1024; x += 64) ctx.lineTo(x, yy + Math.sin(x * 0.01 + rnd() * 6) * 4 + (rnd() - 0.5) * 3);
          ctx.stroke();
        }
        // 옹이
        if (rnd() < 0.7) {
          const kx = rnd() * 1024;
          const ky = y + 20 + rnd() * (plankH - 40);
          for (let r = 18; r > 2; r -= 3) {
            ctx.strokeStyle = `rgba(50,28,10,${0.25 + (18 - r) * 0.03})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(kx, ky, r * 1.6, r, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        // 못
        for (let x = 40; x < 1024; x += 128 + rnd() * 80) {
          ctx.fillStyle = '#3a3a3a';
          ctx.beginPath();
          ctx.arc(x, y + 12, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(90,50,20,0.5)';
          ctx.fillRect(x - 3, y + 14, 6, 14);
        }
        // 판자 사이 그림자
        ctx.fillStyle = 'rgba(20,10,4,0.8)';
        ctx.fillRect(0, y + plankH - 3, 1024, 3);
      }
      // 때·물자국
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(30,18,8,${0.04 + rnd() * 0.12})`;
        ctx.beginPath();
        ctx.ellipse(rnd() * 1024, rnd() * 1024, 30 + rnd() * 120, 10 + rnd() * 60, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    seed,
  );
  map.repeat.set(2, 2);
  const bump = canvasTex(256, 256, (ctx, rnd) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 24) {
      ctx.fillStyle = '#4a4a4a';
      ctx.fillRect(0, y, 256, 2);
    }
    for (let i = 0; i < 4000; i++) {
      const v = 110 + rnd() * 60;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rnd() * 256, rnd() * 256, 4 + rnd() * 8, 1);
    }
  });
  bump.repeat.set(4, 4);
  return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.01, roughness: 0.88, metalness: 0 });
}

// ================================================================ 인체 크루 공통 베이스

/**
 * 동물 GLB 없이 인체 리그(RiderRig) 여러 명으로 이루어진 선수 (말탈 브라더스·휴먼 러너).
 * 크루가 전부 로드될 때까지 fallback(절차 생성)을 보여준다.
 */
abstract class CrewVisualBase implements RacerVisual {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly def: RacerDefinition;
  readonly hoofPoints: THREE.Vector3[] = [];
  height: number;
  protected crew: RiderRig[] = [];
  protected fallback: RacerVisual;
  protected loaded = false;
  protected stridePhase = 0;
  protected seed = Math.random() * 100;
  protected worldForward = new THREE.Vector3(1, 0, 0);
  protected impactAge = 10;
  protected impactStrength = 0;
  protected impactSide = 1;
  protected stumble = 0;
  private tmp = new THREE.Vector3();

  constructor(def: RacerDefinition, fallback: RacerVisual, height: number) {
    this.def = def;
    this.fallback = fallback;
    this.height = height;
    this.root.add(fallback.root);
    this.root.add(this.body);
    this.body.visible = false;
  }

  protected addCrew(colors: RiderColors, pos: THREE.Vector3, pivot: 'hips' | 'feet' = 'feet'): RiderRig {
    const r = new RiderRig(RIDER_ASSET_CFG, colors, pivot);
    r.group.position.copy(pos);
    this.body.add(r.group);
    this.crew.push(r);
    this.hoofPoints.push(new THREE.Vector3(), new THREE.Vector3());
    return r;
  }

  /** 크루 전원 로드 직후 한 번 */
  protected onLoaded(): void {}
  protected abstract updateCrew(ctx: VisualContext, ph: number, grounded: boolean): void;

  setWorldForward(tan: THREE.Vector3): void {
    this.worldForward.copy(tan);
    this.fallback.setWorldForward(tan);
  }

  update(ctx: VisualContext): void {
    if (!this.loaded) {
      if (this.crew.length && this.crew.every((r) => r.loaded)) {
        this.loaded = true;
        this.root.remove(this.fallback.root);
        this.body.visible = true;
        this.onLoaded();
      } else {
        this.fallback.update(ctx);
        return;
      }
    }
    const { dt, time } = ctx;
    const st = ctx.state;
    this.impactAge += dt;
    const grounded = st === 'COLLAPSED' || st === 'FALLEN' || st === 'SLEEPING' || st === 'STUBBORN' || st === 'SHOELACE' || st === 'BROKEN' || st === 'PLANTED' || st === 'DANCING';
    const hz = grounded ? 0 : ctx.speed / Math.max(1, this.def.strideLength);
    this.stridePhase = (this.stridePhase + hz * dt + 1) % 1;
    const lean = -ctx.cornerWeight * THREE.MathUtils.clamp((ctx.speed * ctx.speed) / (60 * 9.8), 0, 1) * 0.25;
    const roll = lean + this.impactStrength * this.impactSide * Math.sin(this.impactAge * 12) * Math.exp(-this.impactAge * 7) * 0.13;
    this.stumble = Math.max(0, this.stumble - dt * 1.2);
    this.body.rotation.set(roll, Math.sin(time * 5.3 + this.seed) * 0.01 * ctx.speedNorm, -THREE.MathUtils.clamp(ctx.accel, -8, 8) * 0.003 - this.stumble * 0.12);
    this.body.position.set(0, 0, 0);
    this.updateCrew(ctx, this.stridePhase, grounded);
    // 발 위치 → root 로컬 (먼지)
    this.root.updateWorldMatrix(true, true);
    this.crew.forEach((r, i) => {
      for (const [k, f] of [[0, r.footL], [1, r.footR]] as const) {
        const p = this.hoofPoints[i * 2 + k];
        p.copy(f);
        r.group.localToWorld(p);
        this.root.worldToLocal(p);
        this.tmp.copy(p);
      }
    });
  }

  onEvent(type: RaceEventType, ctx: VisualContext): void {
    if (!this.loaded) {
      this.fallback.onEvent(type, ctx);
      return;
    }
    if (type === 'TRIP' || type === 'COLLISION' || type === 'BUMP') {
      this.impactAge = 0;
      this.impactStrength = type === 'BUMP' ? 0.45 : 1;
      this.impactSide = ctx.bumpDir || ctx.sideHint || 1;
      this.stumble = type === 'TRIP' ? 0.8 : 0.18;
    }
  }

  reset(): void {
    this.fallback.reset();
    this.stridePhase = 0;
    this.stumble = 0;
    this.impactAge = 10;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  dispose(): void {
    this.fallback.dispose();
    for (const r of this.crew) r.dispose();
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

// ================================================================ 1. 말탈 브라더스
export class CostumeRig extends CrewVisualBase {
  private shell = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private collapse = 0;
  private carry = 0;
  private liftT = 99;
  private carryFinishPose = false;

  constructor(def: RacerDefinition, fallback: RacerVisual) {
    super(def, fallback, 2.4);
    // 앞사람(머리 담당)·뒷사람(엉덩이 담당) — 청바지에 운동화, 상의는 탈 속이라 안 보임
    this.addCrew({ silks: 0xe84c3d, sleeves: 0xe84c3d, helmet: 0x222222, breeches: 0x3b5ba5, boots: 0xf2f2f2, bareHead: true }, new THREE.Vector3(0.55, 0, 0));
    this.addCrew({ silks: 0x3d7be8, sleeves: 0x3d7be8, helmet: 0x6b3a1e, breeches: 0x2e4a8a, boots: 0xf2f2f2, bareHead: true }, new THREE.Vector3(-0.6, 0, 0));
    this.buildShell();
  }

  private buildShell(): void {
    const d = this.def;
    const cardBody = cardboardMaterial('취급주의', 11);
    const cardHead = cardboardMaterial('말', 23);
    const cardPlain = cardboardMaterial('', 37);
    const box = (w: number, h: number, dp: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const shell = this.shell;
    shell.name = 'costume_shell';
    const torso = box(2.5, 1.15, 1.0, cardBody);
    torso.position.set(0, 1.5, 0);
    torso.rotation.z = 0.03;
    shell.add(torso);
    for (const sgn of [-1, 1]) {
      const flap = box(1.1, 0.03, 0.5, cardPlain);
      flap.position.set(sgn * 0.6, 2.1, sgn * 0.25);
      flap.rotation.x = sgn * 0.5;
      shell.add(flap);
    }
    this.neck.position.set(1.1, 1.85, 0);
    this.neck.rotation.z = -0.75;
    const neckBox = box(0.6, 1.0, 0.55, cardPlain);
    neckBox.position.y = 0.45;
    this.neck.add(neckBox);
    this.head.position.set(0.05, 0.95, 0);
    this.head.rotation.z = 0.95;
    const headBox = box(1.0, 0.55, 0.6, cardHead);
    headBox.position.x = 0.35;
    this.head.add(headBox);
    const snout = box(0.35, 0.4, 0.45, cardPlain);
    snout.position.set(0.95, -0.05, 0);
    this.head.add(snout);
    for (const sgn of [-1, 1]) {
      const ear = box(0.04, 0.4, 0.18, cardPlain);
      ear.position.set(0.05, 0.45, sgn * 0.22);
      ear.rotation.x = sgn * 0.3;
      this.head.add(ear);
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      eye.position.set(0.55, 0.12, sgn * 0.301);
      eye.rotation.y = sgn > 0 ? 0 : Math.PI;
      this.head.add(eye);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      pupil.position.set(0.58, 0.1, sgn * 0.302);
      pupil.rotation.y = sgn > 0 ? 0 : Math.PI;
      this.head.add(pupil);
    }
    this.neck.add(this.head);
    shell.add(this.neck);
    const tail = box(0.04, 0.7, 0.12, cardPlain);
    tail.position.set(-1.35, 1.5, 0);
    tail.rotation.z = 0.5;
    shell.add(tail);
    const skirt = box(2.3, 0.25, 1.0, cardPlain);
    skirt.position.set(0, 0.98, 0);
    shell.add(skirt);
    // 번호천
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#' + d.clothColor.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 16);
    ctx.fillRect(0, 112, 128, 16);
    ctx.font = 'bold 84px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#000';
    ctx.strokeText(String(d.number), 64, 66);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(d.number), 64, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.54), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      m.rotation.y = side > 0 ? 0 : Math.PI;
      m.position.set(-0.4, 1.45, side * 0.505);
      shell.add(m);
    }
    this.body.add(shell);
  }

  onEvent(type: RaceEventType, ctx: VisualContext): void {
    super.onEvent(type, ctx);
    if (type === 'COSTUME_COLLAPSE' || type === 'COSTUME_RECOVER') this.carryFinishPose = false;
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
    this.crew.forEach((r, i) => {
      r.group.position.set(i === 0 ? 0.55 : -0.6, 0, 0);
      r.group.rotation.set(0, 0, 0);
    });
  }

  protected updateCrew(ctx: VisualContext, ph: number, grounded: boolean): void {
    const { time, speedNorm, dt } = ctx;
    const target = ctx.state === 'COLLAPSED' ? 1 : ctx.state === 'RECOVERING' ? 0.35 : 0;
    this.collapse = damp(this.collapse, target, ctx.state === 'COLLAPSED' ? 9 : 3, dt);
    const carrying = ctx.state === 'CARRYING' || (ctx.state === 'FINISHED' && this.carryFinishPose);
    this.carry = damp(this.carry, carrying ? 1 : 0, 6, dt);
    const c = this.collapse;
    const k = this.carry;
    this.liftT += dt;
    const energy = grounded ? 0 : speedNorm;
    // 두 사람의 발걸음 (앞사람과 뒷사람 위상이 어긋남)
    const lifts = this.crew.map((r, i) => {
      const p = ph * 2 + i * 0.3;
      const mode = c > 0.3 ? 'lie' : k > 0.02 ? 'lift' : 'run';
      const lift = r.animate({ mode, ph: p, energy: mode === 'lie' ? 0 : energy, time, lean: mode === 'lift' ? 0.1 : 0.2, armRaise: THREE.MathUtils.smoothstep(this.liftT, 0, 0.9) });
      const base = i === 0 ? 0.55 : -0.6;
      if (c > 0.05) {
        // 쓰러진 탈에서 튀어나와 바닥에 널브러짐
        r.group.position.set(base + (i === 0 ? 0.3 : -0.3) * c, 0.2 * c, -0.7 * c);
        r.group.rotation.set(0, (i === 0 ? 0.3 : -0.3) * c, (i === 0 ? 1.3 : -1.3) * c);
      } else {
        r.group.position.set(base, lift, 0);
        r.group.rotation.set(0, 0, 0);
      }
      return lift;
    });
    if (k > 0.02) {
      // 1단계(~0.9초): 멈춰 서서 팔을 번쩍 들어 탈을 머리 위로 → 2단계: 상체 드러낸 채 전력질주
      const lift = THREE.MathUtils.smoothstep(this.liftT, 0, 0.9);
      // 상자 바닥(쉘 로컬 y≈0.86)이 두 사람의 손 높이에 얹히도록
      let handY = 0;
      this.crew.forEach((r) => {
        handY = Math.max(handY, r.group.position.y + Math.max(r.handL.y, r.handR.y));
      });
      const restY = (lifts[0] + lifts[1]) * 0.5;
      this.shell.position.y = THREE.MathUtils.lerp(restY, Math.max(restY, handY - 0.86 + 0.02), k * lift);
      this.shell.rotation.set(Math.sin(time * 14) * 0.06 * k, 0, k * 0.1 + Math.sin(time * 9) * 0.03 * k);
      this.head.rotation.z = 0.95 + k * 0.5;
      return;
    }
    const wob = energy * (1 - c);
    const step = ph * 2;
    const frontBob = lifts[0];
    const rearBob = lifts[1];
    this.shell.position.y = THREE.MathUtils.lerp((frontBob + rearBob) * 0.5, 0.3, c);
    this.shell.rotation.z = (rearBob - frontBob) * 0.55 + Math.sin(time * 2.1 + this.seed) * 0.02 * wob + c * 0.06;
    this.shell.rotation.x = Math.sin(Math.PI * 2 * step) * 0.045 * wob + Math.sin(time * 1.7) * 0.015 * wob + c * 1.34;
    this.shell.rotation.y = Math.sin(Math.PI * 2 * step + 0.6) * 0.02 * wob - c * 0.08;
    this.head.rotation.z = 0.95 + Math.sin(Math.PI * 2 * step - 0.9) * 0.14 * wob + c * 0.18;
    this.neck.rotation.z = -0.75 + Math.sin(Math.PI * 2 * step - 1.2) * 0.06 * wob - c * 0.12;
  }
}

/** 업힌 자세: 상체 앞으로, 팔을 앞 아래로 뻗어 러너의 어깨를 잡는다 */
const PIGGYBACK_POSE: RiderPose = {
  lean: 0.7,
  thigh: 1.35,
  knee: 1.9,
  armForward: 0.75,
  armDown: 0.18,
  elbow: 0.55,
  headUp: 0.45,
  thighSpread: 0.3,
};

// ================================================================ 6. 휴먼 러너
export class HumanRig extends CrewVisualBase {
  private runner: RiderRig;
  private jockey: RiderRig;
  private bipedal = 0;
  private tired = 0;
  private kneel = 0;
  sweatPoint = new THREE.Vector3(0.6, 1.1, 0);

  constructor(def: RacerDefinition, fallback: RacerVisual) {
    super(def, fallback, 1.4);
    // 러너: 티셔츠(clothColor)·반바지·운동화, 맨머리
    this.runner = this.addCrew({ silks: def.clothColor, sleeves: def.clothColor, helmet: 0, breeches: 0x2b2b33, boots: 0xf0f0f0, bareHead: true }, new THREE.Vector3(0, 0.55, 0), 'hips');
    // 등에 탄 기수: 고삐 대신 달리는 사람의 어깨를 붙잡는다
    this.jockey = this.addCrew({ silks: def.silksColor, sleeves: def.clothColor, helmet: def.clothColor }, new THREE.Vector3(-0.2, 0.75, 0), 'hips');
    this.jockey.setPose(PIGGYBACK_POSE);
  }

  get isTired(): boolean {
    return this.tired > 0.5;
  }

  protected updateCrew(ctx: VisualContext, ph: number, grounded: boolean): void {
    const { dt, time, speedNorm } = ctx;
    const st = ctx.state;
    this.bipedal = damp(this.bipedal, st === 'BIPEDAL' ? 1 : 0, 5, dt);
    this.tired = damp(this.tired, st === 'EXHAUSTED' ? 1 : 0, 3, dt);
    this.kneel = damp(this.kneel, st === 'SHOELACE' ? 1 : 0, 6, dt);
    const b = this.bipedal;
    const energy = grounded ? 0 : speedNorm * (1 - this.tired * 0.5);
    const mode = b > 0.5 ? 'run' : 'crawl';
    // 기는 사람: 골반 높이 ~0.62m. 두 발 달리기: 서서.
    const lift = this.runner.animate({ mode, ph, energy: this.kneel > 0.5 ? 0 : energy, time, lean: 0.35 + this.tired * 0.2 });
    // 골반 높이: 네발 0.55m → 두 발 0.88m
    this.runner.group.position.set(0, THREE.MathUtils.lerp(0.55, 0.88, b) + lift - this.kneel * 0.25, 0);
    this.runner.group.rotation.set(0, 0, -this.kneel * 0.6 - this.tired * (1 - b) * 0.1);
    // 기수: 기는 등 위에 앉음 → 두 발이면 업힌 자세(등 뒤 높이)
    const seatY = THREE.MathUtils.lerp(0.74, 1.15, b) + lift;
    const seatX = THREE.MathUtils.lerp(-0.22, -0.4, b);
    this.jockey.group.position.set(seatX, seatY - this.kneel * 0.25, 0);
    this.jockey.group.rotation.set(0, 0, THREE.MathUtils.lerp(0, 0.25, b));
    this.jockey.animate({ mode: 'ride', ph, energy, time });
    this.height = THREE.MathUtils.lerp(1.4, 2.2, b);
    this.sweatPoint.set(0.6 + b * 0.1, THREE.MathUtils.lerp(1.0, 1.6, b), 0);
  }
}

const WHEEL_R = 0.85;

// ================================================================ 10. 트로이 목마
/**
 * 실사 말 GLB 를 나무 조형물로: 털·안장 숨기고 판자 재질, 바인드 포즈 고정(rigid), 발굽에 바퀴.
 * 배 아래 문이 열리면 청동 갑옷 병사(인체 리그)들이 뒤로 나와 밀며 달린다.
 */
export class TrojanRig extends AnimalVisual {
  private wheels: THREE.Mesh[] = [];
  private looseWheel: { obj: THREE.Object3D; vel: THREE.Vector3; spin: number } | null = null;
  private broken = 0;
  private ambush = 0;
  private pushToFinish = false;
  private hatch?: THREE.Mesh;
  private soldiers: RiderRig[] = [];
  private sword?: THREE.Group;

  constructor(def: RacerDefinition, fallback: RacerVisual) {
    super(
      def,
      {
        ...HORSE_ASSET,
        // 전설의 목마: 5.5m 급 조형물
        fitHeight: 5.5,
        height: 6.5,
        rigid: true,
        clips: {},
        hideMeshes: ['Cornea', 'Saddle', 'Horseshoe'],
        seat: { bone: 'chest', offset: [-1.7, 1.15, 0] }, // 지휘관은 목마 등 뒤쪽에 (목·몸통과 안 겹치게)
        bit: undefined,
        numberCloth: { bone: 'spine', offset: [-0.4, 0.1, 0], size: 1.2, halfWidth: 1.3 },
      },
      fallback,
    );
  }

  protected buildDecor(): void {
    const wood = woodMaterial(5);
    this.model!.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      m.material = wood;
    });
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.45, metalness: 0.85 });
    // 바퀴: 네 발굽 소켓
    for (const f of ['legBL_foot', 'legBR_foot'] as const) {
      // 뒷발 두 개에만 바퀴 (앞다리는 페라리 프랜싱 호스처럼 들고 있다). 소켓이 pivot 자세를 잡고 안쪽 그룹이 굴러간다
      const pivot = new THREE.Group();
      const w = new THREE.Group();
      pivot.add(w);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 28), woodMaterial(9));
      disc.rotation.x = Math.PI / 2;
      disc.castShadow = true;
      w.add(disc);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.05, 8, 32), iron);
      w.add(rim);
      for (let i = 0; i < 4; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(WHEEL_R * 1.9, 0.09, 0.28), iron);
        spoke.rotation.z = (i / 4) * Math.PI;
        w.add(spoke);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.36, 12), iron);
      hub.rotation.x = Math.PI / 2;
      w.add(hub);
      this.socket(f, pivot, [0.05, WHEEL_R * 0.75, 0]);
      this.wheels.push(w as unknown as THREE.Mesh);
    }
    // 배 문 (경첩: 앞쪽)
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.4), woodMaterial(13));
    hatch.geometry.translate(-1.1, 0, 0);
    hatch.castShadow = true;
    this.hatch = hatch;
    const hinge = new THREE.Group();
    hinge.add(hatch);
    this.socket('spine', hinge, [1.1, -1.3, 0]);
    // 지휘관 검
    const sword = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.75, 0.08), new THREE.MeshStandardMaterial({ color: 0xe6eaee, roughness: 0.25, metalness: 0.7, emissive: 0x334455, emissiveIntensity: 0.25 }));
    blade.position.y = 0.45;
    sword.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.22), iron);
    guard.position.y = 0.1;
    sword.add(guard);
    this.sword = sword;
    // 병사 12명: 청동 흉갑·붉은 튜닉·코린트식 투구
    for (let i = 0; i < 8; i++) {
      const s = new RiderRig(RIDER_ASSET_CFG, { silks: 0xb08d57, sleeves: 0xd9b27a, helmet: 0xb08d57, breeches: 0x8b1a1a, boots: 0x5a3a1e }, 'feet');
      const row = Math.floor(i / 4);
      const col = i % 4;
      s.group.position.set(-4.6 - row * 0.9, 0, (col - 1.5) * 0.7);
      s.group.userData.baseX = s.group.position.x;
      s.group.userData.baseZ = s.group.position.z;
      s.group.visible = false;
      this.body.add(s.group);
      this.soldiers.push(s);
    }
  }

  private footTmp = new THREE.Vector3();

  protected updateSpecial(ctx: VisualContext, ph: number): void {
    const { dt, time, speed } = ctx;
    // 프랜싱 호스: 골반 축으로 몸을 세우고 앞다리는 접어 올리고, 뒷다리는 수직으로 서서 바퀴를 딛는다
    const rear = 0.75;
    this.rot('root', AXIS_Z, rear);
    for (const [up, lo] of [['legBL_upper', 'legBL_lower'], ['legBR_upper', 'legBR_lower']] as const) {
      this.rot(up, AXIS_Z, -rear * 0.9);
      this.rot(lo, AXIS_Z, 0.15);
    }
    for (const [up, lo, ft, i] of [['legFL_upper', 'legFL_lower', 'legFL_foot', 0], ['legFR_upper', 'legFR_lower', 'legFR_foot', 1]] as const) {
      this.rot(up, AXIS_Z, 0.95 - i * 0.25);
      this.rot(lo, AXIS_Z, -1.55 + i * 0.2);
      this.rot(ft, AXIS_Z, -0.4);
    }
    // 바인드 포즈는 고개를 숙이고 있으므로 목을 들어 당당하게
    this.rot('neck0', AXIS_Z, 0.45);
    this.rot('neck1', AXIS_Z, 0.3);
    this.rot('head', AXIS_Z, 0.35);
    // 뒷발 바퀴가 지면에 닿도록 몸 전체를 들어 올린다
    const foot = this.bones.legBL_foot;
    if (foot) {
      this.body.updateWorldMatrix(true, true);
      foot.getWorldPosition(this.footTmp);
      this.body.worldToLocal(this.footTmp);
      this.body.position.y += WHEEL_R * 0.25 - this.footTmp.y;
    }
    const rot = (speed * dt) / WHEEL_R;
    this.wheels.forEach((w) => (w.rotation.z -= rot));
    if (this.looseWheel) {
      const lw = this.looseWheel;
      lw.vel.y -= 12 * dt;
      lw.obj.position.addScaledVector(lw.vel, dt);
      if (lw.obj.position.y < WHEEL_R) {
        lw.obj.position.y = WHEEL_R;
        lw.vel.y = Math.abs(lw.vel.y) * 0.3;
        lw.vel.x *= 0.96;
        lw.vel.z *= 0.96;
      }
      lw.obj.rotateZ(-lw.spin * dt * Math.min(1, lw.vel.length() / 6));
      if (lw.vel.length() < 0.8) lw.obj.rotation.x = THREE.MathUtils.lerp(lw.obj.rotation.x, 0, dt * 2);
    }
    this.broken = damp(this.broken, ctx.state === 'BROKEN' ? 1 : 0, 4, dt);
    this.body.rotation.z += this.broken * 0.1;
    this.body.rotation.x += -this.broken * 0.08;
    const pushed = ctx.state === 'AMBUSH' || (ctx.state === 'FINISHED' && this.pushToFinish);
    this.ambush = damp(this.ambush, pushed ? 1 : 0, 5, dt);
    const a = this.ambush;
    if (this.hatch) this.hatch.rotation.z = -a * 1.3; // 앞 경첩을 축으로 아래로 열림
    if (this.sword && this.rider) {
      // 지휘관 오른손에 검: 손 위치를 따라가고 위로 치켜든다
      if (this.sword.parent !== this.rider.group) this.rider.group.add(this.sword);
      this.sword.position.copy(this.rider.handR);
      this.sword.rotation.set(0, 0, 0.35 + Math.sin(time * 5) * 0.06 * (0.3 + a));
    }
    const army = ctx.extension > 0.5 ? 8 : 5;
    this.soldiers.forEach((s, i) => {
      if (!s.loaded) return;
      const visible = a > 0.05 && i < army;
      s.group.visible = visible;
      if (!visible) return;
      // 문에서 쏟아져 나와(앞쪽 x≈0.3 아래) 뒤 대형으로 이동
      const out = THREE.MathUtils.clamp((a - 0.05) / 0.6, 0, 1);
      const baseX = s.group.userData.baseX as number;
      const baseZ = s.group.userData.baseZ as number;
      const lift = s.animate({ mode: 'push', ph: ph * 2 + i * 0.17, energy: Math.max(0.3, ctx.speedNorm), time });
      // body 는 뒷발 서기로 들려 있으므로 그만큼 내려 병사 발이 땅에 닿게 한다
      s.group.position.set(THREE.MathUtils.lerp(0.3, baseX, out), lift - this.body.position.y, THREE.MathUtils.lerp(0, baseZ, out));
    });
    // 나무 덜컹거림
    const rattle = ctx.speedNorm * (0.6 + a * 0.6);
    this.body.position.y += Math.sin(time * 23) * 0.012 * rattle + Math.sin(time * 37 + 1) * 0.006 * rattle;
    this.body.rotation.x += Math.sin(time * 19) * 0.01 * rattle;
    this.body.rotation.z += -a * 0.04 + Math.sin(time * 29) * 0.006 * rattle;
  }

  onEvent(type: RaceEventType, ctx: VisualContext): void {
    super.onEvent(type, ctx);
    if (!this.loaded) return;
    if (type === 'TWIST_WHEEL_OFF' && !this.looseWheel && this.wheels.length) {
      this.pushToFinish = true;
      const w = this.wheels[0].parent!; // pivot
      const scene = this.root.parent;
      if (!scene) return;
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      w.getWorldPosition(pos);
      w.getWorldQuaternion(quat);
      this.sockets = this.sockets.filter((s) => s.obj !== w);
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
      w.rotation.set(0, 0, 0);
      const b = this.bones.legBL_foot;
      if (b) {
        // 소켓 재부착
        this.sockets.push(new BoneSocket(b, this.body, w, new THREE.Vector3(0.05, WHEEL_R * 0.75, 0)));
      }
      this.looseWheel = null;
    }
    this.broken = 0;
    this.ambush = 0;
    this.pushToFinish = false;
    for (const s of this.soldiers) s.group.visible = false;
  }
}
