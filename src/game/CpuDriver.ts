import type { TrackGeometry } from '../track/TrackGeometry';
import { angleDelta, type KartInput, type KartParams, type KartState } from './KartPhysics';
import type { Obstacle } from './Obstacles';

/** 봇 성격 — 슬롯 seed 로 고정 */
export interface CpuProfile {
  /** 선호 횡위치 (m) */
  lanePref: number;
  /** 0.88..1 스로틀 상한 */
  skill: number;
  /** 코너에서 드리프트 시작 임계 */
  driftEager: number;
  /** 드리프트 유지/재시작 타이머 (봇이 Shift 를 깜빡거리며 순간부스터를 남발하지 않게) */
  driftHold: number;
  driftCooldown: number;
}

export function cpuProfile(seed: number): CpuProfile {
  const r = (n: number) => {
    const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    lanePref: (r(1) - 0.5) * 18,
    skill: 0.9 + r(2) * 0.1,
    driftEager: 0.25 + r(3) * 0.3,
    driftHold: 0,
    driftCooldown: 0,
  };
}

/**
 * CPU 입력: 중심선 lookahead 추종 + 앞 말 회피 + 코너 드리프트 + 직선 부스트.
 * 결정적(상태·프로필만 의존) — 호스트에서만 돌린다.
 */
export function cpuInput(st: KartState, p: KartParams, track: TrackGeometry, others: KartState[], prof: CpuProfile, out: KartInput, obstacles: Obstacle[] = [], dt = 1 / 60): KartInput {
  const corner = track.cornerWeight(st.s + 15);
  // 코너는 중앙 가까이, 직선은 선호 차선
  let targetLat = corner > 0.3 ? prof.lanePref * 0.3 : prof.lanePref;
  // 바로 앞(3~12m) 에 다른 말이 비슷한 횡위치면 옆으로 비킨다
  for (const o of others) {
    if (o === st) continue;
    const gap = o.progress - st.progress;
    if (gap < 2 || gap > 12) continue;
    const dl = o.lat - targetLat;
    if (Math.abs(dl) < 2.8) targetLat += dl > 0 ? -3 : 3;
  }
  // 앞 30m 안의 건초·진흙은 피하고, 패드는 밟으러 간다
  for (const o of obstacles) {
    const ds = track.wrap(o.s - st.s);
    if (ds > 30) continue;
    const dl = o.lat - targetLat;
    if (o.kind === 'pad') {
      if (Math.abs(dl) < 6) targetLat = o.lat;
    } else if (Math.abs(dl) < o.radius + 2.2) targetLat += dl > 0 ? -(o.radius + 2.5) : o.radius + 2.5;
  }
  const limit = track.width / 2 - 2.5;
  targetLat = Math.max(-limit, Math.min(limit, targetLat));

  const ahead = st.s + 9 + Math.max(0, st.speed) * 0.55;
  const t = track.getPoint(ahead, targetLat);
  const want = Math.atan2(-(t.z - st.z), t.x - st.x);
  const err = angleDelta(want - st.yaw);
  out.steer = Math.max(-1, Math.min(1, -err * 2.2));
  // 급코너(헤어핀) 진입: 빠르면 가속을 늦춰 벽에 안 박히게
  const ahead2 = track.cornerWeight(st.s + 35);
  const tooFast = ahead2 > 0.7 && st.speed > p.maxSpeed * 0.62 && st.boostT <= 0;
  out.throttle = tooFast ? 0 : prof.skill;
  out.brake = tooFast && st.speed > p.maxSpeed * 0.8 ? 0.6 : 0;
  // 코너: 코너 동안 Shift + 방향키를 걸고, 충분히 돌았거나 코너가 풀리면 뗀다 (남은 슬립은 자연히 풀린다)
  prof.driftCooldown = Math.max(0, prof.driftCooldown - dt);
  const wantDrift = corner > Math.max(0.55, prof.driftEager) && st.speed > p.maxSpeed * 0.55 && Math.abs(out.steer) > 0.3;
  out.drift = false;
  if (!st.drifting) {
    out.drift = wantDrift && prof.driftCooldown <= 0;
  } else {
    const moveErr = angleDelta(want - (st.yaw + st.slip));
    const turnedEnough = -Math.sign(moveErr) === -st.driftDir || Math.abs(moveErr) < 0.08;
    const straightAhead = track.cornerWeight(st.s + 20) < 0.2;
    const release = straightAhead || turnedEnough || Math.abs(st.slip) > 0.7;
    out.drift = !release;
    if (!release) out.steer = st.driftDir;
    else prof.driftCooldown = 0.5;
  }
  if (out.drift && !st.drifting && Math.abs(out.steer) < 0.35) out.steer = Math.sign(out.steer || -1) * 0.35;
  // 직선에서 게이지가 차 있으면 부스트
  out.boost = st.boosts > 0 && track.cornerWeight(st.s + 30) < 0.2;
  return out;
}
