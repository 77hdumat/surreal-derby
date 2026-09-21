import * as THREE from 'three';
import type { RaceTrack } from '../track/RaceTrack';
import type { RacerManager } from '../racers/RacerManager';
import type { RaceEngine } from '../game/RaceEngine';
import type { RaceEvent } from '../events/RaceEvent';

export type CameraMode =
  | 'START_CAMERA'
  | 'SIDE_TRACKING_CAMERA'
  | 'LOW_TRACKING_CAMERA'
  | 'LEADER_CAMERA'
  | 'REAR_CAMERA'
  | 'AERIAL_CAMERA'
  | 'EVENT_CAMERA'
  | 'FINISH_CAMERA'
  | 'FINISH_SIDE_CAMERA'
  | 'RESULT_CAMERA';

const BASE_FOV = 50;

/**
 * 자동 중계 카메라. 3~7초마다 전환, 큰 이벤트 시 즉시 EVENT_CAMERA.
 * shake / dynamic FOV / lag / whip pan 포함.
 */
export class CameraManager {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'START_CAMERA';
  private track: RaceTrack;
  private racers: RacerManager;
  private engine: RaceEngine;

  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private smoothPos = new THREE.Vector3();
  private smoothLook = new THREE.Vector3();
  private focusS = 0;
  private focusLat = 0;
  private modeTimer = 0;
  private modeDuration = 4;
  private eventTarget: string | null = null;
  private eventTimer = 0;
  private trauma = 0;
  private fovTarget = BASE_FOV;
  private fovBoost = 0;
  private cut = true;
  private whip = 0;
  private lagK = 6;
  private raceTime = 0;
  private finishLocked = false;
  private finishPending = false;
  private finishSideTimer = 0;
  /** 결승선을 가장 먼저 통과한 선수 — 골인 후에도 카메라가 잠시 따라간다 */
  private winnerId: string | null = null;
  private lastCamPos = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private lookTmp = new THREE.Vector3();
  /** 카메라 이동 속도 (m/s) — 바람 소리 등에 사용 */
  velocity = 0;
  /** 현재 화면에서 가장 강한 부스트 강도 (잔상/스피드라인) */
  boostNearby = 0;
  /** 그림자/조명이 따라갈 관심 지점 */
  readonly focusPoint = new THREE.Vector3();

