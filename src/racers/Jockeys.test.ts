import { describe, expect, it } from 'vitest';
import { RACER_DEFINITIONS } from './RacerDefinitions';
import { JOCKEYS, jockeyById, kartParamsFor } from './Jockeys';

describe('kartParamsFor', () => {
  const horse = RACER_DEFINITIONS.find((d) => d.id === 'classic')!;
  it('올라운더는 배수 1', () => {
    const p = kartParamsFor(horse, jockeyById('balance'));
    expect(p.maxSpeed).toBeCloseTo(140 / 3.6, 6);
    expect(p.boostMul).toBe(1.57);
  });
  it('스피드 기수는 최고속이 더 높고 조향은 낮다', () => {
    const b = kartParamsFor(horse, jockeyById('balance'));
    const s = kartParamsFor(horse, jockeyById('speed'));
    expect(s.maxSpeed).toBeGreaterThan(b.maxSpeed);
    expect(s.handling).toBeLessThan(b.handling);
  });
  it('말별 최고속은 131~147km/h 범위, 휴먼 러너가 최고속 1위가 아니다', () => {
    const tops = RACER_DEFINITIONS.map((d) => [d.id, kartParamsFor(d, jockeyById('balance')).maxSpeed * 3.6] as const);
    for (const [, t] of tops) {
      expect(t).toBeGreaterThanOrEqual(130);
      expect(t).toBeLessThanOrEqual(148);
    }
    const human = tops.find((t) => t[0] === 'human')![1];
    expect(tops.filter((t) => t[1] > human).length).toBeGreaterThanOrEqual(5);
  });
  it('기수 id 는 유일', () => {
    expect(new Set(JOCKEYS.map((j) => j.id)).size).toBe(JOCKEYS.length);
  });
});
