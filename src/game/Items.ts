import type { TrackGeometry } from '../track/TrackGeometry';
import { BLUE_BOOST_DURATION, MAX_BOOSTS, type KartState } from './KartPhysics';
import { mulberry32 } from './Obstacles';

export type ItemKind = 'missile' | 'waterfly' | 'banana' | 'mine' | 'boost' | 'shield' | 'magnet' | 'ufo' | 'gas';

export const ITEM_INFO: Record<ItemKind, { name: string; emoji: string; desc: string }> = {
  missile: { name: '미사일', emoji: '🚀', desc: '앞 말을 추적해 스핀' },
  waterfly: { name: '물파리', emoji: '🪰', desc: '바로 앞 등수를 쫓아가 공중에 가둠 (좌우 연타로 탈출)' },
  banana: { name: '바나나', emoji: '🍌', desc: '뒤에 3개 떨어뜨림 — 밟으면 1초 미끄러짐' },
  mine: { name: '지뢰', emoji: '💣', desc: '뒤에 5개 설치 — 밟으면 공중으로 날아감' },
  boost: { name: '블루 부스터', emoji: '💙', desc: '즉시 파란 부스터 (더 길고 빠름)' },
  shield: { name: '실드', emoji: '🛡️', desc: '공격 1회 막음 (8초)' },
  magnet: { name: '자석', emoji: '🧲', desc: '앞 등수에게 350km/h 로 끌려갔다 튕겨 나가며 추월' },
  ufo: { name: 'UFO', emoji: '🛸', desc: '1등만 붙잡아 공중에 가둠' },
  gas: { name: '환각 가스', emoji: '🍄', desc: '나 빼고 전원 3초간 조작 반대' },
};

export interface ItemBox {
  id: number;
  s: number;
  lat: number;
  x: number;
  z: number;
  /** 먹힌 시각 (-1 = 있음) */
  takenT: number;
}

export interface Projectile {
  id: number;
  kind: 'missile' | 'waterfly' | 'banana' | 'mine' | 'gas';
  owner: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  speed: number;
  age: number;
  /** 미사일 추적 대상 슬롯 (-1 = 없음) */
  target: number;
  done: boolean;
}

/** 아이템 이벤트 — 전원에게 중계돼 같은 결과를 만든다 */
export type ItemEvent =
  | { k: 'box'; id: number; slot: number }
  | { k: 'use'; slot: number; kind: ItemKind; id: number; x: number; z: number; yaw: number; target: number }
  | { k: 'hit'; slot: number; kind: ItemKind; pid: number; blocked: boolean }
  | { k: 'got'; slot: number; kind: ItemKind };

export const BOX_RESPAWN = 8;
export const BOX_RADIUS = 2.2;
const MISSILE_SPEED = 75;
const MISSILE_LIFE = 5;
const MISSILE_TURN = 3.5;
const BOMB_FLIGHT = 1.1;
const BOMB_RADIUS = 6.5;
const BANANA_LIFE = 40;
/** 자석이 대상에 붙기 직전 끊기며 이어지는 추진 부스트 (초) */
const MAGNET_EXIT_BOOST = 1.6;

/** 한 랩에 5구간 × 5개 상자 */
export function generateBoxes(track: TrackGeometry): ItemBox[] {
  const out: ItemBox[] = [];
  let id = 0;
  for (let row = 0; row < 5; row++) {
    const s = ((row + 0.5) / 5) * track.length;
    for (let i = 0; i < 5; i++) {
      const lat = -9 + i * 4.5;
      const p = track.getPoint(s, lat);
      out.push({ id: id++, s, lat, x: p.x, z: p.z, takenT: -1 });
    }
  }
  return out;
}

/**
 * 순위별 아이템 확률: 뒤에 있을수록 강한 공격 아이템. (카트라이더 아이템전 감각)
 */
