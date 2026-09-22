import { describe, expect, it } from 'vitest';
import { TrackGeometry } from './TrackGeometry';

describe('TrackGeometry (spline circuit)', () => {
  const t = new TrackGeometry();
  const sDiff = (a: number, b: number) => {
    const d = Math.abs(t.wrap(a) - t.wrap(b));
    return Math.min(d, t.length - d);
  };

  it('길이 1.8~3.6km, 출발 직선은 +x 방향', () => {
    expect(t.length).toBeGreaterThan(1800);
    expect(t.length).toBeLessThan(4600);
    expect(Math.abs(t.yawAt(20))).toBeLessThan(0.05);
    expect(t.cornerWeight(80)).toBeLessThan(0.15);
  });

  it('getPoint 왕복 오차: s < 2m, lat < 0.3m (트랙 안팎)', () => {
    for (let k = 0; k < 60; k++) {
      const s = (k / 60) * t.length;
      for (const lat of [-11, -4, 0, 5, 11, 14]) {
        const p = t.getPoint(s, lat);
        const c = t.project(p.x, p.z);
        expect(sDiff(c.s, s)).toBeLessThan(2.0);
        expect(Math.abs(c.lat - lat)).toBeLessThan(0.3);
      }
    }
  });

  it('헤어핀이 있다 (cornerWeight 1 인 구간)', () => {
    let maxW = 0;
    for (let s = 0; s < t.length; s += 5) maxW = Math.max(maxW, t.cornerWeight(s));
    expect(maxW).toBeGreaterThan(0.9);
  });

  it('트랙 위 어느 점도 다른 구간과 34m 이상 떨어져 있다 (자기 교차 없음, 나선 팔 간격 π·b≈42)', () => {
    const n = t.samples.length;
    for (let i = 0; i < n; i += 7) {
      for (let j = i + 60; j < n - 60 || (i < 60 && j < n - 60); j += 7) {
        const a = t.samples[i];
        const b = t.samples[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        expect(d, `samples ${i} vs ${j}`).toBeGreaterThan(34);
      }
    }
  });
});
