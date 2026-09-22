import Peer, { type DataConnection } from 'peerjs';
import type { NetMsg } from './Protocol';

/**
 * PeerJS 방코드 매칭, 호스트 권위 스타형. dempsey-boxing 의 Net.js 를 TS 로 옮겼다 (호스트 승계는 뺌).
 *
 * '빠른 채널': ordered:false + maxRetransmits:0 → 유실 패킷 재전송 없음.
 * PeerJS 기본 채널은 reliable:false 여도 SCTP 재전송이 붙어 손실 시 지연이 튄다.
 * 스냅샷·입력처럼 다음 것이 오면 이전 것이 필요 없는 데이터는 빠른 채널, 로비·이벤트는 기본 채널.
 */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'surreal-derby-';
const FAST_LABEL = 'fast';

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/** 단기 TURN 자격증명 발급 엔드포인트 (Cloudflare Worker). 없으면 STUN 만 */
export const TURN_ENDPOINT = 'https://the-fighting-turn.77hdumat.workers.dev/turn';

export type NetError = { type: string; detail?: unknown; withTurn?: boolean };

interface GuestStat {
  div: number;
  sent: number;
  drop: number;
  t0: number;
  calm: number;
  seq: number;
}

interface GuestConn {
  c: DataConnection;
  fast: RTCDataChannel | null;
  lastRx: number;
  hb: boolean;
  stat: GuestStat;
  evq: unknown[] | null;
}

function bindFast(ch: RTCDataChannel, onMsg: (m: NetMsg) => void): RTCDataChannel {
  ch.binaryType = 'arraybuffer';
  ch.onmessage = (e) => {
    let m: NetMsg;
    try {
      m = JSON.parse(e.data as string);
    } catch {
      return;
    }
    onMsg(m);
  };
  ch.onerror = () => {};
  return ch;
}

/**
 * PeerJS 는 peerConnection.ondatachannel 을 가로채 자기 채널로 바꿔치기하므로,
 * 상대가 빠른 채널을 만들기 전에 핸들러를 감싸 둔다.
 */
function guardDataChannel(conn: DataConnection, onFast: (ch: RTCDataChannel) => void): void {
  const pc = conn.peerConnection;
  if (!pc) return;
  const orig = pc.ondatachannel;
  pc.ondatachannel = (evt) => {
    if (evt.channel && evt.channel.label === FAST_LABEL) onFast(evt.channel);
    else if (orig) orig.call(pc, evt);
  };
}

export class Net {
  peer: Peer | null = null;
  role: 'none' | 'host' | 'client' = 'none';
  /** host: 슬롯 1.. (index = slot-1) */
  private guests: (GuestConn | null)[] = [];
  /** client */
  private conn: DataConnection | null = null;
  private fast: RTCDataChannel | null = null;
  code = '';
  mySlot = 0;
  rtt = 0;
  withTurn = true;
  fastOpen = false;
  pathType = '';

  onMessage: ((m: NetMsg, fromSlot: number) => void) | null = null;
  onJoin: ((slot: number) => void) | null = null;
  onLeave: ((slot: number) => void) | null = null;
  onOpen: ((code: string) => void) | null = null;
  onError: ((e: NetError) => void) | null = null;

  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private joinT: ReturnType<typeof setTimeout> | null = null;
  private reconnT: ReturnType<typeof setTimeout> | null = null;
  private unwake: (() => void) | null = null;

  static HB_INTERVAL = 1000;
  static HB_TIMEOUT = 8000;
  static JOIN_TIMEOUT = 12000;
  static CONGESTED_BYTES = 3000;

  private static turnServers: RTCIceServer[] = [];
  private static turnFetch: Promise<void> | null = null;

  static iceServers(withTurn = true): RTCIceServer[] {
    const list: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
    if (!withTurn) return list;
    for (const t of Net.turnServers) {
      const urls = (Array.isArray(t.urls) ? t.urls : [t.urls]).filter((u) => (/^turn:/.test(u) && !/transport=tcp/.test(u)) || /^stun:/.test(u));
      if (urls.length) list.push({ ...t, urls });
    }
    return list;
  }

