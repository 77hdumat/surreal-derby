import type { TrackGeometry } from '../track/TrackGeometry';

export interface MinimapRacer {
  x: number;
  z: number;
  /** 유니폼 색 (#rrggbb) */
  color: string;
  me: boolean;
  finished: boolean;
}

/**
 * 카트라이더식 미니맵: 코스 윤곽을 오프스크린에 한 번 그려 두고, 매 프레임 말 점만 얹는다.
 */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base = document.createElement('canvas');
  private scale = 1;
  private ox = 0;
  private oz = 0;
  private size = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private track: TrackGeometry,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.build();
  }

  /** 코스 윤곽(트랙 폭 포함)을 오프스크린에 그린다. 크기가 바뀌면 다시 호출 */
  build(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const cssSize = this.canvas.clientWidth || 190;
    const size = Math.round(cssSize * dpr);
    this.size = size;
    this.canvas.width = this.canvas.height = size;
    this.base.width = this.base.height = size;
    const b = this.track.bounds;
    const pad = size * 0.08;
    const w = b.maxX - b.minX;
    const h = b.maxZ - b.minZ;
    this.scale = (size - pad * 2) / Math.max(w, h);
    this.ox = pad + (size - pad * 2 - w * this.scale) / 2 - b.minX * this.scale;
    this.oz = pad + (size - pad * 2 - h * this.scale) / 2 - b.minZ * this.scale;
    const g = this.base.getContext('2d')!;
    g.clearRect(0, 0, size, size);
    const path = new Path2D();
    this.track.samples.forEach((p, i) => {
      const x = p.x * this.scale + this.ox;
      const y = p.z * this.scale + this.oz;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = Math.max(4, this.track.width * this.scale + 3 * dpr);
    g.stroke(path);
    g.strokeStyle = 'rgba(40,46,58,0.92)';
    g.lineWidth = Math.max(2.5, this.track.width * this.scale);
    g.stroke(path);
    // 출발/결승선
    const f = this.track.getFrame(this.track.finishS);
    const hw = this.track.width / 2 + 2;
    g.strokeStyle = '#ffe600';
    g.lineWidth = Math.max(2, 3 * dpr);
    g.beginPath();
    g.moveTo((f.pos.x - f.right.x * hw) * this.scale + this.ox, (f.pos.z - f.right.z * hw) * this.scale + this.oz);
    g.lineTo((f.pos.x + f.right.x * hw) * this.scale + this.ox, (f.pos.z + f.right.z * hw) * this.scale + this.oz);
    g.stroke();
  }

  /** 매 프레임: 코스 + (아이템 상자) + 말 점. 내 점은 가장 위에 */
  draw(racers: MinimapRacer[], boxes: { x: number; z: number; takenT: number }[] = []): void {
    const ctx = this.ctx;
    const size = this.size;
    const dpr = size / (this.canvas.clientWidth || 190);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.base, 0, 0);
    ctx.fillStyle = 'rgba(255,210,63,0.95)';
    for (const b of boxes) {
      if (b.takenT >= 0) continue;
      ctx.fillRect(b.x * this.scale + this.ox - 1.5 * dpr, b.z * this.scale + this.oz - 1.5 * dpr, 3 * dpr, 3 * dpr);
    }
    const ordered = [...racers].sort((a, b) => Number(a.me) - Number(b.me));
    for (const r of ordered) {
      const x = r.x * this.scale + this.ox;
      const y = r.z * this.scale + this.oz;
      const rad = (r.me ? 5 : 3.6) * dpr;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = r.finished ? 'rgba(170,170,170,0.75)' : r.color;
      ctx.fill();
      ctx.lineWidth = (r.me ? 2.2 : 1.4) * dpr;
      ctx.strokeStyle = r.me ? '#fff' : 'rgba(0,0,0,0.75)';
      ctx.stroke();
      if (r.me) {
        ctx.beginPath();
        ctx.arc(x, y, rad + 3 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
      }
    }
  }
}
