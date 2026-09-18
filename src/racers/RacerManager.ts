import * as THREE from 'three';
import { Racer } from './Racer';
import { RACER_DEFINITIONS } from './RacerDefinitions';
import { RacerFactory } from './RacerFactory';
import type { RacerVisual, VisualContext } from './RacerVisual';
import type { RaceTrack } from '../track/RaceTrack';
import type { RaceEvent } from '../events/RaceEvent';
import type { ParticleManager } from '../effects/ParticleManager';

/**
 * RaceEngine 결과(distance/lane/state) → 트랙 위 월드 좌표 → RacerVisual 애니메이션.
 */
export class RacerManager {
  readonly racers: Racer[];
  readonly visuals = new Map<string, RacerVisual>();
  private track: RaceTrack;
  private scene: THREE.Scene;
  private particles: ParticleManager;
  private dustPhase = new Map<string, number>();
  private exhaustTimer = 0;
  private tmpPos = new THREE.Vector3();
  private tmpTan = new THREE.Vector3();
  private tmpBack = new THREE.Vector3();
  private tmpHoof = new THREE.Vector3();
  private ctxCache = new Map<string, VisualContext>();
  private prevLane = new Map<string, number>();

  constructor(scene: THREE.Scene, track: RaceTrack, particles: ParticleManager) {
    this.scene = scene;
    this.track = track;
    this.particles = particles;
    this.racers = RACER_DEFINITIONS.map((def) => new Racer(def, track.laneToLat(def.number - 1)));
    for (const r of this.racers) {
      const v = RacerFactory.createVisual(r.def);
      this.visuals.set(r.def.id, v);
      scene.add(v.root);
      this.dustPhase.set(r.def.id, Math.random());
      this.ctxCache.set(r.def.id, {
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
        distanceToFinish: track.raceDistance,
        sideHint: 1,
        extension: 0,
        lateralVel: 0,
        extensionMax: 0,
      });
      r.reset(track.laneToLat(r.def.number - 1));
    }
    this.placeAll();
  }

  byId(id: string): Racer | undefined {
    return this.racers.find((r) => r.def.id === id);
  }

  visual(id: string): RacerVisual | undefined {
    return this.visuals.get(id);
  }

  /** 트랙 좌표계 기준 월드 위치 */
  worldPosition(id: string, out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.byId(id);
    if (!r) return out.set(0, 0, 0);
    this.track.getPoint(r.state.distance, r.state.lane, out);
    return out;
  }

  placeAll(): void {
    for (const r of this.racers) this.place(r);
  }

  private place(r: Racer): void {
    const v = this.visuals.get(r.def.id)!;
    const f = this.track.getFrame(r.state.distance);
    v.root.position.copy(f.pos).addScaledVector(f.right, r.state.lane);
    // 로컬 +x 를 tan 에 맞춤 (+z 가 오른쪽)
    let yaw = Math.atan2(-f.tan.z, f.tan.x);
    // 횡이동 방향으로 살짝 몸을 틀기
    const lateral = r.state.targetLane - r.state.lane;
    yaw -= THREE.MathUtils.clamp(lateral, -1, 1) * 0.12;
    v.root.rotation.y = yaw;
    v.root.updateMatrixWorld();
    v.setWorldForward(f.tan);
  }

  reset(): void {
    for (const r of this.racers) {
      r.reset(this.track.laneToLat(r.def.number - 1));
      this.visuals.get(r.def.id)!.reset();
    }
    this.placeAll();
  }

  onEvent(ev: RaceEvent): void {
    const v = this.visuals.get(ev.racerId);
    const r = this.byId(ev.racerId);
    if (!v || !r) return;
    const ctx = this.ctxCache.get(ev.racerId)!;
    if (ev.targetId) {
      const t = this.byId(ev.targetId);
      if (t) ctx.sideHint = t.state.lane > r.state.lane ? 1 : -1;
    }
    v.onEvent(ev.event, ctx);
    if (ev.targetId && (ev.event === 'COLLISION' || ev.event === 'BUMP' || ev.event === 'GIRAFFE_NECK_ATTACK')) {
      const tv = this.visuals.get(ev.targetId);
      tv?.onEvent(ev.event === 'GIRAFFE_NECK_ATTACK' ? 'BUMP' : ev.event, this.ctxCache.get(ev.targetId)!);
    }
    // 파티클 연출
    const pos = this.worldPosition(ev.racerId, this.tmpPos);
    switch (ev.event) {
      case 'COSTUME_COLLAPSE':
        this.particles.cardboard(pos.clone().setY(1));
        break;
      case 'COLLISION':
      case 'TRIP':
      case 'RIDER_FALL':
        this.particles.impact(pos.clone().setY(0.4), 1.2);
        break;
      case 'BUMP':
        this.particles.impact(pos.clone().setY(0.4), 0.6);
        break;
      case 'ELEPHANT_CHARGE':
      case 'COW_RAGE':
        this.particles.impact(pos.clone().setY(0.3), 1.5);
        break;
      case 'LONGBODY_STRETCH':
        this.particles.sparkle(pos.clone().setY(1.5));
        this.particles.impact(pos.clone().setY(0.3), 0.8);
        break;
      case 'TROJAN_AMBUSH':
        this.particles.impact(pos.clone().setY(0.5), 1.0);
        break;
      case 'TWIST_FALL':
      case 'TWIST_WHEEL_OFF':
        this.particles.impact(pos.clone().setY(0.4), 1.6);
        break;
      case 'LAUNCHED':
        this.particles.impact(pos.clone().setY(0.5), 2.0);
        break;
      case 'PLANTED':
        this.particles.impact(pos.clone().setY(0.2), 2.5);
        this.particles.shockwave(pos.clone().setY(0.3));
        break;
      case 'TWIST_ROCKET':
        this.particles.sparkle(pos.clone().setY(1.5));
        this.particles.sparkle(pos.clone().setY(0.6));
        break;
      case 'ELEPHANT_STOMP':
        this.particles.shockwave(pos.clone().setY(0.3));
        break;
      case 'ELEPHANT_TRUNK':
        this.particles.sparkle(pos.clone().setY(2.5));
        break;
      case 'CIRCUS_ACT':
        this.particles.sparkle(pos.clone().setY(2));
        this.particles.sparkle(pos.clone().setY(1));
        break;
      case 'MOTORCYCLE_BOOST':
      case 'SUPER_SPRINT':
      case 'COMEBACK':
      case 'HUMAN_BIPEDAL':
        this.particles.sparkle(pos.clone().setY(1.5));
        break;
      case 'ENGINE_FAILURE':
        this.particles.blackSmoke(pos.clone().setY(1));
        break;
    }
  }