  /** 페이지 로드 직후 한 번. 실패해도 STUN 만으로 계속 */
  static fetchTurn(): Promise<void> {
    if (Net.turnFetch) return Net.turnFetch;
    const noturn = typeof location !== 'undefined' && /[?&]noturn/.test(location.search);
    Net.turnFetch = noturn
      ? Promise.resolve()
      : fetch(TURN_ENDPOINT, { cache: 'no-store' })
          .then((r) => r.json())
          .then((j: { iceServers?: RTCIceServer[] }) => {
            Net.turnServers = (j?.iceServers ?? []).filter((s) => s && s.urls);
          })
          .catch(() => {});
    return Net.turnFetch;
  }

  private mkPeer(id: string | undefined, withTurn: boolean): Peer {
    this.withTurn = withTurn;
    const peer = new Peer(id as string, {
      debug: 1,
      pingInterval: 5000,
      config: { iceServers: Net.iceServers(withTurn), iceCandidatePoolSize: 4 },
    });
    // 시그널링이 끊기면(화면 꺼짐·망 전환) 맺은 P2P 는 살아 있지만 새 참가가 안 된다 → 자동 재연결
    const tryReconnect = () => {
      if (!peer.destroyed && this.peer === peer && peer.disconnected) {
        try {
          peer.reconnect();
        } catch {
          /* ignore */
        }
      }
    };
    peer.on('disconnected', () => {
      if (peer.destroyed || this.peer !== peer) return;
      if (this.reconnT) clearTimeout(this.reconnT);
      this.reconnT = setTimeout(tryReconnect, 1200);
    });
    const wake = () => {
      if (document.visibilityState === 'visible') tryReconnect();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    this.unwake = () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
    return peer;
  }

  host(maxClients = 3): void {
    this.role = 'host';
    void Net.fetchTurn().then(() => {
      if (this.role !== 'host' || this.peer) return;
      this.code = makeCode();
      const myCode = this.code;
      const peer = this.mkPeer(PREFIX + myCode, true);
      this.peer = peer;
      let opened = false;
      peer.on('open', () => {
        if (opened) return;
        opened = true;
        this.onOpen?.(myCode);
      });
      peer.on('error', (e) => {
        const type = (e as { type?: string }).type ?? 'error';
        if (type === 'unavailable-id' && !opened) {
          // 겹친 코드 → 새 코드로
          peer.destroy();
          this.peer = null;
          this.host(maxClients);
          return;
        }
        this.onError?.({ type, detail: e });
      });
      peer.on('connection', (c) => {
        let idx = this.guests.findIndex((g) => !g);
        if (idx === -1) idx = this.guests.length;
        if (idx >= maxClients) {
          c.on('open', () => {
            c.send({ t: 'full', why: 'slots' } satisfies NetMsg);
            setTimeout(() => c.close(), 300);
          });
          return;
        }
        const g: GuestConn = { c, fast: null, lastRx: performance.now(), hb: false, stat: { div: 1, sent: 0, drop: 0, t0: performance.now(), calm: 0, seq: 0 }, evq: null };
        this.guests[idx] = g;
        const slot = idx + 1;
        c.on('open', () => {
          guardDataChannel(c, (ch) => {
            g.fast = bindFast(ch, (m) => {
              g.lastRx = performance.now();
              this.onMessage?.(m, slot);
            });
          });
          c.send({ t: 'welcome', slot } satisfies NetMsg);
          this.onJoin?.(slot);
        });
        c.on('data', (raw) => {
          const m = raw as NetMsg;
          g.lastRx = performance.now();
          if (m && m.t === 'hb') {
            g.hb = true;
            try {
              c.send({ t: 'hb', t0: m.t0 } satisfies NetMsg);
            } catch {
              /* ignore */
            }
            return;
          }
          this.onMessage?.(m, slot);
        });
        const gone = () => {
          if (this.guests[idx] !== g) return;
          this.guests[idx] = null;
          this.onLeave?.(slot);
        };
        c.on('close', gone);
        c.on('error', gone);
        c.on('iceStateChanged', (st) => {
          if (st === 'failed' || st === 'closed') {
            try {
              c.close();
            } catch {
              /* ignore */
            }
            gone();
          }
        });
      });
      // 하트비트가 끊긴 게스트 정리 (탭 종료는 WebRTC 가 30초 넘게 걸려야 알아챈다)
      this.hbTimer = setInterval(() => {
        const now = performance.now();
        this.guests.forEach((g, i) => {
          if (g && g.hb && now - g.lastRx > Net.HB_TIMEOUT) {
            try {
              g.c.close();
            } catch {
              /* ignore */
            }
            if (this.guests[i] === g) {
              this.guests[i] = null;
              this.onLeave?.(i + 1);
            }
          }
        });
      }, 2000);
    });
  }

  join(code: string, withTurn = false): void {
    this.role = 'client';
    this.code = code.toUpperCase().trim();
    void Net.fetchTurn().then(() => {
      if (this.role !== 'client' || this.peer) return;
      const peer = this.mkPeer(undefined, withTurn);
      this.peer = peer;
      let opened = false;
      // 직결(STUN)은 7초, TURN 포함은 12초 안에 안 열리면 timeout
      this.joinT = setTimeout(() => {
        if (!opened) this.onError?.({ type: 'timeout', withTurn });
      }, withTurn ? Net.JOIN_TIMEOUT : 7000);
      peer.on('open', () => {
        const c = peer.connect(PREFIX + this.code, { serialization: 'json', reliable: false });
        this.conn = c;
        let lastRx = performance.now();
        c.on('open', () => {
          opened = true;
          if (this.joinT) clearTimeout(this.joinT);
          lastRx = performance.now();
          if (this.hbTimer) clearInterval(this.hbTimer);
          this.hbTimer = setInterval(() => {
            if (this.conn !== c) {
              if (this.hbTimer) clearInterval(this.hbTimer);
              return;
            }
            if (!c.open) return;
            try {
              c.send({ t: 'hb', t0: performance.now() } satisfies NetMsg);
            } catch {
              /* ignore */
            }
            if (performance.now() - lastRx > Net.HB_TIMEOUT) {
              if (this.hbTimer) clearInterval(this.hbTimer);
              try {
                c.close();
              } catch {
                /* ignore */
              }
            }
          }, Net.HB_INTERVAL);
          this.onOpen?.(this.code);
        });
        c.on('data', (raw) => {
          const m = raw as NetMsg;
          lastRx = performance.now();
          if (m && m.t === 'hb') {
            const r = performance.now() - m.t0;
            this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
            return;
          }
          if (m.t === 'welcome') {
            this.mySlot = m.slot;
            this.openFast(c);
          }
          this.onMessage?.(m, 0);
        });
        c.on('close', () => {
          if (this.hbTimer) clearInterval(this.hbTimer);
          this.onError?.({ type: 'closed' });
        });
        c.on('error', (e) => this.onError?.({ type: 'conn-error', detail: e }));
        c.on('iceStateChanged', (st) => {
          if (st === 'failed' || st === 'closed') {
            try {
              c.close();
            } catch {
              /* ignore */
            }
          }
        });
      });
      peer.on('error', (e) => this.onError?.({ type: (e as { type?: string }).type ?? 'error', detail: e }));
    });
  }

  /** 클라: 호스트 연결 위에 UDP 식 채널을 하나 더 (실패해도 기본 채널로 동작) */
  private openFast(c: DataConnection): void {
    try {
      const pc = c.peerConnection;
      if (!pc || this.fast) return;
      const ch = pc.createDataChannel(FAST_LABEL, { ordered: false, maxRetransmits: 0 });
      this.fast = bindFast(ch, (m) => this.onMessage?.(m, 0));
      ch.onopen = () => {
        this.fastOpen = true;
      };
      ch.onclose = () => {
        this.fastOpen = false;
        this.fast = null;
      };
    } catch {
      /* 지원 안 함 → 기본 채널 */
    }
  }

  /** 연결 경로 (direct / relay) — HUD 표시용 */
  async probePath(): Promise<string> {
    const c = this.role === 'client' ? this.conn : this.guests.find((g) => g && g.c.open)?.c;
    const pc = c?.peerConnection;
    if (!pc || !pc.getStats) return this.pathType;
    try {
      const stats = await pc.getStats();
      let pair: RTCIceCandidatePairStats | null = null;
      stats.forEach((r) => {
        const s = r as RTCIceCandidatePairStats;
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || !pair)) pair = s;
      });
      if (pair) {
        const p = pair as RTCIceCandidatePairStats;
        const lc = stats.get(p.localCandidateId) as { candidateType?: string } | undefined;
        const rc = stats.get(p.remoteCandidateId) as { candidateType?: string } | undefined;
        this.pathType = lc?.candidateType === 'relay' || rc?.candidateType === 'relay' ? 'relay' : 'direct';
      }
    } catch {
      /* ignore */
    }
    return this.pathType;
  }

  /** host → 모든 클라 (신뢰) */
  broadcast(msg: NetMsg): void {
    for (const g of this.guests) {
      if (!g || !g.c.open) continue;
      try {
        g.c.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  /** host → 특정 슬롯 제외 전원 (신뢰) */
  broadcastExcept(slot: number, msg: NetMsg): void {
    this.guests.forEach((g, i) => {
      if (!g || !g.c.open || i + 1 === slot) return;
      try {
        g.c.send(msg);
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * host → 모든 클라, 버릴 수 있는 메시지(스냅샷). 회선이 느린 게스트에겐 큐에 쌓지 않고 건너뛴다.
   * 게스트별 적응 주기: 최근 1초 드롭이 10% 넘으면 주기를 절반으로(최대 1/4), 3초간 드롭 0 이면 복구.
   */
  broadcastDroppable(msg: NetMsg): void {
    const now = performance.now();
    let serialized: string | null = null;
    for (const g of this.guests) {
      if (!g || !g.c.open) continue;
      const st = g.stat;
      if (now - st.t0 > 1000) {
        const tot = st.sent + st.drop;
        if (tot && st.drop / tot > 0.1) {
          st.div = Math.min(4, st.div * 2);
          st.calm = 0;
        } else if (st.drop === 0) {
          st.calm += 1;
          if (st.calm >= 3 && st.div > 1) {
            st.div = Math.max(1, st.div / 2);
            st.calm = 0;
          }
        }
        st.sent = 0;
        st.drop = 0;
        st.t0 = now;
      }
      st.seq++;
      if (st.div > 1 && st.seq % st.div !== 0) continue;
      const fast = g.fast && g.fast.readyState === 'open' ? g.fast : null;
      const dc = fast ?? g.c.dataChannel;
      if (dc && dc.bufferedAmount > Net.CONGESTED_BYTES) {
        st.drop++;
        continue;
      }
      try {
        if (fast) fast.send((serialized ??= JSON.stringify(msg)));
        else g.c.send(msg);
        st.sent++;
      } catch {
        /* ignore */
      }
    }
  }

  /** client → host (신뢰) */
  send(msg: NetMsg): void {
    if (this.conn && this.conn.open) {
      try {
        this.conn.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  /** client → host, 빠른 채널 우선 (입력처럼 다음 것으로 대체되는 데이터) */
  sendFast(msg: NetMsg): void {
    const c = this.conn;
    if (!c || !c.open) return;
    const f = this.fast;
    const channel = f && f.readyState === 'open' ? f : c.dataChannel;
    if (channel && channel.bufferedAmount > Net.CONGESTED_BYTES) return;
    if (f && f.readyState === 'open') {
      try {
        f.send(JSON.stringify(msg));
        return;
      } catch {
        /* fall through */
      }
    }
    try {
      c.send(msg);
    } catch {
      /* ignore */
    }
  }

  /** host: 강퇴 */
  kick(slot: number): void {
    const g = this.guests[slot - 1];
    if (!g) return;
    try {
      g.c.send({ t: 'kicked' } satisfies NetMsg);
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (this.guests[slot - 1] === g) {
        this.guests[slot - 1] = null;
        this.onLeave?.(slot);
      }
      try {
        g.c.close();
      } catch {
        /* ignore */
      }
    }, 150);
  }

  get connectedSlots(): number[] {
    const r: number[] = [];
    this.guests.forEach((g, i) => {
      if (g && g.c.open) r.push(i + 1);
    });
    return r;
  }

  close(): void {
    // 콜백 먼저 끊는다 — destroy 중 나오는 close/error 이벤트가 새 Net 의 상태를 건드리지 않게
    this.onMessage = this.onJoin = this.onLeave = this.onOpen = this.onError = null;
    if (this.joinT) clearTimeout(this.joinT);
    if (this.reconnT) clearTimeout(this.reconnT);
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.unwake?.();
    this.unwake = null;
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
    this.guests = [];
    this.conn = null;
    this.fast = null;
    this.role = 'none';
  }
}
