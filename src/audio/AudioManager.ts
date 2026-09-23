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
  boostWind: 'boost-wind.mp3',
  airhorn: 'airhorn.mp3',
  fanfare: 'fanfare.mp3',
  tada: 'tada.mp3',
  cowMoo: 'cow-moo.mp3',
  motorRun: 'motor-run.mp3',
  elephantStep: 'elephant-step.mp3',
  woodCreak: 'wood-creak.mp3',
  tribalDrums: 'tribal-drums.mp3',
  circusTadaa: 'circus-tadaa.mp3',
  snowStep: 'snow-step.mp3',
  humanAhh: 'human-ahh.mp3',
  africaLoop: 'africa-loop.mp3',
} as const;

export type SfxName = keyof typeof SFX;
/** gallop 말발굽 · grass 잔디 달리기 · engine 엔진 · motor 모터 스탤리온 주행음 · wood 트로이 목마 나무 삐걱임 */
type LoopKind = 'gallop' | 'grass' | 'engine' | 'motor' | 'wood';

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
  /** 배경 음악 (부족 북소리 루프). 얼룩말 부스트 노래가 나올 땐 줄인다 */
  private bgmGain!: GainNode;
  private bgmDuck = 1;
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
    this.bgmGain = ctx.createGain();
    this.bgmGain.gain.value = 0;
    this.bgmGain.connect(this.master);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.master);
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

  /** 부스트 중 계속 나는 바람 가르는 소리: Pixabay 'Harsh Wind' 루프 + 하이패스, 게인은 update 에서 따라감 */
  private setupRush(): void {
    const ctx = this.ctx!;
    const src = this.makeLoop('boostWind', 1.15);
    if (!src) return;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(0, 1.0);
    this.rushGain = g;
    this.rushFilter = f;
  }

  /** 부스트 바람 세기 0..1 (로컬 플레이어 기준) */
  setBoostRush(v: number): void {
    this.rushTarget = THREE.MathUtils.clamp(v, 0, 1);
  }

  /**
   * 부스트 발동: 전투기 애프터버너 느낌의 합성음 — 부스트가 끝날 때까지 "부우웅~" 이 이어진다.
   * 노이즈 스위프(600→3200Hz) + 톱니파 저음 상승(70→160Hz) + 점화 '킥'. duration 동안 유지 후 짧게 사그라듦.
   */
  jetBoost(strength = 1, duration = 3): void {
    if (!this.ctx || this._muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const end = t + Math.max(0.5, duration);
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.exponentialRampToValueAtTime(0.9 * strength, t + 0.06);
    out.gain.exponentialRampToValueAtTime(0.45 * strength, t + 0.9);
    out.gain.setValueAtTime(0.45 * strength, end - 0.05);
    out.gain.exponentialRampToValueAtTime(0.0001, end + 0.35);
    out.connect(this.sfx);
    // 1) 노이즈 (제트 분사): 점화 때 확 열렸다가 유지
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.35);
    bp.frequency.exponentialRampToValueAtTime(1300, t + 1.2);
    bp.frequency.setValueAtTime(1300, end - 0.05);
    bp.frequency.exponentialRampToValueAtTime(500, end + 0.35);
    const ng = ctx.createGain();
    ng.gain.value = 0.8;
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    n.start(t);
    n.stop(end + 0.4);
    // 2) 저음 톱니파 (터빈 회전): 올라갔다가 부스트 동안 "부우웅" 유지, 끝에서 내려감
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.5);
    o.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    o.frequency.setValueAtTime(120, end - 0.05);
    o.frequency.exponentialRampToValueAtTime(60, end + 0.35);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const og = ctx.createGain();
    og.gain.value = 0.4;
    // 살짝 떨리는 회전감 (6Hz 비브라토)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const lg = ctx.createGain();
    lg.gain.value = 4;
    lfo.connect(lg);
    lg.connect(o.frequency);
    o.connect(lp);
    lp.connect(og);
    og.connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(end + 0.4);
    lfo.stop(end + 0.4);
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

  /**
   * 부스트 종료 알림: 터빈이 식는 '슈우웅↓' (톱니파 하강 + 노이즈 필터 닫힘) 뒤에 짧은 '톡' 두 번.
   * 부스트가 끝났다는 걸 화면을 안 봐도 알 수 있게.
   */
  boostEnd(): void {
    if (!this.ctx || this._muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.7;
    out.connect(this.sfx);
    // 1) 터빈 파워다운
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.45);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(lp);
    lp.connect(og);
    og.connect(out);
    o.start(t);
    o.stop(t + 0.52);
    // 2) 분사 꺼짐 (노이즈, 필터가 닫히며 사그라듦)
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.35);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.45, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    n.start(t);
    n.stop(t + 0.4);
    // 3) 톡-톡 (내림 두 음) — 끝났다는 확실한 신호
    [[660, 0.12], [440, 0.24]].forEach(([f, dt]) => {
      const s = t + dt;
      const b = ctx.createOscillator();
      b.type = 'triangle';
      b.frequency.setValueAtTime(f, s);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, s);
      bg.gain.exponentialRampToValueAtTime(0.35, s + 0.01);
      bg.gain.exponentialRampToValueAtTime(0.0001, s + 0.11);
      b.connect(bg);
      bg.connect(out);
      b.start(s);
      b.stop(s + 0.12);
    });
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
    // 배경 음악: 관중 함성 대신 부족 북소리를 메뉴·대기실·레이스 내내 반복
    const bgm = this.makeLoop('tribalDrums', 1);
    if (bgm) {
      bgm.connect(this.bgmGain);
      bgm.start();
    }
    const wind = this.makeLoop('wind', 1);
    if (wind) {
      wind.connect(this.windGain);
      wind.start();
    }
    this.setupRush();
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
    const name: SfxName = kind === 'engine' ? 'engineLoop' : kind === 'grass' ? 'runGrass' : kind === 'motor' ? 'motorRun' : kind === 'wood' ? 'woodCreak' : 'gallop';
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
  updateRacerLoop(id: string, kind: LoopKind, pos: THREE.Vector3, speedNorm: number, opts: { heavy?: number; rpm?: number; failure?: boolean; active?: boolean; own?: boolean } = {}): void {
    if (!this.ctx) return;
    const node = this.ensureLoop(id, kind);
    if (!node) return;
    const t = this.ctx.currentTime;
    // 내 말: 카메라 거리와 무관하게 항상 또렷하게
    const dist = opts.own ? 1.3 : this.distGain(pos);
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
    } else if (kind === 'motor') {
      // 달리는 속도만큼 모터 회전이 오른다
      rate = 0.8 + speedNorm * 0.45;
      vol = active ? dist * THREE.MathUtils.clamp(0.25 + speedNorm, 0, 1) * 0.6 : 0;
    } else if (kind === 'wood') {
      // 거대한 나무 목마가 굴러가며 삐걱이는 소리
      rate = 0.85 + speedNorm * 0.3;
      vol = active ? dist * THREE.MathUtils.clamp(speedNorm * 1.4, 0, 1) * 0.75 : 0;
    } else {
      const heavy = opts.heavy ?? 1;
      rate = (0.75 + speedNorm * 0.5) / Math.sqrt(heavy);
      vol = active ? dist * THREE.MathUtils.clamp(speedNorm * 1.3, 0, 1) * 0.55 * Math.min(1.6, heavy) : 0;
    }
    node.gain.gain.setTargetAtTime(vol, t, 0.08);
    node.src.playbackRate.setTargetAtTime(rate, t, 0.1);
  }

  private boostLoops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();

  /** 부스트를 쓰는 동안만 울리는 루프 (얼룩말 부족 북). 부스트가 시작되면 처음부터, 끝나면 짧게 페이드아웃 */
  updateBoostLoop(id: string, name: SfxName, pos: THREE.Vector3, on: boolean, own: boolean): void {
    if (!this.ctx) return;
    let n = this.boostLoops.get(id);
    if (on && !n) {
      const src = this.makeLoop(name, 1);
      if (!src) return;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(this.sfx);
      src.start();
      n = { src, gain };
      this.boostLoops.set(id, n);
    }
    if (!n) return;
    const t = this.ctx.currentTime;
    if (on) {
      n.gain.gain.setTargetAtTime((own ? 1 : this.distGain(pos)) * 0.8, t, 0.05);
    } else {
      this.stopBoostLoop(id);
    }
  }

  private stopBoostLoop(id: string): void {
    const n = this.boostLoops.get(id);
    if (!n || !this.ctx) return;
    this.boostLoops.delete(id);
    const t = this.ctx.currentTime;
    n.gain.gain.setTargetAtTime(0, t, 0.08);
    try {
      n.src.stop(t + 0.4);
    } catch {
      /* ignore */
    }
  }

  stopRacerLoops(): void {
    for (const id of [...this.boostLoops.keys()]) this.stopBoostLoop(id);
    this.bgmDuck = 1;
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

  // ---------------------------------------------------------------- 배경 음악 / 바람

  /** 얼룩말 부스트 노래가 나오는 동안 배경 음악을 줄인다 */
  duckBgm(on: boolean): void {
    this.bgmDuck = on ? 0.25 : 1;
  }

  update(_dt: number, cameraVel: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bgmGain.gain.setTargetAtTime(0.32 * this.bgmDuck, t, 0.3);
    // 일반 바람은 낮게 (말발굽이 묻히지 않게), 부스트 바람은 샘플 루프로 크게
    const wind = THREE.MathUtils.clamp((cameraVel - 10) / 60, 0, 0.22);
    this.windGain.gain.setTargetAtTime(wind, t, 0.25);
    if (this.rushGain && this.rushFilter) {
      this.rushGain.gain.setTargetAtTime(this.rushTarget * 0.9, t, this.rushTarget > 0 ? 0.06 : 0.35);
      this.rushFilter.frequency.setTargetAtTime(200 + this.rushTarget * 300, t, 0.2);
    }
  }
}
