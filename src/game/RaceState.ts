export type RacePhase = 'INTRO' | 'COUNTDOWN' | 'RACING' | 'FINISH' | 'RESULT';

export type RacerStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'BOOSTING'
  | 'CHARGING'
  | 'RAGING'
  | 'COLLAPSED'
  | 'RECOVERING'
  | 'STUNNED'
  | 'EXHAUSTED'
  | 'ENGINE_FAILURE'
  | 'BIPEDAL'
  | 'STRETCHED'
  | 'PERFORMING'
  | 'AMBUSH'
  | 'GRABBING'
  | 'CARRYING'
  | 'FALLEN'
  | 'REVERSING'
  | 'BROKEN'
  | 'SLEEPING'
  | 'STUBBORN'
  | 'SHOELACE'
  | 'SPRAYING'
  | 'FINISHED';

/** RaceEngine 이 매 프레임 갱신하는 순수 데이터. Three.js 는 이 값을 읽기만 한다. */
export interface RacerState {
  id: string;
  number: number;
  currentSpeed: number;
  distance: number;
  /** 트랙 중심선 기준 횡방향 위치(m). 음수 = 안쪽(왼쪽) */
  lane: number;
  targetLane: number;
  homeLane: number;
  state: RacerStatus;
  stateTimer: number;
  stamina: number;
  staminaMax: number;
  fatigued: boolean;
  speedMultiplier: number;
  accelMultiplier: number;
  /** 0..1 — 잔상/FOV/파티클 연출 강도 */
  boostIntensity: number;
  rank: number;
  prevRank: number;
  finishTime: number | null;
  form: number;
  /** 최근 접촉으로 인한 흔들림 (초) */
  bumpTimer: number;
  bumpDir: number;
  riderless: boolean;
  /** 결승선 판정 보너스 (기린 목 등) */
  finishBonus: number;
  lastAccel: number;
  wobbleSeed: number;
  /** 몸/목 늘어남 0..1 */
  extension: number;
  /** 늘어남 최대 길이(m) — 시나리오 피날레에서 커짐 */
  extensionMax: number;
  /** 시나리오 우승 보정 활성 */
  destiny: boolean;
}

export interface RankingEntry {
  id: string;
  number: number;
  rank: number;
  distance: number;
  gapToLeader: number;
  finished: boolean;
}
