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
 * 서킷 제어점 (x, z). 닫힌 Catmull-Rom 스플라인으로 잇는다.
 * 첫 구간이 출발 직선주로(+x 방향, z=60) — 관중석·출발선이 여기 붙는다.
 * WKT 브라질 서킷 느낌: 긴 직선 → 헤어핀 → S자 → 긴 스위퍼 → 시케인 → 마지막 헤어핀.
 */
/**
 * 이중 나선(빙글빙글 구간): 바깥에서 안으로 한 바퀴 감아 들어가 중심에서 U턴, 다시 한 바퀴 감아 나온다.
 * 페르마 나선 두 팔(점대칭)이라 서로 교차하지 않고 팔 간격은 π·b.
 * 진입: 동쪽 끝에서 -z 방향으로, 탈출: 서쪽 끝에서 -z 방향으로.
 */
function doubleSpiral(cx: number, cz: number, a = 27, b = 13.5, turns = 1): [number, number][] {
  const out: [number, number][] = [];
  const tMax = Math.PI * 2 * turns;
  const step = Math.PI / 6;
  // 안으로 감아 들어가는 팔: t 큰 값 → 0
  for (let t = tMax; t > 0.01; t -= step) {
    const r = a + b * t;
    out.push([cx + r * Math.cos(t), cz + r * Math.sin(t)]);
  }
  // 중심 U턴: (a,0) → (-a,0) 를 아래(-z)로 돌아
  out.push([cx + a, cz], [cx, cz - a * 1.1], [cx - a, cz]);
  // 감아 나오는 팔 (점대칭)
  for (let t = step; t <= tMax + 0.01; t += step) {
    const r = a + b * t;
    out.push([cx - r * Math.cos(t), cz - r * Math.sin(t)]);
  }
  return out;
}

export const CIRCUIT_POINTS: [number, number][] = [
  [-200, 60], // 출발 직선 (+x)
  [-60, 60],
  [60, 60],
  [135, 60],
  [172, 25], // T1 우 90°
  [172, -30],
  [140, -70], // T2 우 90°
  [80, -72],
  [48, -105], // T3 좌 90°
  [48, -165],
  [92, -205], // T4 좌 90° → 우측 직선
  [165, -205],
  [228, -203],
  [262, -160], // T5 좌 90° 위로 (U턴 준비)
  [262, -100],
  [300, -62], // T6 시케인
  [352, -92],
  [382, -152],
  [365, -240], // T7 우 헤어핀
  [305, -282],
  [350, -320], // 나선 진입 준비 (동쪽에서 -z 로)
  [377, -370],
  ...doubleSpiral(265, -480), // 빙글빙글 (반지름 27→112)
  [153, -560], // 나선 탈출 (서쪽, -z)
  [110, -600],
  [40, -590], // T11 시케인
  [-20, -620],
  [-90, -602], // T12 우 90°
  [-132, -532],
  [-92, -472], // T13
  [-32, -452],
  [-60, -392], // T14 좌 헤어핀
  [-140, -372],
  [-202, -420], // T15
  [-272, -400],
  [-302, -322], // T16 U턴
  [-252, -262],
  [-172, -260], // T17
  [-132, -200],
  [-200, -160], // T18 좌
  [-272, -120],
  [-282, -48], // T19 → 출발 직선
  [-262, 30],
  [-240, 60],
];



interface Sample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  k: number;
}

/**
 * 스플라인 서킷 기하. 1m 간격 호 길이 샘플 테이블 + 격자 색인으로 투영.
 * s = 중심선 진행 거리(출발선 앞 s=0), lat = 횡방향(+ = 진행 방향 오른쪽).
 */
export class TrackGeometry {
  readonly width = 36;
  readonly laneCount = 8;
  readonly length: number;
  /** 출발선 = 결승선 (s=0). 출발 그리드는 선 바로 앞(s>0)이라 첫 통과가 실제 1바퀴 뒤 */
  readonly finishS = 0;
  /** 관람 모드 호환용: 1바퀴 + 결승선 */
  readonly raceDistance: number;
  readonly samples: Sample[] = [];
  readonly bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private cell = 20;
  private grid = new Map<string, number[]>();
  private tmpFrame: TrackFrame = {
    pos: new THREE.Vector3(),
    tan: new THREE.Vector3(),
    right: new THREE.Vector3(),
    curvature: 0,
  };

