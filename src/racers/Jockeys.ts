import type { RacerDefinition } from './Racer';
import type { KartParams } from '../game/KartPhysics';

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
  mul: JockeyMul;
}

const base: JockeyMul = { maxSpeed: 1, accel: 1, handling: 1, mass: 1, gaugeRate: 1, boostMul: 1.35 };

/** 기수 6명. 말 스탯에 곱해져 조합 성능을 만든다 (카트라이더의 캐릭터×카트). */
export const JOCKEYS: Jockey[] = [
  { id: 'speed', name: '스피드 마스터', desc: '최고속 +8% · 조향 -5%', emoji: '⚡', silks: 0xe63946, cloth: 0x1d1d1d, mul: { ...base, maxSpeed: 1.08, handling: 0.95 } },
  { id: 'accel', name: '스타트 대시', desc: '가속 +20% · 최고속 -3%', emoji: '🚀', silks: 0xffb703, cloth: 0x023047, mul: { ...base, accel: 1.2, maxSpeed: 0.97 } },
  { id: 'drift', name: '드리프트 킹', desc: '조향 +15% · 게이지 충전 +25%', emoji: '🌀', silks: 0x2a9d8f, cloth: 0xf1faee, mul: { ...base, handling: 1.15, gaugeRate: 1.25 } },
  { id: 'boost', name: '부스트 매니아', desc: '부스트 출력 1.5배 · 충전 -10%', emoji: '🔥', silks: 0x8338ec, cloth: 0xffbe0b, mul: { ...base, boostMul: 1.5, gaugeRate: 0.9 } },
  { id: 'balance', name: '올라운더', desc: '모든 능력 기본', emoji: '🎯', silks: 0xffffff, cloth: 0x2b2d42, mul: { ...base } },
  { id: 'heavy', name: '헤비 가드', desc: '질량 +40% (안 밀림) · 가속 -10%', emoji: '🛡️', silks: 0x3a5a40, cloth: 0xdad7cd, mul: { ...base, mass: 1.4, accel: 0.9 } },
];

export function jockeyById(id: string): Jockey {
  return JOCKEYS.find((j) => j.id === id) ?? JOCKEYS[4];
}

/** 말 정의 × 기수 → 주행 파라미터 */
export function kartParamsFor(def: RacerDefinition, j: Jockey): KartParams {
  const m = j.mul;
  return {
    maxSpeed: def.speed * 1.75 * m.maxSpeed,
    accel: def.acceleration * 2.1 * m.accel,
    handling: (0.85 + def.cornering * 0.6) * m.handling,
    // 85kg 사람부터 4t 코끼리까지 — 압축해서 3:1 정도로
    mass: (50 + Math.pow(def.weight, 0.6)) * m.mass,
    gaugeRate: 0.5 * m.gaugeRate,
    boostMul: m.boostMul,
    radius: 1.3,
  };
}

/** 로비 스탯 바용 0..1 정규화 */
export function statBars(def: RacerDefinition, j: Jockey): { label: string; value: number }[] {
  const p = kartParamsFor(def, j);
  const n = (v: number, lo: number, hi: number) => Math.max(0.05, Math.min(1, (v - lo) / (hi - lo)));
  return [
    { label: '최고속', value: n(p.maxSpeed, 24, 33) },
    { label: '가속', value: n(p.accel, 3, 12) },
    { label: '조향', value: n(p.handling, 0.85, 1.5) },
    { label: '충전', value: n(p.gaugeRate, 0.4, 0.7) },
    { label: '부스트', value: n(p.boostMul, 1.2, 1.6) },
    { label: '질량', value: n(p.mass, 60, 260) },
  ];
}
