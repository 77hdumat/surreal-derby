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
  /** 탈것 크기에 따른 거리 배수 (트로이 목마 등 큰 말은 멀리서) */
  distanceScale = 1;
  /** 물방울에 갇힌 정도 0..1 (구도 전환용) */
  private trap = 0;

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
        // 빨라질수록 카메라가 낮고 가깝게 붙어 속도감 ↑
        // 말에 가깝게, 살짝 위에서 내려다보는 시점
        const ds = this.distanceScale;
        // 물방울에 갇히면: 뒤·위로 빠지며 천천히 돌아 떠오른 물방울 전체를 보여준다
        const trapped = kart.bubbleT > 0 ? 1 : 0;
        this.trap += (trapped - this.trap) * Math.min(1, (trapped ? 3 : 2) * dt);
        const lift = kart.bubbleT > 0 ? 4.5 * Math.min(1, kart.bubbleT / 0.4) : 0;
        // 살짝 대각선 위에서 내려다본다
        // 부스트 중엔 살짝 더 붙는다 (시야각이 넓어지며 멀어 보이는 것을 상쇄)
        const near = 1 - 0.15 * this.boostNearby;
        const back = (5.0 * near + 3.5 * this.trap) * ds;
        const up = (4.3 * (1 - 0.1 * this.boostNearby) + 2.5 * this.trap) * ds + lift * 0.6;
        // 기본 오른쪽으로 살짝 비켜 대각선 구도 + 드리프트 중엔 미끄러지는 반대쪽으로
        const wantSide = 0.9 * ds - kart.slip * 5 + Math.sin(this.time * 0.9) * 5 * this.trap;
        this.sideOffset += (wantSide - this.sideOffset) * Math.min(1, 4 * dt);
        this.desiredPos.set(kart.x - fx * back + rx * this.sideOffset, up, kart.z - fz * back + rz * this.sideOffset);
        this.desiredLook.set(kart.x + fx * 5.5 * ds * (1 - this.trap), 0.9 * ds + lift * this.trap, kart.z + fz * 5.5 * ds * (1 - this.trap));
        // 고속·부스트에서 카메라가 뒤로 처지지 않게 빠르게 따라붙는다
        k = 18;
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
    const speedFov = kart && this.mode === 'CHASE' ? THREE.MathUtils.clamp(Math.abs(kart.speed) / 50, 0, 1.2) * 14 : 0;
    // 부스트 시야각 확대는 절반만 (너무 멀어 보이지 않게)
    const target = BASE_FOV + this.boostNearby * 12 + speedFov;
    this.fovCur = THREE.MathUtils.lerp(this.fovCur, target, Math.min(1, dt * 5));
    if (Math.abs(this.camera.fov - this.fovCur) > 0.01) {
      this.camera.fov = this.fovCur;
      this.camera.updateProjectionMatrix();
    }

    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma * 0.7 + this.boostNearby * 0.05;
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
