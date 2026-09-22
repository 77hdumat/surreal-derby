import { angleDelta, type KartState } from '../game/KartPhysics';
import { decodeKart } from './Protocol';

interface Sample {
  ts: number;
  k: number[];
}

export interface RemoteTransitions {
  boostStart: boolean;
  bumpStart: boolean;
  finished: boolean;
}

/**
 * 원격 말 하나의 상태 버퍼. 발신자 타임스탬프 기준으로 "조금 늦게" 재생해 지터를 흡수한다.
 * (재생 시계 playT — 버퍼가 두꺼우면 살짝 빠르게, 얇으면 느리게. dempsey-boxing 의 clientInterpolate 와 같은 방식)
 */
export class RemoteKart {
  private snaps: Sample[] = [];
  private playT: number | null = null;
  private jitter = 0;
  private gap = 0;
  private lastTs = 0;
  private lastRecv = 0;

  static SEND_HZ = 30;

  get hasData(): boolean {
    return this.snaps.length > 0;
  }

  reset(): void {
    this.snaps = [];
    this.playT = null;
    this.jitter = 0;
    this.gap = 0;
    this.lastTs = 0;
    this.lastRecv = 0;
  }

  push(ts: number, k: number[]): void {
    if (ts <= this.lastTs) return; // 중복·역순
    const now = performance.now();
    if (this.lastRecv) {
      const dev = Math.abs(now - this.lastRecv - (ts - this.lastTs));
      this.jitter = this.jitter ? this.jitter * 0.88 + dev * 0.12 : dev;
      const g = Math.min(200, ts - this.lastTs);
      this.gap = this.gap ? this.gap * 0.9 + g * 0.1 : g;
    }
    this.lastRecv = now;
    this.lastTs = ts;
    this.snaps.push({ ts, k });
    if (this.snaps.length > 10) this.snaps.shift();
  }

  /** 보간 결과를 into 에 쓴다. 연출용 상태 전이를 돌려준다 */
  sample(dt: number, into: KartState): RemoteTransitions {
    const tr: RemoteTransitions = { boostStart: false, bumpStart: false, finished: false };
    const n = this.snaps.length;
    if (n === 0) return tr;
    const wasBoost = into.boostT > 0;
    const wasBump = into.bumpT > 0;
    const wasFinished = into.finished;
    const latest = this.snaps[n - 1];
    if (n === 1) {
      decodeKart(latest.k, into, true);
    } else {
      const interval = Math.max(1000 / RemoteKart.SEND_HZ, this.gap || 0);
      const delay = Math.min(140, Math.max(10, interval * 0.7 + 2 + (this.jitter || 3) * 1.8));
      if (this.playT === null) this.playT = latest.ts - delay;
      const target = latest.ts - delay;
      const drift = target - this.playT;
      let rate = 1;
      if (Math.abs(drift) > 400) this.playT = target;
      else rate = 1 + Math.max(-0.12, Math.min(0.12, drift / 600));
      this.playT += dt * 1000 * rate;
      let A = this.snaps[0];
      let B = this.snaps[1];
      for (let i = 0; i < n - 1; i++) {
        if (this.snaps[i].ts <= this.playT && this.snaps[i + 1].ts >= this.playT) {
          A = this.snaps[i];
          B = this.snaps[i + 1];
          break;
        }
        if (this.snaps[i + 1].ts < this.playT) {
          A = this.snaps[i];
          B = this.snaps[i + 1];
        }
      }
      const span = Math.max(1, B.ts - A.ts);
      // 최신보다 앞서면 잠깐만 외삽 (최대 1.35 구간)
      const t = Math.max(0, Math.min(1.35, (this.playT - A.ts) / span));
      decodeKart(B.k, into, false);
      into.x = A.k[0] + (B.k[0] - A.k[0]) * t;
      into.z = A.k[1] + (B.k[1] - A.k[1]) * t;
      into.yaw = A.k[2] + angleDelta(B.k[2] - A.k[2]) * t;
    }
    into.lastAccel = 0;
    tr.boostStart = !wasBoost && into.boostT > 0;
    tr.bumpStart = !wasBump && into.bumpT > 0;
    tr.finished = !wasFinished && into.finished;
    return tr;
  }
}
