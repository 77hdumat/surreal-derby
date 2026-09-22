import { describe, expect, it } from 'vitest';
import { createKartState } from '../game/KartPhysics';
import { KART_FIELDS, decodeInput, decodeKart, encodeInput, encodeKart } from './Protocol';

describe('Protocol', () => {
  it('kart 인코딩 왕복', () => {
    const k = createKartState(12.345, -7.891, 1.23456);
    k.speed = 21.126;
    k.slip = -0.31;
    k.gauge = 0.4567;
    k.boostT = 1.5;
    k.progress = 812.34;
    k.lapsDone = 2;
    k.finished = true;
    k.finishTime = 63.2;
    k.drifting = true;
    const a = encodeKart(k);
    expect(a).toHaveLength(KART_FIELDS);
    const b = decodeKart(a, createKartState(0, 0, 0));
    expect(b.x).toBeCloseTo(12.35, 6);
    expect(b.yaw).toBeCloseTo(1.235, 6);
    expect(b.speed).toBeCloseTo(21.13, 6);
    expect(b.lapsDone).toBe(2);
    expect(b.finished).toBe(true);
    expect(b.finishTime).toBe(63.2);
    expect(b.drifting).toBe(true);
    const c = decodeKart(a, createKartState(1, 2, 3), false);
    expect(c.x).toBe(1);
    expect(c.speed).toBeCloseTo(21.13, 6);
  });
  it('null finishTime 은 -1', () => {
    const a = encodeKart(createKartState(0, 0, 0));
    expect(a[12]).toBe(-1);
    expect(decodeKart(a, createKartState(0, 0, 0)).finishTime).toBeNull();
  });
  it('입력 플래그 왕복', () => {
    const d = encodeInput({ steer: -0.5, throttle: 1, brake: 0, drift: true, boost: true });
    expect(d).toEqual([-0.5, 1, 0, 3]);
    expect(decodeInput(d)).toEqual({ steer: -0.5, throttle: 1, brake: 0, drift: true, boost: true });
    expect(decodeInput([0, 0, 0, 2]).drift).toBe(false);
  });
});
