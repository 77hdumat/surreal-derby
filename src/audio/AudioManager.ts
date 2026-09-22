import * as THREE from 'three';

/**
 * Pixabay 샘플 기반 사운드 (public/sfx, 출처는 public/sfx/CREDITS.md).
 * 캐릭터 소리는 카메라와 가까울 때만 들리도록 거리 감쇠 (약 50m 컷오프).
 */
const SFX = {
  gallop: 'gallop-loop.mp3',
  gallopSingle: 'gallop-single.mp3',
  runGrass: 'run-grass.mp3',
  neigh: 'neigh.mp3',
  engineLoop: 'engine-loop.mp3',
  engineRev: 'engine-rev.mp3',
  engineRev2: 'engine-rev2.mp3',
  motoPass: 'moto-passby.mp3',
  engineFail: 'engine-fail.mp3',
  crowdStadium: 'crowd-stadium.mp3',
  crowdLoop: 'crowd-loop.mp3',
  crowdRoar: 'crowd-roar.mp3',
  crowdGasp: 'crowd-gasp.mp3',
  elephant: 'elephant.mp3',
  elephantGrowl: 'elephant-growl.mp3',
  elephantAngry: 'elephant-angry.mp3',
  cow: 'cow.mp3',
  cow2: 'cow2.mp3',
  cardboardDrop: 'cardboard-drop.mp3',
  cardboardOpen: 'cardboard-open.mp3',
  scream: 'scream.mp3',
  screamFall: 'scream-fall.mp3',
  whoosh: 'whoosh.mp3',
  whooshEpic: 'whoosh-epic.mp3',
  bell: 'bell.mp3',
  impact: 'impact.mp3',
  impactHeavy: 'impact-heavy.mp3',
  crash: 'crash.mp3',
  wind: 'wind-loop.mp3',
  airhorn: 'airhorn.mp3',
  fanfare: 'fanfare.mp3',
  tada: 'tada.mp3',
} as const;

export type SfxName = keyof typeof SFX;
type LoopKind = 'gallop' | 'grass' | 'engine';

interface LoopNode {
  src: AudioBufferSourceNode;
  gain: GainNode;
  kind: LoopKind;
}

