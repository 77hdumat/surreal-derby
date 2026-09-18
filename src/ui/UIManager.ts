import * as THREE from 'three';
import type { RacerDefinition } from '../racers/Racer';
import type { Racer } from '../racers/Racer';
import type { RankingEntry } from '../game/RaceState';
import type { RaceEvent } from '../events/RaceEvent';
import { RacerFactory } from '../racers/RacerFactory';
import type { RacerVisual, VisualContext } from '../racers/RacerVisual';
import type { CommentaryLine } from '../commentary/CommentaryManager';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

/**
 * HTML/CSS 오버레이: 소개 화면, 중계 HUD, 결과 화면.
 */
export class UIManager {
  private defs: RacerDefinition[];
  private intro = $('intro');
  private hud = $('hud');
  private result = $('result');
  private rankList = $('rank-list');
  private ranking = document.querySelector('.ranking') as HTMLElement;
  private subtitle = $('subtitle');
  private camLabel = $('cam-label');
  private countdown = $('countdown');
  private raceTime = $('race-time');
  private slowmo = $('slowmo');
  private detail = $('detail-card');
  private selectedId: string | null = null;
  private defaultNames: Map<string, string>;
  private lastRankKey = '';
  private prevRankMap = new Map<string, number>();
  private rankTimer = 0;
  private leaderIdShown: string | null = null;
  // 프리뷰 렌더러
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene = new THREE.Scene();
  private previewCamera = new THREE.PerspectiveCamera(35, 1.5, 0.1, 100);
  private previewVisual: RacerVisual | null = null;
  private previewCtx: VisualContext = {
    dt: 0, time: 0, speedNorm: 0.85, speed: 14, accel: 0, state: 'RUNNING', stateTimer: 0, cornerWeight: 0,
    boost: 0, bump: 0, bumpDir: 0, riderless: false, distanceToFinish: 500, sideHint: 1, extension: 0,
  };

  onStart: (() => void) | null = null;
  onAgain: (() => void) | null = null;
  onBackToSelect: (() => void) | null = null;
  onToggleMute: (() => boolean) | null = null;

