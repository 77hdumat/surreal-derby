import type { RacerDefinition } from './Racer';
import type { KartParams } from '../game/KartPhysics';
import type { JockeyHead } from './rig/JockeyHeads';

export interface JockeyMul {
  maxSpeed: number;
  accel: number;
  handling: number;
  mass: number;
  gaugeRate: number;
  boostMul: number;
}

export interface Jockey {
  id: string;
  name: string;
  /** 한 줄 특성 설명 */
  desc: string;
  emoji: string;
  /** 유니폼(실크) 색 */
  silks: number;
  /** 소매·헬멧·안장천 색 */
  cloth: number;
  /** 캐릭터 머리 */
  head: JockeyHead;
  mul: JockeyMul;
}

const base: JockeyMul = { maxSpeed: 1, accel: 1, handling: 1, mass: 1, gaugeRate: 1, boostMul: 1.57 };

/** 기수 6명. 말 스탯에 곱해져 조합 성능을 만든다 (카트라이더의 캐릭터×카트). */
/** 기수 6명 — 보너스만 있음(페널티 없음). 말 스탯에 곱해진다 (카트라이더의 캐릭터×카트). */
export const JOCKEYS: Jockey[] = [
  { id: 'skull', name: '해골 기사', desc: '최고속 +8%', emoji: '💀', head: 'skull', silks: 0x1d1d1d, cloth: 0x6b0f1a, mul: { ...base, maxSpeed: 1.08 } },
  { id: 'robot', name: '로보 제트', desc: '가속 +25%', emoji: '🤖', head: 'robot', silks: 0x2a9dff, cloth: 0x0d1b2a, mul: { ...base, accel: 1.25 } },
  { id: 'cat', name: '냥냥이', desc: '조향 +15% · 게이지 충전 +20%', emoji: '🐱', head: 'cat', silks: 0xffb703, cloth: 0x7a4a12, mul: { ...base, handling: 1.15, gaugeRate: 1.2 } },
  { id: 'alien', name: '외계인 X', desc: '부스트 출력 +12%', emoji: '👽', head: 'alien', silks: 0x8338ec, cloth: 0xc0f56b, mul: { ...base, boostMul: base.boostMul * 1.12 } },
  { id: 'pumpkin', name: '호박 대장', desc: '전 능력 +4%', emoji: '🎃', head: 'pumpkin', silks: 0xf28c28, cloth: 0x2b2d42, mul: { ...base, maxSpeed: 1.04, accel: 1.04, handling: 1.04, gaugeRate: 1.04 } },
  { id: 'pig', name: '꿀꿀이', desc: '질량 +50% (안 밀림) · 조향 +5%', emoji: '🐷', head: 'pig', silks: 0xf4a3b5, cloth: 0x3a5a40, mul: { ...base, mass: 1.5, handling: 1.05 } },
];



export function jockeyById(id: string): Jockey {
  return JOCKEYS.find((j) => j.id === id) ?? JOCKEYS[0];
}

interface MountKart {
  /** 최고속 km/h */
  top: number;
  accel: number;
  handling: number;
  mass: number;
  /** 부스트 배수 보정 (1 = 기수값 그대로) */
  boost?: number;
  /** 게이지 충전 보정 */
  gauge?: number;
  /** 부스트 중 결승선 판정 코 길이 */
  reach?: number;
}

/**
 * 말별 주행 밸런스 (대결 모드 전용, 관람 모드 스탯과 분리).
 * 총합은 비슷하게, 각자 강점 하나씩: 최고속 / 출발 가속 / 코너 / 질량 / 부스트 / 코 길이.
 */
export const MOUNT_KART: Record<string, MountKart> = {
  classic: { top: 140, accel: 10, handling: 1.25, mass: 92 }, // 올라운더
  human: { top: 131, accel: 14, handling: 1.32, mass: 64 }, // 출발·코너 최강, 최고속 최하, 가벼워 잘 밀림
  costume: { top: 145, accel: 9, handling: 0.98, mass: 70 }, // 직선 괴물, 코너 둔함
  longbody: { top: 138, accel: 11, handling: 1.05, mass: 104, reach: 8 }, // 골인 코 길이
  elephant: { top: 136, accel: 7.5, handling: 1.1, mass: 200, boost: 1.06 }, // 탱크: 부딪히면 상대가 밀림
  cow: { top: 137, accel: 8, handling: 1.15, mass: 110, boost: 1.08 }, // 강한 부스트
  motorcycle: { top: 147, accel: 8, handling: 1.05, mass: 82, gauge: 0.9 }, // 최고속 1위, 가속·충전 약함
  giraffe: { top: 137, accel: 8.5, handling: 1.15, mass: 120, reach: 5.5 },
  circus: { top: 136, accel: 10, handling: 1.3, mass: 91, gauge: 1.2 }, // 드리프트 충전 빠름
  trojan: { top: 139, accel: 6.5, handling: 1.05, mass: 162, boost: 1.05 }, // 무겁고 부스트 강함
};

/** 말 정의 × 기수 → 주행 파라미터 */
export function kartParamsFor(def: RacerDefinition, j: Jockey): KartParams {
  const m = j.mul;
  const k = MOUNT_KART[def.id] ?? { top: def.speed * 2.4 * 3.6, accel: def.acceleration * 2.8, handling: 0.85 + def.cornering * 0.6, mass: 50 + Math.pow(def.weight, 0.6) };
  return {
    maxSpeed: (k.top / 3.6) * m.maxSpeed,
    accel: k.accel * m.accel,
    handling: k.handling * m.handling,
    mass: k.mass * m.mass,
    gaugeRate: 0.8 * (k.gauge ?? 1) * m.gaugeRate,
    boostMul: m.boostMul * (k.boost ?? 1),
    radius: 1.3,
    boostReach: k.reach ?? 0,
  };
}

/** 로비 스탯 바용 0..1 정규화 */
export function statBars(def: RacerDefinition, j: Jockey): { label: string; value: number }[] {
  const p = kartParamsFor(def, j);
  const n = (v: number, lo: number, hi: number) => Math.max(0.05, Math.min(1, (v - lo) / (hi - lo)));
  return [
    { label: '최고속', value: n(p.maxSpeed, 34, 45) },
    { label: '가속', value: n(p.accel, 4, 16) },
    { label: '조향', value: n(p.handling, 0.85, 1.5) },
    { label: '충전', value: n(p.gaugeRate, 0.65, 1.1) },
    { label: '부스트', value: n(p.boostMul, 1.4, 1.8) },
    { label: '질량', value: n(p.mass, 60, 260) },
  ];
}
