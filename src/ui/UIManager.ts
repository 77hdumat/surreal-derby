import * as THREE from 'three';
import type { RacerDefinition } from '../racers/Racer';
import { RacerFactory } from '../racers/RacerFactory';
import type { RacerVisual, VisualContext } from '../racers/RacerVisual';
import { JOCKEYS, jockeyById, statBars, type Jockey } from '../racers/Jockeys';
import type { LobbySlot } from '../net/Protocol';
import type { RaceResult, SlotConfig } from '../game/KartRace';
import { LAPS } from '../game/KartPhysics';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

export interface HudState {
  lap: number;
  rank: number;
  total: number;
  speed: number;
  gauge: number;
  boosts: number;
  /** 그중 파란 부스터 수 */
  blueBoosts: number;
  boosting: boolean;
  /** 지금 터진 부스트가 파란색인가 */
  boostBlue: boolean;
  /** 들고 있는 아이템 표시 문자열 ('' = 없음) */
  item: string;
  /** 두 번째 칸 (이모지) */
  item2: string;
  time: number;
  /** 순위 순 이름 (상위부터) */
  order: { name: string; emoji: string; me: boolean; finished: boolean }[];
}

export interface ResultRow {
  slot: number;
  rank: number;
  name: string;
  mountEmoji: string;
  mountName: string;
  jockeyName: string;
  jockeyEmoji: string;
  time: number | null;
  me: boolean;
}

/**
 * HTML/CSS 오버레이: 메뉴 → 로비(말·기수 선택) → HUD → 결과.
 */
export class UIManager {
  private defs: RacerDefinition[];
  private menu = $('menu');
  private lobby = $('lobby');
  private hud = $('hud');
  private result = $('result');
  private countdown = $('countdown');
  private toast = $('hud-toast');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private rankList = $('rank-list');
  private lastRankKey = '';
  private lastLap = 0;

  mountId: string;
  jockeyId: string;
  nick = '';
  private pickLocked = false;

  // 프리뷰 렌더러
  private previewRenderer: THREE.WebGLRenderer | null = null;
  private previewScene = new THREE.Scene();
  private previewCamera = new THREE.PerspectiveCamera(35, 1.5, 0.1, 100);
  private previewVisual: RacerVisual | null = null;
  private previewCtx: VisualContext = {
    dt: 0, time: 0, speedNorm: 0.85, speed: 14, accel: 0, state: 'RUNNING', stateTimer: 0, cornerWeight: 0,
    boost: 0, bump: 0, bumpDir: 0, riderless: false, distanceToFinish: 500, sideHint: 1, extension: 0, lateralVel: 0, extensionMax: 0,
  };

  onSolo: (() => void) | null = null;
  onHost: (() => void) | null = null;
  onJoin: ((code: string) => void) | null = null;
  onPick: ((mountId: string, jockeyId: string) => void) | null = null;
  onReady: ((v: boolean) => void) | null = null;
  onStartRace: (() => void) | null = null;
  onLeave: (() => void) | null = null;
  onKick: ((slot: number) => void) | null = null;
  onAgain: (() => void) | null = null;
  onToLobby: (() => void) | null = null;
  onChat: ((text: string) => void) | null = null;
  onNick: ((name: string) => void) | null = null;
  onToggleMute: (() => boolean) | null = null;
  onToggleQuality: (() => boolean) | null = null;

