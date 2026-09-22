import * as THREE from 'three';
import { RaceTrack } from '../track/RaceTrack';
import { RacerManager } from '../racers/RacerManager';
import { RACER_DEFINITIONS } from '../racers/RacerDefinitions';
import { GameCamera } from '../camera/GameCamera';
import { EffectsManager } from '../effects/EffectsManager';
import { ParticleManager } from '../effects/ParticleManager';
import { AudioManager } from '../audio/AudioManager';
import { UIManager } from '../ui/UIManager';
import { updateWind } from '../track/Vegetation';
import { onAssetProgress } from '../racers/rig/Assets';
import { loadSky } from '../track/Environment';
import { Footprints } from '../effects/Footprints';
import { installHsvFog } from '../effects/HsvFog';
import { KartRace, MAX_SLOTS, type SlotConfig } from './KartRace';
import { InputManager } from './Input';
import { Net } from '../net/Net';
import { decodeInput, decodeKart, encodeInput, encodeKart, type LobbySlot, type NetMsg } from '../net/Protocol';
import { angleDelta, currentLap, stepKart, type KartInput } from './KartPhysics';
import { JOCKEYS } from '../racers/Jockeys';

type Mode = 'none' | 'solo' | 'host' | 'client';
type Screen = 'MENU' | 'LOBBY' | 'RACE' | 'RESULT';

const STEP = 1 / 60;
const SNAP_HZ = 30;

interface Snap {
  recv: number;
  ts: number;
  k: number[][];
}

