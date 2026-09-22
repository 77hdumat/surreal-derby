import type { TrackGeometry } from '../track/TrackGeometry';
import type { Obstacle } from './Obstacles';

/** 플레이어/CPU 조작. steer: -1(왼쪽)..1(오른쪽), throttle/brake: 0..1 */
export interface KartInput {
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
  boost: boolean;
}

/** 말 × 기수 조합으로 결정되는 주행 파라미터 */
export interface KartParams {
  /** m/s */
  maxSpeed: number;
  /** m/s² */
  accel: number;
  /** 조향 감도 배수 (1 = 기본) */
  handling: number;
  /** kg — 충돌 밀림 비율 */
  mass: number;
  /** 드리프트 게이지 충전 속도 (1/s, 최대 슬립·최고속 기준) */
  gaugeRate: number;
  /** 부스트 중 최고속 배수 */
  boostMul: number;
  /** 충돌 반지름 (m) */
  radius: number;
  /** 부스트 중 결승선 판정에 더해지는 코 길이 (기린 목·롱바디 몸통) */
  boostReach: number;
}

export interface KartState {
  x: number;
  z: number;
  /** 라디안. 모델 +x 전방 규약: 전방 벡터 = (cos yaw, 0, -sin yaw). 오른쪽 회전 = yaw 감소 */
  yaw: number;
  /** m/s (음수 = 후진) */
  speed: number;
  /** 드리프트 슬립각 — 진행 방향 = yaw + slip */
  slip: number;
  drifting: boolean;
  /** 0..1 — 가득 차면 boosts 로 넘어가고 0 부터 다시 */
  gauge: number;
  /** 모아 둔 부스터 개수 (최대 MAX_BOOSTS) */
  boosts: number;
  /** 직전 스텝의 부스트 키 상태 (누른 순간만 잡기 위해) */
  boostKeyWas: boolean;
  /** 이번 드리프트 시작 시점 게이지 — 부딪히면 여기로 되돌린다 */
  gaugeAtDriftStart: number;
  /** 남은 부스트 시간 (초) */
  boostT: number;
  /** 남은 순간부스터 시간 (초) — 드리프트 직후 ↑ */
  miniT: number;
  /** 드리프트 종료 후 순간부스터 입력 창 (초) */
  miniWindow: number;
  /** 현재 드리프트 지속 시간 */
  driftTime: number;
  /** 부스트 패드 재사용 대기 (초) */
  padT: number;
  /** 진흙 안에 있음 (연출용) */
  inMud: boolean;
  // ---- 아이템 효과 (초) — 자기 말은 자기 기기가 판정해 적용
  /** 미사일 피격: 스핀·정지 */
  stunT: number;
  /** 물폭탄/UFO: 물방울에 갇힘 */
  bubbleT: number;
  /** 바나나: 미끄러짐 */
  slipT: number;
  /** 실드: 다음 공격 1회 무효 */
  shieldT: number;
  /** 자석: 앞 말 쪽으로 당겨짐 (가속) */
  magnetT: number;
  /** 환각: 조작이 반대로 (좌우·가속/브레이크) */
  confuseT: number;
  /** 들고 있는 아이템 2칸 (없으면 ''). item 이 먼저 쓰인다 */
  item: string;
  item2: string;
  /** 자석 대상 슬롯 (-1 = 없음). magnetT 동안 그쪽으로 끌려간다 */
  magnetTarget: number;
  /** 트랙 좌표 (project 결과) */
  s: number;
  lat: number;
  /** 언랩된 진행 거리 — 순위·랩 계산 */
  progress: number;
  /** 결승선 통과 횟수 (0..LAPS) */
  lapsDone: number;
  /** 최근 접촉 흔들림 (초), 방향 */
  bumpT: number;
  bumpDir: number;
  finished: boolean;
  finishTime: number | null;
  /** 시각 연출용: 최근 가속도(m/s²), yaw 변화율 */
  lastAccel: number;
  yawRate: number;
}

export type KartEvent = { k: 'wall' } | { k: 'boost' } | { k: 'mini' } | { k: 'lap'; lap: number } | { k: 'finish' } | { k: 'bale' } | { k: 'pad' };

