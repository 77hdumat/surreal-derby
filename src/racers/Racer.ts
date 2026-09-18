import type { RacerState } from '../game/RaceState';

export type SpecialAbility =
  | 'COSTUME'
  | 'LONGBODY'
  | 'ELEPHANT'
  | 'COW'
  | 'MOTORCYCLE'
  | 'HUMAN'
  | 'GIRAFFE'
  | 'CIRCUS'
  | 'TROJAN'
  | 'CLASSIC';

export interface RacerDefinition {
  id: string;
  number: number;
  name: string;
  nameEn: string;
  /** 일본어 음성 중계용 이름 */
  nameJa: string;
  emoji: string;
  /** 최고 속도 (m/s) */
  speed: number;
  /** 가속도 (m/s²) */
  acceleration: number;
  /** 0..1 */
  stamina: number;
  /** 0..1 */
  cornering: number;
  /** kg — 충돌 시 밀림 계산 */
  weight: number;
  /** 0..1 */
  luck: number;
  specialAbility: SpecialAbility;
  abilityName: string;
  abilityDesc: string;
  description: string;
  bodyColor: number;
  clothColor: number;
  silksColor: number;
  /** 보폭 (m) — 말발굽 소리/파티클 주기 */
  strideLength: number;
  /** GLB 경로를 지정하면 placeholder 대신 GLTF 모델을 사용 */
  modelUrl?: string;
  /** GLB 안의 달리기 클립 이름 (없으면 첫 클립) */
  runClipName?: string;
  /** GLB 크기 보정 (말 키 ≈ 1.6m 가 되도록) */
  modelScale?: number;
  /** GLB 가 +x 를 보지 않을 때 Y축 회전 보정 (라디안). 예: +z 를 보는 모델 → -Math.PI/2 */
  modelYaw?: number;
}

export class Racer {
  readonly def: RacerDefinition;
  readonly state: RacerState;

  constructor(def: RacerDefinition, homeLane: number) {
    this.def = def;
    this.state = {
      id: def.id,
      number: def.number,
      currentSpeed: 0,
      distance: 0,
      lane: homeLane,
      targetLane: homeLane,
      homeLane,
      state: 'IDLE',
      stateTimer: 0,
      stamina: 1,
      staminaMax: 1,
      fatigued: false,
      speedMultiplier: 1,
      accelMultiplier: 1,
      boostIntensity: 0,
      rank: def.number,
      prevRank: def.number,
      finishTime: null,
      form: 1,
      bumpTimer: 0,
      bumpDir: 0,
      riderless: false,
      finishBonus: 0,
      lastAccel: 0,
      wobbleSeed: Math.random() * 1000,
      extension: 0,
      extensionMax: 0,
      destiny: false,
    };
  }

  reset(homeLane: number): void {
    const s = this.state;
    s.currentSpeed = 0;
    s.distance = -2.2; // 게이트 안
    s.lane = homeLane;
    s.targetLane = homeLane;
    s.homeLane = homeLane;
    s.state = 'IDLE';
    s.stateTimer = 0;
    s.staminaMax = 20 + this.def.stamina * 60;
    s.stamina = s.staminaMax;
    s.fatigued = false;
    s.speedMultiplier = 1;
    s.accelMultiplier = 1;
    s.boostIntensity = 0;
    s.rank = this.def.number;
    s.prevRank = this.def.number;
    s.finishTime = null;
    // 컨디션: 매 레이스 ±9% — 기본 능력치 차이보다 커서 우승자가 매번 달라짐
    s.form = 0.88 + Math.random() * 0.24;
    s.bumpTimer = 0;
    s.bumpDir = 0;
    s.riderless = false;
    s.finishBonus = 0;
    s.lastAccel = 0;
    s.wobbleSeed = Math.random() * 1000;
    s.extension = 0;
    s.extensionMax = 0;
    s.destiny = false;
  }
}
