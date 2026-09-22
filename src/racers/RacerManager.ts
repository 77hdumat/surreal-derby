import * as THREE from 'three';
import { RACER_DEFINITIONS } from './RacerDefinitions';
import { RacerFactory } from './RacerFactory';
import type { RacerVisual, VisualContext } from './RacerVisual';
import type { RacerDefinition } from './Racer';
import type { TrackGeometry } from '../track/TrackGeometry';
import type { ParticleManager } from '../effects/ParticleManager';
import { whenAssetsIdle } from './rig/Assets';
import type { Footprints } from '../effects/Footprints';
import type { KartParams, KartState } from '../game/KartPhysics';
import type { RacerStatus } from '../game/RaceState';
import type { SpecialAbility } from './Racer';
import type { SlotConfig } from '../game/KartRace';
import { jockeyById } from './Jockeys';
import { BoostFlame } from '../effects/BoostFlame';

/**
 * KartState(x/z/yaw/speed…) → 슬롯별 RacerVisual 배치·애니메이션·파티클.
 * 부팅 시 9종을 전부 한 번 만들어(숨김) 리깅 에셋을 미리 올리고, 레이스마다 슬롯 구성에 맞춰 새로 만든다.
 */
export class RacerManager {
  /** 슬롯 순 비주얼 */
  visuals: RacerVisual[] = [];
  defs: RacerDefinition[] = [];
  private preload: RacerVisual[] = [];
  private track: TrackGeometry;
  private scene: THREE.Scene;
  private particles: ParticleManager;
  private ctx: VisualContext[] = [];
  private dustPhase: number[] = [];
  private wasBoosting: boolean[] = [];
  private flames: BoostFlame[] = [];
  private exhaustTimer = 0;
  private tmpTan = new THREE.Vector3();
  private tmpBack = new THREE.Vector3();
  private tmpHoof = new THREE.Vector3();
  private tmpFoot = new THREE.Vector3();
  /** 발자국 데칼 (Game 이 주입) */
  footprints: Footprints | null = null;

  constructor(scene: THREE.Scene, track: TrackGeometry, particles: ParticleManager) {
    this.scene = scene;
    this.track = track;
    this.particles = particles;
    for (const def of RACER_DEFINITIONS) {
      const v = RacerFactory.createVisual(def);
      v.root.visible = false;
      scene.add(v.root);
      this.preload.push(v);
    }
  }

