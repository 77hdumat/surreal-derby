import type { Racer } from '../racers/Racer';
import { EVENT_LABELS, MAJOR_EVENTS, type RaceEvent, type RaceEventType, type ScheduledEvent } from './RaceEvent';
import type { Scenario } from './Scenarios';

export type RaceEventListener = (ev: RaceEvent) => void;

interface EventSpec {
  type: RaceEventType;
  racerId: string | 'DYNAMIC';
  weight: number;
  /** 예상 레이스 시간 대비 발생 구간 (0..1) */
  window: [number, number];
  /** 불운 이벤트면 luck 이 낮을수록 확률 증가 */
  bad: boolean;
}

const EVENT_POOL: EventSpec[] = [
  { type: 'COSTUME_COLLAPSE', racerId: 'costume', weight: 0.85, window: [0.25, 0.8], bad: true },
  { type: 'ELEPHANT_CHARGE', racerId: 'elephant', weight: 0.75, window: [0.55, 0.85], bad: false },
  { type: 'ELEPHANT_TRUNK', racerId: 'elephant', weight: 0.5, window: [0.25, 0.8], bad: false },
  { type: 'ELEPHANT_STOMP', racerId: 'elephant', weight: 0.45, window: [0.2, 0.75], bad: false },
  { type: 'ELEPHANT_SPRAY', racerId: 'elephant', weight: 0.42, window: [0.2, 0.8], bad: false },
  { type: 'MOTORCYCLE_BOOST', racerId: 'motorcycle', weight: 0.85, window: [0.4, 0.72], bad: false },
  { type: 'ENGINE_FAILURE', racerId: 'motorcycle', weight: 0.3, window: [0.15, 0.9], bad: true },
  { type: 'COW_RAGE', racerId: 'cow', weight: 0.62, window: [0.3, 0.7], bad: false },
  { type: 'HUMAN_EXHAUSTED', racerId: 'human', weight: 0.5, window: [0.45, 0.8], bad: true },
  { type: 'HUMAN_BIPEDAL', racerId: 'human', weight: 0.5, window: [0.25, 0.9], bad: false },
  { type: 'GIRAFFE_NECK_ATTACK', racerId: 'giraffe', weight: 0.38, window: [0.3, 0.8], bad: false },
  { type: 'LONGBODY_STRETCH', racerId: 'longbody', weight: 0.4, window: [0.2, 0.7], bad: false },
  { type: 'CIRCUS_ACT', racerId: 'circus', weight: 0.72, window: [0.3, 0.8], bad: false },
  { type: 'TROJAN_AMBUSH', racerId: 'trojan', weight: 0.7, window: [0.35, 0.85], bad: false },
  { type: 'RIDER_FALL', racerId: 'DYNAMIC', weight: 0.32, window: [0.2, 0.85], bad: true },
  { type: 'TRIP', racerId: 'DYNAMIC', weight: 0.38, window: [0.15, 0.85], bad: true },
  { type: 'SUPER_SPRINT', racerId: 'DYNAMIC', weight: 0.36, window: [0.5, 0.85], bad: false },
  { type: 'COLLISION', racerId: 'DYNAMIC', weight: 0.5, window: [0.15, 0.8], bad: true },
  { type: 'COMEBACK', racerId: 'DYNAMIC', weight: 0.42, window: [0.55, 0.8], bad: false },
];

/**
 * 이벤트 타임라인 생성 + 예약 이벤트 발화 + 리스너 브로드캐스트 + 기록.
 * 실제 능력 적용은 RaceEngine.applyEvent 가 담당.
 */
export class RaceEventManager {
  private listeners: RaceEventListener[] = [];
  scheduled: ScheduledEvent[] = [];
  history: RaceEvent[] = [];