export function rollItem(rank: number, total: number, rnd: () => number): ItemKind {
  const behind = total <= 1 ? 0 : (rank - 1) / (total - 1); // 0 = 1등, 1 = 꼴찌
  const table: [ItemKind, number][] = [
    ['banana', 3 - behind * 2],
    ['mine', 1.5 + behind * 0.8],
    ['shield', 2.5 - behind * 1],
    ['waterfly', 2 + behind * 1.5],
    ['missile', 1.5 + behind * 2.5],
    ['boost', 1 + behind * 2],
    ['magnet', 0.8 + behind * 2],
    ['ufo', behind > 0.4 ? 0.3 + behind * 1.5 : 0],
    ['gas', 1 + behind * 1.2],
  ];
  const sum = table.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * sum;
  for (const [k, w] of table) {
    r -= w;
    if (r <= 0) return k;
  }
  return 'banana';
}

/**
 * 아이템 로직 (Three.js 무관). 각 피어가 같은 코드를 돌리되:
 *  - 상자 습득·피격 판정은 "내가 소유한 말" 에만 한다 (클라이언트 권위)
 *  - 결과(use/hit/box) 는 이벤트로 전원에게 전달돼 투사체·상자 상태를 맞춘다
 */
export class ItemSystem {
  boxes: ItemBox[] = [];
  projectiles: Projectile[] = [];
  private rnd = Math.random;
  private nextId = 1;
  /** 이번 스텝에 발생한, 남에게 알려야 하는 이벤트 */
  events: ItemEvent[] = [];

  constructor(private track: TrackGeometry, private mySlot: number) {}

  setup(seed: number, mySlot: number): void {
    this.boxes = generateBoxes(this.track);
    this.projectiles = [];
    this.events = [];
    this.mySlot = mySlot;
    this.rnd = mulberry32((seed ^ (mySlot * 7919)) >>> 0);
    this.nextId = mySlot * 100000 + 1; // 피어별로 겹치지 않는 id
  }

