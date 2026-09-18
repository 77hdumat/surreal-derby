import * as THREE from 'three';
import type { Racer } from '../racers/Racer';
import type { RaceTrack } from '../track/RaceTrack';
import type { RaceEventManager } from '../events/RaceEventManager';
import type { RaceEvent, RaceEventType, ScheduledEvent } from '../events/RaceEvent';
import type { RankingEntry, RacerState, RacerStatus } from './RaceState';

/**
 * 레이스 시뮬레이션. Three.js 와 무관한 순수 계산.
 * distance / currentSpeed / lane 을 갱신하고, 이벤트를 적용하며, 순위를 계산한다.
 */
export class RaceEngine {
  readonly racers: Racer[];
  readonly track: RaceTrack;
  readonly events: RaceEventManager;
  time = 0;
  running = false;
  over = false;
  ranking: RankingEntry[] = [];
  leaderId: string | null = null;
  firstFinishTime: number | null = null;
  finalStretchFired = false;
  private leadChangeCooldown = 0;
  private pairCooldown = new Map<string, number>();
  private lastRankTime = 0;
  private longbodyFinishTried = false;

  constructor(racers: Racer[], track: RaceTrack, events: RaceEventManager) {
    this.racers = racers;
    this.track = track;
    this.events = events;
  }

  get estimatedDuration(): number {
    return this.track.raceDistance / 15.2;
  }

  reset(): void {
    this.time = 0;
    this.running = false;
    this.over = false;
    this.leaderId = null;
    this.firstFinishTime = null;
    this.finalStretchFired = false;
    this.leadChangeCooldown = 0;
    this.pairCooldown.clear();
    this.longbodyFinishTried = false;
    this.events.clear();
    this.racers.forEach((r) => r.reset(this.track.laneToLat(r.def.number - 1)));
    this.computeRanking();
  }

  start(): void {
    this.reset();
    this.events.generateTimeline(this.racers, this.estimatedDuration);
    this.racers.forEach((r) => {
      r.state.state = 'RUNNING';
      // 출발 반응 속도 — 코끼리/소는 굼뜸
      r.state.currentSpeed = 1 + Math.random() * 2 * r.def.acceleration * 0.3;
    });
    this.running = true;
    this.events.emit({ time: 0, racerId: '', event: 'START', major: false });
  }

  private byId(id: string): Racer | undefined {
    return this.racers.find((r) => r.def.id === id);
  }

  update(dt: number): void {
    if (!this.running || this.over) return;
    this.time += dt;
    this.leadChangeCooldown -= dt;
    for (const due of this.events.popDue(this.time)) this.fireScheduled(due);
    for (const r of this.racers) this.updateRacer(r, dt);
    this.interactions(dt);
    this.longbodyFinishCheck();
    this.checkFinish();
    if (this.time - this.lastRankTime > 0.05) {
      this.computeRanking();
      this.lastRankTime = this.time;
    }
    this.checkRaceOver();
  }

  // ---------------------------------------------------------------- per racer

  private setState(r: Racer, state: RacerStatus, timer: number, speedMul = 1, accelMul = 1): void {
    const s = r.state;
    if (s.state === 'FINISHED') return;
    s.state = state;
    s.stateTimer = timer;
    s.speedMultiplier = speedMul;
    s.accelMultiplier = accelMul;
  }

