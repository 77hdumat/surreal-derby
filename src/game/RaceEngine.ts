import * as THREE from 'three';
import type { Racer } from '../racers/Racer';
import type { RaceTrack } from '../track/RaceTrack';
import type { RaceEventManager } from '../events/RaceEventManager';
import type { RaceEvent, RaceEventType, ScheduledEvent } from '../events/RaceEvent';
import type { RankingEntry, RacerState, RacerStatus } from './RaceState';
import { pickScenario, SCENARIOS, type Scenario } from '../events/Scenarios';

/** 몸통까지 결승선을 지난 뒤 카메라 프레임 밖으로 빠져나가는 거리. */
export const FINISH_EXIT_DISTANCE = 58;

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
  scenario: Scenario | null = null;
  /** 디버그: 특정 시나리오 강제 */
  forcedScenarioId: string | null = null;
  private finaleFired = false;
  private twistCount = 0;
  private twistDistances: [number, number] = [125, 52];
  private carryDuration = 12;

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
    this.finaleFired = false;
    this.twistCount = 0;
    this.twistDistances = [110 + Math.random() * 35, 42 + Math.random() * 20];
    this.scenario = null;
    this.lastRankTime = -1;
    this.events.clear();
    this.racers.forEach((r) => r.reset(this.track.laneToLat(r.def.number - 1)));
    this.computeRanking();
  }

  start(): void {
    this.reset();
    this.scenario = (this.forcedScenarioId && SCENARIOS.find((x) => x.id === this.forcedScenarioId)) || pickScenario();
    this.events.generateTimeline(this.racers, this.estimatedDuration, this.scenario);
    this.racers.forEach((r) => {
      r.state.state = 'RUNNING';
      // 우승 예정자는 컨디션 최소 보장 (피날레 전까지 너무 뒤처지지 않게)
      if (this.scenario?.winnerId === r.def.id) r.state.form = Math.max(r.state.form, 1.0);
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
    this.releaseTrailingPack();
    for (const r of this.racers) this.updateRacer(r, dt);
    this.interactions(dt);
    this.longbodyFinishCheck();
    this.finaleCheck();
    this.twistCheck();
    this.checkFinish();
    if (this.time - this.lastRankTime > 0.05) {
      this.computeRanking();
      this.lastRankTime = this.time;
    }
    this.checkRaceOver();
  }

  /**
   * 첫 골인 뒤에도 사고 상태에 영구히 묶인 선수가 없도록 한다.
   * 연출은 충분히 보여준 뒤 마지막 선수까지 실제 결승선을 통과시킨다.
   */
  private releaseTrailingPack(): void {
    if (this.firstFinishTime === null || this.time - this.firstFinishTime < 18) return;
    const stopped: RacerStatus[] = ['COLLAPSED', 'ENGINE_FAILURE', 'FALLEN', 'BROKEN', 'SLEEPING', 'STUBBORN', 'SHOELACE', 'PLANTED', 'DANCING'];
    for (const r of this.racers) {
      const s = r.state;
      if (s.finishTime !== null || s.state === 'IDLE') continue;
      if (stopped.includes(s.state)) {
        s.state = 'RUNNING';
        s.stateTimer = 0;
      }
      s.speedMultiplier = Math.max(s.speedMultiplier, 1.12);
      s.accelMultiplier = Math.max(s.accelMultiplier, 2);
      s.currentSpeed = Math.max(s.currentSpeed, r.def.speed * 0.78);
    }
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
      // 늘어난 몸/목은 몸통(원점)이 결승선을 지난 뒤에 줄어듦
      if (s.distance >= this.track.raceDistance) s.extension = Math.max(0, s.extension - dt / 1.5);
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
      case 'LAUNCHED':
        stateFactor = 0.35; // 공중에서 앞으로 날아가는 관성
        break;
      case 'PLANTED':
      case 'FALLEN':
      case 'BROKEN':
      case 'SLEEPING':
      case 'STUBBORN':
      case 'SHOELACE':
      case 'DANCING':
        stateFactor = 0;
        break;
    }
    const riderlessFactor = s.riderless ? 0.9 : 1;
    // 러버밴드: 뒤처진 선수는 조금 더, 독주하는 선두는 조금 덜 (중계 재미용)
    const leadDist = this.ranking.length ? Math.max(...this.ranking.map((e) => e.distance)) : s.distance;
    const gap = Math.max(0, leadDist - s.distance);
    let rubber = 1 + Math.min(gap / 120, 1) * 0.16;
    // 우승 예정자: 피날레 전까지 선두와 45m 이상 벌어지지 않게 조용히 보정
    if (this.scenario?.winnerId === d.id && !s.destiny && gap > 45) rubber += 0.18;
    if (s.rank === 1 && this.ranking[1] && this.ranking[1].gapToLeader > 12) rubber = 0.975;
    const baseTarget0 = d.speed * s.form * cornerFactor * fatigue * wobble * s.speedMultiplier * stateFactor * straightBonus * riderlessFactor * rubber * (s.state === 'CARRYING' ? 1.3 : 1);

    let target2 = baseTarget0;
    let accel = d.acceleration * s.accelMultiplier;
    // 시나리오 운명 보정: 결승 전에 선두를 반드시 잡도록 필요한 속도를 계산
    if (s.destiny) {
      const D = this.track.raceDistance;
      let lead: Racer | null = null;
      for (const o of this.racers) {
        if (o === r || o.state.state === 'IDLE') continue;
        if (o.state.finishTime !== null) continue;
        if (!lead || o.state.distance + o.state.finishBonus > lead.state.distance + lead.state.finishBonus) lead = o;
      }
      if (lead) {
        const leadEff = lead.state.distance + lead.state.finishBonus;
        const myEff = s.distance + s.finishBonus;
        const gap = leadEff - myEff;
        const leadSpeed = Math.max(4, lead.state.currentSpeed);
        const timeLeft = Math.max(0.6, (D - leadEff) / leadSpeed);
        // 여유 12m: 기린 목·코끼리 코처럼 막판에 갑자기 늘어나는 판정 거리까지 감안
        const required = leadSpeed + (gap + 12) / timeLeft;
        if (gap > -3) {
          target2 = Math.max(target2, Math.min(required * 1.2, 110));
          accel = Math.max(accel, 14);
        }
      }
    }
    // 탈 들어올리기: 처음 1초는 멈춰 서서 팔을 번쩍 든 뒤 폭주
    const lifting = s.state === 'CARRYING' && s.stateTimer > this.carryDuration - 1.0;
    const target = s.state === 'REVERSING' ? -6.5 : lifting ? 0.5 : target2;
    const prev = s.currentSpeed;
    if (target > s.currentSpeed) s.currentSpeed = Math.min(target, s.currentSpeed + accel * dt);
    else {
      const decel = stateFactor === 0 || s.state === 'REVERSING' ? 14 : Math.max(accel * 2, 6);
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
      // 트랙 왼쪽 끝 ↔ 오른쪽 끝을 계속 왕복 (부스트 중엔 더 빠르게)
      const rate = s.state === 'BOOSTING' ? 1.6 : 0.95;
      baseTarget = Math.sin(this.time * rate + s.wobbleSeed) * (half - 1.6) + Math.sin(this.time * 6.3) * 0.6;
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
    const stopped = s.state === 'COLLAPSED' || s.state === 'FALLEN' || s.state === 'BROKEN' || s.state === 'SLEEPING' || s.state === 'STUBBORN' || s.state === 'SHOELACE' || s.state === 'PLANTED' || s.state === 'DANCING';
    const lateralSpeed = stopped ? 0 : (d.specialAbility === 'MOTORCYCLE' ? 9 : 1.6) + Math.abs(s.currentSpeed) * 0.04;
    const diff = s.targetLane - s.lane;
    s.lane += THREE.MathUtils.clamp(diff, -lateralSpeed * dt, lateralSpeed * dt);
    s.lane = THREE.MathUtils.clamp(s.lane, -half + 0.7, half - 0.7);

    s.bumpTimer = Math.max(0, s.bumpTimer - dt);
    const boosting = s.state === 'BOOSTING' || s.state === 'CHARGING' || s.state === 'RAGING' || s.state === 'BIPEDAL' || s.state === 'PERFORMING' || s.state === 'AMBUSH' || s.state === 'GRABBING';
    const boostTarget = s.state === 'BOOSTING' ? 1 : boosting ? 0.45 : 0;
    s.boostIntensity = THREE.MathUtils.lerp(s.boostIntensity, boostTarget, Math.min(1, dt * (boosting ? 4 : 2)));

    // 결승선 판정은 코끝 기준: 몸통 원점 + noseOffset + (늘어난 코/목/몸통)
    let reach = 0;
    // 코끼리: 코 늘어남 (붙잡기) — 피날레에선 코가 결승선까지 닿음
    if (d.specialAbility === 'ELEPHANT') {
      const want = s.state === 'GRABBING' ? 1 : 0;
      s.extension = THREE.MathUtils.clamp(s.extension + (want > s.extension ? dt / 0.6 : -dt / 1.0), 0, 1);
      if (s.extensionMax === 0) s.extensionMax = 2.4;
      reach = s.extension * s.extensionMax;
    }
    // 롱바디: 몸통 늘어남 → 머리가 먼저 결승선 통과
    if (d.specialAbility === 'LONGBODY') {
      const want = s.state === 'STRETCHED' ? 1 : 0;
      if (s.extensionMax === 0) s.extensionMax = 8.5;
      s.extension = THREE.MathUtils.clamp(s.extension + (want > s.extension ? dt / (s.extensionMax > 20 ? 1.6 : 0.9) : -dt / 1.6), 0, 1);
      reach = s.extension * s.extensionMax;
    }
    // 기린: 결승선 근처에서 목을 앞으로 길게 뻗음 → 코끝이 먼저 들어감 (피날레: 목이 화면 밖까지)
    if (d.specialAbility === 'GIRAFFE') {
      const toFinish = this.track.raceDistance - s.distance;
      if (s.extensionMax === 0) s.extensionMax = 6.5;
      const want = s.state === 'STRETCHED' || toFinish < 55 ? 1 : 0;
      s.extension = THREE.MathUtils.clamp(s.extension + (want > s.extension ? dt / (s.extensionMax > 10 ? 1.4 : 1.0) : -dt / 1.2), 0, 1);
      reach = s.extension * s.extensionMax;
    }
    s.finishBonus = d.noseOffset + reach;
  }

  private leaveState(r: Racer): void {
    const s = r.state;
    const prev = s.state;
    s.speedMultiplier = 1;
    s.accelMultiplier = 1;
    switch (prev) {
      case 'COLLAPSED':
        // 쓰러진 뒤 탈을 다시 뒤집어쓰지 않고 머리 위로 들어 완주한다.
        this.carryDuration = 60;
        this.setState(r, 'CARRYING', this.carryDuration, 1.0, 3);
        s.fatigued = false;
        this.events.emit({ time: this.time, racerId: r.def.id, event: 'COSTUME_CARRY', major: false, label: `${r.def.name} 말탈을 들고 결승선으로 질주` });
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
        if (r.def.specialAbility === 'LONGBODY') this.events.emit({ time: this.time, racerId: r.def.id, event: 'LONGBODY_RETRACT', major: false });
        return;
      case 'CARRYING':
        s.state = 'RUNNING';
        return;
      case 'BROKEN':
        // 바퀴는 그대로 빠진 채 병사 전원이 뒤에서 밀어 결승선까지 간다.
        this.setState(r, 'AMBUSH', 60, 0.62, 2.2);
        s.extension = 1;
        this.events.emit({ time: this.time, racerId: r.def.id, event: 'TROJAN_AMBUSH', major: false, label: `${r.def.name} 병사들이 바퀴 대신 밀어 완주 시도` });
        return;
      case 'LAUNCHED':
        // 착지: 잠시 머리부터 박혔다가 구조되어 다시 출발
        s.state = 'PLANTED';
        s.stateTimer = 4.8;
        s.currentSpeed = 0;
        this.events.emit({ time: this.time, racerId: r.def.id, event: 'PLANTED', major: false, label: `${r.def.name} 머리부터 땅에 꽂힘` });
        return;
      case 'PLANTED':
        s.state = 'RECOVERING';
        s.stateTimer = 1.6;
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
            const protectedWinner = this.scenario?.winnerId === victim.def.id;
            if (aggressor.def.specialAbility === 'ELEPHANT' && aggressor.state.state === 'CHARGING' && !protectedWinner && victim.state.state !== 'LAUNCHED' && victim.state.state !== 'PLANTED' && victim.state.state !== 'FINISHED') {
              // 코끼리 돌진에 받히면 하늘로 날아갔다가 머리부터 땅에 꽂힌다 (기권)
              this.launch(victim, aggressor === a ? -sign : sign);
              this.events.emit({
                time: this.time,
                racerId: victim.def.id,
                targetId: aggressor.def.id,
                event: 'LAUNCHED',
                major: true,
                label: `${victim.def.name} 코끼리에게 받혀 하늘로`,
              });
              continue;
            }
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

  private launch(r: Racer, dir: number): void {
    const s = r.state;
    s.state = 'LAUNCHED';
    s.stateTimer = 2.6;
    s.speedMultiplier = 1;
    s.accelMultiplier = 1;
    s.currentSpeed = Math.max(s.currentSpeed, 8);
    s.bumpTimer = 0.7;
    s.bumpDir = dir;
    s.targetLane += dir * 6;
    s.riderless = true;
    s.destiny = false;
  }

  private knock(r: Racer, dir: number, stun: number, speedKeep: number): void {
    const s = r.state;
    if (s.state === 'COLLAPSED' || s.state === 'FINISHED' || s.state === 'ENGINE_FAILURE') return;
    // 우승 예정자는 밀려도 넘어지지 않음 (각본 보호)
    if (this.scenario?.winnerId === r.def.id) {
      s.bumpTimer = 0.4;
      s.bumpDir = dir;
      return;
    }
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
    if (ev.extensionMax) s.extensionMax = ev.extensionMax;
    if (ev.destiny) s.destiny = true;
    const dur = ev.duration;
    switch (t) {
      case 'COSTUME_CARRY':
        // 탈을 벗어 들고 두 사람이 전력질주
        if (s.state === 'COLLAPSED' || s.state === 'RECOVERING') s.stateTimer = 0;
        this.carryDuration = dur ?? 12;
        this.setState(r, 'CARRYING', this.carryDuration, 1.0, 3);
        s.fatigued = false;
        label = `${r.def.name} 탈을 들고 전력질주`;
        break;
      case 'TWIST_FALL':
        this.setState(r, 'FALLEN', dur ?? 4.5);
        s.riderless = true;
        label = `${r.def.name} 결승 직전 대자로 넘어짐`;
        break;
      case 'TWIST_REVERSE':
        this.setState(r, 'REVERSING', dur ?? 3.5);
        label = `${r.def.name} 결승 직전 뒷걸음질`;
        break;
      case 'TWIST_WHEEL_OFF':
        this.setState(r, 'BROKEN', dur ?? 5.8);
        label = `${r.def.name} 바퀴가 빠져 결승선 앞에서 정지`;
        break;
      case 'TWIST_SLEEP':
        this.setState(r, 'SLEEPING', dur ?? 5);
        label = `${r.def.name} 결승 직전 갑자기 잠듦`;
        break;
      case 'TWIST_SHOELACE':
        this.setState(r, 'SHOELACE', dur ?? 4);
        label = `${r.def.name} 결승 직전 신발끈 묶기`;
        break;
      case 'TWIST_NECK_DANCE':
        this.setState(r, 'DANCING', dur ?? 5);
        label = `${r.def.name} 결승 직전 멈춰서 목 댄스`;
        break;
      case 'TWIST_STUBBORN':
        this.setState(r, 'STUBBORN', dur ?? 4.5);
        label = `${r.def.name} 결승 직전 멈춰서 풀 뜯기`;
        break;
      case 'TWIST_ROCKET':
        this.setState(r, 'BOOSTING', dur ?? 6, 2.0, 20);
        s.fatigued = false;
        label = `${r.def.name} 후방에서 로켓 역전`;
        break;
      case 'GIRAFFE_MEGA_NECK':
        this.setState(r, 'STRETCHED', dur ?? 30, 1.0, 1);
        label = `${r.def.name} 목이 ${Math.round(s.extensionMax)}m 로 늘어남`;
        break;
      case 'COSTUME_COLLAPSE':
        this.setState(r, 'COLLAPSED', this.scenario?.winnerId === r.def.id ? 5.5 : 3.2);
        break;
      case 'ELEPHANT_CHARGE':
        this.setState(r, 'CHARGING', dur ?? 8.5, 1.62, 3.2);
        s.fatigued = false;
        break;
      case 'ELEPHANT_TRUNK': {
        // 앞 선수를 코로 붙잡아 끌어내리고 자신은 끌려가듯 가속
        this.setState(r, 'GRABBING', dur ?? 4.5, 1.35, 3);
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
        this.setState(r, 'RAGING', dur ?? 10, 1.42, 2.5);
        break;
      case 'MOTORCYCLE_BOOST':
        this.setState(r, 'BOOSTING', dur ?? 8, 1.75, 8);
        break;
      case 'ENGINE_FAILURE':
        this.setState(r, 'ENGINE_FAILURE', 4.5);
        break;
      case 'HUMAN_EXHAUSTED':
        this.setState(r, 'EXHAUSTED', 6);
        break;
      case 'HUMAN_BIPEDAL':
        this.setState(r, 'BIPEDAL', dur ?? 5, 1.45, 2.5);
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
        this.setState(r, 'AMBUSH', dur ?? 6, 1.55, 4);
        if (ev.destiny) s.extension = 1; // 전군 출동 표시
        break;
      case 'CIRCUS_ACT':
        this.setState(r, 'PERFORMING', dur ?? 6.5, 1.35, 3);
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
        this.setState(r, 'BOOSTING', dur ?? 5, 1.38, 2.5);
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

  /** 시나리오 피날레: 우승 예정자가 결승선 N m 앞에 오면 발동 */
  private finaleCheck(): void {
    if (this.finaleFired || !this.scenario?.finale || !this.scenario.winnerId) return;
    const r = this.byId(this.scenario.winnerId);
    if (!r || r.state.state === 'FINISHED' || r.state.state === 'IDLE') return;
    const lead = this.ranking[0] ? this.ranking[0].distance : r.state.distance;
    const toFinishLead = this.track.raceDistance - lead;
    const f = this.scenario.finale;
    // 선두 기준으로 발동. 우승 예정자가 많이 뒤처졌으면 더 일찍 발동해 따라잡을 시간을 준다
    const gapToWinner = lead - r.state.distance;
    const triggerDist = f.distance + Math.max(0, gapToWinner - 25) * 2.2;
    if (toFinishLead > triggerDist) return;
    this.finaleFired = true;
    this.applyEvent({
      time: this.time,
      racerId: r.def.id,
      event: f.event,
      major: true,
      destiny: true,
      duration: f.duration,
      extensionMax: f.extensionMax,
      label: `[피날레] ${this.scenario.title}`,
    });
  }

  /** 결승 직전 반전: 선두(또는 우승 예정자 앞의 선수)에게 황당한 사고, 가끔 후방 로켓 */
  private twistCheck(): void {
    if (this.twistCount >= this.twistDistances.length) return;
    const lead = this.ranking.find((e) => !e.finished);
    if (!lead) return;
    if (lead.distance < this.track.raceDistance - this.twistDistances[this.twistCount]) return;
    this.twistCount++;
    const winnerId = this.scenario?.winnerId ?? null;
    const leader = this.byId(lead.id)!;
    let victim: Racer | null = null;
    if (!winnerId) victim = leader;
    else if (lead.id !== winnerId) victim = leader;
    else {
      // 우승 예정자는 보호하되 바로 뒤의 달리는 선수에게 확실한 반전을 준다.
      const next = this.ranking.find((e) => {
        if (e.finished || e.id === winnerId) return false;
        return this.byId(e.id)?.state.state === 'RUNNING';
      });
      if (next) victim = this.byId(next.id)!;
    }
    if (victim && victim.state.state === 'RUNNING') {
      const byType: Record<string, RaceEventType[]> = {
        TROJAN: ['TWIST_WHEEL_OFF'],
        CIRCUS: ['TWIST_SLEEP', 'TWIST_STUBBORN'],
        MOTORCYCLE: ['ENGINE_FAILURE'],
        COSTUME: ['COSTUME_COLLAPSE', 'TWIST_SLEEP'],
        HUMAN: ['TWIST_SHOELACE', 'TWIST_SLEEP'],
        COW: ['TWIST_STUBBORN', 'TWIST_REVERSE', 'TWIST_SLEEP'],
        ELEPHANT: ['TWIST_STUBBORN', 'TWIST_SLEEP'],
        LONGBODY: ['TWIST_REVERSE', 'TWIST_FALL', 'TWIST_SLEEP'],
        GIRAFFE: ['TWIST_NECK_DANCE', 'TWIST_STUBBORN'],
        CLASSIC: ['TWIST_FALL', 'TWIST_REVERSE', 'TWIST_SLEEP', 'TWIST_STUBBORN'],
      };
      const pool = byType[victim.def.specialAbility] ?? ['TWIST_FALL', 'TWIST_REVERSE'];
      const ev = pool[Math.floor(Math.random() * pool.length)];
      this.applyEvent({ time: this.time, racerId: victim.def.id, event: ev, major: true, duration: ev === 'COSTUME_COLLAPSE' ? 5 : undefined });
    }
    // 후방 로켓: 우승 예정자가 아니면서 뒤에 있는 선수 하나가 미친 속도로 (30%)
    // 각본 시나리오에선 우승 예정자가 이미 선두일 때만 (역전을 망치지 않게)
    // 로켓 역전은 우승 예정자가 없는 경우에만 (현재는 항상 우승자가 정해져 있으므로 각본 피날레가 그 역할)
    const rocketAllowed = !winnerId;
    if (rocketAllowed && (Math.random() < 0.3 || (!victim && !winnerId))) {
      const back = this.racers.filter(
        (r) => r.state.state === 'RUNNING' && r.state.rank >= 4 && r.def.id !== winnerId && r !== victim,
      );
      if (back.length) {
        const r = back[Math.floor(Math.random() * back.length)];
        this.applyEvent({ time: this.time, racerId: r.def.id, event: 'TWIST_ROCKET', major: true });
      }
    }
  }

  /** 롱바디: 결승선 앞에서 랜덤하게 쭈우욱 — 선두권일 때만 */
  private longbodyFinishCheck(): void {
    if (this.longbodyFinishTried) return;
    if (this.scenario?.winnerId && this.scenario.winnerId !== 'longbody') {
      this.longbodyFinishTried = true;
      return;
    }
    if (this.scenario?.winnerId === 'longbody') {
      this.longbodyFinishTried = true;
      return;
    }
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
        if (r.def.specialAbility === 'GIRAFFE' && s.extension > 0.5) {
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
    const allExited = this.racers.every(
      (r) => r.state.finishTime !== null && r.state.distance >= this.track.raceDistance + FINISH_EXIT_DISTANCE,
    );
    if (allExited) {
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
    if (gap > 2.5) return 0;
    return 1 - gap / 2.5;
  }

  get states(): RacerState[] {
    return this.racers.map((r) => r.state);
  }

  racerById(id: string): Racer | undefined {
    return this.byId(id);
  }
}