export const LAPS = 2; // 서킷 3.3km × 2
export const MAX_BOOSTS = 2;
export const BOOST_DURATION = 3.0;
/** 순간부스터: 지속·최고속 배수·입력 창·최소 드리프트 시간 */
export const MINI_DURATION = 0.55;
export const MINI_MUL = 1.18;
export const MINI_WINDOW = 0.35;
export const MINI_MIN_DRIFT = 0.12;
/** 출발 부스터: GO 전 이 시간(초) 안에 ↑ 를 누르기 시작했거나, GO 뒤 START_BOOST_LATE 안에 누르면 */
export const START_BOOST_WINDOW = 0.9;
export const START_BOOST_LATE = 0.35;
export const START_BOOST_DURATION = 1.1;

/** 출발 부스터 부여 */
export function applyStartBoost(st: KartState): void {
  st.boostT = START_BOOST_DURATION;
}
export const MAX_SLIP = 0.45;
/** 벽 판정 여유 — 트랙 폭 절반에서 뺀다 */
export const WALL_MARGIN = 1.0;

export const IDLE_INPUT: Readonly<KartInput> = Object.freeze({ steer: 0, throttle: 0, brake: 0, drift: false, boost: false });

export function createKartState(x: number, z: number, yaw: number): KartState {
  return {
    x,
    z,
    yaw,
    speed: 0,
    slip: 0,
    drifting: false,
    gauge: 0,
    boosts: 0,
    boostKeyWas: false,
    gaugeAtDriftStart: 0,
    boostT: 0,
    miniT: 0,
    miniWindow: 0,
    driftTime: 0,
    padT: 0,
    inMud: false,
    stunT: 0,
    bubbleT: 0,
    slipT: 0,
    shieldT: 0,
    magnetT: 0,
    confuseT: 0,
    item: '',
    item2: '',
    magnetTarget: -1,
    s: 0,
    lat: 0,
    progress: 0,
    lapsDone: 0,
    bumpT: 0,
    bumpDir: 0,
    finished: false,
    finishTime: null,
    lastAccel: 0,
    yawRate: 0,
  };
}

/** 결승선 통과 횟수 (출발 그리드가 선 바로 앞이라 시작 시 1) */
function crossings(progress: number, track: TrackGeometry): number {
  return progress >= track.finishS ? Math.floor((progress - track.finishS) / track.length) + 1 : 0;
}

/** 트랙 좌표를 위치에서 다시 계산하고 progress 기준점을 맞춘다 (배치 직후 호출) */
export function syncKartToTrack(st: KartState, track: TrackGeometry): void {
  const c = track.project(st.x, st.z);
  st.s = c.s;
  st.lat = c.lat;
  st.progress = c.s > track.length / 2 ? c.s - track.length : c.s;
  st.lapsDone = crossings(st.progress, track);
}

/** 완주 거리: 출발선 앞에서 시작해 결승선을 LAPS 번 더 지난다 */
export function finishDistance(track: TrackGeometry): number {
  return track.finishS + LAPS * track.length;
}

/** 표시용 현재 랩 (1..LAPS) */
export function currentLap(st: KartState): number {
  return Math.max(1, Math.min(LAPS, st.lapsDone));
}

function wrapDelta(d: number, L: number): number {
  d = ((d + L / 2) % L + L) % L - L / 2;
  return d;
}

/** 진행 방향 각도 차이를 (-π, π] 로 */
export function angleDelta(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 골인 후 / 조작 없는 말: 중심선을 따라 절반 속도로 유유히 달린다 */
export function cruiseInput(st: KartState, p: KartParams, track: TrackGeometry, out: KartInput, targetLat = 0, speedFrac = 0.45): KartInput {
  const ahead = st.s + 8 + Math.max(0, st.speed) * 0.6;
  const target = track.getPoint(ahead, targetLat);
  const dx = target.x - st.x;
  const dz = target.z - st.z;
  const want = Math.atan2(-dz, dx);
  const err = angleDelta(want - st.yaw);
  out.steer = Math.max(-1, Math.min(1, -err * 2.5));
  out.throttle = st.speed < p.maxSpeed * speedFrac ? 1 : 0;
  out.brake = 0;
  out.drift = false;
  out.boost = false;
  return out;
}

const scratchInput: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };
const confusedInput: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };

/** 부딪힘: 드리프트 중이었다면 이번 드리프트로 모은 게이지를 잃고 드리프트가 끊긴다 (카트라이더 규칙) */
export function hitDuringDrift(st: KartState): void {
  if (!st.drifting) return;
  st.gauge = st.gaugeAtDriftStart;
  st.drifting = false;
  st.driftTime = 0;
  st.miniWindow = 0;
}

/**
 * 한 스텝 물리. 결정적(입력·dt 만 의존). 호스트와 게스트 예측이 같은 코드를 돈다.
 */
