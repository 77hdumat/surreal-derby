import { describe, expect, it } from 'vitest';
import { RACER_DEFINITIONS } from './RacerDefinitions';
import { JOCKEYS, jockeyById, kartParamsFor } from './Jockeys';

describe('kartParamsFor', () => {
  const horse = RACER_DEFINITIONS.find((d) => d.id === 'classic')!;
  it('기수 배수는 전부 1 이상 (페널티 없음)', () => {
    for (const j of JOCKEYS) for (const v of Object.values(j.mul)) expect(v).toBeGreaterThanOrEqual(1);
  });
  it('스피드 기수는 최고속만 높고 나머지는 기본', () => {
    const b = kartParamsFor(horse, jockeyById('heavy'));
    const s = kartParamsFor(horse, jockeyById('speed'));
    expect(s.maxSpeed).toBeCloseTo((140 / 3.6) * 1.08, 6);
    expect(s.handling).toBeLessThanOrEqual(b.handling);
    expect(s.accel).toBeCloseTo(b.accel, 6);
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
