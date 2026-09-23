import type { TrackGeometry } from '../track/TrackGeometry';
import type { RacerDefinition } from '../racers/Racer';
import { jockeyById, kartParamsFor } from '../racers/Jockeys';
import { cpuInput, cpuProfile, type CpuProfile } from './CpuDriver';
import { generateObstacles, type Obstacle } from './Obstacles';
import { ItemSystem, type ItemEvent } from './Items';
import {
  IDLE_INPUT,
  applyStartBoost,
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
  /** 로비(네트워크) 슬롯 번호 — 레이스 슬롯과 다를 수 있다 (빈 자리를 건너뛰므로) */
  lobby?: number;
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
/** 1등 골인 후 이 시간 안에 못 들어오면 리타이어 */
export const FINISH_GRACE = 10;
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
  /** 이 피어가 물리를 돌리는 슬롯 (자기 말 + 호스트라면 CPU). 나머지는 원격 상태를 받아 쓴다 */
  owned: boolean[] = [];
  /** 결과 판정 권한 (호스트/솔로) */
  authority = true;
  obstacles: Obstacle[] = [];
  seed = 0;
  /** 아이템전 (상자·투사체). mySlot 은 setup 에서 */
  items: ItemSystem;
  /** 이번 step 의 아이템 이벤트 (호출자가 비우고 남에게 보낸다) */
  itemEvents: ItemEvent[] = [];
  /** 1등 골인 시각 (전 피어 공통: 골인 플래그를 본 순간) */
  firstFinishSeen: number | null = null;
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
    this.items = new ItemSystem(track, 0);
  }

  defOf(slot: number): RacerDefinition {
    const id = this.slots[slot]?.mountId;
    return this.defs.find((d) => d.id === id) ?? this.defs[0];
  }

  /** 출발선(=결승선) 바로 앞에 4명 나란히 (앞뒤 차이 없음) */
  setup(slots: SlotConfig[], owned?: (slot: SlotConfig) => boolean, seed = 1): void {
    this.slots = slots.slice(0, MAX_SLOTS).map((s, i) => ({ ...s, slot: i, lobby: s.lobby ?? i }));
    this.seed = seed;
    this.obstacles = generateObstacles(seed, this.track);
    const mySlot = this.slots.findIndex((s) => (owned ? owned(s) : true) && !s.cpu);
    this.items.setup(seed, Math.max(0, mySlot));
    this.itemEvents = [];
    this.firstFinishSeen = null;
    this.owned = this.slots.map((s) => (owned ? owned(s) : true));
    this.karts = [];
    this.params = [];
    this.inputs = [];
    this.profiles = [];
    this.cpuScratch = [];
    const n = this.slots.length;
    this.slots.forEach((cfg, i) => {
      const s = 5;
      // 폭 30m 에 6m 간격으로 가운데 정렬
      const lat = (i - (n - 1) / 2) * 6;
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

  /** 클라이언트: 호스트의 GO 신호로 바로 주행 시작 */
  startRacing(): void {
    this.phase = 'RACING';
    this.countdown = 0;
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
        // 능숙한 봇은 출발 부스터를 쓴다
        this.slots.forEach((s, i) => {
          if (s.cpu && this.owned[i] && this.profiles[i].skill > 0.94) {
            applyStartBoost(this.karts[i]);
            this.events.push({ k: 'boost', slot: i });
          }
        });
      }
      return;
    }
    // OVER 뒤에도 골인한 말들이 유유히 돌게 물리는 계속
    if (this.phase !== 'RACING' && this.phase !== 'OVER') return;
    this.time += dt;
    for (let i = 0; i < this.karts.length; i++) {
      if (!this.owned[i]) continue;
      const st = this.karts[i];
      const inp = this.slots[i].cpu ? cpuInput(st, this.params[i], this.track, this.karts, this.profiles[i], this.cpuScratch[i], this.obstacles, dt) : this.inputs[i];
      for (const e of stepKart(st, inp, this.params[i], this.track, dt, this.time, this.obstacles)) this.events.push({ ...e, slot: i });
    }
    // 충돌: 내가 돌리는 말만 밀린다 (상대는 자기 쪽에서 자기 말을 민다)
    for (let a = 0; a < this.karts.length; a++) {
      for (let b = a + 1; b < this.karts.length; b++) {
        if (!this.owned[a] && !this.owned[b]) continue;
        const hitBefore = this.karts[a].bumpT > 0 || this.karts[b].bumpT > 0;
        if (resolveKartCollision(this.karts[a], this.params[a], this.karts[b], this.params[b], this.owned[a], this.owned[b]) && !hitBefore) {
          this.events.push({ k: 'bump', slot: a, other: b });
        }
      }
    }
    this.computeRanking();
    // 아이템: 상자·투사체·피격 (소유 말만 판정)
    this.items.step(dt, this.time, this.karts, this.owned, this.ranking);
    if (this.items.events.length) {
      this.itemEvents.push(...this.items.events);
      this.items.events = [];
    }
    if (this.firstFinishSeen === null && this.karts.some((k) => k.finished)) this.firstFinishSeen = this.time;
    if (this.authority && this.phase === 'RACING') this.checkOver();
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

  /** 내 말이 아이템 사용 (이벤트를 돌려주면 남에게 보낸다) */
  useItem(slot: number): ItemEvent | null {
    if (this.phase !== 'RACING') return null;
    return this.items.use(slot, this.karts, this.ranking);
  }

  /** 1등 골인 뒤 남은 시간 (초). 아직 아무도 안 들어왔으면 null */
  finishCountdown(): number | null {
    if (this.firstFinishSeen === null) return null;
    return Math.max(0, FINISH_GRACE - (this.time - this.firstFinishSeen));
  }

  private checkOver(): void {
    if (this.firstFinishTime === null) {
      const first = this.karts.filter((k) => k.finished).map((k) => k.finishTime ?? 0);
      if (first.length) this.firstFinishTime = Math.min(...first);
    }
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