  constructor(defs: RacerDefinition[]) {
    this.defs = defs;
    this.mountId = this.load('surreal-derby-mount', defs[defs.length - 1].id);
    this.jockeyId = this.load('surreal-derby-jockey', 'skull');
    if (!defs.some((d) => d.id === this.mountId)) this.mountId = defs[0].id;
    if (!JOCKEYS.some((j) => j.id === this.jockeyId)) this.jockeyId = JOCKEYS[0].id;
    this.nick = this.load('surreal-derby-nick', '');
    const nick = $('nick') as HTMLInputElement;
    const lobbyNick = $('lobby-nick') as HTMLInputElement;
    nick.value = this.nick;
    lobbyNick.value = this.nick;
    nick.addEventListener('input', () => {
      this.nick = nick.value.trim();
      lobbyNick.value = nick.value;
      this.save('surreal-derby-nick', this.nick);
    });
    // 대기실에서 닉네임 변경: 입력 멈추고 0.4초 뒤 방에 알림
    let nickTimer: ReturnType<typeof setTimeout> | null = null;
    lobbyNick.addEventListener('input', () => {
      this.nick = lobbyNick.value.trim();
      nick.value = lobbyNick.value;
      this.save('surreal-derby-nick', this.nick);
      if (nickTimer) clearTimeout(nickTimer);
      nickTimer = setTimeout(() => this.onNick?.(this.displayNick), 400);
    });
    lobbyNick.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') lobbyNick.blur();
    });
    this.buildMountList();
    this.buildJockeyList();
    this.refreshPick(false);

    const joinCode = $('join-code') as HTMLInputElement;
    joinCode.addEventListener('input', () => {
      joinCode.value = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    });
    joinCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && joinCode.value.length === 5) this.onJoin?.(joinCode.value);
    });
    $('btn-solo').addEventListener('click', () => this.onSolo?.());
    $('btn-host').addEventListener('click', () => this.onHost?.());
    $('btn-join').addEventListener('click', () => {
      if (joinCode.value.length === 5) this.onJoin?.(joinCode.value);
      else this.setMenuMsg('방 코드 5자리를 입력하세요');
    });
    $('btn-ready').addEventListener('click', () => {
      const b = $('btn-ready');
      const v = !b.classList.contains('on');
      this.onReady?.(v);
    });
    $('btn-race').addEventListener('click', () => this.onStartRace?.());
    $('btn-leave').addEventListener('click', () => this.onLeave?.());
    $('btn-again').addEventListener('click', () => this.onAgain?.());
    $('btn-tolobby').addEventListener('click', () => this.onToLobby?.());
    $('room-code-wrap').addEventListener('click', () => {
      const code = $('room-code').textContent ?? '';
      const url = `${location.origin}${location.pathname}?r=${code}`;
      navigator.clipboard?.writeText(url).then(() => {
        $('room-code-wrap').classList.add('copied');
        this.setLobbyMsg('초대 링크를 복사했습니다: ' + url);
        setTimeout(() => $('room-code-wrap').classList.remove('copied'), 1200);
      }).catch(() => {});
    });
    $('btn-mute').addEventListener('click', (e) => {
      const muted = this.onToggleMute?.() ?? false;
      (e.currentTarget as HTMLElement).textContent = muted ? '🔇' : '🔊';
      (e.currentTarget as HTMLElement).classList.toggle('off', muted);
    });
    $('btn-quality').addEventListener('click', () => {
      this.onToggleQuality?.();
    });
    // 터치 기기면 터치 버튼 표시
    if (window.matchMedia('(pointer: coarse)').matches) $('touch').classList.remove('hidden');
    // 채팅: Enter → 입력창, Enter → 전송 후 입력창 사라짐, Esc → 취소
    const chatIn = $('chat-input') as HTMLInputElement;
    chatIn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = chatIn.value.trim();
        if (t) this.onChat?.(t);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    chatIn.addEventListener('blur', () => this.closeChat());
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !this.chatEnabled) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      if (!(this.canChat?.() ?? true)) {
        this.flashChatHint('골인 후에 채팅할 수 있습니다');
        return;
      }
      chatIn.classList.remove('hidden');
      $('chat').classList.add('typing');
      chatIn.focus();
    });
  }

  private chatEnabled = false;
  private chatHintTimer: ReturnType<typeof setTimeout> | null = null;
  /** 지금 채팅을 열 수 있는지 (레이스 중엔 골인한 사람만) */
  canChat: (() => boolean) | null = null;

  /** 멀티 방에서만 채팅 UI 표시 */
  setChatEnabled(on: boolean): void {
    this.chatEnabled = on;
    $('chat').classList.toggle('hidden', !on);
    if (!on) this.closeChat();
  }

  /** 레이스 중 골인 전 안내 문구 */
  setChatLocked(locked: boolean): void {
    $('chat').classList.toggle('locked', locked);
    $('chat-hint').textContent = locked ? '골인 후 채팅 가능' : 'Enter 채팅';
  }

  private flashChatHint(text: string): void {
    const h = $('chat-hint');
    h.textContent = text;
    if (this.chatHintTimer) clearTimeout(this.chatHintTimer);
    this.chatHintTimer = setTimeout(() => this.setChatLocked($('chat').classList.contains('locked')), 1500);
  }

  private closeChat(): void {
    const chatIn = $('chat-input') as HTMLInputElement;
    chatIn.value = '';
    chatIn.classList.add('hidden');
    $('chat').classList.remove('typing');
    if (document.activeElement === chatIn) chatIn.blur();
  }

  clearChat(): void {
    $('chat-log').innerHTML = '';
  }

  addChat(name: string, text: string, me: boolean, sys: boolean): void {
    const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
    const html = sys ? esc(text) : `<b>${esc(name)}</b>${esc(text)}`;
    const cls = 'msg' + (sys ? ' sys' : '') + (me ? ' me' : '');
    // 최근 7개, 10초 뒤 사라짐
    const log = $('chat-log');
    log.insertAdjacentHTML('beforeend', `<div class="${cls}">${html}</div>`);
    while (log.children.length > 7) log.removeChild(log.firstChild!);
    const el = log.lastElementChild as HTMLElement;
    setTimeout(() => el.classList.add('fade'), 10000);
    setTimeout(() => el.remove(), 10800);
  }

  private load(key: string, def: string): string {
    try {
      return localStorage.getItem(key) ?? def;
    } catch {
      return def;
    }
  }
  private save(key: string, v: string): void {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* private browsing */
    }
  }

  get displayNick(): string {
    return this.nick || '플레이어';
  }

  /** 누적 1등 횟수 (브라우저 저장) */
  get wins(): number {
    return Number(this.load('surreal-derby-wins', '0')) || 0;
  }

  addWin(): number {
    const w = this.wins + 1;
    this.save('surreal-derby-wins', String(w));
    return w;
  }

  // ---------------------------------------------------------------- picker

  private buildMountList(): void {
    const list = $('mount-list');
    list.innerHTML = '';
    for (const d of this.defs) {
      const li = document.createElement('li');
      li.dataset.id = d.id;
      li.innerHTML = `<span class="emoji">${d.emoji}</span><div class="txt"><div class="nm">${d.name}</div><div class="en">${d.nameEn}</div></div>`;
      li.addEventListener('click', () => {
        if (this.pickLocked) return;
        this.mountId = d.id;
        this.refreshPick(true);
      });
      list.appendChild(li);
    }
  }

  private buildJockeyList(): void {
    const list = $('jockey-list');
    list.innerHTML = '';
    for (const j of JOCKEYS) {
      const li = document.createElement('li');
      li.dataset.id = j.id;
      li.innerHTML = `<span class="emoji">${j.emoji}</span><div class="txt"><div class="nm">${j.name}</div><div class="en">${j.desc}</div></div><span class="swatch" style="background:${hex(j.silks)}"></span>`;
      li.addEventListener('click', () => {
        if (this.pickLocked) return;
        this.jockeyId = j.id;
        this.refreshPick(true);
      });
      list.appendChild(li);
    }
  }

  private refreshPick(notify: boolean): void {
    const d = this.defs.find((x) => x.id === this.mountId) ?? this.defs[0];
    const j = jockeyById(this.jockeyId);
    $('mount-list').querySelectorAll('li').forEach((li) => li.classList.toggle('active', li.dataset.id === d.id));
    $('jockey-list').querySelectorAll('li').forEach((li) => li.classList.toggle('active', li.dataset.id === j.id));
    $('pick-num').textContent = d.emoji;
    $('pick-num').style.background = hex(d.bodyColor);
    $('pick-name').textContent = d.name;
    $('pick-en').textContent = d.nameEn;
    $('pick-jockey').textContent = `${j.emoji} ${j.name}`;
    $('pick-jockey-desc').textContent = j.desc;
    $('pick-desc').textContent = d.description;
    const stats = $('pick-stats');
    stats.innerHTML = '';
    for (const s of statBars(d, j)) {
      stats.insertAdjacentHTML('beforeend', `<span>${s.label}</span><div class="bar"><i style="width:${Math.round(s.value * 100)}%"></i></div><span class="val">${Math.round(s.value * 100)}</span>`);
    }
    this.save('surreal-derby-mount', d.id);
    this.save('surreal-derby-jockey', j.id);
    if (!this.lobby.classList.contains('hidden')) this.setupPreview(d, j);
    if (notify) this.onPick?.(d.id, j.id);
  }

  /** 레이스 중엔 선택 잠금 */
  lockPick(locked: boolean): void {
    this.pickLocked = locked;
    document.querySelector('.picker')?.classList.toggle('readonly', locked);
  }

  private setupPreview(d: RacerDefinition, j: Jockey): void {
    const canvas = document.getElementById('preview-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    if (!this.previewRenderer) {
      try {
        this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.previewScene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 2.2);
        sun.position.set(4, 8, 5);
        this.previewScene.add(sun);
      } catch {
        this.previewRenderer = null;
        return;
      }
    }
    const rect = canvas.parentElement!.getBoundingClientRect();
    if (rect.width > 0) {
      this.previewRenderer.setSize(rect.width, rect.height, false);
      this.previewCamera.aspect = rect.width / rect.height;
      this.previewCamera.updateProjectionMatrix();
    }
    if (this.previewVisual) {
      this.previewScene.remove(this.previewVisual.root);
      this.previewVisual.dispose();
    }
    this.previewVisual = RacerFactory.createVisual({ ...d, modelUrl: undefined, silksColor: j.silks, clothColor: j.cloth, jockeyHead: j.head });
    this.previewScene.add(this.previewVisual.root);
    const h = this.previewVisual.height;
    // 큰 말(코끼리·트로이)도 프레임에 들어오게 키에 비례해 물러난다
    const dist = THREE.MathUtils.clamp(h * 3.1, 5.5, 12);
    this.previewCamera.position.set(dist, h * 0.9 + 1, dist);
    this.previewCamera.lookAt(0, h * 0.5, 0);
  }

  updatePreview(dt: number): void {
    if (!this.previewRenderer || !this.previewVisual || this.lobby.classList.contains('hidden')) return;
    this.previewCtx.dt = dt;
    this.previewCtx.time += dt;
    this.previewVisual.update(this.previewCtx);
    this.previewVisual.root.rotation.y += dt * 0.6;
    this.previewRenderer.render(this.previewScene, this.previewCamera);
  }

  // ---------------------------------------------------------------- screens

  setLoading(loading: boolean, doneCount = 0, total = 0): void {
    for (const id of ['btn-solo', 'btn-host', 'btn-join']) (document.getElementById(id) as HTMLButtonElement).disabled = loading;
    this.setMenuMsg(loading ? `모델 로딩 중… ${total ? Math.round((doneCount / total) * 100) : 0}%` : '');
  }

  setMenuMsg(text: string): void {
    $('menu-msg').textContent = text;
  }

  showMenu(msg = ''): void {
    this.menu.classList.remove('hidden');
    this.lobby.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.result.classList.add('hidden');
    this.setMenuMsg(msg);
  }

  /** @param code 방 코드 (솔로면 null) */
  showLobby(code: string | null, isHost: boolean): void {
    this.menu.classList.add('hidden');
    this.lobby.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.result.classList.add('hidden');
    $('room-code-wrap').classList.toggle('hidden', !code);
    $('room-code').textContent = code ?? '-----';
    $('lobby-badge').textContent = code ? (isHost ? '방장' : '참가자') : '혼자 달리기';
    $('lobby-title').textContent = code ? '대기실' : '출전 준비';
    $('btn-ready').classList.toggle('hidden', isHost || !code);
    $('btn-race').classList.toggle('hidden', !isHost);
    this.lockPick(false);
    this.refreshPick(false);
    this.setupPreview(this.defs.find((x) => x.id === this.mountId) ?? this.defs[0], jockeyById(this.jockeyId));
  }

  setLobbyMsg(text: string): void {
    $('lobby-msg').textContent = text;
  }

  setReady(v: boolean): void {
    const b = $('btn-ready');
    b.classList.toggle('on', v);
    b.textContent = v ? '준비 완료 ✓' : '준비';
  }

  setStartEnabled(enabled: boolean, label = '레이스 시작'): void {
    const b = $('btn-race') as HTMLButtonElement;
    b.disabled = !enabled;
    b.textContent = label;
  }

  renderLobby(slots: LobbySlot[], mySlot: number, isHost: boolean): void {
    const list = $('slot-list');
    list.innerHTML = '';
    slots.forEach((s, i) => {
      const li = document.createElement('li');
      const empty = !s.human && !s.cpu;
      li.className = (i === mySlot ? 'me ' : '') + (empty ? 'empty' : '');
      const d = this.defs.find((x) => x.id === s.mountId);
      const j = jockeyById(s.jockeyId);
      const badge = i === 0 ? '<span class="badge host">HOST</span>' : s.cpu ? '<span class="badge cpu">CPU</span>' : s.human ? (s.ready ? '<span class="badge ready">READY</span>' : '<span class="badge">대기</span>') : '';
      const wins = s.human ? `<span class="wins" title="누적 1등">🏆 ${s.wins ?? 0}승</span>` : '';
      const kick = isHost && s.human && i !== 0 ? `<button class="kick" data-slot="${i}" title="강퇴">✕</button>` : '';
      li.innerHTML = empty
        ? `<span class="num">${i + 1}</span><div class="txt"><div class="nm">빈 자리</div><div class="sub">시작하면 CPU 가 들어옵니다</div></div>`
        : `<span class="num">${i + 1}</span><div class="txt"><div class="nm">${s.name}${i === mySlot ? ' (나)' : ''}</div><div class="sub">${d ? d.emoji + ' ' + d.name : ''} · ${j.emoji} ${j.name}</div></div>${wins}${badge}${kick}`;
      list.appendChild(li);
    });
    list.querySelectorAll<HTMLButtonElement>('.kick').forEach((b) => b.addEventListener('click', () => this.onKick?.(Number(b.dataset.slot))));
  }

  showHud(): void {
    this.menu.classList.add('hidden');
    this.lobby.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.result.classList.add('hidden');
    this.lastRankKey = '';
    this.lastLap = 0;
    this.setCountdown('');
    $('hud-lap').textContent = '1';
    (document.querySelector('.lap-total') as HTMLElement).textContent = `/${LAPS}`;
  }

  updateHud(h: HudState): void {
    if (h.lap !== this.lastLap) {
      this.lastLap = h.lap;
      $('hud-lap').textContent = String(h.lap);
    }
    $('hud-pos').textContent = String(h.rank);
    $('hud-pos-total').textContent = `/${h.total}`;
    $('hud-speed').textContent = String(Math.round(Math.abs(h.speed) * 3.6));
    $('race-time').textContent = h.time.toFixed(1).padStart(4, '0');
    const fill = $('gauge-fill');
    fill.style.width = `${Math.round(Math.min(1, h.gauge) * 100)}%`;
    const g = fill.parentElement!;
    g.classList.toggle('full', h.boosts >= 2 && !h.boosting);
    g.classList.toggle('boosting', h.boosting);
    const slot = $('item-slot');
    if (slot.textContent !== (h.item || '—')) {
      slot.textContent = h.item || '—';
      slot.classList.toggle('has', !!h.item);
    }
    const slot2 = $('item-slot2');
    if (slot2.textContent !== (h.item2 || '·')) {
      slot2.textContent = h.item2 || '·';
      slot2.classList.toggle('has', !!h.item2);
    }
    for (let i = 0; i < 2; i++) {
      const pip = $(`pip-${i}`);
      pip.classList.toggle('on', h.boosts >= i + 1);
      // 파란 부스터는 먼저 쓰이므로 왼쪽부터 파랗게
      pip.classList.toggle('blue', h.blueBoosts >= i + 1);
    }
    g.classList.toggle('blue', h.boostBlue);
    $('gauge-label').textContent = h.boosting ? (h.boostBlue ? 'BLUE BOOST!!!' : 'BOOST!!') : h.blueBoosts > 0 ? 'SPACE → BLUE BOOST' : h.boosts >= 2 ? 'MAX · 계속 드리프트 → 블루' : h.boosts >= 1 ? 'SPACE → BOOST' : 'DRIFT → 게이지';
    const key = h.order.map((o) => o.name + (o.finished ? '!' : '')).join('|');
    if (key !== this.lastRankKey) {
      this.lastRankKey = key;
      this.rankList.innerHTML = '';
      h.order.forEach((o, i) => {
        const li = document.createElement('li');
        li.className = (i === 0 ? 'leader ' : '') + (o.me ? 'pick ' : '') + (o.finished ? 'finished' : '');
        li.innerHTML = `<span class="pos">${i + 1}</span><span class="name">${o.emoji} ${o.name}</span><span class="gap">${o.finished ? 'FIN' : ''}</span>`;
        this.rankList.appendChild(li);
      });
    }
  }

  setNetInfo(text: string): void {
    $('net-info').textContent = text;
  }

  setCountdown(text: string): void {
    this.countdown.textContent = text;
    this.countdown.classList.remove('pop');
    if (text) {
      void this.countdown.offsetWidth; // 애니메이션 재시작
      this.countdown.classList.add('pop');
    }
  }

  showToast(text: string, ms = 1400): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    void this.toast.offsetWidth;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.add('hidden'), ms);
  }

  showResult(rows: ResultRow[], canRestart: boolean, subtitle = ''): void {
    this.result.classList.remove('hidden');
    $('result-scenario').textContent = subtitle;
    const list = $('result-list');
    list.innerHTML = '';
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.style.animationDelay = `${i * 0.08}s`;
      if (r.me) li.classList.add('me');
      const t = r.time !== null ? r.time.toFixed(2) + 's' : '리타이어';
      li.innerHTML = `<span class="pos">${r.rank}위</span><span class="num">${r.slot + 1}</span><span class="name">${r.name}</span><span class="combo">${r.mountEmoji} ${r.mountName} · ${r.jockeyEmoji} ${r.jockeyName}</span><span class="time">${t}</span>`;
      list.appendChild(li);
    });
    $('btn-again').classList.toggle('hidden', !canRestart);
  }

  hideResult(): void {
    this.result.classList.add('hidden');
  }

  setQuality(high: boolean): void {
    const b = $('btn-quality');
    b.textContent = high ? '고급' : 'HD';
    b.classList.toggle('high', high);
  }

  /** 결과 화면용 행 생성 도우미 */
  resultRows(results: RaceResult[], slots: SlotConfig[], mySlot: number): ResultRow[] {
    return results.map((r) => {
      const cfg = slots[r.slot];
      const d = this.defs.find((x) => x.id === cfg.mountId) ?? this.defs[0];
      const j = jockeyById(cfg.jockeyId);
      return { slot: r.slot, rank: r.rank, name: cfg.name, mountEmoji: d.emoji, mountName: d.name, jockeyEmoji: j.emoji, jockeyName: j.name, time: r.time, me: r.slot === mySlot };
    });
  }
}
