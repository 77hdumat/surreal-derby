import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RaceTrack } from '../track/RaceTrack';
import { RacerManager } from '../racers/RacerManager';
import { RACER_DEFINITIONS } from '../racers/RacerDefinitions';
import { RaceEventManager } from '../events/RaceEventManager';
import { RaceEngine } from './RaceEngine';
import { CameraManager } from '../camera/CameraManager';
import { EffectsManager } from '../effects/EffectsManager';
import { ParticleManager } from '../effects/ParticleManager';
import { AudioManager } from '../audio/AudioManager';
import { CommentaryManager } from '../commentary/CommentaryManager';
import { UIManager } from '../ui/UIManager';
import { VoiceManager } from '../audio/VoiceManager';
import { TEASERS_JA } from '../commentary/CommentaryJa';
import { updateWind } from '../track/Vegetation';
import type { RacePhase } from './RaceState';
import type { RaceEvent } from '../events/RaceEvent';

/**
 * 게임 루프 + 페이즈 관리 + 매니저 간 이벤트 배선.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly track: RaceTrack;
  readonly particles: ParticleManager;
  readonly racers: RacerManager;
  readonly events: RaceEventManager;
  readonly engine: RaceEngine;
  readonly camera: CameraManager;
  readonly effects: EffectsManager;
  readonly audio = new AudioManager();
  readonly commentary = new CommentaryManager();
  readonly voice = new VoiceManager();
  readonly ui: UIManager;

  phase: RacePhase = 'INTRO';
  private clock = new THREE.Clock();
  private globalTime = 0;
  private simTime = 0;
  private timeScale = 1;
  private slowMo = false;
  private countdownTimer = 0;
  private countdownStep = 0;
  private gateTimer = -1;
  private finishTimer = 0;
  private screenTimer = 0;
  private excitement = 0;
  private tmp = new THREE.Vector3();
  private firstFinishHandled = false;
  private sun: THREE.DirectionalLight;
  private sunOffset = new THREE.Vector3(85, 70, 55);

  constructor(glCanvas: HTMLCanvasElement, fxCanvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 여름 오후: 따뜻한 낮은 태양, 긴 그림자, 부드러운 안개
    this.scene.fog = new THREE.Fog(0xe9dfd0, 260, 950);
    // 실사풍 PBR 조명: 환경맵(간접광) + 태양(그림자) + 하늘/지면 반구광
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x8a9a62, 0.6));
    this.sun = new THREE.DirectionalLight(0xffd9a6, 2.4);
    this.sun.position.copy(this.sunOffset);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 400;
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    

    this.track = new RaceTrack();
    this.scene.add(this.track.group);
    this.particles = new ParticleManager(3000);
    this.scene.add(this.particles.points);
    this.racers = new RacerManager(this.scene, this.track, this.particles);
    this.events = new RaceEventManager();
    this.engine = new RaceEngine(this.racers.racers, this.track, this.events);
    this.camera = new CameraManager(this.track, this.racers, this.engine, window.innerWidth / window.innerHeight);
    this.effects = new EffectsManager(this.renderer, this.scene, this.camera.camera, fxCanvas);
    this.ui = new UIManager(RACER_DEFINITIONS);

    this.events.on((ev) => this.onRaceEvent(ev));
    this.commentary.onLine = (line) => this.ui.setSubtitle(line);
    this.commentary.onSpeak = (ja, major) => this.voice.speak(ja, major);
    this.ui.onToggleVoice = () => {
      this.voice.enabled = !this.voice.enabled;
      return this.voice.enabled;
    };
    this.ui.onStart = () => this.beginRace();
    this.ui.onAgain = () => this.beginRace();
    this.ui.onBackToSelect = () => this.backToIntro();
    this.ui.onToggleMute = () => {
      this.audio.init();
      this.audio.setMuted(!this.audio.muted);
      return this.audio.muted;
    };
    window.addEventListener('resize', () => this.resize());
    // 첫 클릭/키 입력에서 오디오 컨텍스트 준비 (샘플 프리로드)
    const prime = () => this.audio.init();
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    this.engine.reset();
    this.racers.placeAll();
  }

  start(): void {
    this.ui.showIntro();
    this.phase = 'INTRO';
    this.renderer.setAnimationLoop(() => this.loop());
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.resize(w / h);
    this.effects.resize(w, h);
  }

  // ---------------------------------------------------------------- phases

  private beginRace(): void {
    this.audio.init();
    this.ui.hideResult();
    this.ui.showHud();
    this.engine.reset();
    this.racers.reset();
    this.particles.clear();
    this.track.resetGate();
    this.camera.reset();
    this.commentary.reset();
    this.timeScale = 1;
    this.slowMo = false;
    this.simTime = 0;
    this.gateTimer = -1;
    this.finishTimer = 0;
    this.excitement = 0.2;
    this.firstFinishHandled = false;
    this.phase = 'COUNTDOWN';
    this.countdownStep = 0;
    this.countdownTimer = 1.2;
    this.ui.setCountdown('');
    this.ui.setSlowMo(false);
    this.ui.updateRanking(0, this.engine.ranking, this.racers.racers, true);
    this.commentary.say('COUNTDOWN', false);
    this.audio.setExcitement(0.25);
    this.audio.play('neigh', { gain: 0.5 });
  }

  private backToIntro(): void {
    this.phase = 'INTRO';
    this.voice.stop();
    this.audio.stopRacerLoops();
    this.engine.reset();
    this.racers.reset();
    this.particles.clear();
    this.track.resetGate();
    this.camera.reset();
    this.ui.showIntro();
  }

  private updateCountdown(dt: number): void {
    this.countdownTimer -= dt;
    if (this.countdownTimer > 0) return;
    this.countdownStep++;
    if (this.countdownStep <= 3) {
      this.ui.setCountdown(String(4 - this.countdownStep));
      this.audio.play('bell', { gain: 0.35, rate: 1.4 });
      this.countdownTimer = 1.0;
    } else {
      this.ui.setCountdown('START!');
      this.audio.play('bell', { gain: 0.9 });
      this.audio.crowdRoar(0.8);
      this.phase = 'RACING';
      this.gateTimer = 0;
      this.engine.start();
      setTimeout(() => this.ui.setCountdown(''), 900);
    }
  }

  private updateGate(dt: number): void {
    if (this.gateTimer < 0) return;
    this.gateTimer += dt;
    this.track.setGateOpen(THREE.MathUtils.clamp(this.gateTimer / 0.35, 0, 1));
    if (this.gateTimer > 2.5) this.track.setGateDrive(THREE.MathUtils.clamp((this.gateTimer - 2.5) / 5, 0, 1));
  }

  // ---------------------------------------------------------------- events

  private onRaceEvent(ev: RaceEvent): void {
    this.racers.onEvent(ev);
    this.camera.onEvent(ev);
    this.commentary.onEvent(ev, this.engine);
    const pos = ev.racerId ? this.racers.worldPosition(ev.racerId, this.tmp).clone() : undefined;
    const a = this.audio;
    switch (ev.event) {
      case 'START':
        if (this.engine.scenario?.teaser) this.commentary.sayRaw(this.engine.scenario.teaser, false, TEASERS_JA[this.engine.scenario.id] ?? this.engine.scenario.teaser);
        break;
      case 'COSTUME_COLLAPSE':
        a.play('cardboardDrop', { pos, minGain: 0.5, gain: 1.2 });
        a.play('scream', { pos, minGain: 0.35, gain: 0.8 });
        a.crowdGasp();
        break;
      case 'COSTUME_CARRY':
        a.play('scream', { pos, minGain: 0.5, gain: 0.8, rate: 1.15 });
        a.play('whooshEpic', { pos, minGain: 0.4, gain: 0.7 });
        a.crowdRoar(0.9);
        break;
      case 'GIRAFFE_MEGA_NECK':
        a.play('whooshEpic', { pos, minGain: 0.5, gain: 1.0, rate: 0.8 });
        a.play('neigh', { pos, minGain: 0.3, gain: 0.5, rate: 0.8 });
        a.crowdRoar(0.9);
        break;
      case 'COSTUME_RECOVER':
        a.play('cardboardOpen', { pos, minGain: 0.3 });
        a.crowdRoar(0.4);
        break;
      case 'ELEPHANT_CHARGE':
        a.play('elephantGrowl', { pos, minGain: 0.25, gain: 0.45 });
        a.crowdRoar(0.7);
        this.excitement += 0.2;
        break;
      case 'ELEPHANT_TRUNK':
        a.play('whooshEpic', { pos, minGain: 0.5, gain: 0.9 });
        a.play('elephant', { pos, minGain: 0.2, gain: 0.35, rate: 1.1 });
        a.crowdGasp();
        break;
      case 'ELEPHANT_STOMP':
        a.play('impactHeavy', { pos, minGain: 0.7, gain: 1.2, rate: 0.8 });
        a.play('elephantAngry', { pos, minGain: 0.2, gain: 0.3 });
        a.crowdGasp();
        break;
      case 'ELEPHANT_SPRAY':
        a.play('elephant', { pos, minGain: 0.2, gain: 0.35 });
        a.play('whoosh', { pos, minGain: 0.3, gain: 0.7, rate: 0.7 });
        a.crowdRoar(0.4);
        break;
      case 'COW_RAGE':
        a.play(Math.random() < 0.5 ? 'cow' : 'cow2', { pos, minGain: 0.55, gain: 1.1 });
        a.crowdRoar(0.5);
        break;
      case 'MOTORCYCLE_BOOST':
        a.play('engineRev2', { pos, minGain: 0.6, gain: 1.1 });
        a.play('motoPass', { pos, minGain: 0.4, gain: 0.8 });
        a.play('whoosh', { pos, minGain: 0.3, gain: 0.6 });
        a.crowdRoar(0.8);
        this.effects.flashScreen(0.35);
        this.excitement += 0.25;
        break;
      case 'ENGINE_FAILURE':
        a.play('engineFail', { pos, minGain: 0.5 });
        a.crowdGasp();
        break;
      case 'ENGINE_RESTART':
        a.play('engineRev', { pos, minGain: 0.4 });
        break;
      case 'RIDER_FALL':
        a.play('screamFall', { pos, minGain: 0.4 });
        a.play('impact', { pos, minGain: 0.3 });
        a.crowdGasp();
        break;
      case 'TRIP':
        a.play('scream', { pos, minGain: 0.3, rate: 1.1 });
        a.play('impact', { pos, minGain: 0.25, gain: 0.7 });
        break;
      case 'LONGBODY_STRETCH':
        a.play('whooshEpic', { pos, minGain: 0.5, gain: 1.0 });
        a.play('scream', { pos, minGain: 0.25, gain: 0.6, rate: 0.9 });
        a.crowdRoar(0.6);
        break;
      case 'LONGBODY_RETRACT':
        a.play('whoosh', { pos, minGain: 0.3, rate: 0.8 });
        break;
      case 'COLLISION':
        a.play('crash', { pos, minGain: 0.45, gain: 0.9 });
        a.play('scream', { pos, minGain: 0.25, gain: 0.6 });
        a.play('neigh', { pos, minGain: 0.2, gain: 0.5, cooldown: 2 });
        a.crowdGasp();
        break;
      case 'GIRAFFE_NECK_ATTACK':
        a.play('impactHeavy', { pos, minGain: 0.4, gain: 0.8 });
        a.play('scream', { pos, minGain: 0.25, gain: 0.5 });
        break;
      case 'BUMP':
        a.play('impact', { pos, gain: 0.55, cooldown: 0.4 });
        break;
      case 'TROJAN_AMBUSH':
        a.play('cardboardOpen', { pos, minGain: 0.5 });
        a.play('scream', { pos, minGain: 0.4, gain: 0.7, rate: 0.85 });
        a.play('whooshEpic', { pos, minGain: 0.3, gain: 0.5 });
        a.crowdRoar(0.7);
        break;
      case 'CIRCUS_ACT':
        a.play('tada', { pos, minGain: 0.6, gain: 0.9 });
        a.play('whooshEpic', { pos, minGain: 0.3, gain: 0.6 });
        a.crowdRoar(0.8);
        break;
      case 'SUPER_SPRINT':
      case 'COMEBACK':
        a.play('whoosh', { pos, minGain: 0.4 });
        a.crowdRoar(0.5);
        break;
      case 'HUMAN_BIPEDAL':
        a.play('whoosh', { pos, minGain: 0.4 });
        a.play('scream', { pos, minGain: 0.2, gain: 0.5, rate: 1.2 });
        a.crowdRoar(0.5);
        break;
      case 'HUMAN_EXHAUSTED':
        a.play('scream', { pos, minGain: 0.2, gain: 0.4, rate: 0.7 });
        break;
      case 'GIRAFFE_PHOTO_FINISH':
        a.play('tada', { gain: 0.5 });
        break;
      case 'LEAD_CHANGE':
        a.crowdRoar(0.3);
        break;
      case 'FINAL_STRETCH':
        a.crowdRoar(0.9);
        this.excitement = 1;
        break;
      case 'FINISH_LINE':
        if (!this.firstFinishHandled) {
          this.firstFinishHandled = true;
          a.play('airhorn', { gain: 0.7 });
          a.crowdRoar(1.2);
          this.effects.flashScreen(0.6);
        }
        break;
      case 'RACE_OVER':
        this.phase = 'FINISH';
        this.finishTimer = 0;
        break;
    }
  }

  // ---------------------------------------------------------------- loop

  private updateSun(): void {
    // 그림자 카메라가 현재 포커스를 따라감
    const look = this.camera.focusPoint;
    this.sun.position.copy(look).add(this.sunOffset);
    this.sun.target.position.copy(look);
    this.sun.target.updateMatrixWorld();
  }

  private loop(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.globalTime += dt;
    switch (this.phase) {
      case 'INTRO':
        this.ui.updatePreview(dt);
        this.camera.update(dt, this.globalTime, false);
        this.track.updateCrowd(this.globalTime, 0.1);
        break;
      case 'COUNTDOWN':
        this.updateCountdown(dt);
        this.racers.update(dt, this.simTime, this.camera.camera.position);
        this.camera.update(dt, this.globalTime, false);
        this.commentary.update(dt, this.engine, false);
        this.track.updateCrowd(this.globalTime, 0.25);
        break;
      case 'RACING':
        this.updateRacing(dt);
        break;
      case 'FINISH':
        this.finishTimer += dt;
        this.updateRacing(dt);
        if (this.finishTimer > 2.8) {
          this.phase = 'RESULT';
          this.camera.setMode('RESULT_CAMERA', true);
          this.ui.setSubtitle(null);
          this.audio.stopRacerLoops();
          this.voice.stop();
          this.audio.play('fanfare', { gain: 0.6 });
          this.ui.showResult(this.engine.ranking, this.racers.racers, this.events.highlights, this.engine.scenario?.title ?? '');
        }
        break;
      case 'RESULT':
        this.racers.update(dt, this.simTime, this.camera.camera.position);
        this.camera.update(dt, this.globalTime, false);
        this.track.updateCrowd(this.globalTime, 0.5);
        this.particles.update(dt);
        break;
    }
    this.updateSun();
    updateWind(this.globalTime, 1 + this.camera.boostNearby * 0.5);
    this.track.updateAmbient(dt);
    this.audio.setCameraPosition(this.camera.camera.position);
    this.audio.update(dt, this.camera.velocity);
    this.effects.update(dt, this.camera.velocity);
    this.effects.render();
  }

  private updateRacing(dt: number): void {
    const tension = this.engine.photoFinishTension();
    const wantSlow = tension > 0.3 && this.phase === 'RACING';
    if (wantSlow !== this.slowMo) {
      this.slowMo = wantSlow;
      this.ui.setSlowMo(wantSlow);
    }
    const targetScale = wantSlow ? THREE.MathUtils.lerp(0.5, 0.3, tension) : 1;
    this.timeScale = THREE.MathUtils.lerp(this.timeScale, targetScale, Math.min(1, dt * 6));
    this.effects.setSlowMo(this.slowMo ? 1 : 0);
    const sdt = dt * this.timeScale;
    this.simTime += sdt;

    this.engine.update(sdt);
    this.updateGate(sdt);
    this.racers.update(sdt, this.simTime, this.camera.camera.position);
    this.particles.update(sdt);
    this.camera.update(dt, this.engine.time, this.phase === 'RACING');
    this.commentary.update(dt, this.engine, this.phase === 'RACING');

    const progress = THREE.MathUtils.clamp(this.engine.time / this.engine.estimatedDuration, 0, 1);
    this.excitement = THREE.MathUtils.lerp(this.excitement, 0.25 + progress * 0.5, Math.min(1, dt * 0.5));
    this.audio.setExcitement(this.excitement);
    this.track.updateCrowd(this.globalTime, this.excitement);

    let after = this.camera.boostNearby;
    const moto = this.racers.byId('motorcycle');
    if (moto && moto.state.state === 'BOOSTING') {
      const d = this.racers.worldPosition('motorcycle', this.tmp).distanceTo(this.camera.camera.position);
      after = Math.max(after, THREE.MathUtils.clamp(1.2 - d / 70, 0, 1));
    }
    if (this.slowMo) after = Math.max(after, 0.35);
    this.effects.setAfterimage(after);
    this.effects.setSpeedLines(this.camera.boostNearby);
    if (this.camera.boostNearby > 0.5) this.camera.shake(dt * 0.6);

    // 선수별 근접 사운드 루프
    for (const r of this.racers.racers) {
      const s = r.state;
      const pos = this.racers.worldPosition(r.def.id, this.tmp);
      const speedNorm = THREE.MathUtils.clamp(s.currentSpeed / r.def.speed, 0, 1.2) * this.timeScale;
      if (r.def.specialAbility === 'MOTORCYCLE') {
        const rpm = s.state === 'BOOSTING' ? 1 : THREE.MathUtils.clamp(s.currentSpeed / 20, 0.15, 0.7);
        this.audio.updateRacerLoop(r.def.id, 'engine', pos, speedNorm, { rpm, failure: s.state === 'ENGINE_FAILURE', active: s.state !== 'IDLE' });
        continue;
      }
      const active = s.state !== 'COLLAPSED' && s.state !== 'IDLE' && s.currentSpeed > 1.5;
      if (r.def.specialAbility === 'HUMAN' || r.def.specialAbility === 'COSTUME' || r.def.specialAbility === 'TROJAN') {
        this.audio.updateRacerLoop(r.def.id, 'grass', pos, speedNorm, { active });
      } else {
        const heavy = r.def.specialAbility === 'ELEPHANT' ? 1.7 : r.def.specialAbility === 'GIRAFFE' ? 1.2 : 1;
        this.audio.updateRacerLoop(r.def.id, 'gallop', pos, speedNorm, { heavy, active });
      }
    }

    this.ui.setRaceTime(this.engine.time);
    this.ui.updateRanking(dt, this.engine.ranking, this.racers.racers);
    this.ui.setCameraLabel(this.camera.mode);
    this.screenTimer += dt;
    if (this.screenTimer > 0.3) {
      this.screenTimer = 0;
      const lines = this.engine.ranking.slice(0, 5).map((e) => {
        const r = this.racers.byId(e.id)!;
        return `${e.rank}. ${r.def.number}번 ${r.def.name}`;
      });
      this.track.updateBigScreen('초현실 경마 그랑프리 LIVE', lines, this.engine.time);
    }
  }
}