export function stepKart(st: KartState, input: KartInput, p: KartParams, track: TrackGeometry, dt: number, time = 0, obstacles: Obstacle[] = []): KartEvent[] {
  const events: KartEvent[] = [];
  if (dt <= 0) return events;
  // ---- 아이템 효과 타이머
  st.stunT = Math.max(0, st.stunT - dt);
  st.bubbleT = Math.max(0, st.bubbleT - dt);
  st.slipT = Math.max(0, st.slipT - dt);
  st.shieldT = Math.max(0, st.shieldT - dt);
  st.magnetT = Math.max(0, st.magnetT - dt);
  st.confuseT = Math.max(0, st.confuseT - dt);
  const disabled = st.stunT > 0 || st.bubbleT > 0;
  let inp = st.finished ? cruiseInput(st, p, track, scratchInput) : disabled ? IDLE_INPUT : input;
  if (st.confuseT > 0 && !st.finished && !disabled) {
    // 환각 가스: 좌우 반대, 가속↔브레이크 반대
    confusedInput.steer = -inp.steer;
    confusedInput.throttle = inp.brake;
    confusedInput.brake = inp.throttle;
    confusedInput.drift = inp.drift;
    confusedInput.boost = inp.boost;
    inp = confusedInput;
  }
  const prevSpeed = st.speed;
  const prevYaw = st.yaw;
  if (disabled) {
    // 맞으면 급정지 (물방울은 완전 정지)
    st.speed *= Math.max(0, 1 - (st.bubbleT > 0 ? 12 : 6) * dt);
    st.drifting = false;
    st.slip *= Math.max(0, 1 - 6 * dt);
  }

  // ---- 부스트: 부스트 중엔 무시(소모 안 함). 끝나기 0.25초 전부터는 누르고 있으면 끊김 없이 바로 이어진다
  st.boostKeyWas = inp.boost;
  if (!st.finished && inp.boost && st.boosts > 0 && st.boostT <= 0.25) {
    st.boosts--;
    st.boostT = BOOST_DURATION + st.boostT; // 남은 시간은 이어 붙인다
    st.speed = Math.max(st.speed, p.maxSpeed * 1.15); // 점화 순간 확 튀어나간다
    events.push({ k: 'boost' });
  }
  const boosting = st.boostT > 0;
  if (boosting) st.boostT = Math.max(0, st.boostT - dt);
  // ---- 순간부스터: 드리프트를 끝낸 직후(창 안에) ↑ 를 누르면 짧은 가속. 짧게 드리프트→↑ 를 반복하면 연속으로 (톡톡이)
  if (st.miniWindow > 0) {
    st.miniWindow = Math.max(0, st.miniWindow - dt);
    if (!st.finished && inp.throttle > 0) {
      st.miniWindow = 0;
      st.miniT = MINI_DURATION;
      st.speed = Math.max(st.speed, Math.min(p.maxSpeed * MINI_MUL, st.speed + 1.5));
      events.push({ k: 'mini' });
    }
  }
  const mini = st.miniT > 0;
  if (mini) st.miniT = Math.max(0, st.miniT - dt);
  const magnet = st.magnetT > 0;
  // 자석: 300~400km/h 로 대상에게 달라붙는다 (방향은 Items.step 이 대상 쪽으로 돌린다)
  const maxCur = p.maxSpeed * (boosting ? p.boostMul : mini ? MINI_MUL : 1) * (st.slipT > 0 ? 0.6 : 1) * (magnet ? 2.6 : 1);
  const accel = p.accel * (boosting ? 4.5 : magnet ? 12 : mini ? 2.6 : 1);

  // ---- 종방향
  if (inp.throttle > 0) {
    if (st.speed < maxCur) st.speed = Math.min(maxCur, st.speed + accel * inp.throttle * dt);
  } else if (inp.brake > 0) {
    st.speed = Math.max(-p.maxSpeed * 0.3, st.speed - accel * 1.5 * inp.brake * dt);
  } else if (st.speed > 0) {
    st.speed = Math.max(0, st.speed - (boosting || mini ? 0 : 3) * dt);
  } else if (st.speed < 0) {
    st.speed = Math.min(0, st.speed + 3 * dt);
  }
  // 최고속 초과분(부스트 종료 후)은 아주 완만히 감속 — 부스트 사이 관성이 유지돼 연속 부스트가 끊기지 않는다
  if (st.speed > maxCur) st.speed = Math.max(maxCur, st.speed - (st.speed - maxCur) * 0.6 * dt);

  // ---- 드리프트 판정
  const gaugeBefore = st.gauge;
  const fast = st.speed > p.maxSpeed * 0.4;
  const wantDrift = !st.finished && inp.drift && fast && (Math.abs(inp.steer) > 0.2 || st.drifting);
  if (st.drifting && !wantDrift) {
    // 드리프트 종료 → 순간부스터 입력 창 (너무 짧은 드리프트는 제외)
    if (st.driftTime >= MINI_MIN_DRIFT) st.miniWindow = MINI_WINDOW;
    st.driftTime = 0;
  } else if (!st.drifting && wantDrift) {
    st.gaugeAtDriftStart = st.gauge;
  }
  st.drifting = wantDrift;
  if (st.drifting) st.driftTime += dt;

  // ---- 조향
  const speedFrac = Math.min(1, Math.abs(st.speed) / p.maxSpeed);
  const grip = Math.min(1, Math.abs(st.speed) / 10); // 저속에서는 잘 안 돌아감
  let yawRate = inp.steer * p.handling * 1.8 * grip * (1 - 0.35 * speedFrac);
  if (st.slipT > 0) yawRate += Math.sin(time * 23 + st.slipT * 9) * 2.5; // 바나나: 비틀거림
  // 드리프트 완급: 누른 시간이 길수록 깊어진다 (0 → 0.8s). 얕은 드리프트 = 살짝 미끄러지며 게이지 효율 ↑, 깊은 드리프트 = 유턴급 회전
  const deep = st.drifting ? Math.min(1, st.driftTime / 0.8) : 0;
  // 드리프트 중 ↑ 를 떼면 덜 미끄러지고 더 꺾인다 (카트라이더 완급 조절)
  const easing = st.drifting && inp.throttle <= 0 ? 1 : 0;
  if (st.drifting) yawRate *= (1.35 + 1.15 * deep) * (1 + 0.15 * easing);
  if (st.speed < 0) yawRate = -yawRate;
  st.yaw -= yawRate * dt;

  // ---- 슬립 (드리프트 시 옆으로 미끄러짐)
  if (st.drifting) {
    const slideMul = (0.55 + 0.45 * deep) * (1 - 0.45 * easing); // ↑ 떼면 슬립 절반
    const target = Math.abs(inp.steer) > 0.2 ? Math.sign(inp.steer) * MAX_SLIP * slideMul : st.slip * Math.max(0, 1 - dt);
    st.slip += (target - st.slip) * Math.min(1, (5 + 4 * easing) * dt);
    st.speed *= Math.max(0, 1 - (0.2 + 0.4 * deep + 0.25 * easing) * dt); // 깊을수록·↑ 뗄수록 속도 손실
    if (st.boosts < MAX_BOOSTS) {
      // 부스터 중 드리프트는 1.6배 (카트라이더의 부스터 드리프트 충전 보너스). 얕은 드리프트가 충전 효율이 좋다
      const bonus = (boosting ? 1.6 : mini ? 1.25 : 1) * (1.25 - 0.35 * deep);
      st.gauge += Math.sqrt(Math.abs(st.slip) / MAX_SLIP) * speedFrac * p.gaugeRate * bonus * dt;
      if (st.gauge >= 1) {
        st.boosts++;
        st.gauge = st.boosts < MAX_BOOSTS ? st.gauge - 1 : 0;
        st.gaugeAtDriftStart = 0; // 이미 확보한 부스터는 부딪혀도 안 잃는다
      }
    }
  } else {
    st.slip += (0 - st.slip) * Math.min(1, 6 * dt);
    if (Math.abs(st.slip) < 1e-3) st.slip = 0;
  }

  // ---- 이동
  const h = st.yaw + st.slip;
  st.x += Math.cos(h) * st.speed * dt;
  st.z += -Math.sin(h) * st.speed * dt;

  // ---- 트랙 좌표 / 벽
  const prevS = st.s;
  const c = track.project(st.x, st.z);
  st.s = c.s;
  st.lat = c.lat;
  const limit = track.width / 2 - WALL_MARGIN;
  if (Math.abs(st.lat) > limit) {
    st.lat = Math.sign(st.lat) * limit;
    const pnt = track.getPoint(st.s, st.lat);
    st.x = pnt.x;
    st.z = pnt.z;
    // 벽을 따라 미끄러지면서 계속 감속. 첫 충돌은 크게
    if (st.bumpT <= 0) {
      st.speed *= 0.85; // 속도감을 잃지 않게 감속은 작게
      st.bumpT = 0.4;
      st.bumpDir = -Math.sign(st.lat);
      hitDuringDrift(st);
      events.push({ k: 'wall' });
    } else {
      st.speed *= Math.max(0, 1 - 0.6 * dt);
    }
    // 코를 트랙 방향으로 살짝 되돌려 벽에 박혀 있지 않게
    const trackYaw = track.yawAt(st.s);
    st.yaw += angleDelta(trackYaw - st.yaw) * Math.min(1, 6 * dt);
    st.slip *= 0.5;
  }
  st.bumpT = Math.max(0, st.bumpT - dt);
  st.padT = Math.max(0, st.padT - dt);

  // ---- 장애물
  st.inMud = false;
  for (const o of obstacles) {
    const dx = st.x - o.x;
    const dz = st.z - o.z;
    const d2 = dx * dx + dz * dz;
    if (o.kind === 'bale') {
      const minD = o.radius + p.radius * 0.7;
      if (d2 >= minD * minD || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      st.x = o.x + (dx / d) * minD;
      st.z = o.z + (dz / d) * minD;
      if (st.bumpT <= 0) {
        st.speed *= 0.55;
        st.bumpT = 0.5;
        st.bumpDir = Math.sin(st.yaw) * dx + Math.cos(st.yaw) * dz > 0 ? 1 : -1;
        hitDuringDrift(st);
        events.push({ k: 'bale' });
      }
    } else if (d2 < o.radius * o.radius) {
      if (o.kind === 'mud') {
        st.inMud = true; // 꾸밈 요소 — 감속 없음
      } else if (o.kind === 'pad' && st.padT <= 0 && !st.finished) {
        st.padT = 1.5;
        st.miniT = Math.max(st.miniT, MINI_DURATION * 1.6);
        st.speed = Math.max(st.speed, Math.min(p.maxSpeed * MINI_MUL, st.speed + 2.5));
        events.push({ k: 'pad' });
      }
    }
  }
  void gaugeBefore;

  // ---- 진행/랩
  st.progress += wrapDelta(st.s - prevS, track.length);
  if (!st.finished) {
    // 부스트 중 늘어난 목/몸통은 코끝 기준으로 먼저 결승선을 지난다
    const reach = st.progress + (st.boostT > 0 ? p.boostReach : 0);
    const done = crossings(reach, track);
    if (done > st.lapsDone) {
      st.lapsDone = done;
      if (done >= LAPS + 1) {
        st.finished = true;
        st.finishTime = time;
        st.drifting = false;
        events.push({ k: 'finish' });
      } else {
        events.push({ k: 'lap', lap: done }); // done = 새로 들어선 랩 번호 (2..LAPS)
      }
    }
  }

  st.lastAccel = (st.speed - prevSpeed) / dt;
  st.yawRate = angleDelta(st.yaw - prevYaw) / dt;
  return events;
}

/**
 * 원-원 충돌. 겹치면 질량 비례로 밀어내고 감속. 접촉했으면 true.
 * moveA/moveB=false 인 쪽은 원격(상대 클라이언트가 권위)이라 건드리지 않는다.
 */
export function resolveKartCollision(a: KartState, pa: KartParams, b: KartState, pb: KartParams, moveA = true, moveB = true): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const minD = pa.radius + pb.radius;
  if (d >= minD || d < 1e-6) return false;
  const nx = dx / d;
  const nz = dz / d;
  const overlap = minD - d;
  const total = pa.mass + pb.mass;
  const ka = pb.mass / total;
  const kb = pa.mass / total;
  // 흔들림 방향: 상대가 내 오른쪽(+right)에 있으면 왼쪽으로 밀림
  const ra = Math.sin(a.yaw) * nx + Math.cos(a.yaw) * nz; // right = (sin yaw, 0, cos yaw)
  if (moveA) {
    // 한쪽만 움직일 때는 겹침 전부를 그쪽이 해소
    const k = moveB ? ka : 1;
    a.x -= nx * overlap * k;
    a.z -= nz * overlap * k;
    a.speed *= 1 - 0.05 * ka;
    if (a.bumpT <= 0) {
      a.bumpT = 0.3;
      a.bumpDir = ra > 0 ? -1 : 1;
      hitDuringDrift(a);
    }
  }
  if (moveB) {
    const k = moveA ? kb : 1;
    b.x += nx * overlap * k;
    b.z += nz * overlap * k;
    b.speed *= 1 - 0.05 * kb;
    if (b.bumpT <= 0) {
      b.bumpT = 0.3;
      b.bumpDir = ra > 0 ? 1 : -1;
      hitDuringDrift(b);
    }
  }
  return true;
}