  constructor(defs: RacerDefinition[]) {
    this.defs = defs;
    this.defaultNames = new Map(defs.map((d) => [d.id, d.name]));
    this.loadNames();
    this.buildIntroList();
    $('btn-reset-names').addEventListener('click', () => {
      for (const d of this.defs) d.name = this.defaultNames.get(d.id) ?? d.name;
      this.saveNames();
      this.buildIntroList();
      if (this.selectedId) this.select(this.selectedId);
    });
    $('btn-start').addEventListener('click', () => this.onStart?.());
    $('btn-again').addEventListener('click', () => this.onAgain?.());
    $('btn-select').addEventListener('click', () => this.onBackToSelect?.());
    $('btn-mute').addEventListener('click', (e) => {
      const muted = this.onToggleMute?.() ?? false;
      (e.currentTarget as HTMLElement).textContent = muted ? '🔇' : '🔊';
      (e.currentTarget as HTMLElement).classList.toggle('off', muted);
    });
    this.previewScene.add(new THREE.HemisphereLight(0xffffff, 0x3f9a2c, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 6, 4);
    this.previewScene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 24), new THREE.MeshLambertMaterial({ color: 0x5ec93c }));
    ground.rotation.x = -Math.PI / 2;
    this.previewScene.add(ground);
  }

  private static NAMES_KEY = 'surreal-derby-names';

  private loadNames(): void {
    try {
      const raw = localStorage.getItem(UIManager.NAMES_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, string>;
      for (const d of this.defs) {
        const n = saved[d.id];
        if (typeof n === 'string' && n.trim()) d.name = n.trim().slice(0, 14);
      }
    } catch {
      /* ignore */
    }
  }

  private saveNames(): void {
    try {
      const obj: Record<string, string> = {};
      for (const d of this.defs) obj[d.id] = d.name;
      localStorage.setItem(UIManager.NAMES_KEY, JSON.stringify(obj));
    } catch {
      /* ignore */
    }
  }

  private buildIntroList(): void {
    const list = $('intro-list');
    list.innerHTML = '';
    for (const d of this.defs) {
      const li = document.createElement('li');
      li.dataset.id = d.id;
      li.innerHTML = `<span class="num" style="background:${hex(d.clothColor)}">${d.number}</span><span class="emoji">${d.emoji}</span><span class="txt"><div class="nm"><input type="text" maxlength="14" value="" spellcheck="false" /><span class="pen">✎</span></div><div class="en">${d.nameEn}</div></span>`;
      const input = li.querySelector('input') as HTMLInputElement;
      input.value = d.name;
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('focus', () => this.select(d.id));
      const commit = () => {
        const v = input.value.trim().slice(0, 14);
        d.name = v || (this.defaultNames.get(d.id) ?? d.name);
        input.value = d.name;
        this.saveNames();
        if (this.selectedId === d.id) this.select(d.id, true);
      };
      input.addEventListener('change', commit);
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
      li.addEventListener('click', () => this.select(d.id));
      list.appendChild(li);
    }
  }

  private select(id: string, keepPreview = false): void {
    this.selectedId = id;
    document.querySelectorAll('#intro-list li').forEach((li) => li.classList.toggle('active', (li as HTMLElement).dataset.id === id));
    const d = this.defs.find((x) => x.id === id)!;
    const stat = (label: string, v: number, max: number, show: string) =>
      `<div>${label}</div><div class="bar"><i style="width:${Math.round((v / max) * 100)}%"></i></div><div class="val">${show}</div>`;
    if (keepPreview && this.detail.querySelector('#preview-canvas')) {
      const nm = this.detail.querySelector('.detail-head .nm');
      if (nm) nm.textContent = `${d.emoji} ${d.name}`;
      return;
    }
    this.detail.innerHTML = `
      <div class="detail-left"><div class="detail-preview"><canvas id="preview-canvas"></canvas></div></div>
      <div class="detail-right">
        <div class="detail-head">
          <span class="num" style="background:${hex(d.clothColor)}">${d.number}</span>
          <div><div class="nm">${d.emoji} ${d.name}</div><div class="en">${d.nameEn}</div></div>
        </div>
        <div class="stats">
          ${stat('속도', d.speed, 18, d.speed.toFixed(1))}
          ${stat('가속', d.acceleration, 6, d.acceleration.toFixed(1))}
          ${stat('스태미나', d.stamina, 1, Math.round(d.stamina * 100) + '')}
          ${stat('코너링', d.cornering, 1, Math.round(d.cornering * 100) + '')}
          ${stat('체중', Math.min(d.weight, 4200), 4200, d.weight + 'kg')}
          ${stat('운', d.luck, 1, Math.round(d.luck * 100) + '')}
        </div>
        <div class="ability"><div class="ab-name">특수 능력 · ${d.abilityName}</div><div class="ab-desc">${d.abilityDesc}</div></div>
        <div class="detail-desc">“${d.description}”</div>
      </div>
    `;
    this.setupPreview(d);
  }

  private setupPreview(d: RacerDefinition): void {
    const canvas = document.getElementById('preview-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    if (this.previewRenderer) {
      this.previewRenderer.dispose();
      this.previewRenderer = null;
    }
    try {
      this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      const rect = canvas.parentElement!.getBoundingClientRect();
      this.previewRenderer.setSize(rect.width, rect.height, false);
      this.previewCamera.aspect = rect.width / rect.height;
      this.previewCamera.updateProjectionMatrix();
    } catch {
      this.previewRenderer = null;
      return;
    }
    if (this.previewVisual) {
      this.previewScene.remove(this.previewVisual.root);
      this.previewVisual.dispose();
    }
    this.previewVisual = RacerFactory.createVisual({ ...d, modelUrl: undefined });
    this.previewScene.add(this.previewVisual.root);
    const h = this.previewVisual.height;
    this.previewCamera.position.set(6.5, h * 0.9 + 1, 6.5);
    this.previewCamera.lookAt(0, h * 0.5, 0);
  }

  updatePreview(dt: number): void {
    if (!this.previewRenderer || !this.previewVisual || this.intro.classList.contains('hidden')) return;
    this.previewCtx.dt = dt;
    this.previewCtx.time += dt;
    this.previewVisual.update(this.previewCtx);
    this.previewVisual.root.rotation.y += dt * 0.6;
    this.previewRenderer.render(this.previewScene, this.previewCamera);
  }

  // ---------------------------------------------------------------- phases

  showIntro(): void {
    this.intro.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.result.classList.add('hidden');
    if (!this.selectedId) this.select(this.defs[0].id);
    else this.select(this.selectedId);
  }

  showHud(): void {
    this.intro.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.result.classList.add('hidden');
    this.subtitle.classList.add('hidden');
    this.lastRankKey = '';
    this.leaderIdShown = null;
    this.prevRankMap.clear();
  }

  showResult(ranking: RankingEntry[], racers: Racer[], highlights: RaceEvent[]): void {
    this.result.classList.remove('hidden');
    const list = $('result-list');
    list.innerHTML = '';
    ranking.forEach((e, i) => {
      const r = racers.find((x) => x.def.id === e.id)!;
      const li = document.createElement('li');
      li.style.animationDelay = `${i * 0.08}s`;
      const t = r.state.finishTime !== null ? r.state.finishTime.toFixed(2) + 's' : 'DNF';
      li.innerHTML = `<span class="pos">${i + 1}위</span><span class="num" style="background:${hex(r.def.clothColor)}">${r.def.number}</span><span class="name">${r.def.emoji} ${r.def.name}</span><span class="time">${t}</span>`;
      list.appendChild(li);
    });
    const pick = $('result-pick');
    const winner = racers.find((x) => x.def.id === ranking[0].id)!;
    const runner = racers.find((x) => x.def.id === ranking[1]?.id);
    const margin = runner && winner.state.finishTime !== null && runner.state.finishTime !== null ? (runner.state.finishTime - winner.state.finishTime).toFixed(2) + '초 차' : '';
    pick.innerHTML = `🏆 우승 · ${winner.def.emoji} ${winner.def.name}<br><span class="big-msg">${winner.state.finishTime !== null ? winner.state.finishTime.toFixed(2) + 's' : ''} ${margin}</span>`;
    const ev = $('result-events');
    ev.innerHTML = '';
    const shown = highlights.slice(0, 12);
    if (!shown.length) ev.innerHTML = '<li>특별한 사건 없이 평화로운(?) 레이스였습니다.</li>';
    for (const h of shown) {
      const li = document.createElement('li');
      const r = racers.find((x) => x.def.id === h.racerId);
      li.innerHTML = `<span class="t">${h.time.toFixed(1)}초</span><span>${r ? r.def.emoji + ' ' : ''}${h.label ?? h.event}</span>`;
      ev.appendChild(li);
    }
  }

  hideResult(): void {
    this.result.classList.add('hidden');
  }

  // ---------------------------------------------------------------- HUD

  setCountdown(text: string): void {
    this.countdown.textContent = text;
    this.countdown.classList.remove('pop');
    if (text) {
      void this.countdown.offsetWidth; // 애니메이션 재시작
      this.countdown.classList.add('pop');
    }
  }

  setCameraLabel(mode: string): void {
    this.camLabel.textContent = 'CAM · ' + mode.replace(/_CAMERA$/, '').replace(/_/g, ' ');
  }

  setRaceTime(t: number): void {
    this.raceTime.textContent = t.toFixed(1).padStart(4, '0');
  }

  setSlowMo(on: boolean): void {
    this.slowmo.classList.toggle('hidden', !on);
  }

  setSubtitle(line: CommentaryLine | null): void {
    if (!line) {
      this.subtitle.classList.add('hidden');
      return;
    }
    this.subtitle.classList.remove('hidden');
    this.subtitle.classList.toggle('major', line.major);
    this.subtitle.textContent = line.text;
    // 애니메이션 재시작
    this.subtitle.style.animation = 'none';
    void this.subtitle.offsetWidth;
    this.subtitle.style.animation = '';
  }

  /** 100~200ms 간격으로만 갱신 */
  updateRanking(dt: number, ranking: RankingEntry[], racers: Racer[], force = false): void {
    this.rankTimer += dt;
    if (!force && this.rankTimer < 0.15) return;
    this.rankTimer = 0;
    const key = ranking.map((e) => e.id).join(',');
    const leaderChanged = ranking[0] && this.leaderIdShown !== null && ranking[0].id !== this.leaderIdShown;
    if (key === this.lastRankKey && !force) {
      // 순위 같아도 간격은 갱신
      ranking.forEach((e, i) => {
        const li = this.rankList.children[i] as HTMLElement | undefined;
        if (li) this.fillGap(li, e, racers);
      });
      return;
    }
    this.lastRankKey = key;
    this.rankList.innerHTML = '';
    ranking.forEach((e) => {
      const r = racers.find((x) => x.def.id === e.id)!;
      const li = document.createElement('li');
      li.classList.toggle('leader', e.rank === 1);
      li.classList.toggle('finished', e.finished);
      const prev = this.prevRankMap.get(e.id);
      if (prev !== undefined && prev !== e.rank) li.classList.add(e.rank < prev ? 'up' : 'down');
      this.prevRankMap.set(e.id, e.rank);
      li.innerHTML = `<span class="pos">${e.rank}</span><span class="num" style="background:${hex(r.def.clothColor)}">${r.def.number}</span><span class="name">${r.def.name}</span><span class="gap"></span>`;
      this.fillGap(li, e, racers);
      this.rankList.appendChild(li);
    });
    if (leaderChanged) {
      this.ranking.classList.remove('leadflash');
      void this.ranking.offsetWidth;
      this.ranking.classList.add('leadflash');
    }
    if (ranking[0]) this.leaderIdShown = ranking[0].id;
  }

  private fillGap(li: HTMLElement, e: RankingEntry, racers: Racer[]): void {
    const gap = li.querySelector('.gap');
    if (!gap) return;
    const r = racers.find((x) => x.def.id === e.id)!;
    const st = r.state.state;
    let s = '';
    if (e.finished) s = 'FIN';
    else if (st === 'COLLAPSED') s = '붕괴!';
    else if (st === 'ENGINE_FAILURE') s = '고장';
    else if (st === 'BOOSTING') s = '부스트';
    else if (st === 'CHARGING') s = '돌진!';
    else if (st === 'RAGING') s = '폭주!';
    else if (st === 'BIPEDAL') s = '두발!';
    else if (st === 'PERFORMING') s = '공연중!';
    else if (st === 'STRETCHED') s = '쭈욱!';
    else if (st === 'EXHAUSTED') s = '탈진';
    else if (st === 'STUNNED') s = '휘청';
    else if (e.rank === 1) s = 'LEAD';
    else s = e.gapToLeader < 1 ? '동착' : `-${e.gapToLeader.toFixed(0)}m`;
    gap.textContent = s;
  }
}