  private updateRacer(r: Racer, dt: number): void {
    const s = r.state;
    const d = r.def;
    if (s.state === 'IDLE') return;
    if (s.state === 'FINISHED') {
      // 결승 후에도 그대로 달려 나가며 아주 천천히 감속 (화면 밖으로 사라지도록)
      s.currentSpeed = Math.max(6, s.currentSpeed - 0.7 * dt);
      s.distance += s.currentSpeed * dt;
      s.boostIntensity = Math.max(0, s.boostIntensity - dt);
      s.extension = Math.max(0, s.extension - dt / 1.5);
      s.lane += (s.homeLane - s.lane) * dt * 0.5;
      return;
    }
    // 상태 타이머
    if (s.state !== 'RUNNING') {
      s.stateTimer -= dt;
      if (s.stateTimer <= 0) this.leaveState(r);
    }
    // 스태미나
    const ratio = s.currentSpeed / d.speed;
    const drain = ratio * ratio * (s.state === 'BOOSTING' || s.state === 'RAGING' ? 1.4 : 1);
    if (d.specialAbility !== 'TROJAN' && d.specialAbility !== 'MOTORCYCLE') s.stamina -= drain * dt;
    if (s.stamina <= 0 && !s.fatigued) s.fatigued = true;

    const cornerW = this.track.cornerWeight(s.distance);
    const outer = Math.max(0, s.lane) / (this.track.width / 2);
    let cornerFactor = 1 - cornerW * (1 - d.cornering) * 0.2 - cornerW * outer * 0.035;
    let straightBonus = 1;
    if (d.specialAbility === 'COSTUME') straightBonus = 1 + (1 - cornerW) * 0.06;
    if (d.specialAbility === 'MOTORCYCLE' && s.state !== 'BOOSTING') {
      // 초반엔 얌전히
      straightBonus = this.time < 10 ? 0.92 : 1;
    }
    const fatigue = s.fatigued ? (d.specialAbility === 'HUMAN' ? 0.78 : 0.84) : 1;
    const wobble = 1 + 0.03 * Math.sin(this.time * 1.3 + s.wobbleSeed) + 0.02 * Math.sin(this.time * 2.9 + s.wobbleSeed * 1.7);
    let stateFactor = 1;
    switch (s.state) {
      case 'COLLAPSED':
      case 'ENGINE_FAILURE':
        stateFactor = 0;
        break;
      case 'RECOVERING':
        stateFactor = 0.35;
        break;
      case 'STUNNED':
        stateFactor = 0.45;
        break;
      case 'EXHAUSTED':
        stateFactor = 0.62;
        break;
    }
    const riderlessFactor = s.riderless ? 0.9 : 1;
    // 러버밴드: 뒤처진 선수는 조금 더, 독주하는 선두는 조금 덜 (중계 재미용)
    const leadDist = this.ranking.length ? Math.max(...this.ranking.map((e) => e.distance)) : s.distance;
    const gap = Math.max(0, leadDist - s.distance);
    let rubber = 1 + Math.min(gap / 120, 1) * 0.16;
    if (s.rank === 1 && this.ranking[1] && this.ranking[1].gapToLeader > 12) rubber = 0.975;
    const target = d.speed * s.form * cornerFactor * fatigue * wobble * s.speedMultiplier * stateFactor * straightBonus * riderlessFactor * rubber;

    const accel = d.acceleration * s.accelMultiplier;
    const prev = s.currentSpeed;
    if (target > s.currentSpeed) s.currentSpeed = Math.min(target, s.currentSpeed + accel * dt);
    else {
      const decel = stateFactor === 0 ? 14 : Math.max(accel * 2, 6);
      s.currentSpeed = Math.max(target, s.currentSpeed - decel * dt);
    }
    s.lastAccel = THREE.MathUtils.lerp(s.lastAccel, (s.currentSpeed - prev) / Math.max(dt, 1e-4), 0.2);
    s.distance += s.currentSpeed * dt;

    // 횡방향: 선두는 안쪽으로, 코너링 나쁘면 바깥으로 밀림
    const half = this.track.width / 2;
    const blend = THREE.MathUtils.clamp(this.time / 22, 0, 1);
    const preferred = -half + 2.2 + (s.rank - 1) * 1.9 + Math.sin(s.wobbleSeed) * 0.8;
    const startLat = this.track.laneToLat(d.number - 1);
    s.homeLane = THREE.MathUtils.lerp(startLat, preferred, blend);
    const cornerDrift = cornerW * (1 - d.cornering) * 3.2;
    let baseTarget = s.homeLane + cornerDrift;
    // 모터사이클: 좌우로 와리가리 (부스트 중엔 더 크게)
    if (d.specialAbility === 'MOTORCYCLE' && s.currentSpeed > 4) {
      const amp = s.state === 'BOOSTING' ? 6.5 : 3.5;
      baseTarget += Math.sin(this.time * 2.6 + s.wobbleSeed) * amp + Math.sin(this.time * 7.1) * 1.2;
    }
    // 코끼리: 돌진 중엔 가장 가까운 앞 선수를 향해 들이받으러 감
    if (d.specialAbility === 'ELEPHANT' && s.state === 'CHARGING') {
      let best: Racer | null = null;
      let bestD = 14;
      for (const o of this.racers) {
        if (o === r || o.state.state === 'FINISHED' || o.state.state === 'IDLE') continue;
        const ds = o.state.distance - s.distance;
        if (ds > -2 && ds < bestD) {
          bestD = ds;
          best = o;
        }
      }
      if (best) baseTarget = best.state.lane;
    }
    // targetLane 은 interactions 에서 추월 오프셋을 더할 수 있으므로 서서히 복귀
    s.targetLane += (baseTarget - s.targetLane) * Math.min(1, dt * 1.5);
    s.targetLane = THREE.MathUtils.clamp(s.targetLane, -half + 0.9, half - 0.9);
    const lateralSpeed = s.state === 'COLLAPSED' ? 0 : (d.specialAbility === 'MOTORCYCLE' ? 4.5 : 1.6) + s.currentSpeed * 0.04;
    const diff = s.targetLane - s.lane;
    s.lane += THREE.MathUtils.clamp(diff, -lateralSpeed * dt, lateralSpeed * dt);
    s.lane = THREE.MathUtils.clamp(s.lane, -half + 0.7, half - 0.7);

    s.bumpTimer = Math.max(0, s.bumpTimer - dt);
    const boosting = s.state === 'BOOSTING' || s.state === 'CHARGING' || s.state === 'RAGING' || s.state === 'BIPEDAL' || s.state === 'PERFORMING' || s.state === 'AMBUSH' || s.state === 'GRABBING';
    const boostTarget = s.state === 'BOOSTING' ? 1 : boosting ? 0.45 : 0;
    s.boostIntensity = THREE.MathUtils.lerp(s.boostIntensity, boostTarget, Math.min(1, dt * (boosting ? 4 : 2)));

    // 기린: 결승선 근처에서 목 뻗기 → 판정 보너스
    if (d.specialAbility === 'GIRAFFE') {
      const toFinish = this.track.raceDistance - s.distance;
      const want = toFinish < 45 ? 1 : 0;
      s.extension = THREE.MathUtils.clamp(s.extension + (want > s.extension ? dt / 0.8 : -dt / 1.2), 0, 1);
      s.finishBonus = s.extension * 2.2;
    }
    // 코끼리: 코 늘어남 (붙잡기)
    if (d.specialAbility === 'ELEPHANT') {
      const want = s.state === 'GRABBING' ? 1 : 0;
      s.extension = THREE.MathUtils.clamp(s.extension + (want > s.extension ? dt / 0.6 : -dt / 1.0), 0, 1);
    }
    // 롱바디: 몸통 늘어남 → 머리가 먼저 결승선 통과
    if (d.specialAbility === 'LONGBODY') {
      const want = s.state === 'STRETCHED' ? 1 : 0;
      s.extension = THREE.MathUtils.clamp(s.extension + (want > s.extension ? dt / 0.9 : -dt / 1.6), 0, 1);
      s.finishBonus = s.extension * 8.5;
    }
  }

