import { describe, expect, it } from 'vitest';
import { TrackGeometry } from './TrackGeometry';

describe('TrackGeometry.project', () => {
  const t = new TrackGeometry();
  const sDiff = (a: number, b: number) => {
    const d = Math.abs(t.wrap(a) - t.wrap(b));
    return Math.min(d, t.length - d);
  };

  it('getPoint 왕복 오차 < 1e-3 (직선·코너·경계)', () => {
    const arc = Math.PI * t.radius;
    const samples = [0, 5, 100, 199.9, 200.1, 200 + arc / 2, 200 + arc - 0.1, 200 + arc + 0.1, 300, 399.9, 400 + arc + 1, 2 * 200 + 2 * arc - 0.5];
    for (const s of samples) {
      for (const lat of [-14, -5, 0, 4.5, 14, 18]) {
        const p = t.getPoint(s, lat);
        const c = t.project(p.x, p.z);
        expect(sDiff(c.s, s)).toBeLessThan(1e-3);
        expect(Math.abs(c.lat - lat)).toBeLessThan(1e-3);
      }
    }
  });

  it('트랙 밖 점도 최근접 s 를 준다', () => {
    const p = t.getPoint(50, 0);
    const c = t.project(p.x, p.z + 40); // 앞 직선에서 바깥(+lat, 오른쪽)으로
    expect(sDiff(c.s, 50)).toBeLessThan(1e-6);
    expect(c.lat).toBeCloseTo(40, 6);
  });

  it('yawAt 은 직선에서 0 / π', () => {
    expect(t.yawAt(10)).toBeCloseTo(0, 6);
    expect(Math.abs(t.yawAt(200 + Math.PI * 60 + 10))).toBeCloseTo(Math.PI, 6);
  });
});
