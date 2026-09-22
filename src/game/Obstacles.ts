import type { TrackGeometry } from '../track/TrackGeometry';

export type ObstacleKind = 'bale' | 'mud' | 'pad';

export interface Obstacle {
  kind: ObstacleKind;
  /** 트랙 좌표 */
  s: number;
  lat: number;
  /** 월드 좌표 (generate 시 계산) */
  x: number;
  z: number;
  /** 진행 방향 yaw (패드 화살표 방향) */
  yaw: number;
  radius: number;
}

/** 결정적 난수 (호스트 seed 를 전원이 공유) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const OBSTACLE_RADIUS: Record<ObstacleKind, number> = { bale: 1.3, mud: 3.0, pad: 2.0 };

/**
 * 트랙 위 장애물 배치. 출발 직후 70m 와 결승선 앞뒤 20m 는 비운다. 서로 22m 이상 떨어뜨린다.
 * 건초더미(부딪히면 크게 감속) / 진흙(지나는 동안 감속·게이지 안 참) / 부스트 패드(순간부스터)
 */
export function generateObstacles(seed: number, track: TrackGeometry, count = 12): Obstacle[] {
  const rnd = mulberry32(seed);
  const out: Obstacle[] = [];
  const L = track.length;
  const halfW = track.width / 2;
  let guard = 0;
  while (out.length < count && guard++ < 400) {
    const s = rnd() * L;
    if (s < 70 || Math.abs(s - track.finishS) < 20) continue;
    // 코너 안쪽 레코드 라인은 살짝 비켜서 (바깥쪽 위주)
    const corner = track.cornerWeight(s) > 0.5;
    const lat = corner ? -halfW * 0.4 + rnd() * halfW * 1.1 : (rnd() * 2 - 1) * (halfW - 3);
    const r = rnd();
    const kind: ObstacleKind = r < 0.5 ? 'bale' : r < 0.8 ? 'mud' : 'pad';
    let ok = true;
    for (const o of out) {
      const ds = Math.abs(track.wrap(o.s - s));
      if (Math.min(ds, L - ds) < 22) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const p = track.getPoint(s, lat);
    out.push({ kind, s, lat, x: p.x, z: p.z, yaw: track.yawAt(s), radius: OBSTACLE_RADIUS[kind] });
  }
  out.sort((a, b) => a.s - b.s);
  return out;
}
