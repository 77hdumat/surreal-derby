import type { TrackGeometry } from '../track/TrackGeometry';
import type { RacerDefinition } from '../racers/Racer';
import { jockeyById, kartParamsFor } from '../racers/Jockeys';
import { cpuInput, cpuProfile, type CpuProfile } from './CpuDriver';
import {
  IDLE_INPUT,
  createKartState,
  resolveKartCollision,
  stepKart,
  syncKartToTrack,
  type KartEvent,
  type KartInput,
  type KartParams,
  type KartState,
} from './KartPhysics';

export interface SlotConfig {
  slot: number;
  name: string;
  mountId: string;
  jockeyId: string;
  cpu: boolean;
}

export type RacePhaseK = 'IDLE' | 'COUNTDOWN' | 'RACING' | 'OVER';

export type RaceEventK = (KartEvent | { k: 'bump'; other: number }) & { slot: number };

export interface RaceResult {
  slot: number;
  rank: number;
  /** null = 시간 초과로 미완주 */
  time: number | null;
}

export const COUNTDOWN_SECONDS = 3;
/** 1등 골인 후 이 시간이 지나면 나머지는 현재 순위로 마감 */
export const FINISH_GRACE = 25;
export const MAX_SLOTS = 4;

/**
 * 레이스 상태기. 호스트/솔로에서 고정 dt 로 step 한다. Three.js 무관.
 */
export class KartRace {
  readonly track: TrackGeometry;
  private defs: RacerDefinition[];
  slots: SlotConfig[] = [];
  karts: KartState[] = [];
  params: KartParams[] = [];
  private inputs: KartInput[] = [];
  private profiles: CpuProfile[] = [];
  private cpuScratch: KartInput[] = [];
  phase: RacePhaseK = 'IDLE';
  time = 0;
  countdown = 0;
  /** 순위 순 슬롯 번호 */
  ranking: number[] = [];
  /** 이번 step 에서 발생한 이벤트 (호출자가 비운다) */
  events: RaceEventK[] = [];
  results: RaceResult[] = [];
  firstFinishTime: number | null = null;

  constructor(track: TrackGeometry, defs: RacerDefinition[]) {
    this.track = track;
    this.defs = defs;
  }

  defOf(slot: number): RacerDefinition {
    const id = this.slots[slot]?.mountId;
    return this.defs.find((d) => d.id === id) ?? this.defs[0];
  }

  /** 2×2 그리드 배치. 게이트 뒤(s<0)에서 출발 */
  setup(slots: SlotConfig[]): void {
    this.slots = slots.slice(0, MAX_SLOTS).map((s, i) => ({ ...s, slot: i }));
    this.karts = [];
    this.params = [];
    this.inputs = [];
    this.profiles = [];
    this.cpuScratch = [];
    this.slots.forEach((cfg, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const s = -4 - row * 5;
      const lat = this.track.laneToLat(3 + col * 3);
      const p = this.track.getPoint(s, lat);
      const st = createKartState(p.x, p.z, this.track.yawAt(s));
      syncKartToTrack(st, this.track);
      this.karts.push(st);
      this.params.push(kartParamsFor(this.defOf(i), jockeyById(cfg.jockeyId)));
      this.inputs.push({ ...IDLE_INPUT });
      this.profiles.push(cpuProfile(i + 1));
      this.cpuScratch.push({ ...IDLE_INPUT });
    });
    this.phase = 'IDLE';
    this.time = 0;
    this.countdown = 0;
    this.events = [];
    this.results = [];
    this.firstFinishTime = null;
    this.computeRanking();
  }

  startCountdown(): void {
    this.phase = 'COUNTDOWN';
    this.countdown = COUNTDOWN_SECONDS;
    this.time = 0;
  }

  setInput(slot: number, input: KartInput): void {
    const t = this.inputs[slot];
    if (!t) return;
    t.steer = Math.max(-1, Math.min(1, input.steer || 0));
    t.throttle = Math.max(0, Math.min(1, input.throttle || 0));
    t.brake = Math.max(0, Math.min(1, input.brake || 0));
    t.drift = !!input.drift;
    t.boost = !!input.boost;
  }

  inputOf(slot: number): KartInput {
    return this.inputs[slot];
  }

  step(dt: number): void {
    if (this.phase === 'COUNTDOWN') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = 'RACING';
      }
      return;
    }
    if (this.phase !== 'RACING') return;
    this.time += dt;
    for (let i = 0; i < this.karts.length; i++) {
      const st = this.karts[i];
      const inp = this.slots[i].cpu ? cpuInput(st, this.params[i], this.track, this.karts, this.profiles[i], this.cpuScratch[i]) : this.inputs[i];
      for (const e of stepKart(st, inp, this.params[i], this.track, dt, this.time)) this.events.push({ ...e, slot: i });
    }
    for (let a = 0; a < this.karts.length; a++) {
      for (let b = a + 1; b < this.karts.length; b++) {
        const hitBefore = this.karts[a].bumpT > 0 || this.karts[b].bumpT > 0;
        if (resolveKartCollision(this.karts[a], this.params[a], this.karts[b], this.params[b]) && !hitBefore) {
          this.events.push({ k: 'bump', slot: a, other: b });
        }
      }
    }
    for (const e of this.events) if (e.k === 'finish' && this.firstFinishTime === null) this.firstFinishTime = this.time;
    this.computeRanking();
    this.checkOver();
  }

  /** 클라이언트가 스냅샷 적용 후 순위를 다시 계산할 때 */
  refreshRanking(): void {
    this.computeRanking();
  }

  private computeRanking(): void {
    const idx = this.karts.map((_, i) => i);
    idx.sort((a, b) => {
      const ka = this.karts[a];
      const kb = this.karts[b];
      if (ka.finished && kb.finished) return (ka.finishTime ?? Infinity) - (kb.finishTime ?? Infinity);
      if (ka.finished !== kb.finished) return ka.finished ? -1 : 1;
      return kb.progress - ka.progress;
    });
    this.ranking = idx;
  }

  rankOf(slot: number): number {
    return this.ranking.indexOf(slot) + 1;
  }

  private checkOver(): void {
    const allDone = this.karts.every((k) => k.finished);
    const timeout = this.firstFinishTime !== null && this.time - this.firstFinishTime > FINISH_GRACE;
    if (!allDone && !timeout) return;
    this.results = this.ranking.map((slot, i) => {
      const k = this.karts[slot];
      return { slot, rank: i + 1, time: k.finished ? k.finishTime : null };
    });
    this.phase = 'OVER';
  }
}
