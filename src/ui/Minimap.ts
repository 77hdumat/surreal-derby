import type { TrackGeometry } from '../track/TrackGeometry';
import type { KartState } from '../game/KartPhysics';

export interface MinimapRacer {
  x: number;
  z: number;
  /** 유니폼 색 (#rrggbb) */
  color: string;
  me: boolean;
  finished: boolean;
}

/**
 * 카트라이더식 미니맵: 코스 윤곽을 한 번 그려 두고(오프스크린), 매 프레임 말 점만 얹는다.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private scale = 1;
  private ox = 0;
  private oz = 0;
  private size = 0;

  constructor(canvas: HTMLCanvasElement, private track: TrackGeometry) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.build();
  }

  /** 코스 윤곽(트랙 폭 포함)을 오프스크린에 그린다 */
  build(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const cssSize = this.canvas.clientWidth || 180;
    const size = Math.round(cssSize * dpr);
    this.size = size;
    this.canvas.width = size;
    this.canvas.height = size;
    this.base.width = size;
    this.base.height = size;
    const b = this.track.bounds;
    const pad = size * 0.08;
    const w = b.maxX - b.minX;
    const h = b.maxZ - b.minZ;
    this.scale = (size - pad * 2) / Math.max(w, h);
    this.ox = pad + (size - pad * 2 - w * this.scale) / 2 - b.minX * this.scale;
    this.oz = pad + (size - pad * 2 - h * this.scale) / 2 - b.minZ * this.scale;
    const g = this.base.getContext('2d')!;
    g.clearRect(0, 0, size, size);
    const pts = this.track.samples;
    const path = new Path2D();
    pts.forEach((p, i) => {
      const x = p.x * this.scale + this.ox;
      const y = p.z * this.scale + this.oz;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    // 트랙 폭 (바깥 테두리 + 아스팔트)
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = Math.max(4, this.track.width * this.scale + 3);
    g.stroke(path);
    g.strokeStyle = 'rgba(28,32,40,0.9)';
    g.lineWidth = Math.max(2.5, this.track.width * this.scale);
    g.stroke(path);
    // 출발/결승선
    const f = this.track.getFrame(this.track.finishS);
    const r = f.right;
    const hw = this.track.width / 2;
    g.strokeStyle = '#ffe600';
    g.lineWidth = Math.max(2, 3 * dpr);
    g.beginPath();
    g.moveTo((f.pos.x - r.x * hw) * this.scale + this.ox, (f.pos.z - r.z * hw) * this.scale + this.oz);
    g.lineTo((f.pos.x + r.x * hw) * this.scale + this.ox, (f.pos.z + r.z * hw) * this.scale + this.oz);
    g.stroke();
  }

  /** 매 프레임: 코스 + 말 점 */
  draw(racers: MinimapRacer[], boxes: { x: number; z: number; takenT: number }[] = []): void {
    const ctx = this.ctx;
    const size = this.size;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.base, 0, 0);
    const dpr = size / (this.canvas.clientWidth || 180);
    // 아이템 상자
    ctx.fillStyle = 'rgba(255,210,63,0.9)';
    for (const b of boxes) {
      if (b.takenT >= 0) continue;
      ctx.fillRect(b.x * this.scale + this.ox - 1.5 * dpr, b.z * this.scale + this.oz - 1.5 * dpr, 3 * dpr, 3 * dpr);
    }
    for (const r of racers) {
      const x = r.x * this.scale + this.ox;
      const y = r.z * this.scale + this.oz;
      const rad = (r.me ? 5 : 3.6) * dpr;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = r.finished ? 'rgba(160,160,160,0.7)' : r.color;
      ctx.fill();
      ctx.lineWidth = (r.me ? 2.2 : 1.4) * dpr;
      ctx.strokeStyle = r.me ? '#fff' : 'rgba(0,0,0,0.75)';
      ctx.stroke();
      if (r.me) {
        // 내 점은 링 하나 더
        ctx.beginPath();
        ctx.arc(x, y, rad + 3 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
      }
    }
  }

  /** KartState 배열 → 표시용 */
  static toRacers(karts: KartState[], colors: string[], mySlot: number): MinimapRacer[] {
    return karts.map((k, i) => ({ x: k.x, z: k.z, color: colors[i] ?? '#fff', me: i === mySlot, finished: k.finished }));
  }
}
