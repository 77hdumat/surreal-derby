import { describe, expect, it } from 'vitest';
import { TrackGeometry } from '../track/TrackGeometry';
import { BOOST_DURATION, LAPS, createKartState, finishDistance, resolveKartCollision, stepKart, syncKartToTrack, type KartInput, type KartParams } from './KartPhysics';

const track = new TrackGeometry();
const P: KartParams = { maxSpeed: 20, accel: 8, handling: 1, mass: 100, gaugeRate: 0.55, boostMul: 1.35, radius: 1.3, boostReach: 0 };
const inp = (o: Partial<KartInput>): KartInput => ({ steer: 0, throttle: 0, brake: 0, drift: false, boost: false, ...o });
const DT = 1 / 60;

function spawn(s = 10, lat = 0) {
  const p = track.getPoint(s, lat);
  const st = createKartState(p.x, p.z, track.yawAt(s));
  syncKartToTrack(st, track);
  return st;
}

describe('stepKart', () => {
  it('직진 가속은 maxSpeed 를 넘지 않고 앞으로 간다', () => {
    const st = spawn();
    for (let i = 0; i < 420; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT); // 7초, 출발 직선 안
    expect(st.speed).toBeCloseTo(P.maxSpeed, 5);
    expect(st.progress).toBeGreaterThan(100);
    expect(Math.abs(st.lat)).toBeLessThan(2);
  });

  it('드리프트하면 슬립이 생기고 게이지가 찬다', () => {
    const st = spawn();
    for (let i = 0; i < 180; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    for (let i = 0; i < 30; i++) stepKart(st, inp({ throttle: 1, steer: 1, drift: true }), P, track, DT); // 0.5s (벽에 닿기 전)
    expect(st.drifting).toBe(true);
    expect(st.slip).toBeGreaterThan(0.15);
    expect(st.gauge).toBeGreaterThan(0.1);
    // 놓으면 슬립 복원
    for (let i = 0; i < 60; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    expect(st.drifting).toBe(false);
    expect(Math.abs(st.slip)).toBeLessThan(0.05);
  });

  it('부스터가 있어야 발동하고, 부스트 중 최고속이 올라간다', () => {
    const st = spawn();
    st.gauge = 0.5;
    expect(stepKart(st, inp({ throttle: 1, boost: true }), P, track, DT)).toEqual([]);
    st.boosts = 1;
    st.boostKeyWas = false;
    const ev = stepKart(st, inp({ throttle: 1, boost: true }), P, track, DT);
    expect(ev).toEqual([{ k: 'boost' }]);
    expect(st.boosts).toBe(0);
    expect(st.boostT).toBeCloseTo(BOOST_DURATION - DT, 6);
    for (let i = 0; i < 60; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    expect(st.speed).toBeGreaterThan(P.maxSpeed * 1.2);
    for (let i = 0; i < 600; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT); // 관성이 오래 남는다
    expect(st.speed).toBeLessThan(P.maxSpeed * 1.01);
    expect(st.speed).toBeGreaterThanOrEqual(P.maxSpeed);
  });

  it('벽에 닿으면 lat 이 클램프되고 wall 이벤트 + 감속', () => {
    const st = spawn(10, 0);
    st.speed = 18;
    st.yaw = track.yawAt(10) - 0.6; // 오른쪽(바깥)으로 비스듬히
    const evs: string[] = [];
    for (let i = 0; i < 120; i++) for (const e of stepKart(st, inp({ throttle: 1 }), P, track, DT)) evs.push(e.k);
    expect(evs).toContain('wall');
    expect(Math.abs(st.lat)).toBeLessThanOrEqual(track.width / 2 - 1 + 1e-6);
  });

  it('출발선 앞에서 출발해 결승선을 LAPS 번 지나면 완주 + 랩 이벤트', () => {
    const st = spawn(5, 0);
    expect(st.progress).toBeCloseTo(5, 6);
    expect(st.lapsDone).toBe(1);
    const laps: number[] = [];
    let finished = false;
    let t = 0;
    for (let i = 0; i < 60 * 600 && !finished; i++) {
      t += DT;
      // 중심선 추종 조향
      const ahead = track.getPoint(st.s + 10, 0);
      const want = Math.atan2(-(ahead.z - st.z), ahead.x - st.x);
      const err = Math.atan2(Math.sin(want - st.yaw), Math.cos(want - st.yaw));
      for (const e of stepKart(st, inp({ throttle: 1, steer: Math.max(-1, Math.min(1, -err * 2)) }), P, track, DT, t)) {
        if (e.k === 'lap') laps.push(e.lap);
        if (e.k === 'finish') finished = true;
      }
    }
    expect(laps).toEqual(Array.from({ length: LAPS - 1 }, (_, i) => i + 2));
    expect(finished).toBe(true);
    expect(st.lapsDone).toBe(LAPS + 1);
    expect(st.finishTime).toBeGreaterThan(0);
    expect(st.progress).toBeGreaterThanOrEqual(finishDistance(track));
  });
});

describe('부스터 연타', () => {
  it('부스트 중에 누르면 무시(소모 안 함), 끝난 뒤 눌러야 다음 것', () => {
    const st = spawn();
    st.boosts = 2;
    let boosts = 0;
    const count = (evs: { k: string }[]) => evs.forEach((e) => e.k === 'boost' && boosts++);
    count(stepKart(st, inp({ throttle: 1, boost: true }), P, track, DT));
    expect(boosts).toBe(1);
    expect(st.boosts).toBe(1);
    for (let i = 0; i < 60; i++) count(stepKart(st, inp({ throttle: 1, boost: i % 2 === 0 }), P, track, DT)); // 연타
    expect(boosts).toBe(1);
    expect(st.boosts).toBe(1);
    // 끝나기 직전(0.25s 전)부터 누르고 있으면 텀 없이 이어진다
    for (let i = 0; i < 60 * 1.5; i++) count(stepKart(st, inp({ throttle: 1 }), P, track, DT)); // 총 2.5s 경과
    expect(st.boostT).toBeGreaterThan(0.26);
    count(stepKart(st, inp({ throttle: 1, boost: true }), P, track, DT)); // 아직 0.25 초과 → 무시
    expect(boosts).toBe(1);
    for (let i = 0; i < 60 * 0.6; i++) count(stepKart(st, inp({ throttle: 1, boost: true }), P, track, DT));
    expect(boosts).toBe(2);
    expect(st.boosts).toBe(0);
    expect(st.boostT).toBeGreaterThan(2.6); // 3s + 남은 시간 - 지난 프레임
  });
});

describe('게이지 규칙', () => {
  it('가득 차면 부스터 1개로 바뀌고, 2칸이 차면 파란 부스터로 승급', () => {
    const st = spawn();
    for (let i = 0; i < 300; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    st.gauge = 0.99;
    st.gaugeAtDriftStart = 0.99;
    for (let i = 0; i < 30; i++) stepKart(st, inp({ throttle: 1, steer: 1, drift: true }), P, track, DT);
    expect(st.boosts).toBe(1);
    expect(st.gauge).toBeLessThan(0.2);
    // 2칸이 다 차면 다음 충전부터는 파란 부스터로 승급
    st.boosts = 2;
    st.blueBoosts = 0;
    st.gauge = 0.99;
    for (let i = 0; i < 30; i++) stepKart(st, inp({ throttle: 1, steer: -1, drift: true }), P, track, DT);
    expect(st.boosts).toBe(2);
    expect(st.blueBoosts).toBe(1);
    // 둘 다 파랑이면 더는 안 찬다
    st.blueBoosts = 2;
    st.gauge = 0.99;
    for (let i = 0; i < 30; i++) stepKart(st, inp({ throttle: 1, steer: 1, drift: true }), P, track, DT);
    expect(st.gauge).toBeCloseTo(0.99, 6);
  });
  it('드리프트 중 벽에 부딪히면 이번 드리프트 게이지를 잃는다', () => {
    const st = spawn(10, 0);
    for (let i = 0; i < 300; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    st.gauge = 0.3;
    // 드리프트를 시작한 뒤 벽 밖으로 밀어 넣는다
    for (let i = 0; i < 20; i++) stepKart(st, inp({ throttle: 1, steer: 1, drift: true }), P, track, DT);
    expect(st.drifting).toBe(true);
    expect(st.gauge).toBeGreaterThan(0.3);
    const out = track.getPoint(st.s, track.width / 2 + 2);
    st.x = out.x;
    st.z = out.z;
    let wall = false;
    for (const e of stepKart(st, inp({ throttle: 1, steer: 1, drift: true }), P, track, DT)) if (e.k === 'wall') wall = true;
    expect(wall).toBe(true);
    expect(st.gauge).toBeCloseTo(0.3, 6);
    expect(st.drifting).toBe(false);
  });
});

describe('순간부스터', () => {
  it('드리프트 종료 직후 ↑ 면 mini 이벤트 + 최고속 초과, 반복 가능', () => {
    const st = spawn();
    for (let i = 0; i < 300; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    let minis = 0;
    for (let rep = 0; rep < 3; rep++) {
      const steer = rep % 2 ? -1 : 1; // 좌우 번갈아 (벽에 안 가게)
      for (let i = 0; i < 12; i++) stepKart(st, inp({ throttle: 1, steer, drift: true }), P, track, DT); // 0.2s 드리프트
      for (let i = 0; i < 6; i++) for (const e of stepKart(st, inp({ throttle: 1, steer: -steer * 0.5 }), P, track, DT)) if (e.k === 'mini') minis++;
      expect(st.miniT).toBeGreaterThan(0);
      for (let i = 0; i < 12; i++) stepKart(st, inp({ throttle: 1, steer: -steer * 0.5 }), P, track, DT);
      expect(st.speed).toBeGreaterThan(P.maxSpeed * 1.05);
      expect(Math.abs(st.lat)).toBeLessThan(13);
    }
    expect(minis).toBe(3);
  });
  it('창이 지나면 ↑ 를 눌러도 안 나간다 / 너무 짧은 드리프트는 무시', () => {
    const st = spawn();
    for (let i = 0; i < 300; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    for (let i = 0; i < 20; i++) stepKart(st, inp({ throttle: 1, steer: 1, drift: true }), P, track, DT);
    for (let i = 0; i < 30; i++) stepKart(st, inp({}), P, track, DT); // 0.5s 아무것도 안 누름
    expect(st.miniWindow).toBe(0);
    expect(stepKart(st, inp({ throttle: 1 }), P, track, DT)).toEqual([]);
    for (let i = 0; i < 4; i++) stepKart(st, inp({ throttle: 1, steer: 1, drift: true }), P, track, DT); // 0.07s
    expect(stepKart(st, inp({ throttle: 1 }), P, track, DT)).toEqual([]);
    expect(st.miniT).toBe(0);
  });
});

describe('boostReach', () => {
  it('부스트 중엔 코끝만큼 먼저 골인 판정', () => {
    const st = spawn(track.length - 6, 0); // 마지막 결승선 6m 전
    st.progress = track.finishS + LAPS * track.length - 6;
    st.lapsDone = LAPS;
    const G = { ...P, boostReach: 8 };
    // 정지 상태로 한 스텝: 부스트 없으면 미완주
    expect(stepKart(st, inp({}), G, track, DT).some((e) => e.k === 'finish')).toBe(false);
    st.boostT = 1;
    expect(stepKart(st, inp({}), G, track, DT).some((e) => e.k === 'finish')).toBe(true);
  });
});

describe('resolveKartCollision', () => {
  it('겹친 두 말을 질량 비례로 밀어낸다', () => {
    const a = createKartState(0, 0, 0);
    const b = createKartState(1.0, 0, 0);
    const heavy = { ...P, mass: 300 };
    a.speed = b.speed = 10;
    expect(resolveKartCollision(a, P, b, heavy)).toBe(true);
    expect(b.x - a.x).toBeCloseTo(2.6, 6);
    expect(Math.abs(a.x)).toBeGreaterThan(Math.abs(b.x - 1.0)); // 가벼운 a 가 더 밀림
    expect(a.speed).toBeLessThan(10);
    expect(a.bumpT).toBeGreaterThan(0);
  });
  it('안 겹치면 false', () => {
    const a = createKartState(0, 0, 0);
    const b = createKartState(5, 0, 0);
    expect(resolveKartCollision(a, P, b, P)).toBe(false);
  });
});

describe('파란 부스터', () => {
  it('파란 부스터가 먼저 쓰이고 더 길고 빠르다', () => {
    const st = spawn();
    for (let i = 0; i < 300; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    st.boosts = 2;
    st.blueBoosts = 1;
    stepKart(st, inp({ throttle: 1, boost: true }), P, track, DT);
    expect(st.boostBlue).toBe(true);
    expect(st.blueBoosts).toBe(0);
    expect(st.boostT).toBeGreaterThan(BOOST_DURATION);
    for (let i = 0; i < 90; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    const blueTop = st.speed;
    // 일반 부스터와 비교
    const st2 = spawn();
    for (let i = 0; i < 300; i++) stepKart(st2, inp({ throttle: 1 }), P, track, DT);
    st2.boosts = 1;
    stepKart(st2, inp({ throttle: 1, boost: true }), P, track, DT);
    for (let i = 0; i < 90; i++) stepKart(st2, inp({ throttle: 1 }), P, track, DT);
    expect(blueTop).toBeGreaterThan(st2.speed * 1.1);
  });
});

describe('자동 드리프트', () => {
  it('코너에서 Shift 만 눌러도 미끄러지고, 미끄러지는 동안만 게이지가 찬다', () => {
    // 곡률이 큰 지점 찾기
    let cs = 0;
    for (let s = 0; s < track.length; s += 5) if (track.cornerWeight(s) > 0.9) { cs = s; break; }
    const st = spawn(cs - 30, 0);
    st.speed = P.maxSpeed * 0.9;
    for (let i = 0; i < 60; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    const g0 = st.gauge;
    // 방향키 없이 Shift 만
    for (let i = 0; i < 45; i++) stepKart(st, inp({ throttle: 1, drift: true, steer: 0.25 }), P, track, DT);
    expect(Math.abs(st.slip)).toBeGreaterThan(0.1);
    expect(st.gauge).toBeGreaterThan(g0);
    // 드리프트를 놓으면 더는 안 찬다
    const g1 = st.gauge;
    for (let i = 0; i < 60; i++) stepKart(st, inp({ throttle: 1 }), P, track, DT);
    expect(st.gauge).toBeCloseTo(g1, 6);
  });
});