  /** 리깅 에셋(모델·기수·병사)이 전부 인스턴스화될 때까지 대기 */
  async whenReady(): Promise<void> {
    // 로드 완료 콜백 안에서 새 인스턴스(기수 등)를 추가로 요청하므로, 큐가 비어도 한 번 더 확인한다
    for (let i = 0; i < 6; i++) {
      await whenAssetsIdle();
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  /** 프리로드용 비주얼 정리 (첫 레이스 준비 뒤) */
  dropPreload(): void {
    for (const v of this.preload) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.preload = [];
  }

  private makeCtx(): VisualContext {
    return {
      dt: 0,
      time: 0,
      speedNorm: 0,
      speed: 0,
      accel: 0,
      state: 'IDLE',
      stateTimer: 0,
      cornerWeight: 0,
      boost: 0,
      bump: 0,
      bumpDir: 0,
      riderless: false,
      distanceToFinish: 9999,
      sideHint: 1,
      extension: 0,
      lateralVel: 0,
      extensionMax: 0,
    };
  }

  /** 슬롯 구성대로 비주얼 생성 (기수 색 주입). 에셋 인스턴스화까지 대기 */
  async setLineup(slots: SlotConfig[]): Promise<void> {
    this.clear();
    slots.forEach((cfg, i) => {
      const base = RACER_DEFINITIONS.find((d) => d.id === cfg.mountId) ?? RACER_DEFINITIONS[0];
      const j = jockeyById(cfg.jockeyId);
      const def: RacerDefinition = { ...base, number: i + 1, name: cfg.name, silksColor: j.silks, clothColor: j.cloth };
      const v = RacerFactory.createVisual(def);
      this.scene.add(v.root);
      this.visuals.push(v);
      this.defs.push(def);
      this.ctx.push(this.makeCtx());
      this.dustPhase.push(Math.random());
      this.wasBoosting.push(false);
      // 부스트 화염: 몸통 뒤 아래쪽에서 뒤로
      const flame = new BoostFlame(4.4, 1.5);
      flame.group.position.set(-v.height * 0.55 - 0.2, Math.max(0.45, v.height * 0.28), 0);
      v.root.add(flame.group);
      this.flames.push(flame);
    });
    await this.whenReady();
  }

  clear(): void {
    for (const f of this.flames) f.dispose();
    this.flames = [];
    for (const v of this.visuals) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.visuals = [];
    this.defs = [];
    this.ctx = [];
    this.dustPhase = [];
    this.wasBoosting = [];
  }

  /** 부스트 중 말별 특수 연출 상태 (관람 모드의 이벤트 연출 재사용) */
  static boostState(ability: SpecialAbility): RacerStatus {
    switch (ability) {
      case 'COSTUME':
        return 'CARRYING'; // 말탈을 벗어 들고 사람 다리로 전력 질주
      case 'TROJAN':
        return 'AMBUSH'; // 병사들이 나와 뒤에서 밀어준다
      case 'ELEPHANT':
        return 'SPRAYING'; // 물을 뿜으며 돌진
      case 'HUMAN':
        return 'BIPEDAL'; // 갑자기 두 발로 달린다
      case 'COW':
        return 'RAGING'; // 분노 + 투우사 기수
      case 'CIRCUS':
        return 'PERFORMING'; // 뒷발로 깡충깡충
      default:
        return 'BOOSTING';
    }
  }

  reset(): void {
    for (const v of this.visuals) v.reset();
  }

  worldPosition(slot: number, out = new THREE.Vector3()): THREE.Vector3 {
    const v = this.visuals[slot];
    return v ? out.copy(v.root.position) : out.set(0, 0, 0);
  }

  bump(slot: number, big: boolean): void {
    const v = this.visuals[slot];
    if (!v) return;
    v.onEvent(big ? 'COLLISION' : 'BUMP', this.ctx[slot]);
    this.particles.impact(v.root.position.clone().setY(0.4), big ? 1.2 : 0.6);
  }

  boostFx(slot: number): void {
    const v = this.visuals[slot];
    if (!v) return;
    const ab = this.defs[slot].specialAbility;
    const ev = ab === 'COSTUME' ? 'COSTUME_CARRY' : ab === 'TROJAN' ? 'TROJAN_AMBUSH' : ab === 'ELEPHANT' ? 'ELEPHANT_SPRAY' : ab === 'HUMAN' ? 'HUMAN_BIPEDAL' : ab === 'COW' ? 'COW_RAGE' : ab === 'CIRCUS' ? 'CIRCUS_ACT' : ab === 'MOTORCYCLE' ? 'MOTORCYCLE_BOOST' : ab === 'LONGBODY' ? 'LONGBODY_STRETCH' : ab === 'GIRAFFE' ? 'GIRAFFE_MEGA_NECK' : 'SUPER_SPRINT';
    v.onEvent(ev, this.ctx[slot]);
    if (ab === 'COW') v.onEvent('BULL_TOSS', this.ctx[slot]); // 뿔 치켜올리며 돌진 시작
  }

  private boostEndFx(slot: number): void {
    const v = this.visuals[slot];
    if (!v) return;
    const ab = this.defs[slot].specialAbility;
    if (ab === 'COSTUME') v.onEvent('COSTUME_RECOVER', this.ctx[slot]); // 말탈 다시 뒤집어쓰기
    if (ab === 'LONGBODY') v.onEvent('LONGBODY_RETRACT', this.ctx[slot]);
  }

  miniFx(slot: number): void {
    const v = this.visuals[slot];
    if (!v) return;
    this.tmpHoof.set(-v.height * 0.5, 0.4, 0).applyMatrix4(v.root.matrixWorld);
    this.tmpBack.set(-Math.cos(v.root.rotation.y), 0, Math.sin(v.root.rotation.y));
    for (let i = 0; i < 4; i++) this.particles.ember(this.tmpHoof, this.tmpBack);
  }

  place(slot: number, k: KartState): void {
    const v = this.visuals[slot];
    if (!v) return;
    v.root.position.set(k.x, 0, k.z);
    v.root.rotation.y = k.yaw;
    v.root.updateMatrixWorld();
    this.tmpTan.set(Math.cos(k.yaw), 0, -Math.sin(k.yaw));
    v.setWorldForward(this.tmpTan);
  }

  update(karts: KartState[], params: KartParams[], dt: number, time: number, cameraPos: THREE.Vector3): void {
    this.exhaustTimer += dt;
    const doExhaust = this.exhaustTimer > 0.05;
    if (doExhaust) this.exhaustTimer = 0;
    for (let i = 0; i < this.visuals.length; i++) {
      const k = karts[i];
      const p = params[i];
      const v = this.visuals[i];
      if (!k || !p) continue;
      this.place(i, k);
      const ctx = this.ctx[i];
      const def = this.defs[i];
      ctx.dt = dt;
      ctx.time = time;
      ctx.speed = Math.abs(k.speed);
      ctx.speedNorm = THREE.MathUtils.clamp(Math.abs(k.speed) / p.maxSpeed, 0, 1.3);
      ctx.accel = k.lastAccel;
      const boosting = k.boostT > 0 && !k.finished;
      if (boosting !== this.wasBoosting[i]) {
        this.wasBoosting[i] = boosting;
        if (!boosting) this.boostEndFx(i);
      }
      ctx.state = k.finished ? 'FINISHED' : boosting ? RacerManager.boostState(def.specialAbility) : Math.abs(k.speed) > 0.3 ? 'RUNNING' : 'IDLE';
      // 롱바디·기린은 몸/목 늘어남으로 표현
      const stretchy = def.specialAbility === 'LONGBODY' || def.specialAbility === 'GIRAFFE';
      ctx.extension = stretchy ? THREE.MathUtils.lerp(ctx.extension, boosting ? 1 : 0, Math.min(1, dt * 4)) : 0;
      ctx.extensionMax = stretchy ? (def.specialAbility === 'GIRAFFE' ? 6 : 9) : 0; // 롱바디는 몸이 확 길어진다
      ctx.stateTimer = k.boostT;
      ctx.cornerWeight = Math.max(this.track.cornerWeight(k.s), Math.abs(k.slip) / 0.45);
      ctx.boost = THREE.MathUtils.lerp(ctx.boost, k.boostT > 0 ? 1 : k.miniT > 0 ? 0.5 : 0, Math.min(1, dt * 6));
      const flame = this.flames[i];
      if (flame) {
        const want = k.finished ? 0 : k.boostT > 0 ? 1 : k.miniT > 0 ? 0.55 : 0;
        flame.setIntensity(THREE.MathUtils.lerp(flame.value, want, Math.min(1, dt * (want > flame.value ? 12 : 5))));
        flame.update(time + i * 1.7);
      }
      ctx.bump = k.bumpT;
      ctx.bumpDir = k.bumpDir;
      ctx.distanceToFinish = k.finished ? -50 : 9999;
      // 슬립각 → 몸 기준 횡속도 (+ = 오른쪽). 오른쪽 드리프트(slip>0)는 코가 진행 방향보다 오른쪽 → 몸은 왼쪽으로 미끄러짐
      ctx.lateralVel = THREE.MathUtils.lerp(ctx.lateralVel, -Math.sin(k.slip) * k.speed, 0.25);
      v.update(ctx);

      const distToCam = v.root.position.distanceTo(cameraPos);
      if (distToCam > 140 || Math.abs(k.speed) < 2) continue;
      this.tmpBack.copy(this.tmpTan).negate();
      const strength = THREE.MathUtils.clamp(Math.abs(k.speed) / 18, 0, 1.5) * (k.drifting ? 2.2 : 1);
      if (def.specialAbility === 'MOTORCYCLE') {
        if (doExhaust) {
          for (const ep of RacerFactory.exhaustPoints(v)) {
            this.tmpHoof.copy(ep).applyMatrix4(v.root.matrixWorld);
            this.particles.exhaust(this.tmpHoof, this.tmpBack, k.boostT > 0);
          }
          if (k.drifting || k.boostT > 0) {
            this.tmpHoof.set(-1, 0.2, 0).applyMatrix4(v.root.matrixWorld);
            this.particles.hoofDust(this.tmpHoof, this.tmpBack, strength);
          }
        }
        continue;
      }
      // 부스트 특수 파티클: 코끼리 물대포 / 소 콧김
      if (doExhaust && k.boostT > 0 && !k.finished) {
        if (def.specialAbility === 'ELEPHANT') {
          const tip = RacerFactory.trunkTip(v);
          if (tip) this.particles.water(tip, this.tmpTan);
        } else if (def.specialAbility === 'COW') {
          for (const np of RacerFactory.nostrilPoints(v)) {
            this.tmpHoof.copy(np).applyMatrix4(v.root.matrixWorld);
            this.particles.steam(this.tmpHoof, this.tmpTan);
          }
        }
      }
      // 발자국
      if (this.footprints && distToCam < 120) {
        const size = def.specialAbility === 'ELEPHANT' ? 2.6 : def.specialAbility === 'TROJAN' ? 0 : def.specialAbility === 'HUMAN' || def.specialAbility === 'COSTUME' ? 0.9 : def.specialAbility === 'GIRAFFE' ? 1.3 : 1;
        if (size > 0) {
          v.hoofPoints.forEach((hp, hi) => {
            this.tmpFoot.copy(hp).applyMatrix4(v.root.matrixWorld);
            this.tmpFoot.y = hp.y;
            this.footprints!.track(`${i}:${hi}`, this.tmpFoot, this.tmpTan, dt, size, Math.abs(k.speed));
          });
        }
      }
      // 발굽 먼지 — 드리프트 중엔 매 스텝 더 많이
      let phase = this.dustPhase[i] + (Math.abs(k.speed) * dt) / Math.max(1, def.strideLength) * (k.drifting ? 3 : 1);
      if (phase >= 1) {
        phase -= 1;
        const hp = v.hoofPoints;
        const pick = hp.length ? hp[Math.floor(Math.random() * hp.length)] : null;
        if (pick) {
          this.tmpHoof.copy(pick).applyMatrix4(v.root.matrixWorld);
          this.tmpHoof.y = 0.1;
          this.particles.hoofDust(this.tmpHoof, this.tmpBack, strength * (distToCam < 60 ? 1 : 0.5));
        }
      }
      this.dustPhase[i] = phase;
      if (doExhaust && (k.boostT > 0 || k.miniT > 0) && distToCam < 80) {
        this.tmpHoof.set(-v.height * 0.55 - 1.5, 0.5, 0).applyMatrix4(v.root.matrixWorld);
        this.particles.ember(this.tmpHoof, this.tmpBack);
      }
    }
    this.scene.updateMatrixWorld();
  }
}
