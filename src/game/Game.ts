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
import { ObstacleMeshes } from '../track/ObstacleMeshes';
import { encodeKart, type LobbySlot, type NetMsg } from '../net/Protocol';
import { RemoteKart } from '../net/RemoteKart';
import { START_BOOST_WINDOW, applyStartBoost, currentLap } from './KartPhysics';
import { JOCKEYS } from '../racers/Jockeys';

type Mode = 'none' | 'solo' | 'host' | 'client';
type Screen = 'MENU' | 'LOBBY' | 'RACE' | 'RESULT';

const STEP = 1 / 60;
const SEND_HZ = 30;

/**
 * 게임 루프 + 화면 전환 + 네트워크 배선.
 *
 * 네트워크 모델: 클라이언트 권위(카트라이더식). 자기 말은 자기 기기에서만 물리를 돌리고(절대 되감기·밀림 없음),
 * 상태를 30Hz 로 보낸다. 남의 말은 받은 상태를 보간해서 그린다. 충돌은 각자 자기 말에만 적용.
 * 호스트는 CPU 를 돌리고, 모든 상태를 모아 다시 뿌리며(스타형 중계), 결과만 판정한다.
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
  /** 뒤 근접 선수 PiP (오른쪽 상단) */
  private rearCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 600);
  private rearEl = document.getElementById('rear-pip') as HTMLElement;
  private rearActive = false;
  private rearLook = new THREE.Vector3();
  private obstacleMeshes = new ObstacleMeshes();

  /** 원격 말 상태 버퍼 (슬롯별) */
  private remotes: RemoteKart[] = [];
  /** 호스트: 슬롯별 마지막으로 받은 원격 상태 (중계용) */
  private latestRemote: ({ ts: number; k: number[] } | null)[] = [];
  private sendSeq = 0;
  private sendAccum = 0;
  /** 출발 부스터 판정: ↑ 를 누르기 시작한 시각 (performance.now, ms) */
  private throttleSince = -1;
  private startBoostDone = false;
  /** 호스트: 카운트다운 전 게스트 준비 대기 */
  private waitingLoaded = false;
  private loadedSlots = new Set<number>();
  private pendingSeed = -1;
  private loadedTimer: ReturnType<typeof setTimeout> | null = null;
  /** 클라: 세팅 중에 GO 가 먼저 도착한 경우 */
  private pendingGo = false;
  /** 레이스 세대 — 세팅(await) 도중 로비/메뉴로 나가면 그 세팅은 버린다 */
  private raceGen = 0;
  private recvSeq = 0;
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
    this.scene.add(this.obstacleMeshes.group);
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
    this.ui.onChat = (text) => this.sendChat(text);
    // 대기실·결과 화면은 자유, 레이스 중엔 골인한 사람만
    this.ui.canChat = () => this.screen !== 'RACE' || !!this.race.karts[this.mySlot]?.finished;
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
    // 탭이 뒤로 가면 rAF 가 멈춘다 → 호스트 시뮬·중계가 끊기지 않게 30Hz 로 계속 돌린다
    setInterval(() => {
      if (document.hidden && (this.screen === 'RACE' || this.screen === 'RESULT')) this.loop();
    }, 1000 / 30);
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
    this.ui.setChatEnabled(false);
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
      const name = this.lobby[slot]?.name;
      this.lobby[slot] = this.emptySlot();
      this.renderLobby();
      this.broadcastLobby();
      if (name) this.hostChat(`${name} 퇴장`, -1, true);
      if (this.waitingLoaded) this.checkAllLoaded();
      // 레이스 중 이탈: 그 말은 CPU 가 이어받아 달린다 (트랙에 멈춰 있지 않게)
      if ((this.screen === 'RACE' || this.screen === 'RESULT') && this.race.slots[slot] && !this.race.owned[slot]) {
        this.race.slots[slot].cpu = true;
        this.race.owned[slot] = true;
        this.latestRemote[slot] = null;
        if (name) this.hostChat(`${name} 의 말은 CPU 가 이어서 달립니다`, -1, true);
      }
    };
    this.ui.setChatEnabled(true);
    this.ui.clearChat();
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
        this.hostChat(`${s.name} 입장`, -1, true);
        break;
      case 'chat':
        if (typeof m.text === 'string') this.hostChat(m.text.slice(0, 120), slot, false);
        break;
      case 'loaded':
        // 이번 레이스(seed) 의 신호만. 방장 세팅이 끝나기 전에 와도 저장해 둔다
        if (m.seed === this.pendingSeed) {
          this.loadedSlots.add(slot);
          this.checkAllLoaded();
        }
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
      case 'st':
        if (this.screen === 'RACE' || this.screen === 'RESULT') {
          this.remotes[slot]?.push(m.ts, m.k);
          this.latestRemote[slot] = { ts: m.ts, k: m.k };
        }
        break;
      case 'ping':
        this.net?.broadcast({ t: 'pong', t0: m.t0 });
        break;
    }
  }

  /** 호스트: 채팅 표시 + 전원 브로드캐스트 (from -1 = 시스템) */
  private hostChat(text: string, from: number, sys: boolean): void {
    const name = sys ? '' : this.lobby[from]?.name ?? 'P' + (from + 1);
    this.ui.addChat(name, text, from === this.mySlot && !sys, sys);
    this.net?.broadcast({ t: 'chat', text, from, name, sys });
  }

  private sendChat(text: string): void {
    if (this.mode === 'host') this.hostChat(text, 0, false);
    else if (this.mode === 'client') this.net?.send({ t: 'chat', text });
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
    this.ui.setChatEnabled(true);
    this.ui.clearChat();
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
        void this.beginRace(m.slots, m.seed);
        break;
      case 'count':
        if (this.raceStarting) {
          // 아직 모델 세팅 중 — 끝나면 바로 출발
          if (m.n === 0) this.pendingGo = true;
          break;
        }
        this.showCount(m.n);
        if (m.n === 0 && this.race.phase !== 'RACING') {
          this.race.startRacing();
          this.tryStartBoost();
        }
        break;
      case 'snap':
        if (this.screen !== 'RACE' && this.screen !== 'RESULT') break;
        if (m.q <= this.recvSeq && this.recvSeq - m.q < 300) break; // 비순서 채널: 옛 것 버림 (300 이상 뒤면 호스트 재시작으로 본다)
        this.recvSeq = m.q;
        for (let i = 0; i < m.k.length; i++) {
          const k = m.k[i];
          if (i === this.mySlot || !k) continue;
          this.remotes[i]?.push(m.ts[i], k);
        }
        break;
      case 'over':
        this.race.results = m.results;
        this.showResult();
        break;
      case 'tolobby':
        this.toLobby();
        break;
      case 'chat':
        this.ui.addChat(m.name ?? '', String(m.text).slice(0, 120), m.from === this.mySlot && !m.sys, !!m.sys);
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
    this.raceGen++;
    this.raceStarting = false;
    this.race.phase = 'IDLE';
    this.net?.close();
    this.net = null;
    this.mode = 'none';
    this.input.detach();
    this.input.clear();
    this.audio.stopRacerLoops();
    this.racers.clear();
    this.obstacleMeshes.clear();
    this.camera.setMode('INTRO');
    this.screen = 'MENU';
    this.ui.setChatEnabled(false);
    try {
      history.replaceState(null, '', location.pathname);
    } catch {
      /* ignore */
    }
    this.ui.showMenu(msg);
  }

  private toLobby(): void {
    if (this.mode === 'host') this.net?.broadcast({ t: 'tolobby' });
    this.raceGen++;
    this.raceStarting = false;
    this.race.phase = 'IDLE';
    this.input.detach();
    this.input.clear();
    this.audio.stopRacerLoops();
    this.racers.clear();
    this.obstacleMeshes.clear();
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
    this.ui.setChatLocked(false);
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
    const seed = (Math.random() * 0x7fffffff) >>> 0;
    // 게스트 준비 신호는 브로드캐스트 직후부터 들어올 수 있으니 여기서 초기화
    this.pendingSeed = seed;
    this.loadedSlots.clear();
    this.net?.broadcast({ t: 'start', slots, seed });
    void this.beginRace(slots, seed);
  }

  private async beginRace(slots: SlotConfig[], seed: number): Promise<void> {
    const gen = ++this.raceGen;
    this.raceStarting = true;
    // 스냅샷 시퀀스는 세팅 전에 미리 초기화 (호스트가 먼저 보내기 시작해도 안 버리게)
    this.recvSeq = 0;
    this.sendSeq = 0;
    this.audio.init();
    this.ui.hideResult();
    this.ui.lockPick(true);
    this.ui.setLobbyMsg('레이스 준비 중…');
    this.ui.setStartEnabled(false, '준비 중…');
    await this.racers.setLineup(slots);
    if (gen !== this.raceGen) return; // 세팅 중 나감
    const me = this.mySlot;
    const mode = this.mode;
    this.race.authority = mode !== 'client';
    this.race.setup(slots, (s) => (mode === 'solo' ? true : mode === 'host' ? s.cpu || s.slot === me : s.slot === me), seed);
    this.obstacleMeshes.build(this.race.obstacles);
    this.remotes = slots.map(() => new RemoteKart());
    this.latestRemote = slots.map(() => null);
    this.sendAccum = 0;
    this.particles.clear();
    this.footprints.clear();
    this.track.resetGate();
    this.gateTimer = -1;
    this.lastCount = -1;
    this.finishTimer = 0;
    this.excitement = 0.3;
    this.accum = 0;
    this.throttleSince = -1;
    this.startBoostDone = false;
    this.pendingGo = false;
    this.input.attach();
    this.input.clear();
    this.screen = 'RACE';
    this.ui.showHud();
    this.camera.setMode('CHASE', true);
    this.camera.distanceScale = Game.cameraScaleFor(this.racers.defs[this.mySlot]?.specialAbility);
    this.camera.update(0, this.race.karts[this.mySlot] ?? null, 0);
    this.racers.update(this.race.karts, this.race.params, 0, 0, this.camera.camera.position);
    this.audio.setExcitement(0.3);
    this.audio.play('neigh', { gain: 0.5 });
    this.raceStarting = false;
    if (this.mode === 'solo') {
      this.startCountdownNow();
    } else if (this.mode === 'host') {
      // 게스트 전원이 모델 세팅을 끝낼 때까지 대기 (최대 10초) → 동시에 출발
      this.waitingLoaded = true;
      this.ui.setCountdown('대기 중…');
      if (this.loadedTimer) clearTimeout(this.loadedTimer);
      this.loadedTimer = setTimeout(() => this.checkAllLoaded(true), 5000);
      this.checkAllLoaded();
    } else {
      this.ui.setCountdown('준비…');
      this.net?.send({ t: 'loaded', seed });
      if (this.pendingGo) {
        this.pendingGo = false;
        this.showCount(0);
        this.race.startRacing();
        this.tryStartBoost();
      }
    }
  }

  /** 호스트: 사람 슬롯이 전부 loaded 를 보냈으면(또는 타임아웃) 카운트다운 */
  private checkAllLoaded(force = false): void {
    if (!this.waitingLoaded || this.screen !== 'RACE') return;
    const humans = this.race.slots.filter((s) => !s.cpu && s.slot !== this.mySlot && this.lobby[s.slot]?.human);
    const ready = humans.every((s) => this.loadedSlots.has(s.slot));
    if (!ready && !force) return;
    this.waitingLoaded = false;
    if (this.loadedTimer) clearTimeout(this.loadedTimer);
    this.loadedTimer = null;
    this.startCountdownNow();
  }

  private startCountdownNow(): void {
    this.race.startCountdown();
    this.lastCount = -1;
    this.showCount(3);
    this.net?.broadcast({ t: 'count', n: 3 });
  }

  /** 큰 탈것은 화면에 엉덩이만 나오지 않게 카메라를 멀리 */
  static cameraScaleFor(ability?: string): number {
    switch (ability) {
      case 'TROJAN':
        return 2.9;
      case 'ELEPHANT':
        return 1.6;
      case 'GIRAFFE':
        return 1.35;
      case 'LONGBODY':
        return 1.2;
      default:
        return 1;
    }
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
    if (!this.racers.visuals[e.slot]) return;
    const slot = e.slot;
    const pos = this.racers.worldPosition(slot, this.tmp).clone();
    const me = slot === this.mySlot;
    switch (e.k) {
      case 'boost':
        this.racers.boostFx(slot);
        this.playBoostSound(slot, pos, me);
        this.audio.jetBoost(me ? 1 : 0.35);
        if (me) {
          this.camera.shake(0.35);
          this.effects.flashScreen(0.3);
        }
        break;
      case 'mini':
        this.racers.miniFx(slot);
        this.audio.play('whoosh', { pos, minGain: me ? 0.7 : 0.25, gain: 0.7, rate: 1.2 });
        if (me) this.camera.shake(0.12);
        break;
      case 'bale':
        this.racers.bump(slot, true);
        this.audio.play('cardboardDrop', { pos, minGain: me ? 0.8 : 0.3, gain: 1.0, cooldown: 0.2 });
        this.audio.play('impactHeavy', { pos, minGain: me ? 0.6 : 0.2, gain: 0.7, cooldown: 0.2 });
        if (me) {
          this.camera.shake(0.6);
          this.ui.showToast('건초더미!', 900);
        }
        break;
      case 'pad':
        this.racers.miniFx(slot);
        this.audio.play('whooshEpic', { pos, minGain: me ? 0.7 : 0.25, gain: 0.8, rate: 1.3 });
        if (me) this.camera.shake(0.15);
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

  /** 부스트 효과음: 관람 모드의 말별 특수 이벤트 소리를 그대로 (병사 등장, 물대포, 소 울음…) */
  private playBoostSound(slot: number, pos: THREE.Vector3, me: boolean): void {
    const a = this.audio;
    const near = me ? 0.8 : 0.3;
    const g = me ? 1 : 0.8;
    switch (this.racers.defs[slot]?.specialAbility) {
      case 'TROJAN': // 문 열리고 병사들이 함성과 함께 뛰쳐나옴
        a.play('cardboardOpen', { pos, minGain: near, gain: g });
        a.play('scream', { pos, minGain: near * 0.7, gain: 0.7 * g, rate: 0.85 });
        a.play('whooshEpic', { pos, minGain: near * 0.5, gain: 0.5 * g });
        a.crowdRoar(0.7);
        break;
      case 'ELEPHANT': // 물대포
        a.play('elephant', { pos, minGain: near * 0.5, gain: 0.5 * g });
        a.play('whoosh', { pos, minGain: near * 0.5, gain: 0.7 * g, rate: 0.7 });
        a.crowdRoar(0.4);
        break;
      case 'COW': // 분노
        a.play(Math.random() < 0.5 ? 'cow' : 'cow2', { pos, minGain: near, gain: 1.1 * g });
        a.crowdRoar(0.5);
        break;
      case 'COSTUME': // 탈 벗어 들고 질주
        a.play('scream', { pos, minGain: near, gain: 0.8 * g, rate: 1.15 });
        a.play('whooshEpic', { pos, minGain: near * 0.6, gain: 0.7 * g });
        a.crowdRoar(0.9);
        break;
      case 'HUMAN': // 이족보행
        a.play('whoosh', { pos, minGain: near * 0.6, gain: 0.8 * g });
        a.play('scream', { pos, minGain: near * 0.4, gain: 0.5 * g, rate: 1.2 });
        a.crowdRoar(0.5);
        break;
      case 'CIRCUS': // 서커스
        a.play('tada', { pos, minGain: near, gain: 0.9 * g });
        a.play('whooshEpic', { pos, minGain: near * 0.5, gain: 0.6 * g });
        a.crowdRoar(0.8);
        break;
      case 'MOTORCYCLE': // 엔진 폭발
        a.play('engineRev2', { pos, minGain: near, gain: 1.1 * g });
        a.play('motoPass', { pos, minGain: near * 0.6, gain: 0.8 * g });
        a.play('whoosh', { pos, minGain: near * 0.4, gain: 0.6 * g });
        a.crowdRoar(0.8);
        break;
      case 'LONGBODY': // 몸 늘어남
        a.play('whooshEpic', { pos, minGain: near * 0.7, gain: 1.0 * g });
        a.play('scream', { pos, minGain: near * 0.4, gain: 0.6 * g, rate: 0.9 });
        a.crowdRoar(0.6);
        break;
      case 'GIRAFFE': // 목 뻗기
        a.play('whooshEpic', { pos, minGain: near * 0.7, gain: 1.0 * g, rate: 0.8 });
        a.play('neigh', { pos, minGain: near * 0.4, gain: 0.5 * g, rate: 0.8 });
        a.crowdRoar(0.9);
        break;
      default: // 얼룩말: 슈퍼 스프린트
        a.play('whooshEpic', { pos, minGain: near, gain: 0.9 * g });
        a.crowdRoar(0.5);
    }
  }

  private showResult(): void {
    if (this.screen === 'RESULT') return;
    this.audio.setBoostRush(0);
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
    this.ui.setChatLocked(false);
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
    this.obstacleMeshes.update(this.globalTime);
    updateWind(this.globalTime, 1 + this.camera.boostNearby * 0.5);
    this.track.updateAmbient(dt);
    this.audio.setCameraPosition(this.camera.camera.position);
    this.audio.update(dt, this.camera.velocity);
    this.effects.update(dt, this.camera.velocity);
    this.effects.render();
    this.renderRearPip();
  }

  /**
   * 뒤에서 바짝 따라오는 선수가 있으면 오른쪽 상단에 후방 카메라를 띄운다 (22m 안 → 표시, 28m 밖 → 숨김).
   * 후처리 결과 위에 씬을 한 번 더 그린다 (그림자맵은 재사용).
   */
  private renderRearPip(): void {
    const my = this.race.karts[this.mySlot];
    if (this.screen !== 'RACE' || !my) {
      if (this.rearActive) {
        this.rearActive = false;
        this.rearEl.classList.add('hidden');
      }
      return;
    }
    let gap = Infinity;
    for (let i = 0; i < this.race.karts.length; i++) {
      if (i === this.mySlot) continue;
      const g = my.progress - this.race.karts[i].progress;
      if (g > 0.5 && g < gap) gap = g;
    }
    const want = this.rearActive ? gap < 28 : gap < 22;
    if (want !== this.rearActive) {
      this.rearActive = want;
      this.rearEl.classList.toggle('hidden', !want);
    }
    if (!want) return;
    (document.getElementById('pip-gap') as HTMLElement).textContent = `${gap.toFixed(0)}m`;
    const fx = Math.cos(my.yaw);
    const fz = -Math.sin(my.yaw);
    this.rearCam.position.set(my.x - fx * 1.0, 3.0, my.z - fz * 1.0);
    this.rearLook.set(my.x - fx * 16, 0.8, my.z - fz * 16);
    this.rearCam.lookAt(this.rearLook);
    const rect = this.rearEl.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 8 || h < 8) return;
    this.rearCam.aspect = w / h;
    this.rearCam.updateProjectionMatrix();
    const r = this.renderer;
    const shadowAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(null);
    r.autoClear = false;
    r.setScissorTest(true);
    r.setViewport(Math.round(rect.left), Math.round(H - rect.bottom), w, h);
    r.setScissor(Math.round(rect.left), Math.round(H - rect.bottom), w, h);
    r.clearDepth();
    // 내 말은 가려서 뒤쫓는 상대만 보이게
    const myVisual = this.racers.visuals[this.mySlot];
    if (myVisual) myVisual.root.visible = false;
    r.render(this.scene, this.rearCam);
    if (myVisual) myVisual.root.visible = true;
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.autoClear = true;
    r.shadowMap.autoUpdate = shadowAuto;
  }

  /**
   * 시뮬 + 네트워크 한 틱 (RACE/RESULT 공통). 내 말·CPU 는 고정 스텝 물리, 원격 말은 보간, 30Hz 로 상태 송신.
   * @returns 이번 틱에 발생한 내(소유) 말 이벤트
   */
  private stepSim(dt: number): void {
    this.accum += dt;
    let steps = 0;
    while (this.accum >= STEP && steps < 6) {
      this.race.step(STEP);
      this.accum -= STEP;
      steps++;
    }
    for (const e of this.race.events) this.onRaceEvent(e);
    this.race.events = [];
    // 원격 말 보간 + 상태 전이 연출
    for (let i = 0; i < this.race.karts.length; i++) {
      if (this.race.owned[i]) continue;
      const tr = this.remotes[i].sample(dt, this.race.karts[i]);
      if (tr.boostStart) this.onRaceEvent({ k: 'boost', slot: i });
      if (tr.bumpStart) this.onRaceEvent({ k: 'wall', slot: i });
      if (tr.finished) this.onRaceEvent({ k: 'finish', slot: i });
    }
    if (!this.race.owned.every(Boolean)) this.race.refreshRanking();
    // 송신
    if (this.net && this.mode !== 'solo') {
      this.sendAccum += dt;
      if (this.sendAccum >= 1 / SEND_HZ - 0.002) {
        this.sendAccum = Math.min(this.sendAccum - 1 / SEND_HZ, 1 / SEND_HZ);
        const now = Math.round(performance.now());
        if (this.mode === 'host') {
          const k = this.race.karts.map((kart, i) => (this.race.owned[i] ? encodeKart(kart) : this.latestRemote[i]?.k ?? null));
          const ts = this.race.karts.map((_, i) => (this.race.owned[i] ? now : this.latestRemote[i]?.ts ?? 0));
          this.net.broadcastDroppable({ t: 'snap', q: ++this.sendSeq, k, ts });
        } else if (this.race.phase === 'RACING' || this.race.phase === 'OVER') {
          this.net.sendFast({ t: 'st', q: ++this.sendSeq, ts: now, k: encodeKart(this.race.karts[this.mySlot]) });
        }
      }
    }
  }

  private updateRace(dt: number): void {
    const myKart = this.race.karts[this.mySlot];
    if (!myKart) return;
    const input = this.input.update(dt);
    if (input.throttle > 0) {
      if (this.throttleSince < 0) this.throttleSince = performance.now();
    } else this.throttleSince = -1;
    this.race.setInput(this.mySlot, input);
    this.stepSim(dt);
    if (this.mode !== 'client') {
      if (this.race.phase === 'COUNTDOWN') this.hostCount(Math.ceil(this.race.countdown));
      else if (this.race.phase === 'RACING' && this.lastCount !== 0) {
        this.hostCount(0);
        this.tryStartBoost();
      }
      if (this.race.phase === 'OVER') {
        this.net?.broadcast({ t: 'over', results: this.race.results });
        this.showResult();
        return;
      }
    } else {
      this.pingT += dt;
      if (this.pingT > 1) {
        this.pingT = 0;
        this.net?.send({ t: 'ping', t0: performance.now() });
      }
    }

    // 게이트
    if (this.gateTimer >= 0) {
      this.gateTimer += dt;
      this.track.setGateOpen(THREE.MathUtils.clamp(this.gateTimer / 0.35, 0, 1));
      if (this.gateTimer > 2.5) this.track.setGateDrive(THREE.MathUtils.clamp((this.gateTimer - 2.5) / 5, 0, 1));
    }

    const boost = myKart.boostT > 0 ? 1 : myKart.miniT > 0 ? 0.45 : 0;
    this.audio.setBoostRush(boost);
    this.racers.update(this.race.karts, this.race.params, dt, this.race.time, this.camera.camera.position);
    this.particles.update(dt);
    this.camera.update(dt, myKart, boost);
    // 속도감: 부스트 잔상·스피드라인 강하게, 고속 주행 자체도 살짝
    const speedK = THREE.MathUtils.clamp((Math.abs(myKart.speed) - 28) / 25, 0, 1);
    this.effects.setAfterimage(Math.max(this.camera.boostNearby * 0.75, speedK * 0.25));
    this.effects.setSpeedLines(Math.max(this.camera.boostNearby * 1.3, speedK * 0.35));
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
      const own = i === this.mySlot;
      if (def.specialAbility === 'MOTORCYCLE') {
        this.audio.updateRacerLoop(String(i), 'engine', pos, speedNorm, { rpm: k.boostT > 0 ? 1 : THREE.MathUtils.clamp(speedNorm, 0.15, 0.7), active: true, own });
      } else if (def.specialAbility === 'HUMAN' || def.specialAbility === 'COSTUME') {
        this.audio.updateRacerLoop(String(i), 'grass', pos, speedNorm, { active, own });
      } else {
        // 트로이 목마는 바퀴 굴러가는 소리 대신 무거운 말발굽(병사 발소리 느낌)
        const heavy = def.specialAbility === 'ELEPHANT' ? 1.7 : def.specialAbility === 'GIRAFFE' ? 1.2 : def.specialAbility === 'TROJAN' ? 1.4 : 1;
        this.audio.updateRacerLoop(String(i), 'gallop', pos, speedNorm, { heavy, active, own });
      }
    }

    // HUD
    const order = this.race.ranking.map((slot) => {
      const d = this.racers.defs[slot];
      return { name: this.race.slots[slot].name, emoji: d?.emoji ?? '', me: slot === this.mySlot, finished: this.race.karts[slot].finished };
    });
    this.ui.setChatLocked(!myKart.finished);
    this.ui.updateHud({
      lap: currentLap(myKart),
      rank: this.race.rankOf(this.mySlot),
      total: this.race.karts.length,
      speed: myKart.speed,
      gauge: myKart.gauge,
      boosts: myKart.boosts,
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

  /** GO 직전 START_BOOST_WINDOW 안에 ↑ 를 누르기 시작했으면 출발 부스터 */
  private tryStartBoost(): void {
    if (this.startBoostDone) return;
    this.startBoostDone = true;
    const my = this.race.karts[this.mySlot];
    if (!my || this.throttleSince < 0) return;
    const held = (performance.now() - this.throttleSince) / 1000;
    if (held <= START_BOOST_WINDOW) {
      applyStartBoost(my);
      this.onRaceEvent({ k: 'boost', slot: this.mySlot });
      this.ui.showToast('출발 부스터!', 1200);
    }
  }

  private hostCount(n: number): void {
    if (n === this.lastCount) return;
    this.showCount(n);
    this.net?.broadcast({ t: 'count', n });
  }
}
