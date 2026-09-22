import { describe, expect, it } from 'vitest';
import { TrackGeometry } from '../track/TrackGeometry';
import { createKartState, stepKart, syncKartToTrack, type KartState } from './KartPhysics';
import { BOX_RESPAWN, ItemSystem, generateBoxes, rollItem } from './Items';
import { mulberry32 } from './Obstacles';

const track = new TrackGeometry();
function kartAt(s: number, lat: number): KartState {
  const p = track.getPoint(s, lat);
  const k = createKartState(p.x, p.z, track.yawAt(s));
  syncKartToTrack(k, track);
  return k;
}

describe('Items', () => {
  it('상자는 5구간 × 5개, 먹으면 사라지고 8초 뒤 리젠', () => {
    expect(generateBoxes(track)).toHaveLength(25);
    const sys = new ItemSystem(track, 0);
    sys.setup(1, 0);
    const b = sys.boxes[0];
    const karts = [kartAt(b.s, b.lat)];
    sys.step(1 / 60, 1, karts, [true], [0]);
    expect(karts[0].item).not.toBe('');
    expect(b.takenT).toBe(1);
    expect(sys.events.map((e) => e.k)).toEqual(['box', 'got']);
    karts[0].item = 'banana';
    karts[0].item2 = 'banana'; // 두 칸 다 차면 못 먹는다 → 리젠 확인용
    sys.step(1 / 60, 1 + BOX_RESPAWN + 0.1, karts, [true], [0]);
    expect(b.takenT).toBe(-1);
  });

  it('미사일은 앞 말을 추적해 맞히고 스핀시킨다 (피격자 소유자가 판정)', () => {
    const sys = new ItemSystem(track, 0);
    sys.setup(1, 0);
    const me = kartAt(20, 0);
    const ahead = kartAt(60, 3);
    me.item = 'missile';
    const ev = sys.use(0, [me, ahead], [1, 0])!;
    expect(ev.k).toBe('use');
    expect((ev as { target: number }).target).toBe(1);
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      sys.step(1 / 60, i / 60, [me, ahead], [false, true], [1, 0]);
      for (const e of sys.events) if (e.k === 'hit') hit = true;
      sys.events = [];
    }
    expect(hit).toBe(true);
    expect(ahead.stunT).toBeGreaterThan(0);
  });

  it('실드는 공격을 한 번 막는다', () => {
    const sys = new ItemSystem(track, 0);
    sys.setup(1, 0);
    const me = kartAt(20, 0);
    const ahead = kartAt(60, 0);
    ahead.shieldT = 5;
    me.item = 'missile';
    sys.use(0, [me, ahead], [1, 0]);
    let blocked = false;
    for (let i = 0; i < 120 && !blocked; i++) {
      sys.step(1 / 60, i / 60, [me, ahead], [false, true], [1, 0]);
      for (const e of sys.events) if (e.k === 'hit' && e.blocked) blocked = true;
      sys.events = [];
    }
    expect(blocked).toBe(true);
    expect(ahead.stunT).toBe(0);
    expect(ahead.shieldT).toBe(0);
  });

  it('꼴찌는 강한 아이템이 더 잘 나온다', () => {
    const rnd = mulberry32(42);
    const count = (rank: number) => {
      let strong = 0;
      for (let i = 0; i < 2000; i++) if (['missile', 'ufo', 'magnet', 'boost'].includes(rollItem(rank, 4, rnd))) strong++;
      return strong;
    };
    expect(count(4)).toBeGreaterThan(count(1) * 1.5);
  });
});

describe('물방울 탈출·착지 부스터', () => {
  it('좌우 연타로 물방울이 빨리 터지고, 떨어지는 순간 ↑ 면 부스터', () => {
    const st = kartAt(20, 0);
    st.bubbleT = 2;
    const P = { maxSpeed: 40, accel: 10, handling: 1, mass: 100, gaugeRate: 0.8, boostMul: 1.57, radius: 1.3, boostReach: 0 };
    const mash = (steer: number) => stepKart(st, { steer, throttle: 0, brake: 0, drift: false, boost: false }, P, track, 1 / 60);
    for (let i = 0; i < 7; i++) {
      mash(i % 2 === 0 ? 1 : -1);
      mash(0);
    }
    expect(st.bubbleT).toBeLessThanOrEqual(0.36); // 터짐 → 낙하 단계
    for (let i = 0; i < 25; i++) stepKart(st, { steer: 0, throttle: 0, brake: 0, drift: false, boost: false }, P, track, 1 / 60);
    expect(st.bubbleT).toBe(0);
    const ev = stepKart(st, { steer: 0, throttle: 1, brake: 0, drift: false, boost: false }, P, track, 1 / 60);
    expect(ev.some((e) => e.k === 'boost')).toBe(true);
    expect(st.boostT).toBeGreaterThan(1);
  });
});