  on(listener: RaceEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  clear(): void {
    this.scheduled = [];
    this.history = [];
  }

  /**
   * 시나리오의 각본 이벤트 + 랜덤 필러 이벤트로 타임라인 구성.
   * 우승 예정자에게 불리한 이벤트는 필러에서 제외한다.
   */
  generateTimeline(racers: Racer[], estimatedDuration: number, scenario?: Scenario): ScheduledEvent[] {
    const luckOf = (id: string) => racers.find((r) => r.def.id === id)?.def.luck ?? 0.5;
    const scripted: ScheduledEvent[] = (scenario?.events ?? []).map((e) => ({
      time: estimatedDuration * e.at,
      racerId: e.racerId,
      event: e.event,
      fired: false,
    }));
    const usedTypes = new Set(scripted.map((e) => e.event));
    if (scenario?.finale) usedTypes.add(scenario.finale.event);
    const winner = scenario?.winnerId ?? null;
    const maxFillers = scenario ? scenario.fillers : 7;
    const picked: EventSpec[] = [];
    const rest: EventSpec[] = [];
    for (const spec of EVENT_POOL) {
      if (usedTypes.has(spec.type)) continue;
      // 우승 예정자의 불운 이벤트 제외
      if (winner && spec.bad && spec.racerId === winner) continue;
      if (winner && spec.racerId === winner && spec.type !== 'SUPER_SPRINT') continue;
      const luck = spec.racerId === 'DYNAMIC' ? 0.5 : luckOf(spec.racerId);
      const p = spec.weight * (spec.bad ? 1.3 - luck * 0.6 : 0.7 + luck * 0.6);
      if (Math.random() < p) picked.push(spec);
      else rest.push(spec);
    }
    const minFillers = scenario ? Math.min(1, maxFillers) : 3;
    while (picked.length < minFillers && rest.length) {
      const i = Math.floor(Math.random() * rest.length);
      picked.push(rest.splice(i, 1)[0]);
    }
    while (picked.length > maxFillers) {
      picked.sort((a, b) => a.weight - b.weight);
      picked.splice(Math.floor(Math.random() * Math.min(3, picked.length)), 1);
    }
    // 시간 배정 + 최소 간격 확보
    const list: ScheduledEvent[] = [
      ...scripted,
      ...picked.map((spec) => ({
        time: estimatedDuration * (spec.window[0] + Math.random() * (spec.window[1] - spec.window[0])),
        racerId: spec.racerId,
        event: spec.type,
        fired: false,
      })),
    ];
    list.sort((a, b) => a.time - b.time);
    // 최소 3초 간격 — 앞으로 당길 수 있으면 당기고, 아니면 뒤로 민다
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].time - list[i - 1].time;
      if (gap >= 3) continue;
      const earlier = list[i - 1].time - 3;
      const prevPrev = i >= 2 ? list[i - 2].time + 3 : 6;
      if (earlier >= prevPrev) list[i - 1].time = earlier;
      else list[i].time = list[i - 1].time + 3 + Math.random() * 1.2;
    }
    list.sort((a, b) => a.time - b.time);
    // 같은 선수의 부스트/고장 순서 정리: 고장 → 부스트 순이면 더 재밌으므로 그대로 두되, 겹치면 간격
    this.scheduled = list;
    return list;
  }

  /** 시간이 된 예약 이벤트를 꺼낸다 */
  popDue(time: number): ScheduledEvent[] {
    const due = this.scheduled.filter((e) => !e.fired && e.time <= time);
    due.forEach((e) => (e.fired = true));
    return due;
  }

  emit(partial: Omit<RaceEvent, 'major' | 'label'> & { major?: boolean; label?: string }): RaceEvent {
    const ev: RaceEvent = {
      ...partial,
      major: partial.major ?? MAJOR_EVENTS.has(partial.event),
      label: partial.label ?? EVENT_LABELS[partial.event],
    };
    this.history.push(ev);
    for (const l of this.listeners) l(ev);
    return ev;
  }

  /** 결과 화면용 주요 사건 */
  get highlights(): RaceEvent[] {
    return this.history.filter(
      (e) =>
        e.major || e.event === 'GIRAFFE_PHOTO_FINISH' || e.event === 'COSTUME_RECOVER' || e.event === 'ENGINE_RESTART' || e.event === 'HUMAN_EXHAUSTED' || e.event === 'LONGBODY_RETRACT',
    );
  }
}
