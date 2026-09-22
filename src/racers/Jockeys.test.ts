import { describe, expect, it } from 'vitest';
import { RACER_DEFINITIONS } from './RacerDefinitions';
import { JOCKEYS, jockeyById, kartParamsFor } from './Jockeys';

describe('kartParamsFor', () => {
  const horse = RACER_DEFINITIONS.find((d) => d.id === 'classic')!;
  it('올라운더는 배수 1', () => {
    const p = kartParamsFor(horse, jockeyById('balance'));
    expect(p.maxSpeed).toBeCloseTo(horse.speed * 1.5, 6);
    expect(p.boostMul).toBe(1.35);
  });
  it('스피드 기수는 최고속이 더 높고 조향은 낮다', () => {
    const b = kartParamsFor(horse, jockeyById('balance'));
    const s = kartParamsFor(horse, jockeyById('speed'));
    expect(s.maxSpeed).toBeGreaterThan(b.maxSpeed);
    expect(s.handling).toBeLessThan(b.handling);
  });
  it('기수 id 는 유일', () => {
    expect(new Set(JOCKEYS.map((j) => j.id)).size).toBe(JOCKEYS.length);
  });
});
