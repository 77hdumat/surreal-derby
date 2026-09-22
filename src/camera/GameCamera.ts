import * as THREE from 'three';
import type { TrackGeometry } from '../track/TrackGeometry';
import type { KartState } from '../game/KartPhysics';

export type GameCameraMode = 'INTRO' | 'CHASE' | 'RESULT';

const BASE_FOV = 58;

/**
 * 인트로 스윙 / 플레이어 추적(카트라이더식 3인칭) / 결과 궤도 카메라.
 * shake(trauma²)·부스트 FOV 킥·드리프트 시 측면 오프셋 포함.
 */
export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: GameCameraMode = 'INTRO';
  /** 그림자/조명이 따라갈 관심 지점 */
  readonly focusPoint = new THREE.Vector3();
  /** 카메라 이동 속도 (m/s) — 바람 소리 등 */
  velocity = 0;
  /** 화면 부스트 강도 0..1 (잔상/스피드라인) */
  boostNearby = 0;

  private track: TrackGeometry;
  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private smoothPos = new THREE.Vector3();
  private smoothLook = new THREE.Vector3();
  private lastCamPos = new THREE.Vector3();
  private trauma = 0;
  private cut = true;
  private time = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private lookTmp = new THREE.Vector3();
  private sideOffset = 0;
  private fovCur = BASE_FOV;
  /** 결과 화면에서 바라볼 지점 */
  private resultFocus = new THREE.Vector3();

  constructor(track: TrackGeometry, aspect: number) {
    this.track = track;
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.3, 4000);
    this.setMode('INTRO');
    this.update(0, null, 0);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  setMode(mode: GameCameraMode, cut = true): void {
    this.mode = mode;
    this.cut = cut;
    if (mode !== 'CHASE') this.boostNearby = 0;
  }

  setResultFocus(p: THREE.Vector3): void {
    this.resultFocus.copy(p);
  }

  private P(s: number, lat: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    this.track.getPoint(s, lat, out);
    out.y = y;
    return out;
  }

  /**
   * @param kart 추적 대상 (CHASE)
   * @param boost 대상의 부스트 강도 0..1
   */
  update(dt: number, kart: KartState | null, boost: number): void {
    this.time += dt;
    let k = 6;
    switch (this.mode) {
      case 'INTRO': {
        const sway = Math.sin(this.time * 0.4) * 3;
        this.P(24 + sway, 16, 3.2, this.desiredPos);
        this.P(-1, -1, 1.4, this.desiredLook);
        k = 2.5;
        break;
      }
      case 'CHASE': {
        if (!kart) break;
        // 진행 방향(yaw+slip 절반) 뒤 7m·위 3m. 속도 붙으면 살짝 더 뒤로.
        const h = kart.yaw + kart.slip * 0.5;
        const fx = Math.cos(h);
        const fz = -Math.sin(h);
        const rx = -fz; // 오른쪽 = (sin h, 0, cos h)
        const rz = fx;
        const speedK = THREE.MathUtils.clamp(Math.abs(kart.speed) / 30, 0, 1.3);
        // 빨라질수록 카메라가 낮고 가깝게 붙어 속도감 ↑
        // 말에 가깝게, 살짝 위에서 내려다보는 시점
        const back = 5.2 + speedK * 0.9 + boost * 0.5;
        const up = 3.7 - speedK * 0.35;
        // 드리프트 중엔 미끄러지는 반대쪽으로 살짝 빠져 옆모습이 보이게
        const wantSide = -kart.slip * 5;
        this.sideOffset += (wantSide - this.sideOffset) * Math.min(1, 4 * dt);
        this.desiredPos.set(kart.x - fx * back + rx * this.sideOffset, up, kart.z - fz * back + rz * this.sideOffset);
        this.desiredLook.set(kart.x + fx * 7, 1.1, kart.z + fz * 7);
        k = 9;
        break;
      }
      case 'RESULT': {
        const ang = this.time * 0.25;
        const rad = 14;
        this.desiredPos.set(this.resultFocus.x + Math.sin(ang) * rad, 6, this.resultFocus.z + Math.cos(ang) * rad);
        this.desiredLook.set(this.resultFocus.x, 1.5, this.resultFocus.z);
        k = 4;
        break;
      }
    }

    if (this.cut || dt === 0) {
      this.smoothPos.copy(this.desiredPos);
      this.smoothLook.copy(this.desiredLook);
      this.cut = false;
    } else {
      const a = 1 - Math.exp(-k * dt);
      this.smoothPos.lerp(this.desiredPos, a);
      this.smoothLook.lerp(this.desiredLook, Math.min(1, a * 1.4));
    }

    this.boostNearby = THREE.MathUtils.lerp(this.boostNearby, this.mode === 'CHASE' ? boost : 0, Math.min(1, dt * 5));
    const speedFov = kart && this.mode === 'CHASE' ? THREE.MathUtils.clamp(Math.abs(kart.speed) / 30, 0, 1.2) * 14 : 0;
    const target = BASE_FOV + this.boostNearby * 16 + speedFov;
    this.fovCur = THREE.MathUtils.lerp(this.fovCur, target, Math.min(1, dt * 5));
    if (Math.abs(this.camera.fov - this.fovCur) > 0.01) {
      this.camera.fov = this.fovCur;
      this.camera.updateProjectionMatrix();
    }

    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma * 0.7 + this.boostNearby * 0.03;
    const t = performance.now() * 0.001;
    this.tmp2.set(Math.sin(t * 37.1) * sh * 0.45, Math.sin(t * 43.7 + 1) * sh * 0.35, Math.sin(t * 29.3 + 2) * sh * 0.3);
    this.lastCamPos.copy(this.camera.position);
    this.camera.position.copy(this.smoothPos).add(this.tmp2);
    this.lookTmp.copy(this.smoothLook);
    this.lookTmp.x += Math.sin(t * 31) * sh * 0.5;
    this.lookTmp.y += Math.sin(t * 41 + 0.5) * sh * 0.4;
    this.camera.lookAt(this.lookTmp);
    this.camera.rotation.z += Math.sin(t * 23) * sh * 0.02;
    this.focusPoint.copy(this.smoothLook);
    this.velocity = dt > 0 ? this.tmp.subVectors(this.camera.position, this.lastCamPos).length() / dt : 0;
  }
}