  private leaveState(r: Racer): void {
    const s = r.state;
    const prev = s.state;
    s.speedMultiplier = 1;
    s.accelMultiplier = 1;
    switch (prev) {
      case 'COLLAPSED':
        s.state = 'RECOVERING';
        s.stateTimer = 1.6;
        this.events.emit({ time: this.time, racerId: r.def.id, event: 'COSTUME_RECOVER', major: false });
        return;
      case 'ENGINE_FAILURE':
        s.state = 'RUNNING';
        this.events.emit({ time: this.time, racerId: r.def.id, event: 'ENGINE_RESTART', major: false });
        return;
      case 'BIPEDAL':
        // 두 발 질주 후엔 반드시 지친다
        s.state = 'EXHAUSTED';
        s.stateTimer = 3.5;
        return;
      case 'STRETCHED':
        s.state = 'RUNNING';
        this.events.emit({ time: this.time, racerId: r.def.id, event: 'LONGBODY_RETRACT', major: false });
        return;
      default:
        s.state = 'RUNNING';
    }
  }

  // ---------------------------------------------------------------- interactions

  private pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  private interactions(dt: number): void {
    for (const [k, v] of this.pairCooldown) {
      const nv = v - dt;
      if (nv <= 0) this.pairCooldown.delete(k);
      else this.pairCooldown.set(k, nv);
    }
    const n = this.racers.length;
    for (let i = 0; i < n; i++) {
      const a = this.racers[i];
      if (a.state.state === 'IDLE' || a.state.state === 'FINISHED') continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.racers[j];
        if (b.state.state === 'IDLE' || b.state.state === 'FINISHED') continue;
        const sa = a.state;
        const sb = b.state;
        const ds = sa.distance - sb.distance;
        const dl = sa.lane - sb.lane;
        const ads = Math.abs(ds);
        const adl = Math.abs(dl);
        // 추월 시도: 뒤 선수가 앞 선수에 막힘 → 옆으로 빠짐
        if (ads < 7 && adl < 1.6) {
          const back = ds < 0 ? a : b;
          const front = ds < 0 ? b : a;
          if (back.state.currentSpeed > front.state.currentSpeed + 0.3) {
            const side = back.state.lane > front.state.lane ? 1 : -1;
            back.state.targetLane += side * 2.4 * dt * 3;
          }
        }
        // 접촉
        if (ads < 3.2 && adl < 1.7) {
          const overlap = 1.7 - adl;
          const wa = a.def.weight;
          const wb = b.def.weight;
          const sign = dl >= 0 ? 1 : -1;
          sa.lane += sign * overlap * (wb / (wa + wb)) * 0.6;
          sb.lane -= sign * overlap * (wa / (wa + wb)) * 0.6;
          const key = this.pairKey(a.def.id, b.def.id);
          if (this.pairCooldown.has(key)) continue;
          const aggressorA = sa.state === 'CHARGING' || sa.state === 'RAGING';
          const aggressorB = sb.state === 'CHARGING' || sb.state === 'RAGING';
          if (aggressorA || aggressorB) {
            const victim = aggressorA ? b : a;
            const aggressor = aggressorA ? a : b;
            this.pairCooldown.set(key, 1.5);
            this.knock(victim, aggressor === a ? -sign : sign, 0.6, 0.55);
            this.events.emit({
              time: this.time,
              racerId: aggressor.def.id,
              targetId: victim.def.id,
              event: 'BUMP',
              major: false,
              label: `${aggressor.def.name} → ${victim.def.name} 밀어냄`,
            });
          } else if (Math.random() < 0.35) {
            this.pairCooldown.set(key, 3);
            const lighter = wa < wb ? a : b;
            const lighterSign = lighter === a ? sign : -sign;
            this.knock(lighter, lighterSign, 0.35, 0.9);
            this.events.emit({
              time: this.time,
              racerId: lighter.def.id,
              targetId: lighter === a ? b.def.id : a.def.id,
              event: 'BUMP',
              major: false,
            });
          }
        }
      }
    }
  }

  private knock(r: Racer, dir: number, stun: number, speedKeep: number): void {
    const s = r.state;
    if (s.state === 'COLLAPSED' || s.state === 'FINISHED' || s.state === 'ENGINE_FAILURE') return;
    s.currentSpeed *= speedKeep;
    s.bumpTimer = 0.7;
    s.bumpDir = dir;
    s.targetLane += dir * 2.0;
    if (stun > 0 && (s.state === 'RUNNING' || s.state === 'STUNNED')) {
      s.state = 'STUNNED';
      s.stateTimer = stun;
    }
  }

  // ---------------------------------------------------------------- events

  private fireScheduled(due: ScheduledEvent): void {
    let racer: Racer | undefined;
    let target: Racer | undefined;
    const running = this.racers.filter((r) => r.state.state === 'RUNNING');
    if (due.racerId !== 'DYNAMIC') {
      racer = this.byId(due.racerId);
      if (!racer || racer.state.state === 'FINISHED') return;
    } else {
      switch (due.event) {
        case 'COLLISION': {
          let best: [Racer, Racer] | null = null;
          let bestScore = Infinity;
          for (let i = 0; i < this.racers.length; i++)
            for (let j = i + 1; j < this.racers.length; j++) {
              const a = this.racers[i];
              const b = this.racers[j];
              if (a.state.state !== 'RUNNING' || b.state.state !== 'RUNNING') continue;
              const ds = Math.abs(a.state.distance - b.state.distance);
              if (ds > 7) continue;
              let score = ds + Math.abs(a.state.lane - b.state.lane) * 0.5;
              if (a.def.id === 'classic' || b.def.id === 'classic') score -= 4;
              if (score < bestScore) {
                bestScore = score;
                best = [a, b];
              }
            }
          if (!best) return;
          const lighter = best[0].def.weight < best[1].def.weight ? best[0] : best[1];
          racer = lighter;
          target = lighter === best[0] ? best[1] : best[0];
          break;
        }
        case 'COMEBACK': {
          const back = running.filter((r) => r.state.rank >= 5 && r.def.id !== 'motorcycle');
          if (!back.length) return;
          racer = back[Math.floor(Math.random() * back.length)];
          break;
        }
        default: {
          // 불운한 클래식 호스는 사고에 잘 휘말린다
          const pool: Racer[] = [];
          for (const r of running) {
            if (due.event === 'RIDER_FALL' && r.state.riderless) continue;
            if (due.event === 'SUPER_SPRINT' && (r.def.id === 'motorcycle' || r.def.id === 'elephant')) continue;
            const w = r.def.id === 'classic' && due.event !== 'SUPER_SPRINT' ? 4 : 1;
            for (let k = 0; k < w; k++) pool.push(r);
          }
          if (!pool.length) return;
          racer = pool[Math.floor(Math.random() * pool.length)];
        }
      }
    }
    if (!racer) return;
    if (due.event === 'GIRAFFE_NECK_ATTACK') {
      let bestD = 14;
      for (const o of running) {
        if (o === racer) continue;
        const ds = Math.abs(o.state.distance - racer.state.distance);
        if (ds < bestD) {
          bestD = ds;
          target = o;
        }
      }
      if (!target) return;
    }
    this.applyEvent({ time: this.time, racerId: racer.def.id, targetId: target?.def.id, event: due.event, major: true });
  }

  /** 이벤트를 실제 상태 변화로 적용하고 브로드캐스트 */
  applyEvent(evIn: Omit<RaceEvent, 'label'> & { label?: string }): void {
    let ev = evIn;
    const r = this.byId(ev.racerId);
    if (!r) return;
    const s = r.state;
    if (s.state === 'FINISHED' || s.state === 'IDLE') return;
    const target = ev.targetId ? this.byId(ev.targetId) : undefined;
    const t: RaceEventType = ev.event;
    let label = ev.label;
    switch (t) {
      case 'COSTUME_COLLAPSE':
        this.setState(r, 'COLLAPSED', 3.2);
        break;
      case 'ELEPHANT_CHARGE':
        this.setState(r, 'CHARGING', 8.5, 1.62, 3.2);
        s.fatigued = false;
        break;
      case 'ELEPHANT_TRUNK': {
        // 앞 선수를 코로 붙잡아 끌어내리고 자신은 끌려가듯 가속
        this.setState(r, 'GRABBING', 4.5, 1.35, 3);
        let best: Racer | undefined;
        let bestD = 12;
        for (const o of this.racers) {
          if (o === r || o.state.state === 'FINISHED' || o.state.state === 'IDLE') continue;
          const ds = o.state.distance - s.distance;
          if (ds > 0 && ds < bestD && Math.abs(o.state.lane - s.lane) < 6) {
            bestD = ds;
            best = o;
          }
        }
        if (best) {
          this.knock(best, best.state.lane > s.lane ? 1 : -1, 2.0, 0.45);
          ev = { ...ev, targetId: best.def.id };
          label = `${r.def.name} 코로 ${best.def.name} 붙잡음`;
        } else label = `${r.def.name} 코 늘리기 (허공)`;
        break;
      }
      case 'ELEPHANT_STOMP': {
        // 발구르기: 주변 전원 휘청
        let hit = 0;
        for (const o of this.racers) {
          if (o === r || o.state.state === 'FINISHED' || o.state.state === 'IDLE') continue;
          if (Math.abs(o.state.distance - s.distance) < 10) {
            this.knock(o, o.state.lane > s.lane ? 1 : -1, 1.3, 0.55);
            hit++;
          }
        }
        label = `${r.def.name} 발구르기 — ${hit}명 휘청`;
        break;
      }
      case 'ELEPHANT_SPRAY': {
        this.setState(r, 'SPRAYING', 3.2, 1.0, 1);
        let hit = 0;
        for (const o of this.racers) {
          if (o === r || o.state.state === 'FINISHED' || o.state.state === 'IDLE') continue;
          const ds = o.state.distance - s.distance;
          if (ds > 0 && ds < 16 && Math.abs(o.state.lane - s.lane) < 5) {
            this.knock(o, o.state.lane > s.lane ? 1 : -1, 1.6, 0.6);
            hit++;
          }
        }
        label = `${r.def.name} 물대포 — ${hit}명 미끄러짐`;
        break;
      }
      case 'COW_RAGE':
        this.setState(r, 'RAGING', 10, 1.42, 2.5);
        break;
      case 'MOTORCYCLE_BOOST':
        this.setState(r, 'BOOSTING', 8, 1.75, 8);
        break;
      case 'ENGINE_FAILURE':
        this.setState(r, 'ENGINE_FAILURE', 4.5);
        break;
      case 'HUMAN_EXHAUSTED':
        this.setState(r, 'EXHAUSTED', 6);
        break;
      case 'HUMAN_BIPEDAL':
        this.setState(r, 'BIPEDAL', 5, 1.45, 2.5);
        s.fatigued = false;
        break;
      case 'GIRAFFE_NECK_ATTACK':
        if (target) {
          const dir = target.state.lane > s.lane ? 1 : -1;
          this.knock(target, dir, 1.2, 0.5);
          label = `${r.def.name} 목 공격 → ${target.def.name}`;
        }
        break;
      case 'TROJAN_AMBUSH':
        this.setState(r, 'AMBUSH', 6, 1.55, 4);
        break;
      case 'CIRCUS_ACT':
        this.setState(r, 'PERFORMING', 6.5, 1.35, 3);
        s.fatigued = false;
        break;
      case 'LONGBODY_STRETCH':
        // 결승선 앞이면 골인까지 유지, 중간이면 잠깐 늘었다 줄어듦
        this.setState(r, 'STRETCHED', ev.duration ?? 4.5, 1.04);
        break;
      case 'RIDER_FALL':
        s.riderless = true;
        this.setState(r, 'STUNNED', 1.0);
        label = `${r.def.name} 기수 낙마`;
        break;
      case 'TRIP':
        this.setState(r, 'STUNNED', 1.6);
        s.currentSpeed *= 0.35;
        label = `${r.def.name} 발이 걸림`;
        break;
      case 'SUPER_SPRINT':
        this.setState(r, 'BOOSTING', 5, 1.38, 2.5);
        s.fatigued = false;
        label = `${r.def.name} 초강력 스퍼트`;
        break;
      case 'COLLISION':
        if (target) {
          const dir = s.lane > target.state.lane ? 1 : -1;
          this.knock(r, dir, 1.4, 0.4);
          this.knock(target, -dir, 0.3, 0.8);
          label = `${r.def.name} × ${target.def.name} 충돌`;
        }
        break;
      case 'COMEBACK':
        this.setState(r, 'BOOSTING', 8.5, 1.48, 2.2);
        s.fatigued = false;
        label = `${r.def.name} 기적의 추격`;
        break;
    }
    this.events.emit({ ...ev, label });
  }

  /** 롱바디: 결승선 앞에서 랜덤하게 쭈우욱 — 선두권일 때만 */
  private longbodyFinishCheck(): void {
    if (this.longbodyFinishTried) return;
    const r = this.byId('longbody');
    if (!r || r.state.state === 'FINISHED' || r.state.state === 'IDLE') return;
    const toFinish = this.track.raceDistance - r.state.distance;
    if (toFinish > 60) return;
    this.longbodyFinishTried = true;
    const leadDist = this.ranking.length ? this.ranking[0].distance : r.state.distance;
    const gap = leadDist - r.state.distance;
    const running = r.state.state === 'RUNNING' || r.state.state === 'STRETCHED';
    if (running && gap < 16 && Math.random() < 0.75) {
      this.applyEvent({
        time: this.time,
        racerId: 'longbody',
        event: 'LONGBODY_STRETCH',
        major: true,
        duration: 40,
        label: '결승선 앞 몸통 쭈우욱 (사진 판정)',
      });
    }
  }

  // ---------------------------------------------------------------- finish / ranking

  private checkFinish(): void {
    const D = this.track.raceDistance;
    const leader = this.ranking[0] ? this.byId(this.ranking[0].id) : undefined;
    if (!this.finalStretchFired && leader && leader.state.distance >= D - 150) {
      this.finalStretchFired = true;
      this.events.emit({ time: this.time, racerId: leader.def.id, event: 'FINAL_STRETCH', major: false });
    }
    for (const r of this.racers) {
      const s = r.state;
      if (s.state === 'FINISHED' || s.state === 'IDLE') continue;
      const eff = s.distance + s.finishBonus;
      if (eff >= D) {
        const overshoot = eff - D;
        s.finishTime = this.time - overshoot / Math.max(s.currentSpeed, 0.1);
        s.state = 'FINISHED';
        s.speedMultiplier = 1;
        if (this.firstFinishTime === null) this.firstFinishTime = this.time;
        const isFirst = this.racers.filter((x) => x.state.state === 'FINISHED').length === 1;
        this.events.emit({
          time: this.time,
          racerId: r.def.id,
          event: 'FINISH_LINE',
          major: false,
          label: isFirst ? `${r.def.name} 1위 결승선 통과` : undefined,
        });
        if (r.def.specialAbility === 'GIRAFFE' && s.finishBonus > 0) {
          const rival = this.racers.find(
            (o) => o !== r && o.state.state !== 'IDLE' && Math.abs(o.state.distance + o.state.finishBonus - eff) < 3,
          );
          if (rival) {
            this.events.emit({
              time: this.time,
              racerId: r.def.id,
              targetId: rival.def.id,
              event: 'GIRAFFE_PHOTO_FINISH',
              major: false,
              label: `${r.def.name} 목 내밀기 사진 판정 (vs ${rival.def.name})`,
            });
          }
        }
      }
    }
  }

  computeRanking(): void {
    const sorted = [...this.racers].sort((a, b) => {
      const fa = a.state.finishTime;
      const fb = b.state.finishTime;
      if (fa !== null && fb !== null) return fa - fb;
      if (fa !== null) return -1;
      if (fb !== null) return 1;
      return b.state.distance + b.state.finishBonus - (a.state.distance + a.state.finishBonus);
    });
    const leadDist = sorted[0].state.distance;
    this.ranking = sorted.map((r, i) => {
      r.state.prevRank = r.state.rank;
      r.state.rank = i + 1;
      return {
        id: r.def.id,
        number: r.def.number,
        rank: i + 1,
        distance: r.state.distance,
        gapToLeader: leadDist - r.state.distance,
        finished: r.state.finishTime !== null,
      };
    });
    const newLeader = sorted[0].def.id;
    if (this.running && this.leaderId && newLeader !== this.leaderId && this.time > 3 && this.leadChangeCooldown <= 0 && !sorted[0].state.finishTime) {
      this.leadChangeCooldown = 2.5;
      this.events.emit({ time: this.time, racerId: newLeader, event: 'LEAD_CHANGE', major: false, label: `${sorted[0].def.name} 선두 교체` });
    }
    this.leaderId = newLeader;
  }

  private checkRaceOver(): void {
    const allDone = this.racers.every((r) => r.state.state === 'FINISHED');
    const timeout = this.firstFinishTime !== null && this.time - this.firstFinishTime > 20;
    if (allDone || timeout) {
      this.over = true;
      this.running = false;
      this.computeRanking();
      this.events.emit({ time: this.time, racerId: this.ranking[0].id, event: 'RACE_OVER', major: false });
    }
  }

  /** 슬로모션 조건: 선두가 결승선 직전이고 2위와 근접 */
  photoFinishTension(): number {
    if (!this.ranking.length) return 0;
    const lead = this.byId(this.ranking[0].id)!;
    if (lead.state.state === 'FINISHED') return 0;
    const toFinish = this.track.raceDistance - lead.state.distance - lead.state.finishBonus;
    if (toFinish > 40 || toFinish < 0) return 0;
    const second = this.ranking[1] ? this.byId(this.ranking[1].id)! : null;
    if (!second) return 0;
    const gap = lead.state.distance + lead.state.finishBonus - (second.state.distance + second.state.finishBonus);
    if (gap > 4.5) return 0;
    return 1 - gap / 4.5;
  }

  get states(): RacerState[] {
    return this.racers.map((r) => r.state);
  }

  racerById(id: string): Racer | undefined {
    return this.byId(id);
  }
}
