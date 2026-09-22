import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export interface TrackFrame {
  pos: THREE.Vector3;
  tan: THREE.Vector3;
  right: THREE.Vector3;
  curvature: number;
}

export interface TrackCoord {
  s: number;
  lat: number;
}

/**
 * 타원형(스타디움형) 트랙의 순수 기하. Three.js 씬 객체 없음 → 물리·테스트에서 그대로 사용.
 * s = 트랙 중심선을 따라 진행한 거리. s=0 은 정면 직선주로 시작(출발 게이트).
 * lat = 중심선 기준 횡방향 위치, 음수 = 안쪽(왼쪽, 좌회전 트랙).
 */
export class TrackGeometry {
  readonly straight = 200;
  readonly radius = 60;
  readonly width = 30;
  readonly laneCount = 10;
  readonly length: number;
  /** 결승선 s 위치 (정면 직선주로 중간) */
  readonly finishS = 165;
  /** 전체 레이스 거리 (1바퀴 + 결승선까지) — 관람 모드 호환용 */
  readonly raceDistance: number;

  private tmpFrame: TrackFrame = {
    pos: new THREE.Vector3(),
    tan: new THREE.Vector3(),
    right: new THREE.Vector3(),
    curvature: 0,
  };

  constructor() {
    this.length = 2 * this.straight + 2 * Math.PI * this.radius;
    this.raceDistance = this.length + this.finishS;
  }

  laneToLat(lane: number): number {
    return -this.width / 2 + (lane + 0.5) * (this.width / this.laneCount);
  }

  wrap(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  isCorner(s: number): boolean {
    return this.getFrame(s).curvature > 0;
  }

  /** 0..1 코너 진입/이탈 부드러운 가중치 */
  cornerWeight(s: number): number {
    const w = this.wrap(s);
    const L1 = this.straight;
    const arc = Math.PI * this.radius;
    const blend = 12;
    const seg = (start: number, end: number) => {
      const a = THREE.MathUtils.clamp((w - start) / blend, 0, 1);
      const b = THREE.MathUtils.clamp((end - w) / blend, 0, 1);
      return Math.min(a, b);
    };
    return Math.max(seg(L1, L1 + arc), seg(2 * L1 + arc, 2 * L1 + 2 * arc));
  }

  getFrame(sIn: number, out: TrackFrame = this.tmpFrame): TrackFrame {
    const s = this.wrap(sIn);
    const L1 = this.straight;
    const R = this.radius;
    const arc = Math.PI * R;
    if (s < L1) {
      out.pos.set(-L1 / 2 + s, 0, R);
      out.tan.set(1, 0, 0);
      out.curvature = 0;
    } else if (s < L1 + arc) {
      const th = (s - L1) / R;
      out.pos.set(L1 / 2 + R * Math.sin(th), 0, R * Math.cos(th));
      out.tan.set(Math.cos(th), 0, -Math.sin(th));
      out.curvature = 1 / R;
    } else if (s < 2 * L1 + arc) {
      const u = s - L1 - arc;
      out.pos.set(L1 / 2 - u, 0, -R);
      out.tan.set(-1, 0, 0);
      out.curvature = 0;
    } else {
      const th = (s - 2 * L1 - arc) / R;
      out.pos.set(-L1 / 2 - R * Math.sin(th), 0, -R * Math.cos(th));
      out.tan.set(-Math.cos(th), 0, Math.sin(th));
      out.curvature = 1 / R;
    }
    out.right.crossVectors(out.tan, UP).normalize();
    return out;
  }

  getPoint(s: number, lat: number, out = new THREE.Vector3()): THREE.Vector3 {
    const f = this.getFrame(s);
    return out.copy(f.pos).addScaledVector(f.right, lat);
  }

  getTangent(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.getFrame(s).tan);
  }

  /** 중심선 진행 방향 yaw (라디안, 모델 +x 전방 규약: yaw = atan2(-tan.z, tan.x)) */
  yawAt(s: number): number {
    const f = this.getFrame(s);
    return Math.atan2(-f.tan.z, f.tan.x);
  }

  /**
   * 월드 (x,z) → 트랙 좌표 (s, lat). getPoint 의 역변환.
   * 트랙 밖의 점도 가장 가까운 중심선 위치를 돌려준다 (벽 판정용).
   */
  project(x: number, z: number, out: TrackCoord = { s: 0, lat: 0 }): TrackCoord {
    const L1 = this.straight;
    const R = this.radius;
    const arc = Math.PI * R;
    const hx = L1 / 2;
    // 직선 구간: 앞(z>0, s 증가 방향 +x) / 뒤(z<0, -x)
    if (Math.abs(x) <= hx) {
      if (z >= 0) {
        out.s = x + hx;
        out.lat = z - R; // right = (0,0,1)
      } else {
        out.s = L1 + arc + (hx - x);
        out.lat = -z - R; // right = (0,0,-1)
      }
      return out;
    }
    if (x > hx) {
      // 오른쪽 반원, 중심 (hx, 0). th = atan2(x - hx, z)
      const dx = x - hx;
      const th = Math.atan2(dx, z);
      out.s = L1 + th * R;
      out.lat = Math.hypot(dx, z) - R;
      return out;
    }
    // 왼쪽 반원, 중심 (-hx, 0). pos = (-hx - R sin th, -R cos th)
    const dx = x + hx;
    const th = Math.atan2(-dx, -z);
    out.s = 2 * L1 + arc + th * R;
    out.lat = Math.hypot(dx, z) - R;
    return out;
  }
}
