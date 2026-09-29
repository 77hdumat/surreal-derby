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
  /** 부스트 가속 배수 (1 = 기본). 부스트 최고속은 모든 말이 BOOST_TOP 으로 같다 */
  boostAccel: number;
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
  /** 이번 부스트가 켜진 뒤 지난 시간 (초) — 가속이 점점 붙는 램프용. 이어 붙인 부스트는 리셋 안 됨 */
  boostAge: number;
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
  /** 조향을 풀었거나 역조향한 누적 시간 — 일정 이상이면 드리프트가 풀린다 */
  counterT: number;
  /** 드리프트가 자동으로 풀린 뒤 Shift 를 뗄 때까지 재진입 금지 (Shift 꾹 누르고 직진 방지) */
  driftLock: boolean;
  /** 드리프트 관성 1..0 — Shift 를 누르고 있으면 1, 떼면 줄어든다 (톡 치고 방향키만 잡아도 쭉 밀린다) */
  driftPush: number;
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
/** 부스트 최고속 — 말·기수와 무관하게 전원 동일 (350km/h) */
export const BOOST_TOP = 350 / 3.6;
/** 부스트 가속 (m/s²). 켜진 순간엔 BOOST_RAMP_START 배에서 시작해 BOOST_RAMP_TIME 동안 점점 붙는다 */
export const BOOST_ACCEL = 38;
export const BOOST_RAMP_START = 0.3;
export const BOOST_RAMP_TIME = 0.8;
/** 파란 부스터: 최고속은 같고 가속이 더 세다 */
export const BLUE_BOOST_ACCEL = 1.2;
/** 드리프트 중 강하게 역조향을 이만큼(초) 유지하면 슬립이 남아 있어도 바로 탈출 */
export const DRIFT_COUNTER_EXIT = 0.14;
/** Shift 를 톡 치고 방향키를 잡고 있으면 이 시간(초) 동안 관성으로 밀린다. 방향키를 풀면 더 빨리 멈춘다 */
export const DRIFT_TAP_SLIDE = 1.1;
/** 순간부스터: 지속·최고속 배수·입력 창·최소 드리프트 시간 */
export const MINI_DURATION = 0.4;
export const MINI_MUL = 1.28;
/** 순간부스터 가속 배수 (엔진 가속 대비) · 발동 순간 속도 킥 (m/s) — 짧고 굵게 */
export const MINI_ACCEL = 4.5;
export const MINI_KICK = 3;
export const MINI_WINDOW = 0.35;
export const MINI_MIN_DRIFT = 0.12;
/** 출발 부스터(순간부스터): GO 전 이 시간(초) 안에 ↑ 를 누르기 시작했거나, GO 뒤 START_BOOST_LATE 안에 누르면 */
export const START_BOOST_WINDOW = 0.9;
export const START_BOOST_LATE = 0.35;
/** 출발 순간부스터 지속 — 정지 상태에서 시작하니 드리프트 뒤 순간부스터보다 조금 길게 */
export const START_BOOST_DURATION = 0.6;
/** 물방울 착지 부스터(순간부스터): 풀린 뒤 이 시간(초) 안에 ↑ */
export const LAND_BOOST_WINDOW = 0.5;
export const LAND_BOOST_DURATION = 0.6;
/** 엔진 가속은 최고속에 가까울수록 둔해진다 (최고속에서 1-ACCEL_TAPER 배) — 속도를 잃으면 되찾기 어렵다 */
export const ACCEL_TAPER = 0.55;
/** 드리프트 진입 킥: 이 시간(초) 동안 꼬리가 확 빠지며 슬립이 최소 DRIFT_KICK_SLIP 배까지 붙는다 (카트라이더식 칼 진입) */
export const DRIFT_KICK_TIME = 0.16;
export const DRIFT_KICK_SLIP = 0.75;
/** 슬립 변화 중 코(yaw)가 같이 돌아가는 비율 — 진입 땐 코만 안쪽으로 꺾이고 진행 방향은 유지, 끊으면 코가 제자리로 (제자리 끊기) */
export const DRIFT_NOSE_FOLLOW = 0.6;
/** 짧은 드리프트(끊기) 게이지 보너스 — 이 시간(초) 안의 드리프트 구간 */
export const DRIFT_CUT_TIME = 0.4;
export const DRIFT_CUT_BONUS = 1.5;