/**
 * 게임 루프 + 화면 전환 + 네트워크 배선.
 * solo/host: KartRace 를 고정 60Hz 로 시뮬. host 는 30Hz 스냅샷 + 이벤트 브로드캐스트.
 * client: 입력 전송, 타인 보간, 자기 말 로컬 예측 + 호스트 값으로 보정.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly track: RaceTrack;
  readonly particles: ParticleManager;
  readonly racers: RacerManager;
  readonly camera: GameCamera;
  readonly effects: EffectsManager;
  readonly audio = new AudioManager();
  readonly ui: UIManager;
  readonly input = new InputManager();
  readonly race: KartRace;

  screen: Screen = 'MENU';
  mode: Mode = 'none';
  net: Net | null = null;
  mySlot = 0;
  private lobby: LobbySlot[] = [];


  private clock = new THREE.Clock();
  private globalTime = 0;
  private accum = 0;
  private gateTimer = -1;
  private lastCount = -1;
  private raceStarting = false;
  private finishTimer = 0;
  private excitement = 0.3;
  private highQuality = false;
  private sun: THREE.DirectionalLight;
  private footprints: Footprints;
  private sceneryPromise: Promise<void> = Promise.resolve();
  private sunOffset = new THREE.Vector3(70, 95, 50);
  private tmp = new THREE.Vector3();
  private warm = false;

  // host
  private outSeq = 0;
  private snapAccum = 0;
  // client
  private snaps: Snap[] = [];
  private snapSeq = 0;
  private playT: number | null = null;
  private jitter = 0;
  private sendGap = 0;
  private lastRecv = 0;
  private lastRecvTs = 0;
  private inSeq = 0;
  private clientRacing = false;
  private pingT = 0;
  private netInfoT = 0;

  constructor(glCanvas: HTMLCanvasElement, fxCanvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 여름 오후: 따뜻한 낮은 태양, 긴 그림자, 부드러운 안개 (HSV 안개: r=목표 명도, g=목표 채도)
    installHsvFog();
    this.scene.fog = new THREE.Fog(new THREE.Color(0.64, 0.36, 0), 90, 560);
    this.scene.add(new THREE.HemisphereLight(0xbcd7f5, 0x8c8776, 0.45));
    this.sun = new THREE.DirectionalLight(0xfff6e8, 2.2);
    this.sun.position.copy(this.sunOffset);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 400;
    const sc = this.sun.shadow.camera;
    sc.left = -55;
    sc.right = 55;
    sc.top = 55;
    sc.bottom = -55;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.track = new RaceTrack();
    this.scene.add(this.track.group);
    this.sunOffset.copy(RaceTrack.SUN_DIR).multiplyScalar(130);
    {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const skyScene = new THREE.Scene();
      skyScene.add(this.track.sky);
      this.scene.environment = pmrem.fromScene(skyScene, 0, 1, 3000).texture;
      this.scene.environmentIntensity = 0.38;
      this.track.group.add(this.track.sky);
      pmrem.dispose();
    }
    this.sceneryPromise = this.applySky();
    if (import.meta.env.DEV) (window as unknown as { __game?: unknown }).__game = this;
    this.particles = new ParticleManager(3000);
    this.scene.add(this.particles.points);
    this.racers = new RacerManager(this.scene, this.track, this.particles);
    this.footprints = new Footprints(1600);
    this.scene.add(this.footprints.mesh);
    this.racers.footprints = this.footprints;
    this.race = new KartRace(this.track, RACER_DEFINITIONS);
    this.camera = new GameCamera(this.track, window.innerWidth / window.innerHeight);
    this.effects = new EffectsManager(this.renderer, this.scene, this.camera.camera, fxCanvas);
    this.ui = new UIManager(RACER_DEFINITIONS);

    this.ui.onSolo = () => this.startSolo();
    this.ui.onHost = () => this.hostRoom();
    this.ui.onJoin = (code) => this.joinRoom(code);
    this.ui.onPick = (m, j) => this.pick(m, j);
    this.ui.onReady = (v) => this.setReady(v);
    this.ui.onStartRace = () => this.hostStart();
    this.ui.onLeave = () => this.leaveRoom();
    this.ui.onKick = (slot) => this.kick(slot);
    this.ui.onAgain = () => this.hostStart();
    this.ui.onToLobby = () => this.toLobby();
    this.ui.onToggleMute = () => {
      this.audio.init();
      this.audio.setMuted(!this.audio.muted);
      return this.audio.muted;
    };
    this.ui.onToggleQuality = () => this.setHighQuality(!this.highQuality);
    window.addEventListener('resize', () => this.resize());
    const prime = () => this.audio.init();
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    window.addEventListener('beforeunload', () => this.net?.close());
    let savedQuality: string | null = null;
    try {
      savedQuality = localStorage.getItem('surreal-derby-quality');
    } catch {
      /* private browsing */
    }
    this.setHighQuality(savedQuality === 'high');
    void Net.fetchTurn();
  }

  /** 실사 HDRI 하늘: 배경·환경광으로 쓰고, HDRI 의 태양 방향에 DirectionalLight 를 맞춘다 */
  private async applySky(): Promise<void> {
    try {
      const sky = await loadSky(this.highQuality);
      this.scene.background = sky.texture;
      this.scene.environment = sky.texture;
      this.scene.environmentIntensity = 0.55;
      this.scene.backgroundIntensity = 1.0;
      this.scene.backgroundBlurriness = 0;
      this.track.sky.visible = false;
      this.sunOffset.copy(sky.sunDir).multiplyScalar(130);
      this.sun.intensity = 2.4;
      await this.track.loadRealAssets(sky.sunDir);
      const fog = this.scene.fog as THREE.Fog;
      fog.color.setRGB(0.8, 0.16, 0);
      fog.near = 200;
      fog.far = 2600;
    } catch (e) {
      console.warn('[sky] HDRI 로드 실패 — 절차 하늘 유지', e);
      await this.track.loadRealAssets(RaceTrack.SUN_DIR);
    }
  }

  start(): void {
    this.ui.showMenu();
    this.screen = 'MENU';
    this.renderer.setAnimationLoop(() => this.loop());
    void this.warmUp().then(() => {
      // ?r=CODE 로 열면 바로 참가
      const m = /[?&]r=([A-Z0-9]{5})/i.exec(location.search);
      if (m) this.joinRoom(m[1].toUpperCase());
    });
  }

  /** 첫 레이스 렉 방지: 리깅 에셋 인스턴스화 + 셰이더 컴파일 + 텍스처 업로드 뒤 버튼을 연다 */
  private async warmUp(): Promise<void> {
    this.ui.setLoading(true);
    const off = onAssetProgress((d, t) => this.ui.setLoading(true, d, t));
    await this.racers.whenReady();
    await Promise.race([this.sceneryPromise, new Promise((r) => setTimeout(r, 20000))]);
    off();
    try {
      await this.renderer.compileAsync(this.scene, this.camera.camera);
    } catch (e) {
      console.warn('[warmup] compile 실패', e);
    }
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const sm = mat as THREE.MeshStandardMaterial;
        for (const tex of [sm.map, sm.normalMap, sm.roughnessMap, sm.metalnessMap, sm.bumpMap]) if (tex) this.renderer.initTexture(tex);
      }
    });
    this.racers.dropPreload();
    this.warm = true;
    this.ui.setLoading(false);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.resize(w / h);
    this.effects.resize(w, h);
  }

  private setHighQuality(high: boolean): boolean {
    this.highQuality = high;
    const pixelBudget = high ? 2_600_000 : 1_700_000;
    const budgetRatio = Math.sqrt(pixelBudget / Math.max(1, window.innerWidth * window.innerHeight));
    const ratio = Math.min(window.devicePixelRatio, high ? 1.25 : 1.0, Math.max(0.7, budgetRatio));
    this.renderer.setPixelRatio(ratio);
    const shadowSize = high ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.effects.setHighQuality(high, this.renderer.getPixelRatio());
    this.resize();
    this.ui.setQuality(high);
    try {
      localStorage.setItem('surreal-derby-quality', high ? 'high' : 'balanced');
    } catch {
      /* 저장 불가 환경 */
    }
    return high;
  }

  // ---------------------------------------------------------------- lobby

  private emptySlot(): LobbySlot {
    return { name: '', mountId: RACER_DEFINITIONS[0].id, jockeyId: 'balance', ready: false, cpu: false, human: false };
  }

  private mySlotData(): LobbySlot {
    return { name: this.ui.displayNick, mountId: this.ui.mountId, jockeyId: this.ui.jockeyId, ready: true, cpu: false, human: true };
  }

  private startSolo(): void {
    if (!this.warm) return;
    this.audio.init();
    this.mode = 'solo';
    this.mySlot = 0;
    this.lobby = [this.mySlotData(), this.emptySlot(), this.emptySlot(), this.emptySlot()];
    this.screen = 'LOBBY';
    this.ui.showLobby(null, true);
    this.ui.setLobbyMsg('말과 기수를 고르고 레이스 시작. 빈 자리는 CPU 가 채웁니다');
    this.ui.setStartEnabled(true);
    this.renderLobby();
  }

  private hostRoom(): void {
    if (!this.warm) return;
    this.audio.init();
    this.net?.close();
    const net = new Net();
    this.net = net;
    this.mode = 'host';
    this.mySlot = 0;
    this.lobby = [this.mySlotData(), this.emptySlot(), this.emptySlot(), this.emptySlot()];
    this.screen = 'LOBBY';
    this.ui.showLobby('…', true);
    this.ui.setLobbyMsg('방을 여는 중…');
    this.ui.setStartEnabled(false, '연결 중…');
    this.renderLobby();
    net.onOpen = (code) => {
      try {
        history.replaceState(null, '', `?r=${code}`);
      } catch {
        /* ignore */
      }
      this.ui.showLobby(code, true);
      this.ui.setLobbyMsg('친구에게 코드를 알려주세요 (코드 클릭 = 초대 링크 복사). 빈 자리는 CPU 가 채웁니다');
      this.ui.setStartEnabled(true);
      this.renderLobby();
    };
    net.onError = (e) => this.ui.setLobbyMsg('연결 오류: ' + e.type);
    net.onJoin = (slot) => {
      if (this.screen === 'RACE') {
        // 경기 중 참가는 거절
        net.kick(slot);
        return;
      }
      this.lobby[slot] = { ...this.emptySlot(), human: true, name: 'P' + (slot + 1) };
      this.renderLobby();
      this.broadcastLobby();
    };
    net.onLeave = (slot) => {
      this.lobby[slot] = this.emptySlot();
      this.renderLobby();
      this.broadcastLobby();
    };
    net.onMessage = (m, slot) => this.onHostMessage(m, slot);
    net.host(MAX_SLOTS - 1);
  }

  private onHostMessage(m: NetMsg, slot: number): void {
    const s = this.lobby[slot];
    if (!s) return;
    switch (m.t) {
      case 'hello':
        s.name = String(m.name || 'P' + (slot + 1)).slice(0, 12);
        s.mountId = m.mountId;
        s.jockeyId = m.jockeyId;
        s.human = true;
        this.renderLobby();
        this.broadcastLobby();
        break;
      case 'pick':
        s.mountId = m.mountId;
        s.jockeyId = m.jockeyId;
        this.renderLobby();
        this.broadcastLobby();
        break;
      case 'ready':
        s.ready = !!m.v;
        this.renderLobby();
        this.broadcastLobby();
        break;
      case 'in':
        if (this.screen === 'RACE') this.race.setInput(slot, decodeInput(m.d));
        break;
      case 'ping':
        this.net?.broadcast({ t: 'pong', t0: m.t0 });
        break;
    }
  }

  private broadcastLobby(): void {
    this.net?.broadcast({ t: 'lobby', slots: this.lobby });
  }

  private renderLobby(): void {
    const isHost = this.mode !== 'client';
    this.ui.renderLobby(this.lobby, this.mySlot, isHost);
    if (this.mode === 'host') {
      const humans = this.lobby.filter((s) => s.human);
      const allReady = humans.every((s, i) => i === 0 || s.ready);
      this.ui.setStartEnabled(allReady, allReady ? '레이스 시작' : '참가자 준비 대기…');
    }
  }

  private joinRoom(code: string): void {
    if (!this.warm) return;
    this.audio.init();
    this.net?.close();
    const net = new Net();
    this.net = net;
    this.mode = 'client';

    this.screen = 'LOBBY';
    this.ui.showLobby(code, false);
    this.ui.setLobbyMsg('접속 중…');
    this.ui.setReady(false);
    this.lobby = [];
    let tries = 0;
    net.onOpen = () => {
      this.ui.setLobbyMsg('접속 완료. 말과 기수를 고르고 준비를 누르세요');
      try {
        history.replaceState(null, '', `?r=${code}`);
      } catch {
        /* ignore */
      }
    };
    net.onError = (e) => {
      if (e.type === 'timeout' && tries < 2) {
        // 직결 실패 → TURN 으로 재시도
        tries++;
        this.ui.setLobbyMsg('직결이 안 됩니다. 중계 서버로 다시 시도 중…');
        net.close();
        const n2 = new Net();
        this.net = n2;
        n2.onOpen = net.onOpen;
        n2.onError = net.onError;
        n2.onMessage = net.onMessage;
        n2.join(code, true);
        return;
      }
      if (e.type === 'peer-unavailable') this.leaveRoom('그 코드의 방이 없습니다');
      else if (e.type === 'closed') this.leaveRoom('방장과 연결이 끊겼습니다');
      else if (e.type === 'timeout') this.leaveRoom('방장에게 연결하지 못했습니다');
      else this.ui.setLobbyMsg('연결 오류: ' + e.type);
    };
    net.onMessage = (m) => this.onClientMessage(m);
    net.join(code, false);
  }

  private onClientMessage(m: NetMsg): void {
    const net = this.net;
    if (!net) return;
    switch (m.t) {
      case 'welcome':
        this.mySlot = m.slot;
        net.send({ t: 'hello', name: this.ui.displayNick, mountId: this.ui.mountId, jockeyId: this.ui.jockeyId });
        break;
      case 'lobby':
        this.lobby = m.slots;
        if (this.screen === 'LOBBY') this.renderLobby();
        break;
      case 'full':
        this.leaveRoom(m.why === 'playing' ? '경기가 진행 중입니다' : '방이 가득 찼습니다');
        break;
      case 'start':
        void this.beginRace(m.slots);
        break;
      case 'count':
        this.showCount(m.n);
        if (m.n === 0) this.clientRacing = true;
        break;
      case 'snap':
        if (this.screen === 'RACE') this.onSnapshot(m);
        break;
      case 'ev':
        if (this.screen === 'RACE') for (const e of m.ev) this.onRaceEvent(e);
        break;
      case 'over':
        this.race.results = m.results;
        this.showResult();
        break;
      case 'tolobby':
        this.toLobby();
        break;
      case 'kicked':
        this.leaveRoom('방장이 강퇴했습니다');
        break;
      case 'pong': {
        const r = performance.now() - m.t0;
        net.rtt = net.rtt ? net.rtt * 0.8 + r * 0.2 : r;
        break;
      }
    }
  }

  private pick(mountId: string, jockeyId: string): void {
    if (this.mode === 'client') {
      this.net?.send({ t: 'pick', mountId, jockeyId });
      return;
    }
    if (this.lobby[this.mySlot]) {
      this.lobby[this.mySlot].mountId = mountId;
      this.lobby[this.mySlot].jockeyId = jockeyId;
      this.renderLobby();
      this.broadcastLobby();
    }
  }

  private setReady(v: boolean): void {

    this.ui.setReady(v);
    this.net?.send({ t: 'ready', v });
  }

  private kick(slot: number): void {
    if (this.mode !== 'host') return;
    this.net?.kick(slot);
  }

  private leaveRoom(msg = ''): void {
    if (this.mode === 'host') this.net?.broadcast({ t: 'kicked' });
    this.net?.close();
    this.net = null;
    this.mode = 'none';
    this.input.detach();
    this.input.clear();
    this.audio.stopRacerLoops();
    this.racers.clear();
    this.camera.setMode('INTRO');
    this.screen = 'MENU';
    try {
      history.replaceState(null, '', location.pathname);
    } catch {
      /* ignore */
    }
    this.ui.showMenu(msg);
  }

  private toLobby(): void {
    if (this.mode === 'host') this.net?.broadcast({ t: 'tolobby' });
    this.input.detach();
    this.input.clear();
    this.audio.stopRacerLoops();
    this.racers.clear();
    this.camera.setMode('INTRO');
    this.screen = 'LOBBY';
    if (this.mode === 'client') {

      this.ui.showLobby(this.net?.code ?? '', false);
      this.ui.setReady(false);
      this.ui.setLobbyMsg('다음 레이스를 위해 준비를 누르세요');
    } else {
      for (const s of this.lobby) if (s.human) s.ready = false;
      this.lobby[0].ready = true;
      this.ui.showLobby(this.mode === 'host' ? this.net?.code ?? '' : null, true);
    }
    this.renderLobby();
    if (this.mode === 'host') this.broadcastLobby();
  }

  // ---------------------------------------------------------------- race setup

  /** 호스트/솔로: 로비 → 슬롯 구성 → 시작 */
  private hostStart(): void {
    if (this.mode === 'client' || this.raceStarting) return;
    if (this.screen === 'RESULT') {
      this.ui.hideResult();
      this.racers.clear();
    }
    if (this.mode === 'host') {
      this.lobby[0] = { ...this.mySlotData() };
    } else {
      this.lobby[0] = this.mySlotData();
    }
    const usedMounts = new Set(this.lobby.filter((s) => s.human).map((s) => s.mountId));
    const slots: SlotConfig[] = this.lobby.map((s, i) => {
      if (s.human) return { slot: i, name: s.name, mountId: s.mountId, jockeyId: s.jockeyId, cpu: false };
      // 빈 자리: 안 겹치는 말 + 무작위 기수
      const pool = RACER_DEFINITIONS.filter((d) => !usedMounts.has(d.id));
      const d = (pool.length ? pool : RACER_DEFINITIONS)[Math.floor(Math.random() * (pool.length ? pool.length : RACER_DEFINITIONS.length))];
      usedMounts.add(d.id);
      const j = JOCKEYS[Math.floor(Math.random() * JOCKEYS.length)];
      return { slot: i, name: `CPU ${i + 1}`, mountId: d.id, jockeyId: j.id, cpu: true };
    });
    this.net?.broadcast({ t: 'start', slots });
    void this.beginRace(slots);
  }

  private async beginRace(slots: SlotConfig[]): Promise<void> {
    this.raceStarting = true;
    this.audio.init();
    this.ui.hideResult();
    this.ui.lockPick(true);
    this.ui.setLobbyMsg('레이스 준비 중…');
    this.ui.setStartEnabled(false, '준비 중…');
    await this.racers.setLineup(slots);
    this.race.setup(slots);
    this.particles.clear();
    this.footprints.clear();
    this.track.resetGate();
    this.gateTimer = -1;
    this.lastCount = -1;
    this.finishTimer = 0;
    this.excitement = 0.3;
    this.accum = 0;
    this.snapAccum = 0;
    this.outSeq = 0;
    this.snaps = [];
    this.snapSeq = 0;
    this.playT = null;
    this.jitter = 0;
    this.sendGap = 0;
    this.lastRecv = 0;
    this.clientRacing = false;
    this.input.attach();
    this.input.clear();
    this.screen = 'RACE';
    this.ui.showHud();
    this.camera.setMode('CHASE', true);
    this.camera.update(0, this.race.karts[this.mySlot] ?? null, 0);
    this.racers.update(this.race.karts, this.race.params, 0, 0, this.camera.camera.position);
    this.audio.setExcitement(0.3);
    this.audio.play('neigh', { gain: 0.5 });
    if (this.mode !== 'client') {
      this.race.startCountdown();
      this.showCount(3);
      this.net?.broadcast({ t: 'count', n: 3 });
    }
    this.raceStarting = false;
  }

  private showCount(n: number): void {
    if (n === this.lastCount) return;
    this.lastCount = n;
    if (n > 0) {
      this.ui.setCountdown(String(n));
      this.audio.play('bell', { gain: 0.35, rate: 1.4 });
    } else {
      this.ui.setCountdown('GO!');
      this.audio.play('bell', { gain: 0.9 });
      this.audio.crowdRoar(0.8);
      this.gateTimer = 0;
      setTimeout(() => this.ui.setCountdown(''), 900);
    }
  }

  // ---------------------------------------------------------------- race events

  private onRaceEvent(e: { k: string; slot: number; lap?: number; other?: number }): void {
    const slot = e.slot;
    const pos = this.racers.worldPosition(slot, this.tmp).clone();
    const me = slot === this.mySlot;
    switch (e.k) {
      case 'boost':
        this.racers.boostFx(slot);
        this.audio.play('whooshEpic', { pos, minGain: me ? 0.8 : 0.3, gain: 0.9 });
        if (me) {
          this.camera.shake(0.25);
          this.effects.flashScreen(0.25);
        }
        break;
      case 'wall':
        this.racers.bump(slot, true);
        this.audio.play('impact', { pos, minGain: me ? 0.7 : 0.2, gain: 0.8, cooldown: 0.2 });
        if (me) this.camera.shake(0.45);
        break;
      case 'bump':
        this.racers.bump(slot, false);
        if (e.other !== undefined) this.racers.bump(e.other, false);
        this.audio.play('impact', { pos, minGain: 0.3, gain: 0.55, cooldown: 0.3 });
        if (me || e.other === this.mySlot) this.camera.shake(0.2);
        break;
      case 'lap':
        if (me) {
          this.ui.showToast(e.lap === 2 ? 'FINAL LAP!' : `LAP ${(e.lap ?? 0) + 1}`);
          this.audio.play('bell', { gain: 0.5, rate: 1.2 });
        }
        if (e.lap === 2) this.excitement = Math.max(this.excitement, 0.8);
        break;
      case 'finish': {
        const first = this.race.karts.every((k, i) => i === slot || !k.finished || (k.finishTime ?? 0) >= (this.race.karts[slot].finishTime ?? 0));
        if (first) {
          this.audio.play('airhorn', { gain: 0.7 });
          this.audio.crowdRoar(1.2);
          this.effects.flashScreen(0.6);
        }
        if (me) this.ui.showToast(`${this.race.rankOf(slot)}위 골인!`, 2500);
        break;
      }
    }
  }

  private showResult(): void {
    if (this.screen === 'RESULT') return;
    this.screen = 'RESULT';
    this.input.detach();
    this.input.clear();
    const winner = this.race.results[0]?.slot ?? 0;
    this.camera.setResultFocus(this.racers.worldPosition(winner, this.tmp));
    this.camera.setMode('RESULT', true);
    this.audio.stopRacerLoops();
    this.audio.play('fanfare', { gain: 0.6 });
    const rows = this.ui.resultRows(this.race.results, this.race.slots, this.mySlot);
    const mine = rows.find((r) => r.me);
    this.ui.showResult(rows, this.mode !== 'client', mine ? `당신은 ${mine.rank}위` : '');
    this.ui.setStartEnabled(true);
  }

  // ---------------------------------------------------------------- loop

  private updateSun(): void {
    const look = this.camera.focusPoint;
    this.sun.position.copy(look).add(this.sunOffset);
    this.sun.target.position.copy(look);
    this.sun.target.updateMatrixWorld();
  }

  private loop(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.globalTime += dt;
    switch (this.screen) {
      case 'MENU':
      case 'LOBBY':
        this.ui.updatePreview(dt);
        this.camera.update(dt, null, 0);
        this.track.updateCrowd(this.globalTime, 0.1);
        break;
      case 'RACE':
        this.updateRace(dt);
        break;
      case 'RESULT': {
        // 골인한 말들은 계속 유유히 돈다
        this.stepSim(dt);
        const w = this.race.results[0]?.slot ?? 0;
        this.camera.setResultFocus(this.racers.worldPosition(w, this.tmp));
        this.racers.update(this.race.karts, this.race.params, dt, this.race.time, this.camera.camera.position);
        this.camera.update(dt, null, 0);
        this.track.updateCrowd(this.globalTime, 0.5);
        this.particles.update(dt);
        break;
      }
    }
    this.updateSun();
    updateWind(this.globalTime, 1 + this.camera.boostNearby * 0.5);
    this.track.updateAmbient(dt);
    this.audio.setCameraPosition(this.camera.camera.position);
    this.audio.update(dt, this.camera.velocity);
    this.effects.update(dt, this.camera.velocity);
    this.effects.render();
  }

  /** 호스트/솔로: 고정 스텝 시뮬 (RESULT 화면에서도 남은 말들이 움직이게) */
  private stepSim(dt: number): void {
    if (this.mode === 'client') {
      // 결과 화면의 클라이언트: 마지막 스냅샷 기준으로 로컬 물리로 굴린다
      for (let i = 0; i < this.race.karts.length; i++) stepKart(this.race.karts[i], this.race.inputOf(i), this.race.params[i], this.track, dt, this.race.time);
      return;
    }
    this.accum += dt;
    let steps = 0;
    while (this.accum >= STEP && steps < 6) {
      this.race.step(STEP);
      this.accum -= STEP;
      steps++;
    }
    this.race.events = [];
  }

  private updateRace(dt: number): void {
    const myKart = this.race.karts[this.mySlot];
    if (!myKart) return;
    const input = this.input.update(dt);

    if (this.mode === 'client') {
      this.clientTick(dt, input);
    } else {
      this.race.setInput(this.mySlot, input);
      this.accum += dt;
      let steps = 0;
      while (this.accum >= STEP && steps < 6) {
        this.race.step(STEP);
        this.accum -= STEP;
        steps++;
      }
      if (this.race.phase === 'COUNTDOWN') this.hostCount(Math.ceil(this.race.countdown));
      else if (this.race.phase === 'RACING' && this.lastCount !== 0) this.hostCount(0);
      if (this.race.events.length) {
        this.net?.broadcast({ t: 'ev', ev: this.race.events });
        for (const e of this.race.events) this.onRaceEvent(e);
        this.race.events = [];
      }
      if (this.mode === 'host') {
        this.snapAccum += dt;
        if (this.snapAccum >= 1 / SNAP_HZ - 0.002) {
          this.snapAccum = Math.min(this.snapAccum - 1 / SNAP_HZ, 1 / SNAP_HZ);
          this.net?.broadcastDroppable({ t: 'snap', q: ++this.outSeq, ts: Math.round(performance.now()), k: this.race.karts.map(encodeKart) });
        }
      }
      if (this.race.phase === 'OVER') {
        this.net?.broadcast({ t: 'over', results: this.race.results });
        this.showResult();
        return;
      }
    }

    // 게이트
    if (this.gateTimer >= 0) {
      this.gateTimer += dt;
      this.track.setGateOpen(THREE.MathUtils.clamp(this.gateTimer / 0.35, 0, 1));
      if (this.gateTimer > 2.5) this.track.setGateDrive(THREE.MathUtils.clamp((this.gateTimer - 2.5) / 5, 0, 1));
    }

    const boost = myKart.boostT > 0 ? 1 : 0;
    this.racers.update(this.race.karts, this.race.params, dt, this.race.time, this.camera.camera.position);
    this.particles.update(dt);
    this.camera.update(dt, myKart, boost);
    this.effects.setAfterimage(this.camera.boostNearby * 0.55);
    this.effects.setSpeedLines(this.camera.boostNearby);
    this.effects.setSlowMo(0);
    if (myKart.drifting) this.camera.shake(dt * 0.08);

    // 분위기: 마지막 랩일수록 관중 열기 ↑
    const lapFrac = THREE.MathUtils.clamp(myKart.progress / (this.track.finishS + 2 * this.track.length), 0, 1);
    this.excitement = THREE.MathUtils.lerp(this.excitement, 0.3 + lapFrac * 0.6, Math.min(1, dt * 0.5));
    this.audio.setExcitement(this.excitement);
    this.track.updateCrowd(this.globalTime, this.excitement);

    // 사운드 루프
    for (let i = 0; i < this.race.karts.length; i++) {
      const k = this.race.karts[i];
      const p = this.race.params[i];
      const def = this.racers.defs[i];
      if (!def) continue;
      const pos = this.racers.worldPosition(i, this.tmp);
      const speedNorm = THREE.MathUtils.clamp(Math.abs(k.speed) / p.maxSpeed, 0, 1.2);
      const active = Math.abs(k.speed) > 1.5;
      if (def.specialAbility === 'MOTORCYCLE') {
        this.audio.updateRacerLoop(String(i), 'engine', pos, speedNorm, { rpm: k.boostT > 0 ? 1 : THREE.MathUtils.clamp(speedNorm, 0.15, 0.7), active: true });
      } else if (def.specialAbility === 'HUMAN' || def.specialAbility === 'COSTUME' || def.specialAbility === 'TROJAN') {
        this.audio.updateRacerLoop(String(i), 'grass', pos, speedNorm, { active });
      } else {
        const heavy = def.specialAbility === 'ELEPHANT' ? 1.7 : def.specialAbility === 'GIRAFFE' ? 1.2 : 1;
        this.audio.updateRacerLoop(String(i), 'gallop', pos, speedNorm, { heavy, active });
      }
    }

    // HUD
    const order = this.race.ranking.map((slot) => {
      const d = this.racers.defs[slot];
      return { name: this.race.slots[slot].name, emoji: d?.emoji ?? '', me: slot === this.mySlot, finished: this.race.karts[slot].finished };
    });
    this.ui.updateHud({
      lap: currentLap(myKart),
      rank: this.race.rankOf(this.mySlot),
      total: this.race.karts.length,
      speed: myKart.speed,
      gauge: myKart.gauge,
      boosting: myKart.boostT > 0,
      time: this.race.time,
      order,
    });
    this.netInfoT += dt;
    if (this.net && this.netInfoT > 1) {
      this.netInfoT = 0;
      void this.net.probePath();
      this.ui.setNetInfo(`${this.mode === 'host' ? 'HOST' : 'GUEST'} · ${this.net.pathType || '…'} · rtt ${Math.round(this.net.rtt)}ms`);
    }
    this.finishTimer += dt;
    if (this.finishTimer > 0.3) {
      this.finishTimer = 0;
      const lines = this.race.ranking.slice(0, 4).map((slot, i) => `${i + 1}. ${this.race.slots[slot].name}`);
      this.track.updateBigScreen('초현실 경마 그랑프리 · 대결', lines, this.race.time);
    }
  }

  private hostCount(n: number): void {
    if (n === this.lastCount) return;
    this.showCount(n);
    this.net?.broadcast({ t: 'count', n });
  }

  // ---------------------------------------------------------------- client

  private clientTick(dt: number, input: KartInput): void {
    const net = this.net!;
    net.sendFast({ t: 'in', q: ++this.inSeq, d: encodeInput(input) });
    this.pingT += dt;
    if (this.pingT > 1) {
      this.pingT = 0;
      net.send({ t: 'ping', t0: performance.now() });
    }
    // 자기 말: 로컬 예측 (호스트와 같은 물리)
    if (this.clientRacing) {
      const my = this.race.karts[this.mySlot];
      this.accum += dt;
      let steps = 0;
      while (this.accum >= STEP && steps < 6) {
        const wasBoost = my.boostT > 0;
        stepKart(my, input, this.race.params[this.mySlot], this.track, STEP, this.race.time);
        if (!wasBoost && my.boostT > 0) this.onRaceEvent({ k: 'boost', slot: this.mySlot });
        this.accum -= STEP;
        steps++;
      }
      this.race.time += dt;
    }
    this.clientInterpolate(dt);
    this.race.refreshRanking();
  }

  private onSnapshot(m: { q: number; ts: number; k: number[][] }): void {
    // 비순서 채널: 늦게 온 옛 스냅샷은 버린다
    if (m.q <= this.snapSeq && this.snapSeq - m.q < 100000) return;
    this.snapSeq = m.q;
    const now = performance.now();
    const ts = m.ts;
    if (this.lastRecv) {
      const dev = Math.abs(now - this.lastRecv - (ts - this.lastRecvTs));
      this.jitter = this.jitter ? this.jitter * 0.88 + dev * 0.12 : dev;
      const gap = Math.min(200, ts - this.lastRecvTs);
      this.sendGap = this.sendGap ? this.sendGap * 0.9 + gap * 0.1 : gap;
    }
    this.lastRecv = now;
    this.lastRecvTs = ts;
    this.snaps.push({ recv: now, ts, k: m.k });
    if (this.snaps.length > 10) this.snaps.shift();
  }

  /**
   * 타인: 호스트 타임스탬프 기준으로 "조금 늦게" 재생 (재생 시계 playT, 버퍼 두께에 따라 ±12% 속도 조정).
   * 자기 말: 위치·방향만 호스트 값으로 부드럽게 당기고(오차 > 3m 면 스냅), 속도·게이지는 로컬 예측 유지.
   */
  private clientInterpolate(dt: number): void {
    const n = this.snaps.length;
    if (n === 0) return;
    const latest = this.snaps[n - 1];
    const karts = this.race.karts;
    const applyOthers = (A: Snap, B: Snap, t: number) => {
      for (let i = 0; i < karts.length; i++) {
        if (i === this.mySlot) continue;
        const a = A.k[i];
        const b = B.k[i];
        if (!a || !b) continue;
        decodeKart(b, karts[i], false);
        karts[i].x = THREE.MathUtils.lerp(a[0], b[0], t);
        karts[i].z = THREE.MathUtils.lerp(a[1], b[1], t);
        karts[i].yaw = a[2] + angleDelta(b[2] - a[2]) * t;
        karts[i].lastAccel = 0;
      }
    };
    if (n === 1) {
      applyOthers(latest, latest, 1);
    } else {
      const interval = Math.max(1000 / SNAP_HZ, this.sendGap || 0);
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
      const t = Math.max(0, Math.min(1.35, (this.playT - A.ts) / span));
      applyOthers(A, B, t);
    }
    // 자기 말 보정
    const my = karts[this.mySlot];
    const sv = latest.k[this.mySlot];
    if (my && sv) {
      const keep = { speed: my.speed, slip: my.slip, gauge: my.gauge, boostT: my.boostT, drifting: my.drifting, bumpT: my.bumpT, bumpDir: my.bumpDir };
      decodeKart(sv, my, false);
      if (!this.clientRacing) {
        my.x = sv[0];
        my.z = sv[1];
        my.yaw = sv[2];
      } else {
        my.speed = keep.speed;
        my.slip = keep.slip;
        my.gauge = Math.max(keep.gauge, my.gauge);
        my.boostT = Math.max(keep.boostT, my.boostT);
        my.drifting = keep.drifting;
        my.bumpT = Math.max(keep.bumpT, my.bumpT);
        my.bumpDir = keep.bumpT > 0 ? keep.bumpDir : my.bumpDir;
        // 호스트 위치는 편도 지연만큼 과거 → 속도로 조금 앞당겨 비교
        const lead = Math.min(0.15, ((this.net?.rtt ?? 40) * 0.5) / 1000);
        const h = sv[2] + sv[4];
        const tx = sv[0] + Math.cos(h) * sv[3] * lead;
        const tz = sv[1] - Math.sin(h) * sv[3] * lead;
        const ex = tx - my.x;
        const ez = tz - my.z;
        const err = Math.hypot(ex, ez);
        if (err > 3) {
          my.x = tx;
          my.z = tz;
          my.yaw = sv[2];
        } else {
          const k = Math.min(1, 5 * dt);
          my.x += ex * k;
          my.z += ez * k;
          my.yaw += angleDelta(sv[2] - my.yaw) * k * 0.5;
        }
      }
    }
  }
}
