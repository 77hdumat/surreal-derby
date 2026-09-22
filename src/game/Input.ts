import type { KartInput } from './KartPhysics';

/**
 * 키보드 + 터치 버튼 → KartInput.
 * ↑/W 가속, ↓/S 브레이크·후진, ←→/A D 조향, Shift 드리프트, Ctrl 부스트.
 * 터치: #touch 안의 [data-key] 버튼 (left/right/gas/brake/drift/boost).
 */
export class InputManager {
  readonly input: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };
  private keys = new Set<string>();
  private touch = new Set<string>();
  private attached = false;
  /** 조향은 급격히 튀지 않게 부드럽게 (초당 도달 비율) */
  private steerCur = 0;

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
    const k = this.mapKey(e.code);
    if (!k) return;
    this.keys.add(k);
    e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    const k = this.mapKey(e.code);
    if (k) this.keys.delete(k);
  };
  private onBlur = () => {
    this.keys.clear();
    this.touch.clear();
  };

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private mapKey(code: string): string | null {
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        return 'gas';
      case 'ArrowDown':
      case 'KeyS':
        return 'brake';
      case 'ArrowLeft':
      case 'KeyA':
        return 'left';
      case 'ArrowRight':
      case 'KeyD':
        return 'right';
      case 'ShiftLeft':
      case 'ShiftRight':
        return 'drift';
      case 'ControlLeft':
      case 'ControlRight':
        return 'boost';
      default:
        return null;
    }
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    const touch = document.getElementById('touch');
    if (touch) {
      touch.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
        const key = el.dataset.key!;
        const down = (e: Event) => {
          e.preventDefault();
          this.touch.add(key);
          el.classList.add('down');
        };
        const up = (e: Event) => {
          e.preventDefault();
          this.touch.delete(key);
          el.classList.remove('down');
        };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', up);
        el.addEventListener('contextmenu', (e) => e.preventDefault());
      });
    }
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.keys.clear();
    this.touch.clear();
  }

  private has(k: string): boolean {
    return this.keys.has(k) || this.touch.has(k);
  }

  /** 매 프레임 호출 → this.input 갱신 */
  update(dt: number): KartInput {
    const i = this.input;
    const target = (this.has('right') ? 1 : 0) - (this.has('left') ? 1 : 0);
    const rate = target === 0 ? 12 : 9;
    this.steerCur += (target - this.steerCur) * Math.min(1, rate * dt);
    if (Math.abs(this.steerCur) < 0.01) this.steerCur = 0;
    i.steer = this.steerCur;
    i.throttle = this.has('gas') ? 1 : 0;
    i.brake = this.has('brake') ? 1 : 0;
    i.drift = this.has('drift');
    i.boost = this.has('boost');
    return i;
  }

  clear(): void {
    this.keys.clear();
    this.touch.clear();
    this.steerCur = 0;
    this.input.steer = 0;
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.drift = false;
    this.input.boost = false;
  }
}
