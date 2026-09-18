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
    void this.loadAll();
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
    this.windGain.gain.setTargetAtTime(wind, t, 0.25);
  }
}