  constructor(points: [number, number][] = CIRCUIT_POINTS) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    const rawLen = curve.getLength();
    // 1m 등간격 샘플 → 최소 회전 반지름이 MIN_RADIUS 이상이 될 때까지 이동 평균으로 다듬는다
    let pts = curve.getSpacedPoints(Math.max(64, Math.round(rawLen))).slice(0, -1).map((p) => [p.x, p.z] as [number, number]);
    for (let pass = 0; pass < 80; pass++) {
      pts = TrackGeometry.resample(pts, 1);
      if (TrackGeometry.maxCurvature(pts) < 1 / TrackGeometry.MIN_RADIUS) break;
      pts = TrackGeometry.smoothTight(pts, 1 / TrackGeometry.MIN_RADIUS, 6);
    }
    pts = TrackGeometry.resample(pts, 1);
    const n = pts.length;
    let L = 0;
    for (let i = 0; i < n; i++) L += Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]);
    this.length = L;
    this.raceDistance = L + this.finishS;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const m = Math.hypot(tx, tz) || 1;
      tx /= m;
      tz /= m;
      this.samples.push({ x: pts[i][0], z: pts[i][1], tx, tz, k: 0 });
    }
    // 곡률: 인접 접선 각 변화 / 거리, ±6m 창으로 부드럽게
    const th = this.samples.map((s) => Math.atan2(-s.tz, s.tx));
    const raw = this.samples.map((_, i) => {
      const a = th[(i - 1 + n) % n];
      const b = th[(i + 1) % n];
      const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
      return Math.abs(d) / (2 * (L / n));
    });
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let w = -6; w <= 6; w++) acc += raw[(i + w + n) % n];
      this.samples[i].k = acc / 13;
    }
    // 격자 색인
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    this.samples.forEach((s, i) => {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
      const key = this.cellKey(s.x, s.z);
      const arr = this.grid.get(key);
      if (arr) arr.push(i);
      else this.grid.set(key, [i]);
    });
    this.bounds.minX = minX;
    this.bounds.maxX = maxX;
    this.bounds.minZ = minZ;
    this.bounds.maxZ = maxZ;
  }

  /** 최소 회전 반지름 (m) — 이보다 급한 굽이는 다듬는다 */
  static MIN_RADIUS = 26;

  /** 닫힌 폴리라인을 step(m) 간격으로 재샘플 */
  static resample(pts: [number, number][], step: number): [number, number][] {
    const n = pts.length;
    const cum: number[] = [0];
    for (let i = 0; i < n; i++) cum.push(cum[i] + Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]));
    const L = cum[n];
    const m = Math.max(16, Math.round(L / step));
    const out: [number, number][] = [];
    let j = 0;
    for (let i = 0; i < m; i++) {
      const d = (i / m) * L;
      while (j < n - 1 && cum[j + 1] < d) j++;
      const a = pts[j];
      const b = pts[(j + 1) % n];
      const t = (d - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }

  /** 닫힌 폴리라인 이동 평균 (±w 샘플) */
  static smooth(pts: [number, number][], w: number): [number, number][] {
    const n = pts.length;
    return pts.map((_, i) => {
      let x = 0;
      let z = 0;
      for (let k = -w; k <= w; k++) {
        const p = pts[(i + k + n) % n];
        x += p[0];
        z += p[1];
      }
      return [x / (2 * w + 1), z / (2 * w + 1)] as [number, number];
    });
  }

  /** 곡률이 한계를 넘는 구간(±12m)만 국소 이동 평균 — 다른 코너의 각은 살린다 */
  static smoothTight(pts: [number, number][], kLimit: number, w: number): [number, number][] {
    const n = pts.length;
    const k = TrackGeometry.curvatures(pts);
    const hot = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) if (k[i] > kLimit) for (let d = -12; d <= 12; d++) hot[(i + d + n) % n] = true;
    return pts.map((p, i) => {
      if (!hot[i]) return p;
      let x = 0;
      let z = 0;
      for (let d = -w; d <= w; d++) {
        const q = pts[(i + d + n) % n];
        x += q[0];
        z += q[1];
      }
      return [x / (2 * w + 1), z / (2 * w + 1)] as [number, number];
    });
  }

  /** 1m 간격 폴리라인의 곡률 배열 (±5 샘플 각 변화) */
  static curvatures(pts: [number, number][]): number[] {
    const n = pts.length;
    const out: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 5 + n) % n];
      const b = pts[i];
      const c = pts[(i + 5) % n];
      const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      const d = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
      out[i] = d / 5;
    }
    return out;
  }

  /** 1m 간격 폴리라인의 최대 곡률 (±5 샘플 각 변화) */
  static maxCurvature(pts: [number, number][]): number {
    return Math.max(...TrackGeometry.curvatures(pts));
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  laneToLat(lane: number): number {
    return -this.width / 2 + (lane + 0.5) * (this.width / this.laneCount);
  }

  wrap(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  isCorner(s: number): boolean {
    return this.cornerWeight(s) > 0.3;
  }

  /** 0..1 코너 강도 (곡률 기준: 반지름 60m 이하면 1) */
  cornerWeight(s: number): number {
    const n = this.samples.length;
    const u = (this.wrap(s) / this.length) * n;
    const i = Math.floor(u) % n;
    const t = u - Math.floor(u);
    const k = this.samples[i].k * (1 - t) + this.samples[(i + 1) % n].k * t;
    return THREE.MathUtils.clamp(k * 60, 0, 1);
  }

  getFrame(sIn: number, out: TrackFrame = this.tmpFrame): TrackFrame {
    const n = this.samples.length;
    const u = (this.wrap(sIn) / this.length) * n;
    const i = Math.floor(u) % n;
    const t = u - Math.floor(u);
    const a = this.samples[i];
    const b = this.samples[(i + 1) % n];
    out.pos.set(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
    out.tan.set(a.tx + (b.tx - a.tx) * t, 0, a.tz + (b.tz - a.tz) * t).normalize();
    out.curvature = a.k + (b.k - a.k) * t;
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
   * 월드 (x,z) → 트랙 좌표 (s, lat). 격자에서 가까운 샘플을 찾고 접선 방향으로 보정한다.
   * 트랙 밖의 점도 가장 가까운 중심선 위치를 돌려준다 (벽 판정용).
   */
  project(x: number, z: number, out: TrackCoord = { s: 0, lat: 0 }): TrackCoord {
    const n = this.samples.length;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bestD = Infinity;
    // 반경을 넓혀 가며 후보 탐색 (트랙에서 멀리 떨어진 점도 결국 찾는다)
    for (let r = 1; r <= 40 && best < 0; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const arr = this.grid.get(`${cx + dx},${cz + dz}`);
          if (!arr) continue;
          for (const i of arr) {
            const s = this.samples[i];
            const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      // 한 링 더 확인해 경계 오차 제거
      if (best >= 0 && r < 40) {
        const rr = r + 1;
        for (let dx = -rr; dx <= rr; dx++) {
          for (let dz = -rr; dz <= rr; dz++) {
            if (Math.abs(dx) !== rr && Math.abs(dz) !== rr) continue;
            const arr = this.grid.get(`${cx + dx},${cz + dz}`);
            if (!arr) continue;
            for (const i of arr) {
              const s = this.samples[i];
              const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
        }
        break;
      }
    }
    if (best < 0) best = 0;
    // 접선 방향 보정: 가장 가까운 샘플과 이웃 사이 선분에 투영
    const step = this.length / n;
    const a = this.samples[best];
    const along = (x - a.x) * a.tx + (z - a.z) * a.tz; // m
    const s = this.wrap(best * step + THREE.MathUtils.clamp(along, -step, step));
    const f = this.getFrame(s);
    out.s = s;
    out.lat = (x - f.pos.x) * f.right.x + (z - f.pos.z) * f.right.z;
    return out;
  }

  /** 트랙 중심선에서 가장 먼 지점 (호수 등 큰 오브젝트 배치용) */
  farthestPoint(margin = 40): THREE.Vector3 {
    let best = new THREE.Vector3();
    let bestD = -1;
    const c = { s: 0, lat: 0 };
    for (let x = this.bounds.minX + margin; x <= this.bounds.maxX - margin; x += 10) {
      for (let z = this.bounds.minZ + margin; z <= this.bounds.maxZ - margin; z += 10) {
        this.project(x, z, c);
        const d = Math.abs(c.lat);
        if (d > bestD) {
          bestD = d;
          best = new THREE.Vector3(x, 0, z);
        }
      }
    }
    return best;
  }
}