  constructor(track: RaceTrack, racers: RacerManager, engine: RaceEngine, aspect: number) {
    this.track = track;
    this.racers = racers;
    this.engine = engine;
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.3, 2000);
    this.setMode('START_CAMERA', true);
    this.computeDesired(0);
    this.smoothPos.copy(this.desiredPos);
    this.smoothLook.copy(this.desiredLook);
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.smoothLook);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** 레이스 리셋 */
  reset(): void {
    this.finishLocked = false;
    this.finishPending = false;
    this.eventTarget = null;
    this.eventTimer = 0;
    this.trauma = 0;
    this.fovBoost = 0;
    this.raceTime = 0;
    this.finishSideTimer = 0;
    this.winnerId = null;
    this.setMode('START_CAMERA', true);
    this.computeDesired(0);
    this.smoothPos.copy(this.desiredPos);
    this.smoothLook.copy(this.desiredLook);
  }

  setMode(mode: CameraMode, cut = true): void {
    this.mode = mode;
    this.modeTimer = 0;
    this.modeDuration = 3 + Math.random() * 4;
    this.cut = cut;
    if (!cut) this.whip = 1;
    switch (mode) {
      case 'SIDE_TRACKING_CAMERA':
        this.lagK = 4.5;
        break;
      case 'LOW_TRACKING_CAMERA':
        this.lagK = 5;
        break;
      case 'LEADER_CAMERA':
        this.lagK = 3.5;
        break;
      case 'REAR_CAMERA':
        this.lagK = 3;
        break;
      case 'AERIAL_CAMERA':
        this.lagK = 2;
        this.modeDuration = 3.5 + Math.random() * 2;
        break;
      case 'EVENT_CAMERA':
        this.lagK = 7;
        break;
      case 'FINISH_CAMERA':
        this.lagK = 9;
        break;
      default:
        this.lagK = 4;
    }
  }

  onEvent(ev: RaceEvent): void {
    if (ev.event === 'START') {
      this.setMode('SIDE_TRACKING_CAMERA', false);
      this.shake(0.3);
      return;
    }
    if (ev.event === 'FINISH_LINE' && !this.finishSideTimer) {
      this.finishSideTimer = 0.01;
      this.winnerId = ev.racerId ?? null;
      this.shake(0.3);
    }
    // 우승마가 골인한 뒤에는 이벤트 카메라가 결승 장면을 빼앗지 않는다.
    if (this.winnerId) return;
    if (ev.event === 'PLANTED') this.shake(0.7);
    if (ev.event === 'LEAD_CHANGE' && !this.finishLocked && this.mode !== 'EVENT_CAMERA' && Math.random() < 0.5) {
      this.setMode('LEADER_CAMERA', true);
    }
    if (ev.event === 'FINAL_STRETCH') {
      // 결승 카메라는 선두가 결승선 95m 안에 들어올 때 잠금 (그 전까지 역전 장면은 일반 카메라로)
      this.finishPending = true;
    }
    if (!ev.major) return;
    this.eventTarget = ev.racerId;
    this.eventTimer = ev.destiny ? 4.5 : this.finishLocked ? 2.4 : 3.2;
    this.setMode('EVENT_CAMERA', false);
    if (ev.destiny) {
      this.shake(0.6);
      this.fovBoost = 1;
    }
    switch (ev.event) {
      case 'MOTORCYCLE_BOOST':
        this.shake(0.5);
        this.fovBoost = 1;
        break;
      case 'ELEPHANT_CHARGE':
        this.shake(0.7);
        this.fovBoost = 0.7;
        break;
      case 'ELEPHANT_STOMP':
        this.shake(1.0);
        break;
      case 'LAUNCHED':
        this.shake(0.8);
        this.eventTimer = 3.4;
        break;
      case 'ELEPHANT_TRUNK':
      case 'ELEPHANT_SPRAY':
        this.shake(0.4);
        break;
      case 'COW_RAGE':
      case 'SUPER_SPRINT':
      case 'COMEBACK':
      case 'HUMAN_BIPEDAL':
        this.shake(0.35);
        this.fovBoost = 0.6;
        break;
      case 'COSTUME_COLLAPSE':
      case 'COLLISION':
      case 'RIDER_FALL':
      case 'TRIP':
        this.shake(0.45);
        break;
      default:
        this.shake(0.25);
    }
  }

  private leaderPack(): { s: number; lat: number; leaderId: string; leaderS: number; leaderLat: number; rearS: number } {
    const ranking = this.engine.ranking;
    const active = ranking.filter((e) => !e.finished);
    const list = active.length ? active : ranking;
    const top = list.slice(0, 3);
    let s = 0;
    let lat = 0;
    for (const e of top) {
      const r = this.racers.byId(e.id)!;
      s += r.state.distance;
      lat += r.state.lane;
    }
    s /= top.length;
    lat /= top.length;
    const leader = this.racers.byId(list[0].id)!;
    const rear = this.racers.byId(list[Math.min(list.length - 1, 3)].id)!;
    return { s, lat, leaderId: leader.def.id, leaderS: leader.state.distance, leaderLat: leader.state.lane, rearS: rear.state.distance };
  }

  private computeDesired(dt: number): void {
    const t = this.track;
    const half = t.width / 2;
    const pack = this.engine.ranking.length ? this.leaderPack() : { s: 0, lat: 0, leaderId: '', leaderS: 0, leaderLat: 0, rearS: 0 };
    // 포커스는 살짝 늦게 따라간다 (속도 빠를수록 더 늦게)
    const leaderSpeed = pack.leaderId ? this.racers.byId(pack.leaderId)!.state.currentSpeed : 0;
    const k = this.lagK * THREE.MathUtils.clamp(1 - (leaderSpeed - 14) * 0.03, 0.5, 1);
    if (dt > 0) {
      this.focusS += (pack.s - this.focusS) * Math.min(1, dt * k);
      this.focusLat += (pack.lat - this.focusLat) * Math.min(1, dt * k);
    } else {
      this.focusS = pack.s;
      this.focusLat = pack.lat;
    }
    const P = (s: number, lat: number, y: number, out: THREE.Vector3) => {
      t.getPoint(s, lat, out);
      out.y = y;
      return out;
    };
    switch (this.mode) {
      case 'START_CAMERA': {
        const sway = Math.sin(this.raceTime * 0.4) * 3;
        P(24 + sway, 16, 3.2, this.desiredPos);
        P(-1, -1, 1.4, this.desiredLook);
        break;
      }
      case 'SIDE_TRACKING_CAMERA': {
        // 옆이 아니라 약간 뒤·위 45° 대각선에서 내려다보는 중계 시점
        P(this.focusS - 5, -half - 8.5, 6.5, this.desiredPos);
        P(this.focusS + 3, this.focusLat, 1.2, this.desiredLook);
        break;
      }
      case 'LOW_TRACKING_CAMERA': {
        P(this.focusS - 4, half + 7, 0.9, this.desiredPos);
        P(this.focusS + 6, this.focusLat, 1.2, this.desiredLook);
        break;
      }
      case 'LEADER_CAMERA': {
        const lr = this.racers.byId(pack.leaderId);
        const ls = lr ? lr.state.distance : this.focusS;
        const ll = lr ? lr.state.lane : this.focusLat;
        P(ls - 7, ll + 6.5, 4.8, this.desiredPos);
        P(ls + 1, ll, 1.3, this.desiredLook);
        break;
      }
      case 'REAR_CAMERA': {
        P(pack.rearS - 16, 0, 5.5, this.desiredPos);
        P(pack.leaderS, pack.leaderLat * 0.5, 1.2, this.desiredLook);
        break;
      }
      case 'AERIAL_CAMERA': {
        P(this.focusS - 20, -half - 30, 48, this.desiredPos);
        P(this.focusS + 12, 0, 0, this.desiredLook);
        break;
      }
      case 'EVENT_CAMERA': {
        const r = this.eventTarget ? this.racers.byId(this.eventTarget) : undefined;
        const s = r ? r.state.distance : this.focusS;
        const lat = r ? r.state.lane : this.focusLat;
        const v = r ? this.racers.visual(r.def.id) : undefined;
        const h = v ? v.height * 0.5 : 1.3;
        // 이벤트 카메라: 앞 옆에서 얼굴이 보이게, 시간 지나며 조금 뒤로 빠짐
        const pull = THREE.MathUtils.clamp((3.2 - this.eventTimer) / 3.2, 0, 1);
        P(s + 8 + pull * 4, lat + 9.5 + pull * 3, 2.6 + pull * 1.5, this.desiredPos);
        P(s + 0.5, lat, h, this.desiredLook);
        break;
      }
      case 'FINISH_CAMERA':
      case 'FINISH_SIDE_CAMERA': {
        // 올림픽 결승선 사이드 카메라: 결승선 옆(인필드)에 고정, 다가오는 선두를 팬으로 따라가다
        // 결승선 근처에서는 라인을 옆에서 보며 말들이 화면을 가로질러 지나가게 한다.
        const fs = t.finishS;
        // 결승선도 대각선 위에서: 결승선 약간 앞, 인필드 쪽 높은 위치
        P(fs + 4, -half - 12, 7.5, this.desiredPos);
        const winner = this.winnerId ? this.racers.byId(this.winnerId) : undefined;
        if (winner && this.finishSideTimer < 3.2) {
          // 골인 직후 3초: 우승마를 계속 팬으로 따라가 화면에서 사라지지 않게 한다.
          const ws = winner.state.distance;
          const follow = THREE.MathUtils.clamp((this.finishSideTimer - 1.6) / 1.6, 0, 1);
          P(THREE.MathUtils.lerp(ws + 1, fs + 6, follow * 0.35), THREE.MathUtils.lerp(winner.state.lane, 0, 0.35), 1.35, this.desiredLook);
          break;
        }
        const approach = THREE.MathUtils.clamp((fs - pack.leaderS) / 90, 0, 1); // 1 = 멀리, 0 = 결승선
        const lookS = fs - approach * 70 - 2 + (1 - approach) * 1.5;
        P(lookS, THREE.MathUtils.lerp(pack.leaderLat, 0, 0.5), 1.35, this.desiredLook);
        break;
      }
      case 'RESULT_CAMERA': {
        const fs = t.finishS;
        const ang = this.raceTime * 0.15;
        P(fs + 10 + Math.sin(ang) * 30, -half - 20 + Math.cos(ang) * 10, 12, this.desiredPos);
        P(fs + 10, 0, 2, this.desiredLook);
        break;
      }
    }
  }

  private autoSwitch(): void {
    if (this.finishLocked) return;
    const pool: CameraMode[] = ['SIDE_TRACKING_CAMERA', 'SIDE_TRACKING_CAMERA', 'LEADER_CAMERA', 'REAR_CAMERA', 'LOW_TRACKING_CAMERA', 'AERIAL_CAMERA'];
    let next: CameraMode = this.mode;
    let guard = 0;
    while (next === this.mode && guard++ < 10) next = pool[Math.floor(Math.random() * pool.length)];
    // 초반 3초는 사이드 트래킹 유지
    if (this.raceTime < 5) next = 'SIDE_TRACKING_CAMERA';
    this.setMode(next, true);
  }

  update(dt: number, raceTime: number, racing: boolean): void {
    this.raceTime = raceTime;
    this.modeTimer += dt;
    if (racing && this.finishPending && !this.finishLocked && this.engine.ranking.length) {
      const lead = this.engine.ranking.find((e) => !e.finished) ?? this.engine.ranking[0];
      if (lead.distance >= this.track.raceDistance - 95 && this.mode !== 'EVENT_CAMERA') {
        this.finishLocked = true;
        this.setMode('FINISH_CAMERA', true);
        this.modeDuration = 999;
      }
    }
    if (racing) {
      if (this.mode === 'EVENT_CAMERA') {
        this.eventTimer -= dt;
        if (this.eventTimer <= 0) {
          this.eventTarget = null;
          if (this.finishLocked) {
            this.setMode('FINISH_CAMERA', true);
            this.modeDuration = 999;
          } else this.autoSwitch();
        }
      } else if (this.modeTimer > this.modeDuration && this.mode !== 'START_CAMERA') {
        this.autoSwitch();
      }
      if (this.finishSideTimer > 0) this.finishSideTimer += dt;
    }
    this.computeDesired(dt);

    // 컷 vs 휩팬
    if (this.cut) {
      this.smoothPos.copy(this.desiredPos);
      this.smoothLook.copy(this.desiredLook);
      this.cut = false;
    } else {
      const k = this.whip > 0 ? 14 : this.mode === 'AERIAL_CAMERA' ? 2.5 : 6;
      const a = 1 - Math.exp(-k * dt);
      this.smoothPos.lerp(this.desiredPos, a);
      this.smoothLook.lerp(this.desiredLook, a * 1.3);
    }
    this.whip = Math.max(0, this.whip - dt * 2.5);

    // 근처 부스트 강도 → FOV
    let near = 0;
    for (const r of this.racers.racers) {
      const b = r.state.boostIntensity;
      if (b < 0.05) continue;
      const d = this.racers.worldPosition(r.def.id, this.tmp).distanceTo(this.smoothPos);
      near = Math.max(near, b * THREE.MathUtils.clamp(1 - d / 60, 0, 1));
    }
    this.boostNearby = THREE.MathUtils.lerp(this.boostNearby, near, Math.min(1, dt * 4));
    this.fovBoost = Math.max(0, this.fovBoost - dt * 0.35);
    const eventZoom = this.mode === 'EVENT_CAMERA' ? -8 * THREE.MathUtils.clamp(this.eventTimer / 3.2, 0, 1) : 0;
    const aerial = this.mode === 'AERIAL_CAMERA' ? 8 : this.mode === 'FINISH_CAMERA' ? 10 : 0;
    this.fovTarget = BASE_FOV + this.boostNearby * 22 + this.fovBoost * 10 + eventZoom + aerial;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.fovTarget, Math.min(1, dt * 5));
    this.camera.updateProjectionMatrix();

    // 쉐이크 (trauma²)
    this.trauma = Math.max(0, this.trauma - dt * 1.2);
    const sh = this.trauma * this.trauma + this.boostNearby * 0.12;
    const t = performance.now() * 0.001;
    this.tmp2.set(
      Math.sin(t * 37.1) * sh * 0.45,
      Math.sin(t * 43.7 + 1) * sh * 0.35,
      Math.sin(t * 29.3 + 2) * sh * 0.3,
    );
    this.lastCamPos.copy(this.camera.position);
    this.camera.position.copy(this.smoothPos).add(this.tmp2);
    this.lookTmp.copy(this.smoothLook);
    this.lookTmp.x += Math.sin(t * 31) * sh * 0.5;
    this.lookTmp.y += Math.sin(t * 41 + 0.5) * sh * 0.4;
    this.camera.lookAt(this.lookTmp);
    this.camera.rotation.z += Math.sin(t * 23) * sh * 0.02;
    this.focusPoint.copy(this.smoothLook);
    this.velocity = dt > 0 ? this.tmp3.subVectors(this.camera.position, this.lastCamPos).length() / dt : 0;
  }
}