/** 출발 부스터 부여 — 진짜 부스터가 아니라 순간부스터 (드리프트 뒤 ↑ 와 같은 가속) */
export function applyStartBoost(st: KartState): void {
  st.miniT = Math.max(st.miniT, START_BOOST_DURATION);
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
    boostAge: 0,
    miniT: 0,
    miniWindow: 0,
    driftTime: 0,
    driftDir: 0,
    driftKeyWas: false,
    counterT: 0,
    driftLock: false,
    driftPush: 0,
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
 * driftBoosts=false (아이템전): 드리프트 게이지·부스터가 없다. 부스트는 아이템으로만.
 */
export function stepKart(st: KartState, input: KartInput, p: KartParams, track: TrackGeometry, dt: number, time = 0, obstacles: Obstacle[] = [], driftBoosts = true): KartEvent[] {
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

  // ---- 착지 부스터: 물방울에서 떨어지는 타이밍에 ↑ 를 누르면 순간부스터 (아이템 소모 없음)
  if (st.landWindow > 0 && st.bubbleT <= 0 && inp.throttle > 0 && !st.finished) {
    st.landWindow = 0;
    st.miniT = Math.max(st.miniT, LAND_BOOST_DURATION);
    events.push({ k: 'mini' });
  }
  // ---- 부스트: 부스트 중엔 무시(소모 안 함). 끝나기 0.25초 전부터는 누르고 있으면 끊김 없이 바로 이어진다
  st.boostKeyWas = inp.boost;
  if (driftBoosts && !st.finished && inp.boost && st.boosts > 0 && st.boostT <= 0.25) {
    st.boosts--;
    const blue = st.blueBoosts > 0;
    if (blue) st.blueBoosts--;
    st.boostBlue = blue;
    st.boostT = (blue ? BLUE_BOOST_DURATION : BOOST_DURATION) + st.boostT; // 남은 시간은 이어 붙인다 (속도 점프 없음 — 가속 램프로 붙는다)
    events.push({ k: 'boost' });
  }
  if (st.boostT <= 0) st.boostBlue = false;
  const boosting = st.boostT > 0;
  if (boosting) {
    st.boostT = Math.max(0, st.boostT - dt);
    st.boostAge += dt;
  } else {
    st.boostAge = 0;
  }
  // ---- 순간부스터: 드리프트를 끝낸 직후(창 안에) ↑ 를 누르면 짧은 가속. 짧게 드리프트→↑ 를 반복하면 연속으로 (톡톡이)
  if (st.miniWindow > 0) {
    st.miniWindow = Math.max(0, st.miniWindow - dt);
    if (!st.finished && inp.throttle > 0) {
      st.miniWindow = 0;
      st.miniT = MINI_DURATION;
      st.speed = Math.max(st.speed, Math.min(p.maxSpeed * MINI_MUL, st.speed + MINI_KICK));
      events.push({ k: 'mini' });
    }
  }
  const mini = st.miniT > 0;
  if (mini) st.miniT = Math.max(0, st.miniT - dt);
  const magnet = st.magnetT > 0;
  // 자석: 300~400km/h 로 대상에게 달라붙는다 (방향은 Items.step 이 대상 쪽으로 돌린다)
  const top = boosting ? BOOST_TOP : p.maxSpeed * (mini ? MINI_MUL : 1);
  const maxCur = (magnet ? Math.max(top, p.maxSpeed * 2.6) : top) * (st.slipT > 0 ? 0.6 : 1);
  // 부스트 가속: 켜진 순간엔 약하게 → 0.8초에 걸쳐 최대로 (저속에서 급발진하지 않고 점점 빨라진다)
  const ramp = Math.min(1, st.boostAge / BOOST_RAMP_TIME);
  const rampMul = BOOST_RAMP_START + (1 - BOOST_RAMP_START) * ramp * ramp * (3 - 2 * ramp);
  const boostAccel = BOOST_ACCEL * p.boostAccel * (st.boostBlue ? BLUE_BOOST_ACCEL : 1) * rampMul;
  // 드리프트 중엔 (부스트가 아니면) 엔진 가속이 1/4 — 드리프트가 공짜 가속이 되지 않게
  const driftAccel = st.drifting && !boosting ? 0.25 : 1;
  // 엔진 가속만 최고속에 가까울수록 둔해진다 (부스터·순간부스터는 그대로 확 붙는다)
  const sf = Math.max(0, Math.min(1, st.speed / p.maxSpeed));
  const taper = boosting || mini || magnet ? 1 : 1 - ACCEL_TAPER * sf * sf;
  const accel = boosting ? Math.max(p.accel, boostAccel) : p.accel * (magnet ? 12 : mini ? MINI_ACCEL : 1);

  // ---- 종방향
  if (inp.throttle > 0) {
    if (st.speed < maxCur) st.speed = Math.min(maxCur, st.speed + accel * driftAccel * taper * inp.throttle * dt);
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
  // 진입: Shift + 방향키 (중속 이상). 드리프트가 끝나는 건 타이머가 아니라 "슬립이 다 풀렸을 때" — 완급 조절:
  //  · 드리프트 방향으로 꺾으면 깊어지고 (Shift 를 누르고 있으면 더 깊게)
  //  · 방향키를 놓으면 쭉 끌리다 서서히 펴지고 (끌리는 동안에도 게이지가 찬다)
  //  · 반대로 꺾으면 빨리 펴진다 (강하게 역조향을 유지하면 곧바로 탈출)
  // Shift 를 누른 채로 드리프트가 끝났다면 뗐다 눌러야 다시 들어간다 (Shift 꾹 + 직진 = 드리프트 아님)
  if (!inp.drift) st.driftLock = false;
  const steerIn = st.drifting ? inp.steer * st.driftDir : 0; // 드리프트 방향으로 꺾는 정도 (음수 = 역조향)
  if (st.drifting) st.counterT = steerIn < -0.5 ? st.counterT + dt : 0;
  if (st.drifting) st.driftPush = inp.drift ? 1 : Math.max(0, st.driftPush - (steerIn > 0.5 ? 1 / DRIFT_TAP_SLIDE : 2.5) * dt);
  const straightened = st.drifting && st.counterT >= DRIFT_COUNTER_EXIT;
  // 슬립이 거의 풀렸으면 그립 복귀 (Shift 를 누르고 꺾고 있으면 계속, 관성이 다 빠졌으면 꺾고 있어도 끝)
  const settled = st.drifting && st.driftTime > 0.15 && (steerIn < 0.3 || st.driftPush <= 0) && Math.abs(st.slip) < MAX_SLIP * 0.12;
  const canStart = inp.drift && !st.driftLock && st.speed > p.maxSpeed * 0.4 && Math.abs(inp.steer) > 0.35;
  const keep = st.drifting && !straightened && !settled && st.speed > p.maxSpeed * 0.12;
  const wantDrift = !st.finished && (st.drifting ? keep : canStart);
  if (st.drifting && !wantDrift) {
    // 드리프트 종료 → 순간부스터 입력 창 (너무 짧은 드리프트는 제외)
    if (st.driftTime >= MINI_MIN_DRIFT) st.miniWindow = MINI_WINDOW;
    st.driftTime = 0;
    if (inp.drift) st.driftLock = true;
  } else if (!st.drifting && wantDrift) {
    st.gaugeAtDriftStart = st.gauge;
    st.driftDir = Math.sign(inp.steer);
    st.counterT = 0;
    st.driftPush = 1;
  }
  st.drifting = wantDrift;
  if (st.drifting) st.driftTime += dt;

  // ---- 조향
  const speedFrac = Math.min(1, Math.abs(st.speed) / p.maxSpeed);
  const grip = Math.min(1, Math.abs(st.speed) / 10); // 저속에서는 잘 안 돌아감
  let yawRate = inp.steer * p.handling * 1.8 * grip * (1 - 0.35 * speedFrac);
  if (st.slipT > 0) yawRate += Math.sin(time * 23 + st.slipT * 9) * 2.5; // 바나나: 비틀거림
  // 드리프트 완급: 누른 시간이 길수록 깊어진다 (0 → 0.8s). 얕은 드리프트 = 살짝 미끄러지며 게이지 효율 ↑, 깊은 드리프트 = 유턴급 회전
  // Shift 를 뗀 관성 슬라이드는 관성(push)이 빠지는 만큼 얕아진다 — 처음엔 거의 그대로 밀리다 끝에서 빠진다
  const push = st.drifting ? (inp.drift ? 1 : Math.sqrt(st.driftPush)) : 0;
  const deep = st.drifting ? Math.min(1, st.driftTime / 1.1) * push : 0;
  // 드리프트 중 ↑ 를 떼면 덜 미끄러지고 더 꺾인다 (카트라이더 완급 조절)
  const easing = st.drifting && inp.throttle <= 0 ? 1 : 0;
  // 드리프트 중 브레이크(↓)를 같이 누르면 더 조인다 — 헤어핀 유턴용
  if (st.drifting) yawRate *= (1.1 + 0.7 * deep) * (1 + 0.15 * easing) * (1 + 0.35 * Math.min(1, inp.brake));
  // 최고속을 넘으면(부스터) 선회력도 같이 올라간다 — 350km/h 에서도 실력으로 코너를 돌 수 있게
  yawRate *= Math.pow(Math.max(1, Math.abs(st.speed) / p.maxSpeed), 0.75);
  if (st.speed < 0) yawRate = -yawRate;
  st.yaw -= yawRate * dt;

  // ---- 슬립 (드리프트 시 옆으로 미끄러짐)
  const slipBefore = st.slip;
  if (st.drifting) {
    const slideMul = (0.55 + 0.45 * deep) * (1 - 0.45 * easing); // ↑ 떼면 슬립 절반
    // 진입 킥: 처음 잠깐은 방향키를 얼마나 꺾었든 꼬리가 확 빠진다 (톡 쳐도 각이 선다)
    const kicking = st.driftTime < DRIFT_KICK_TIME && steerIn > -0.2;
    const engage = Math.max(kicking ? DRIFT_KICK_SLIP : 0, Math.min(1, steerIn)); // 드리프트 방향으로 꺾는 만큼 깊어진다
    const target = st.driftDir * MAX_SLIP * Math.max(slideMul, kicking ? DRIFT_KICK_SLIP : 0) * engage * push;
    // 슬립 변화 속도 = 완급 조절: 꺾으면 빨리 깊어지고, 놓으면 천천히 끌리며 펴지고, 반대로 꺾으면 탁 끊긴다
    const follow =
      kicking ? 11
      : Math.abs(target) >= Math.abs(st.slip) ? 2.4 + 1.6 * easing
      : steerIn < -0.2 ? 3 + 6 * -steerIn // 역조향: 제자리에서 끊기
      : inp.drift && engage < 0.2 ? 3 // Shift 만 누르고 직진: 오래 못 버틴다
      : 1.2; // 방향키를 놓으면 쭉 끌린다
    // 부드럽게 붙고 풀리도록 지수 보간 (프레임레이트 무관)
    st.slip += (target - st.slip) * (1 - Math.exp(-follow * dt));
    // 깊을수록·↑ 뗄수록 속도 손실 (관성 슬라이드는 덜, 부스터 중엔 절반 — 부스터 드리프트로 속도를 이어 간다)
    st.speed *= Math.max(0, 1 - (0.3 + 0.4 * deep + 0.25 * easing) * (0.4 + 0.6 * push) * (boosting ? 0.5 : 1) * dt);
    if (driftBoosts && !(st.boosts >= MAX_BOOSTS && st.blueBoosts >= MAX_BOOSTS)) {
      // 부스터 중 드리프트는 2배 (카트라이더의 부스터 드리프트 충전 보너스) — 잘 이으면 부스터가 끊기지 않는다. 얕은 드리프트가 충전 효율이 좋다
      // 슬립만큼 찬다: 끌리는 동안에도 차고, 펴지면 멈춘다
      // 짧게 끊는 드리프트(톡톡이)도 게이지가 쏠쏠히 찬다 — 직선에서 끊어 치며 게이지를 모으는 기술
      const cut = st.driftTime < DRIFT_CUT_TIME ? DRIFT_CUT_BONUS : 1;
      const bonus = (boosting ? 2 : mini ? 1.25 : 1) * (1.25 - 0.35 * deep) * cut;
      st.gauge += Math.sqrt(Math.abs(st.slip) / MAX_SLIP) * speedFrac * p.gaugeRate * bonus * dt;
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
    st.slip += (0 - st.slip) * (1 - Math.exp(-6 * dt));
    if (Math.abs(st.slip) < 1e-3) st.slip = 0;
  }
  // 슬립이 변한 만큼 코도 같이 돈다: 진입 땐 코가 안쪽으로 꺾이며 꼬리가 빠지고(진행 방향은 거의 그대로),
  // 끊으면 코가 제자리로 돌아온다 — 그래서 직선에서 톡톡 끊어 쳐도 라인이 안 흔들린다
  st.yaw -= (st.slip - slipBefore) * DRIFT_NOSE_FOLLOW;

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
      st.speed *= 0.6; // 벽에 박으면 확 깎인다 — 코너링을 잘해야 하는 이유
      st.bumpT = 0.4;
      st.bumpDir = -Math.sign(st.lat);
      hitDuringDrift(st);
      events.push({ k: 'wall' });
    } else {
      st.speed *= Math.max(0, 1 - 1.2 * dt);
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
        st.speed *= 0.45;
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
    if (a.bumpT <= 0) a.speed *= 1 - 0.3 * ka; // 부딪힌 순간 한 번 크게 (가벼울수록 더)
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
    if (b.bumpT <= 0) b.speed *= 1 - 0.3 * kb;
    if (b.bumpT <= 0) {
      b.bumpT = 0.3;
      b.bumpDir = ra > 0 ? 1 : -1;
      hitDuringDrift(b);
    }
  }
  return true;
}
