import type { KartState } from '../game/KartPhysics';
import type { RaceEventK, RaceResult, SlotConfig } from '../game/KartRace';

export interface LobbySlot {
  name: string;
  mountId: string;
  jockeyId: string;
  ready: boolean;
  cpu: boolean;
  /** 사람 접속 여부 (false + cpu=false = 빈 자리) */
  human: boolean;
}

/** 입력 압축: [steer, throttle, brake, flags] flags bit0 = drift, bit1 = boost */
export type InputTuple = [number, number, number, number];

export type NetMsg =
  | { t: 'welcome'; slot: number }
  | { t: 'hello'; name: string; mountId: string; jockeyId: string }
  | { t: 'pick'; mountId: string; jockeyId: string }
  | { t: 'ready'; v: boolean }
  | { t: 'lobby'; slots: LobbySlot[] }
  | { t: 'full'; why: 'slots' | 'playing' }
  | { t: 'start'; slots: SlotConfig[]; seed: number }
  | { t: 'count'; n: number }
  /** 호스트 → 전원: 슬롯별 최신 상태 + 각 상태의 원 발신 타임스탬프 */
  | { t: 'snap'; q: number; k: (number[] | null)[]; ts: number[] }
  /** 클라 → 호스트: 자기 말 상태 (클라이언트 권위) */
  | { t: 'st'; q: number; ts: number; k: number[] }
  | { t: 'in'; q: number; d: InputTuple }
  | { t: 'ev'; ev: RaceEventK[] }
  | { t: 'over'; results: RaceResult[] }
  | { t: 'tolobby' }
  /** 채팅: 클라→호스트는 text 만, 호스트→전원은 from/name 포함. sys = 시스템 안내 */
  | { t: 'chat'; text: string; from?: number; name?: string; sys?: boolean }
  | { t: 'kicked' }
  | { t: 'hb'; t0: number }
  | { t: 'ping'; t0: number }
  | { t: 'pong'; t0: number };

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** 스냅샷 한 칸: 소수 2~3자리로 줄여 30Hz × 4명이 가볍게 */
export function encodeKart(k: KartState): number[] {
  return [
    r2(k.x),
    r2(k.z),
    r3(k.yaw),
    r2(k.speed),
    r3(k.slip),
    r3(k.gauge),
    r2(k.boostT),
    r2(k.progress),
    k.lapsDone,
    r2(k.bumpT),
    k.bumpDir,
    k.finished ? 1 : 0,
    k.finishTime === null ? -1 : r2(k.finishTime),
    k.drifting ? 1 : 0,
    r2(k.s),
    r2(k.lat),
    r2(k.miniT),
    k.boosts,
  ];
}

export const KART_FIELDS = 18;

/** 스냅샷 값 → 상태. 위치(x,z,yaw)는 보간 대상이라 applyPos=false 로 건너뛸 수 있다 */
export function decodeKart(a: number[], into: KartState, applyPos = true): KartState {
  if (applyPos) {
    into.x = a[0];
    into.z = a[1];
    into.yaw = a[2];
  }
  into.speed = a[3];
  into.slip = a[4];
  into.gauge = a[5];
  into.boostT = a[6];
  into.progress = a[7];
  into.lapsDone = a[8];
  into.bumpT = a[9];
  into.bumpDir = a[10];
  into.finished = a[11] === 1;
  into.finishTime = a[12] < 0 ? null : a[12];
  into.drifting = a[13] === 1;
  into.s = a[14];
  into.lat = a[15];
  into.miniT = a[16] ?? 0;
  into.boosts = a[17] ?? 0;
  return into;
}

export function encodeInput(i: { steer: number; throttle: number; brake: number; drift: boolean; boost: boolean }): InputTuple {
  return [r2(i.steer), r2(i.throttle), r2(i.brake), (i.drift ? 1 : 0) | (i.boost ? 2 : 0)];
}

export function decodeInput(d: InputTuple): { steer: number; throttle: number; brake: number; drift: boolean; boost: boolean } {
  return { steer: d[0], throttle: d[1], brake: d[2], drift: (d[3] & 1) !== 0, boost: (d[3] & 2) !== 0 };
}