  /** 상자 리젠 + 소유 말의 습득/피격 판정 + 투사체 이동 */
  step(dt: number, time: number, karts: KartState[], owned: boolean[], ranking: number[]): void {
    for (const b of this.boxes) if (b.takenT >= 0 && time - b.takenT > BOX_RESPAWN) b.takenT = -1;
    // 습득
    for (let i = 0; i < karts.length; i++) {
      if (!owned[i]) continue;
      const k = karts[i];
      if (k.finished || (k.item && k.item2)) continue;
      for (const b of this.boxes) {
        if (b.takenT >= 0) continue;
        const dx = k.x - b.x;
        const dz = k.z - b.z;
        if (dx * dx + dz * dz > BOX_RADIUS * BOX_RADIUS) continue;
        b.takenT = time;
        const rank = ranking.indexOf(i) + 1;
        const got = rollItem(rank, karts.length, this.rnd);
        if (k.item) k.item2 = got;
        else k.item = got;
        this.events.push({ k: 'box', id: b.id, slot: i });
        this.events.push({ k: 'got', slot: i, kind: got });
        break;
      }
    }
    // 자석: 내 소유 말이 자석 중이면 대상 쪽으로 코를 돌리고, 닿으면 끝
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      if (!owned[i] || k.magnetT <= 0) continue;
      const t = karts[k.magnetTarget];
      if (!t) {
        k.magnetT = 0;
        continue;
      }
      const dx = t.x - k.x;
      const dz = t.z - k.z;
      const d = Math.hypot(dx, dz);
      // 대상 쪽으로 당기되 조향은 살려 둔다 (플레이어가 궤도를 틀 수 있다)
      const want = Math.atan2(-dz, dx);
      const err = Math.atan2(Math.sin(want - k.yaw), Math.cos(want - k.yaw));
      // 가까워질수록 유도를 풀어 옆으로 스쳐 지나가게 — 관성으로 추월한다
      const pull = d > 14 ? 2.2 : d > 7 ? 1.0 : 0;
      k.yaw += Math.max(-pull * dt, Math.min(pull * dt, err));
      k.slip *= Math.max(0, 1 - 4 * dt);
      // 붙기 직전에 끊어 그대로 튀어 나간다 (속도는 유지 → 추월)
      if (d < 5.5) {
        k.magnetT = 0;
        k.magnetTarget = -1;
        // 탈출 추진: 부스트로 전환해 관성이 이어진다
        k.boostT = Math.max(k.boostT, MAGNET_EXIT_BOOST);
      }
    }
    // 투사체
    for (const pr of this.projectiles) {
      if (pr.done) continue;
      pr.age += dt;
      if (pr.kind === 'missile' || pr.kind === 'waterfly') {
        const turn = pr.kind === 'waterfly' ? 8 : MISSILE_TURN;
        if (pr.target >= 0 && karts[pr.target] && !karts[pr.target].finished) {
          const t = karts[pr.target];
          const want = Math.atan2(-(t.z - pr.z), t.x - pr.x);
          const err = Math.atan2(Math.sin(want - pr.yaw), Math.cos(want - pr.yaw));
          pr.yaw += Math.max(-turn * dt, Math.min(turn * dt, err));
        }
        pr.x += Math.cos(pr.yaw) * pr.speed * dt;
        pr.z += -Math.sin(pr.yaw) * pr.speed * dt;
        pr.y = pr.kind === 'waterfly' ? 1.6 + Math.sin(pr.age * 14) * 0.3 : 1.0;
        if (pr.age > (pr.kind === 'waterfly' ? 12 : MISSILE_LIFE)) pr.done = true;
        // 트랙 밖으로 나가면 소멸 (물파리는 날아다니므로 예외)
        if (pr.kind === 'missile' && Math.abs(this.track.project(pr.x, pr.z).lat) > this.track.width / 2 + 3) pr.done = true;
      } else if (pr.kind === 'gas') {
        if (pr.age < BOMB_FLIGHT) {
          pr.x += Math.cos(pr.yaw) * pr.speed * dt;
          pr.z += -Math.sin(pr.yaw) * pr.speed * dt;
          const u = pr.age / BOMB_FLIGHT;
          pr.y = 1 + Math.sin(u * Math.PI) * 4;
        } else {
          pr.y = 0;
          // 착지 후 가스 구름 1.5s 유지
          if (pr.age > BOMB_FLIGHT + 1.5) pr.done = true;
        }
      } else {
        // 바나나·지뢰: 그 자리에 남는다
        pr.y = pr.kind === 'mine' ? 0.25 : 0;
        if (pr.age > BANANA_LIFE) pr.done = true;
      }
      // 피격: 내가 소유한 말만 (자기 투사체는 0.5초간 면역)
      for (let i = 0; i < karts.length; i++) {
        if (!owned[i] || pr.done) continue;
        const k = karts[i];
        if (k.finished || k.bubbleT > 0 || k.stunT > 0) continue;
        if (pr.owner === i && pr.age < (pr.kind === 'banana' || pr.kind === 'mine' ? 1.5 : 0.5)) continue;
        const dx = k.x - pr.x;
        const dz = k.z - pr.z;
        const d2 = dx * dx + dz * dz;
        let hit = false;
        if (pr.kind === 'missile' || pr.kind === 'waterfly') hit = d2 < 3.2 * 3.2;
        else if (pr.kind === 'gas') hit = pr.age >= BOMB_FLIGHT && d2 < BOMB_RADIUS * BOMB_RADIUS;
        else if (pr.kind === 'mine') hit = d2 < 2.2 * 2.2;
        else hit = d2 < 1.8 * 1.8;
        if (!hit) continue;
        if (pr.kind === 'gas' && k.confuseT > 0) continue; // 이미 취함
        const blocked = k.shieldT > 0;
        if (blocked) k.shieldT = 0;
        else this.applyHit(k, pr.kind);
        if (pr.kind !== 'gas') pr.done = true;
        this.events.push({ k: 'hit', slot: i, kind: pr.kind, pid: pr.id, blocked });
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.done || p.age < 0.5);
  }

