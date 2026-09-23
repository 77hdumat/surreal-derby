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
  /** 그중 파란 부스터(강화) 개수 — 먼저 쓰인다 */
  blueBoosts: number;
  /** 지금 터진 부스트가 파란 부스터인가 */
  boostBlue: boolean;
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
  /** 드리프트 방향 (+1 오른쪽, -1 왼쪽) */
  driftDir: number;
  /** 직전 스텝의 Shift 상태 (눌린 순간 판정) */
  driftKeyWas: boolean;
  /** 역조향 유지 시간 (드리프트 탈출 판정) */
  counterT: number;
  /** 직전 스텝의 ↑ 상태 (톡톡이 판정) */
  throttleWas: boolean;
  /** 같은 방향으로 조향을 붙잡고 있는 시간 (초) — 길게 꺾을수록 더 돈다 */
  steerHold: number;
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
  /** 물방울 탈출 진행도 0..1 — 좌우 연타로 채운다 */
  escape: number;
  /** 직전 스텔의 조향 부호 (연타 판정) */
  escapeDir: number;
  /** 물방울 착지 직후 부스터 입력 창 (초) */
  landWindow: number;
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
/** 파란 부스터: 1.5배 길고 더 빠르다 */
export const BLUE_BOOST_DURATION = BOOST_DURATION * 1.5;
export const BLUE_BOOST_EXTRA = 1.22;
/** 순간부스터: 지속·최고속 배수·입력 창·최소 드리프트 시간 */
export const MINI_DURATION = 0.55;
export const MINI_MUL = 1.18;
export const MINI_WINDOW = 0.35;
export const MINI_MIN_DRIFT = 0.12;
/** 출발 부스터: GO 전 이 시간(초) 안에 ↑ 를 누르기 시작했거나, GO 뒤 START_BOOST_LATE 안에 누르면 */
export const START_BOOST_WINDOW = 0.9;
export const START_BOOST_LATE = 0.35;
export const START_BOOST_DURATION = 1.1;
/** 물방울 착지 부스터: 풀린 뒤 이 시간(초) 안에 ↑ */
export const LAND_BOOST_WINDOW = 0.5;
export const LAND_BOOST_DURATION = 1.4;

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
    blueBoosts: 0,
    boostBlue: false,
    boostKeyWas: false,
    gaugeAtDriftStart: 0,
    boostT: 0,
    miniT: 0,
    miniWindow: 0,
    driftTime: 0,
    driftDir: 0,
    driftKeyWas: false,
    counterT: 0,
    throttleWas: false,
    steerHold: 0,
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
    escape: 0,
    escapeDir: 0,
    landWindow: 0,
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
  // ---- 물방울 탈출: 좌우를 번갈아 누르면 빨리 터진다
  if (st.bubbleT > 0 && !st.finished) {
    const dir = Math.sign(input.steer);
    if (dir !== 0 && dir !== st.escapeDir) {
      st.escapeDir = dir;
      st.escape += 0.16;
    }
    if (st.escape >= 1) {
      st.bubbleT = Math.min(st.bubbleT, 0.35); // 터짐 → 바로 낙하 단계로
      st.escape = 0;
    }
  } else {
    st.escape = 0;
    st.escapeDir = 0;
  }
  // 물방울이 풀린 순간부터 착지 부스터 창
  if (st.bubbleT <= 0 && st.landWindow > 0) st.landWindow = Math.max(0, st.landWindow - dt);
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
  if (st.bubbleT > 0) st.landWindow = LAND_BOOST_WINDOW; // 갇혀 있는 동안 창을 채워 두고, 풀리면 줄어든다
  if (disabled) {
    // 맞으면 급정지 (물방울은 완전 정지)
    st.speed *= Math.max(0, 1 - (st.bubbleT > 0 ? 12 : 6) * dt);
    st.drifting = false;
    st.slip *= Math.max(0, 1 - 6 * dt);
  }

  // ---- 착지 부스터: 물방울에서 떨어지는 타이밍에 ↑ 를 누르면 짧은 부스트 (아이템 소모 없음)
  if (st.landWindow > 0 && st.bubbleT <= 0 && inp.throttle > 0 && !st.finished) {
    st.landWindow = 0;
    st.boostT = Math.max(st.boostT, LAND_BOOST_DURATION);
    st.speed = Math.max(st.speed, p.maxSpeed * 0.8);
    events.push({ k: 'boost' });
  }
  // ---- 부스트: 부스트 중엔 무시(소모 안 함). 끝나기 0.25초 전부터는 누르고 있으면 끊김 없이 바로 이어진다
  st.boostKeyWas = inp.boost;
  if (!st.finished && inp.boost && st.boosts > 0 && st.boostT <= 0.25) {
    st.boosts--;
    const blue = st.blueBoosts > 0;
    if (blue) st.blueBoosts--;
    st.boostBlue = blue;
    st.boostT = (blue ? BLUE_BOOST_DURATION : BOOST_DURATION) + st.boostT; // 남은 시간은 이어 붙인다
    st.speed = Math.max(st.speed, p.maxSpeed * (blue ? 1.3 : 1.15)); // 점화 순간 확 튀어나간다
    events.push({ k: 'boost' });
  }
  if (st.boostT <= 0) st.boostBlue = false;
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
  const boostMul = p.boostMul * (st.boostBlue ? BLUE_BOOST_EXTRA : 1);
  const maxCur = p.maxSpeed * (boosting ? boostMul : mini ? MINI_MUL : 1) * (st.slipT > 0 ? 0.6 : 1) * (magnet ? 2.6 : 1);
  const accel = p.accel * (boosting ? (st.boostBlue ? 5.5 : 4.5) : magnet ? 12 : mini ? 2.6 : 1);

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

  // ---- 드리프트 (카트라이더식): 차체 방향(yaw) 과 진행 방향(yaw + slip) 을 분리한다.
  //  · Shift + 방향키를 누르는 동안: 그립이 확 낮아져 깊게 미끄러진다
  //  · 떼면: 그립이 천천히 돌아오며 쭈욱 미끄러지다 슬립이 풀리면 자연 종료 (+ 순간부스터 창)
  //  · 미끄러지는 중 Shift + 방향키 다시 → 이어서 드리프트 / Shift 만 톡 · 역방향키 → 즉시 끊기
  //  · 톡톡이: 미끄러지는 중 ↑ 를 뗐다 다시 누르면 그 순간 끊기며 순간부스터
  const gaugeBefore = st.gauge;
  const driftPressed = inp.drift && !st.driftKeyWas;
  st.driftKeyWas = inp.drift;
  const throttlePressed = inp.throttle > 0 && !st.throttleWas;
  st.throttleWas = inp.throttle > 0;
  const steerSign = Math.abs(inp.steer) > 0.2 ? Math.sign(inp.steer) : 0;
  const endDrift = (mini: boolean) => {
    if (mini && st.driftTime >= MINI_MIN_DRIFT) st.miniWindow = MINI_WINDOW;
    st.drifting = false;
    st.driftTime = 0;
    st.counterT = 0;
  };
  /** 지금 Shift + 방향키로 드리프트를 "걸고" 있는가 */
  let driftHeld = false;
  if (!st.drifting) {
    if (!st.finished && inp.drift && steerSign !== 0 && st.speed > p.maxSpeed * 0.32) {
      st.drifting = true;
      st.driftDir = steerSign;
      st.driftTime = 0;
      st.gaugeAtDriftStart = st.gauge;
      // 킥: 진입 순간 차체를 안쪽으로 확 돌려 슬립을 만든다
      st.yaw -= steerSign * 0.2;
      st.slip += steerSign * 0.2;
      driftHeld = true;
    }
  } else {
    st.driftTime += dt;
    driftHeld = inp.drift && steerSign === st.driftDir;
    // 미끄러지는 중 반대쪽으로 Shift + 방향키 → 방향 전환해 이어서 드리프트
    if (inp.drift && steerSign === -st.driftDir && driftPressed) {
      st.driftDir = steerSign;
      driftHeld = true;
    }
    st.counterT = !inp.drift && steerSign === -st.driftDir ? st.counterT + dt : 0;
    if (st.finished || st.speed < p.maxSpeed * 0.12) endDrift(false);
    else if (driftPressed && steerSign === 0 && st.driftTime > 0.12) endDrift(true); // Shift 만 톡 → 끊기
    else if (st.counterT > 0.1) endDrift(true); // 역조향 → 끊기
    else if (throttlePressed && st.driftTime > MINI_MIN_DRIFT) {
      // 톡톡이: ↑ 를 다시 누른 순간 끊고 바로 순간부스터
      endDrift(false);
      st.miniWindow = 0;
      st.miniT = MINI_DURATION;
      st.speed = Math.max(st.speed, Math.min(p.maxSpeed * MINI_MUL, st.speed + 1.5));
      events.push({ k: 'mini' });
    } else if (!driftHeld && st.driftTime > 0.2 && Math.abs(st.slip) < 0.07) endDrift(true); // 자연 종료
  }

  // ---- 조향
  const steerDir = Math.sign(inp.steer);
  if (steerDir !== 0 && steerDir === Math.sign(st.steerHold || steerDir)) st.steerHold = steerDir * Math.min(0.9, Math.abs(st.steerHold) + dt);
  else st.steerHold = steerDir === 0 ? 0 : steerDir * dt;
  const hold = Math.min(1, Math.abs(st.steerHold) / 0.7); // 0 → 1 (0.7초)
  const speedFrac = Math.min(1, Math.abs(st.speed) / p.maxSpeed);
  const grip = Math.min(1, Math.abs(st.speed) / 10); // 저속에서는 잘 안 돌아감
  let yawRate: number;
  if (st.drifting) {
    // 걸고 있는 동안: 안쪽으로 강하게(유턴까지), 뗀 뒤: 남은 슬립 방향으로 완만히 계속 돈다
    const inner = steerSign === st.driftDir ? 1 : 0;
    const base = driftHeld ? 0.8 + 1.5 * inner * (0.6 + 0.4 * hold) : 0.35 + 0.6 * inner;
    yawRate = st.driftDir * p.handling * base * (1 + 0.35 * Math.min(1, inp.brake));
  } else {
    yawRate = inp.steer * p.handling * (1.05 + 0.95 * hold) * grip * (1 - 0.3 * speedFrac);
  }
  if (st.slipT > 0) yawRate += Math.sin(time * 23 + st.slipT * 9) * 2.5; // 바나나: 비틀거림
  if (st.speed < 0) yawRate = -yawRate;
  const dYaw = yawRate * dt;
  st.yaw -= dYaw;
  // 진행 방향은 관성으로 남는다: 차체가 돈 만큼 슬립이 생긴다 (드리프트 중에만)
  if (st.drifting) st.slip += dYaw;

  // ---- 슬립 복원 (그립): 드리프트 중엔 느리게(쭈욱), 평소엔 빠르게
  if (st.drifting) {
    // 걸고 있으면 그립이 낮아 깊게, 떼면 서서히 복원(쭈욱), ↑ 를 떼면 조금 더 빨리 붙는다
    const gripRate = (driftHeld ? 0.9 : 1.9) + (inp.throttle > 0 ? 0 : 0.8) + (st.counterT > 0 ? 6 : 0);
    st.slip -= st.slip * Math.min(1, gripRate * dt);
    st.slip = Math.max(-1.2, Math.min(1.2, st.slip));
    // 옆으로 미끄러지는 동안 측면 마찰이 속도를 깎는다 (슬립각의 사인에 비례, 45° 넘으면 급감)
    const side = Math.sin(Math.min(1.2, Math.abs(st.slip)));
    st.speed *= Math.max(0, 1 - (0.1 + 0.55 * side + 1.2 * Math.max(0, Math.abs(st.slip) - 0.75)) * dt);
    // 드리프트 중엔 ↑ 를 눌러도 원래 최고속까지 못 올라간다
    const driftCap = maxCur * (1 - 0.22 * side);
    if (st.speed > driftCap && st.boostT <= 0) st.speed = Math.max(driftCap, st.speed - (st.speed - driftCap) * 3 * dt);
    if (!(st.boosts >= MAX_BOOSTS && st.blueBoosts >= MAX_BOOSTS)) {
      // 부스터 중 드리프트는 1.6배. 실제로 미끄러질 때(슬립 ≥ 0.12rad)만, 슬립·속도·유지 시간에 비례
      const bonus = boosting ? 1.6 : mini ? 1.25 : 1;
      const slipAmt = Math.min(1, Math.max(0, Math.abs(st.slip) - 0.12) / 0.5);
      st.gauge += slipAmt * speedFrac * p.gaugeRate * bonus * dt * 1.25;
      if (st.gauge >= 1) {
        // 칸이 비어 있으면 일반 부스터, 다 찼으면 한 칸씩 파란 부스터로 승격
        if (st.boosts < MAX_BOOSTS) st.boosts++;
        else if (st.blueBoosts < st.boosts) st.blueBoosts++;
        const full = st.boosts >= MAX_BOOSTS && st.blueBoosts >= MAX_BOOSTS;
        st.gauge = full ? 0 : st.gauge - 1;
        st.gaugeAtDriftStart = 0; // 이미 확보한 부스터는 부딪혀도 안 잃는다
      }
    }
  } else {
    st.slip -= st.slip * Math.min(1, 9 * dt);
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