const NEAR_DISTANCE = 52;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private buffers = new Map<SfxName, AudioBuffer>();
  private loading = false;
  private cameraPos = new THREE.Vector3();
  private crowdGain!: GainNode;
  private crowdTarget = 0.12;
  private roar = 0;
  private windGain!: GainNode;
  /** 부스트 중 바람 가르는 소리 (하이패스 노이즈) */
  private rushGain: GainNode | null = null;
  private rushFilter: BiquadFilterNode | null = null;
  private rushTarget = 0;
  private noiseBuf: AudioBuffer | null = null;
  private racerLoops = new Map<string, LoopNode>();
  private ambientStarted = false;
  private _muted = false;
  private lastOneShot = new Map<string, number>();

  get enabled(): boolean {
    return this.ctx !== null;
  }
  get muted(): boolean {
    return this._muted;
  }

  /** 사용자 제스처 이후 호출 */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    this.crowdGain.connect(this.master);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.master);
    this.setupRush();
    void this.loadAll();
  }

  /** 화이트 노이즈 2초 버퍼 (제트·바람 합성용) */
  private noise(): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }

  /** 부스트 중 계속 나는 바람 가르는 소리: 밴드패스 노이즈 루프, 게인은 update 에서 따라감 */
  private setupRush(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
    this.rushGain = g;
    this.rushFilter = f;
  }

  /** 부스트 바람 세기 0..1 (로컬 플레이어 기준) */
  setBoostRush(v: number): void {
    this.rushTarget = THREE.MathUtils.clamp(v, 0, 1);
  }

  /**
   * 부스트 발동: 전투기 애프터버너 느낌의 합성음.
   * 노이즈 스위프(600→3200Hz, 0.35s) + 톱니파 저음 상승(70→160Hz) + 짧은 하이 '킥'. 3초에 걸쳐 감쇠.
   */
  jetBoost(strength = 1): void {
    if (!this.ctx || this._muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.exponentialRampToValueAtTime(0.9 * strength, t + 0.06);
    out.gain.exponentialRampToValueAtTime(0.35 * strength, t + 0.9);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    out.connect(this.sfx);
    // 1) 노이즈 스위프 (제트 분사)
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.35);
    bp.frequency.exponentialRampToValueAtTime(900, t + 3.0);
    const ng = ctx.createGain();
    ng.gain.value = 0.8;
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    n.start(t);
    n.stop(t + 3.1);
    // 2) 저음 톱니파 (터빈 회전 상승)
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.5);
    o.frequency.exponentialRampToValueAtTime(90, t + 3.0);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const og = ctx.createGain();
    og.gain.value = 0.35;
    o.connect(lp);
    lp.connect(og);
    og.connect(out);
    o.start(t);
    o.stop(t + 3.1);
    // 3) 킥 (점화 순간)
    const k = ctx.createOscillator();
    k.type = 'sine';
    k.frequency.setValueAtTime(220, t);
    k.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const kg = ctx.createGain();
    kg.gain.setValueAtTime(0.9, t);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    k.connect(kg);
    kg.connect(out);
    k.start(t);
    k.stop(t + 0.35);
  }

  private async loadAll(): Promise<void> {
    if (this.loading || !this.ctx) return;
    this.loading = true;
    const base = `${import.meta.env.BASE_URL}sfx/`;
    await Promise.all(
      (Object.keys(SFX) as SfxName[]).map(async (name) => {
        try {
          const res = await fetch(base + SFX[name]);
          const arr = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(arr);
          this.buffers.set(name, buf);
        } catch (e) {
          console.warn('[sfx] 로드 실패', name, e);
        }
      }),
    );
    this.startAmbient();
  }

  private startAmbient(): void {
    if (this.ambientStarted || !this.ctx) return;
    this.ambientStarted = true;
    // 관중: 두 겹을 다른 속도/시작점으로 깔아 루프 이음새를 숨김
    for (const [name, rate, offset, vol] of [
      ['crowdStadium', 1.0, 0, 0.7],
      ['crowdLoop', 0.93, 7.3, 0.45],
    ] as [SfxName, number, number, number][]) {
      const src = this.makeLoop(name, rate);
      if (!src) continue;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(g);
      g.connect(this.crowdGain);
      src.start(0, offset);
    }
    const wind = this.makeLoop('wind', 1);
    if (wind) {
      wind.connect(this.windGain);
      wind.start();
    }
  }

  private makeLoop(name: SfxName, rate: number): AudioBufferSourceNode | null {
    const buf = this.buffers.get(name);
    if (!buf || !this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // mp3 인코더 패딩 제외
    src.loopStart = 0.08;
    src.loopEnd = Math.max(0.2, buf.duration - 0.08);
    src.playbackRate.value = rate;
    return src;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  setCameraPosition(p: THREE.Vector3): void {
    this.cameraPos.copy(p);
  }

  private distGain(pos?: THREE.Vector3, range = NEAR_DISTANCE): number {
    if (!pos) return 1;
    const d = pos.distanceTo(this.cameraPos);
    return Math.pow(THREE.MathUtils.clamp(1 - d / range, 0, 1), 1.5);
  }

  // ---------------------------------------------------------------- one-shots

  /**
   * 단발 효과음. pos 를 주면 거리 감쇠, minGain 은 중계 관점에서 꼭 들려야 하는 소리의 최소 볼륨.
   */
  play(name: SfxName, opts: { pos?: THREE.Vector3; gain?: number; rate?: number; minGain?: number; cooldown?: number; range?: number } = {}): void {
    if (!this.ctx) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const now = this.ctx.currentTime;
    if (opts.cooldown) {
      const last = this.lastOneShot.get(name) ?? -99;
      if (now - last < opts.cooldown) return;
      this.lastOneShot.set(name, now);
    }
    let g = opts.pos ? this.distGain(opts.pos, opts.range) : 1;
    g = Math.max(g, opts.minGain ?? 0) * (opts.gain ?? 1);
    if (g < 0.02) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = this.ctx.createGain();
    gain.gain.value = g;
    src.connect(gain);
    gain.connect(this.sfx);
    src.start();
  }

  /** 말탈 브라더스 전용: 사람 비명 대신 짧고 귀여운 8비트 데굴데굴 소리. */
  playPixelTumble(pos?: THREE.Vector3): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const volume = Math.max(this.distGain(pos), 0.45) * 0.16;
    const notes = [784, 659, 523, 392, 523];
    notes.forEach((freq, i) => {
      const start = now + i * 0.065;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = i === notes.length - 1 ? 'sine' : 'square';
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.92, start + 0.075);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume * (i === notes.length - 1 ? 1.2 : 1), start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.085);
      osc.connect(gain);
      gain.connect(this.sfx);
      osc.start(start);
      osc.stop(start + 0.09);
    });
  }

  // ---------------------------------------------------------------- 선수별 루프 (말발굽 / 잔디 달리기 / 엔진)

  private ensureLoop(id: string, kind: LoopKind): LoopNode | null {
    const existing = this.racerLoops.get(id);
    if (existing && existing.kind === kind) return existing;
    if (existing) {
      try {
        existing.src.stop();
      } catch {
        /* already stopped */
      }
      existing.gain.disconnect();
      this.racerLoops.delete(id);
    }
    if (!this.ctx) return null;
    const name: SfxName = kind === 'engine' ? 'engineLoop' : kind === 'grass' ? 'runGrass' : 'gallop';
    const src = this.makeLoop(name, 1);
    if (!src) return null;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(this.sfx);
    // 시작 오프셋을 무작위로 — 8마리가 같은 박자로 뛰지 않게
    src.start(0, Math.random() * Math.max(0.1, src.buffer!.duration - 0.5));
    const node = { src, gain, kind };
    this.racerLoops.set(id, node);
    return node;
  }

  /**
   * 매 프레임 호출. speedNorm 0..1, heavy 는 코끼리 등 (저음/느림).
   */
  updateRacerLoop(id: string, kind: LoopKind, pos: THREE.Vector3, speedNorm: number, opts: { heavy?: number; rpm?: number; failure?: boolean; active?: boolean } = {}): void {
    if (!this.ctx) return;
    const node = this.ensureLoop(id, kind);
    if (!node) return;
    const t = this.ctx.currentTime;
    const dist = this.distGain(pos);
    const active = opts.active ?? true;
    let vol = 0;
    let rate = 1;
    if (kind === 'engine') {
      const rpm = opts.rpm ?? 0.3;
      rate = 0.75 + rpm * 0.9;
      vol = active ? dist * 0.5 : 0;
      if (opts.failure) {
        rate = 0.6 + Math.random() * 0.15;
        vol *= Math.random() < 0.5 ? 1 : 0.15;
      }
    } else {
      const heavy = opts.heavy ?? 1;
      rate = (0.75 + speedNorm * 0.5) / Math.sqrt(heavy);
      vol = active ? dist * THREE.MathUtils.clamp(speedNorm * 1.3, 0, 1) * 0.55 * Math.min(1.6, heavy) : 0;
    }
    node.gain.gain.setTargetAtTime(vol, t, 0.08);
    node.src.playbackRate.setTargetAtTime(rate, t, 0.1);
  }

  stopRacerLoops(): void {
    for (const [id, n] of this.racerLoops) {
      try {
        n.src.stop();
      } catch {
        /* ignore */
      }
      n.gain.disconnect();
      this.racerLoops.delete(id);
    }
  }

  // ---------------------------------------------------------------- 관중 / 바람

  setExcitement(v: number): void {
    this.crowdTarget = 0.12 + THREE.MathUtils.clamp(v, 0, 1) * 0.45;
  }

  crowdRoar(strength = 1): void {
    this.roar = Math.min(1.2, this.roar + strength);
    if (strength >= 0.5) this.play('crowdRoar', { gain: 0.35 * strength, cooldown: 2.5 });
  }

  crowdGasp(): void {
    this.play('crowdGasp', { gain: 0.6, cooldown: 3 });
  }

  update(dt: number, cameraVel: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.roar = Math.max(0, this.roar - dt * 0.8);
    this.crowdGain.gain.setTargetAtTime(this.crowdTarget + this.roar * 0.3, t, 0.2);
    const wind = THREE.MathUtils.clamp((cameraVel - 8) / 40, 0, 0.5);
    this.windGain.gain.setTargetAtTime(wind + this.rushTarget * 0.35, t, 0.25);
    if (this.rushGain && this.rushFilter) {
      this.rushGain.gain.setTargetAtTime(this.rushTarget * 0.32, t, this.rushTarget > 0 ? 0.08 : 0.3);
      this.rushFilter.frequency.setTargetAtTime(900 + this.rushTarget * 1600, t, 0.2);
    }
  }
}