  private applyHit(k: KartState, kind: ItemKind): void {
    if (kind === 'missile') k.stunT = 1.6;
    else if (kind === 'waterfly') k.bubbleT = 2.0; // 2초 공중에 갇혔다 떨어진다
    else if (kind === 'ufo') k.bubbleT = 2.7; // 2.45 초과 = UFO 연출 (ItemVisuals)
    else if (kind === 'banana') k.slipT = 1.0;
    else if (kind === 'mine') {
      // 공중으로 붕 떴다가 떨어진다 (물방울과 같은 곡선, 조작 불가)
      k.bubbleT = 1.5;
      k.escape = 0;
      k.speed *= 0.35;
    }
    else if (kind === 'gas') {
      k.confuseT = 3;
      return; // 취하는 건 게이지 손실 없음
    }
    k.drifting = false;
    k.gauge = k.gaugeAtDriftStart;
  }

  /** 내 말이 아이템 사용 → 이벤트 생성 + 로컬 적용 */
  use(slot: number, karts: KartState[], ranking: number[]): ItemEvent | null {
    const k = karts[slot];
    if (!k || !k.item || k.finished || k.bubbleT > 0 || k.stunT > 0) return null;
    const kind = k.item as ItemKind;
    let target = -1;
    const myRank = ranking.indexOf(slot);
    /** 바로 앞 등수 (골인 안 한 사람) */
    const justAhead = (): number => {
      for (let r = myRank - 1; r >= 0; r--) if (!karts[ranking[r]].finished) return ranking[r];
      return -1;
    };
    if (kind === 'waterfly' || kind === 'magnet') {
      target = justAhead();
      if (target < 0) return null; // 1등은 쏠 대상 없음 (아이템 유지)
    } else if (kind === 'missile') {
      // 앞에서 가장 가까운 말 (progress 기준 0~120m 앞)
      let best = Infinity;
      karts.forEach((o, i) => {
        if (i === slot || o.finished) return;
        const gap = o.progress - k.progress;
        if (gap > 0 && gap < 120 && gap < best) {
          best = gap;
          target = i;
        }
      });
    } else if (kind === 'ufo') {
      // UFO 는 1등 전용 — 내가 1등이면 못 쓴다
      const leader = ranking.find((s) => !karts[s].finished) ?? -1;
      if (leader < 0 || leader === slot) return null;
      target = leader;
    }
    k.item = k.item2;
    k.item2 = '';
    const ev: ItemEvent = { k: 'use', slot, kind, id: this.nextId++, x: k.x, z: k.z, yaw: k.yaw, target };
    this.apply(ev, karts, /* owned */ null);
    return ev;
  }

