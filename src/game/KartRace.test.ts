import { describe, expect, it } from 'vitest';
import { TrackGeometry } from '../track/TrackGeometry';
import { RACER_DEFINITIONS } from '../racers/RacerDefinitions';
import { KartRace, type SlotConfig } from './KartRace';

const DT = 1 / 60;
const slots: SlotConfig[] = [
  { slot: 0, name: 'A', mountId: 'classic', jockeyId: 'pumpkin', cpu: true },
  { slot: 1, name: 'B', mountId: 'human', jockeyId: 'skull', cpu: true },
  { slot: 2, name: 'C', mountId: 'elephant', jockeyId: 'pig', cpu: true },
  { slot: 3, name: 'D', mountId: 'motorcycle', jockeyId: 'cat', cpu: true },
];

describe('KartRace', () => {
  it('카운트다운 3초 뒤 RACING', () => {
    const r = new KartRace(new TrackGeometry(), RACER_DEFINITIONS);
    r.setup(slots);
    expect(r.phase).toBe('IDLE');
    r.startCountdown();
    for (let i = 0; i < 60 * 2.9; i++) r.step(DT);
    expect(r.phase).toBe('COUNTDOWN');
    for (let i = 0; i < 12; i++) r.step(DT);
    expect(r.phase).toBe('RACING');
  });

  it('그리드는 서로 겹치지 않고 게이트 뒤에서 출발', () => {
    const r = new KartRace(new TrackGeometry(), RACER_DEFINITIONS);
    r.setup(slots);
    for (const k of r.karts) expect(k.progress).toBeCloseTo(5, 3); // 전원 같은 선상 (출발선 바로 앞)
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) expect(Math.hypot(r.karts[a].x - r.karts[b].x, r.karts[a].z - r.karts[b].z)).toBeGreaterThan(2.6);
  });

  it('CPU 4명이 5바퀴를 완주하고 결과가 시간순', () => {
    const r = new KartRace(new TrackGeometry(), RACER_DEFINITIONS);
    r.setup(slots);
    r.startCountdown();
    let wall = 0;
    for (let i = 0; i < 60 * 600 && r.phase !== 'OVER'; i++) {
      r.step(DT);
      for (const e of r.events) if (e.k === 'wall') wall++;
      r.events = [];
    }
    expect(r.phase).toBe('OVER');
    expect(r.results).toHaveLength(4);
    expect(r.results.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
    const times = r.results.map((x) => x.time).filter((t): t is number => t !== null);
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    expect(times[0]).toBeGreaterThan(50);
    expect(times[0]).toBeLessThan(400);
    // 봇이 벽에 마구 박지는 않아야 한다
    expect(wall).toBeLessThan(120);
  });
});