  update(dt: number, time: number, cameraPos: THREE.Vector3): void {
    this.exhaustTimer += dt;
    const doExhaust = this.exhaustTimer > 0.05;
    if (doExhaust) this.exhaustTimer = 0;
    for (const r of this.racers) {
      const s = r.state;
      const v = this.visuals.get(r.def.id)!;
      this.place(r);
      const ctx = this.ctxCache.get(r.def.id)!;
      ctx.dt = dt;
      ctx.time = time;
      ctx.speed = s.currentSpeed;
      ctx.speedNorm = THREE.MathUtils.clamp(s.currentSpeed / (r.def.speed * 1.2), 0, 1.3);
      ctx.accel = s.lastAccel;
      ctx.state = s.state;
      ctx.stateTimer = s.stateTimer;
      ctx.cornerWeight = this.track.cornerWeight(s.distance);
      ctx.boost = s.boostIntensity;
      ctx.bump = s.bumpTimer;
      ctx.bumpDir = s.bumpDir;
      ctx.riderless = s.riderless;
      ctx.distanceToFinish = this.track.raceDistance - s.distance;
      ctx.extension = s.extension;
      ctx.extensionMax = s.extensionMax;
      const pl = this.prevLane.get(r.def.id) ?? s.lane;
      ctx.lateralVel = dt > 0 ? THREE.MathUtils.lerp(ctx.lateralVel, (s.lane - pl) / dt, 0.25) : 0;
      this.prevLane.set(r.def.id, s.lane);
      v.update(ctx);

      // 파티클 — 카메라 근처 선수만
      const distToCam = v.root.position.distanceTo(cameraPos);
      if (distToCam > 140 || s.currentSpeed < 2) continue;
      this.track.getTangent(s.distance, this.tmpTan);
      this.tmpBack.copy(this.tmpTan).negate();
      const strength = THREE.MathUtils.clamp(s.currentSpeed / 18, 0, 1.5) * (s.state === 'CHARGING' ? 2 : 1);
      if (r.def.specialAbility === 'MOTORCYCLE') {
        if (doExhaust && s.state !== 'ENGINE_FAILURE') {
          for (const ep of RacerFactory.exhaustPoints(v)) {
            this.tmpHoof.copy(ep).applyMatrix4(v.root.matrixWorld);
            this.particles.exhaust(this.tmpHoof, this.tmpBack, s.state === 'BOOSTING');
          }
        }
        if (doExhaust && s.state === 'ENGINE_FAILURE') {
          this.tmpHoof.set(0, 1, 0).applyMatrix4(v.root.matrixWorld);
          this.particles.blackSmoke(this.tmpHoof);
        }
        if (s.state === 'BOOSTING' && doExhaust) {
          this.tmpHoof.set(-1, 0.2, 0).applyMatrix4(v.root.matrixWorld);
          this.particles.hoofDust(this.tmpHoof, this.tmpBack, 1.5);
        }
        continue;
      }
      // 코끼리: 물대포
      if (doExhaust && s.state === 'SPRAYING') {
        const tip = RacerFactory.trunkTip(v);
        if (tip) this.particles.water(tip, this.tmpTan);
      }
      // 잠: Zzz 거품 / 풀 뜯기: 잔디 조각
      if (doExhaust && s.state === 'SLEEPING' && Math.random() < 0.35) this.particles.zzz(v.root.position.clone().setY(v.height * 0.6));
      if (doExhaust && s.state === 'STUBBORN' && Math.random() < 0.5) {
        this.tmpHoof.set(1.8, 0.3, 0).applyMatrix4(v.root.matrixWorld);
        this.particles.hoofDust(this.tmpHoof, this.tmpTan, 0.6);
      }
      // 소: 분노 시 콧김 / 인간: 탈진 시 땀
      if (doExhaust && s.state === 'RAGING') {
        for (const np of RacerFactory.nostrilPoints(v)) {
          this.tmpHoof.copy(np).applyMatrix4(v.root.matrixWorld);
          this.particles.steam(this.tmpHoof, this.tmpTan);
        }
      }
      const sweat = doExhaust ? RacerFactory.sweatPoint(v) : null;
      if (sweat && Math.random() < 0.5) {
        this.tmpHoof.copy(sweat).applyMatrix4(v.root.matrixWorld);
        this.particles.sweat(this.tmpHoof);
      }
      let phase = this.dustPhase.get(r.def.id)! + (s.currentSpeed * dt) / Math.max(1, r.def.strideLength);
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
      this.dustPhase.set(r.def.id, phase);
    }
    this.scene.updateMatrixWorld();
  }
}