  /**
   * use 이벤트 적용 (로컬·원격 공통). 투사체는 전원이 만들고, 자기 말 효과(부스트·실드·자석)는 발신자 쪽에서만,
   * UFO 는 대상 말의 소유자만 적용한다.
   */
  apply(ev: Extract<ItemEvent, { k: 'use' }>, karts: KartState[], owned: boolean[] | null): void {
    const k = karts[ev.slot];
    const mine = owned ? owned[ev.slot] : true;
    switch (ev.kind) {
      case 'missile':
        this.projectiles.push({ id: ev.id, kind: 'missile', owner: ev.slot, x: ev.x + Math.cos(ev.yaw) * 2.5, z: ev.z - Math.sin(ev.yaw) * 2.5, y: 1, yaw: ev.yaw, speed: MISSILE_SPEED, age: 0, target: ev.target, done: false });
        break;
      case 'waterfly':
        this.projectiles.push({ id: ev.id, kind: 'waterfly', owner: ev.slot, x: ev.x + Math.cos(ev.yaw) * 2.5, z: ev.z - Math.sin(ev.yaw) * 2.5, y: 1.6, yaw: ev.yaw, speed: 85, age: 0, target: ev.target, done: false });
        break;
      case 'gas':
        // 사용자 빼고 전원에게 즉시 (내가 소유한 말에만 적용 — 각자 자기 말을 판정)
        karts.forEach((o, i) => {
          if (i === ev.slot || o.finished) return;
          const isMine = owned ? owned[i] : i === this.mySlot;
          if (!isMine) return;
          if (o.shieldT > 0) o.shieldT = 0;
          else o.confuseT = 3;
        });
        break;
      case 'mine': {
        // 뒤에 5개: 부채꼴로
        const mx = ev.x - Math.cos(ev.yaw) * 4;
        const mz = ev.z + Math.sin(ev.yaw) * 4;
        const rx2 = Math.sin(ev.yaw);
        const rz2 = Math.cos(ev.yaw);
        for (let i = -2; i <= 2; i++) {
          this.projectiles.push({ id: ev.id * 8 + (i + 2), kind: 'mine', owner: ev.slot, x: mx + rx2 * i * 3.4 - Math.cos(ev.yaw) * Math.abs(i) * 1.8, z: mz + rz2 * i * 3.4 + Math.sin(ev.yaw) * Math.abs(i) * 1.8, y: 0.25, yaw: ev.yaw, speed: 0, age: 0, target: -1, done: false });
        }
        break;
      }
      case 'banana': {
        // 뒤에 3개: 가운데 + 좌우 3m
        const bx = ev.x - Math.cos(ev.yaw) * 3.5;
        const bz = ev.z + Math.sin(ev.yaw) * 3.5;
        const rx = Math.sin(ev.yaw);
        const rz = Math.cos(ev.yaw);
        for (let i = -1; i <= 1; i++) {
          this.projectiles.push({ id: ev.id * 4 + (i + 1), kind: 'banana', owner: ev.slot, x: bx + rx * i * 3.2 - Math.cos(ev.yaw) * Math.abs(i) * 1.5, z: bz + rz * i * 3.2 + Math.sin(ev.yaw) * Math.abs(i) * 1.5, y: 0, yaw: ev.yaw, speed: 0, age: 0, target: -1, done: false });
        }
        break;
      }
      case 'boost':
        if (mine && k) {
          // 이미 부스트 중이면 파란 부스터로 쌓아 둔다 (키가 먹통이 되지 않게)
          if (k.boostT > 0.25) {
            k.boosts = Math.min(MAX_BOOSTS, k.boosts + 1);
            k.blueBoosts = Math.min(k.boosts, k.blueBoosts + 1);
          } else {
            k.boostBlue = true;
            k.boostT = Math.max(k.boostT, BLUE_BOOST_DURATION);
            k.speed = Math.max(k.speed, k.speed * 1.15);
          }
        }
        break;
      case 'shield':
        if (mine && k) k.shieldT = 8;
        break;
      case 'magnet':
        if (mine && k) {
          k.magnetT = 3.0;
          k.magnetTarget = ev.target;
        }
        break;
      case 'ufo': {
        const t = karts[ev.target];
        const tMine = owned ? owned[ev.target] : ev.target === this.mySlot;
        if (t && tMine) {
          if (t.shieldT > 0) t.shieldT = 0;
          else this.applyHit(t, 'ufo');
        }
        break;
      }
    }
  }

  /** 원격 hit: 투사체 제거 (효과는 피격자 쪽에서 이미 적용됨) */
  applyHit_remote(pid: number, kind: ItemKind): void {
    if (kind === 'gas') return; // 구름은 시간이 지나면 저절로 사라진다
    for (const p of this.projectiles) if (p.id === pid) p.done = true;
  }

  /** 원격 box: 상자 숨김 (리젠 타이머 동기) */
  takeBox(id: number, time: number): void {
    const b = this.boxes.find((x) => x.id === id);
    if (b) b.takenT = time;
  }
}
