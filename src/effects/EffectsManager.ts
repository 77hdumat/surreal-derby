import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { makeGradePass } from './GradePass';
import { N8AOPass } from 'n8ao';

/**
 * 포스트프로세싱(잔상/블룸) + 2D 스피드라인 오버레이.
 */
export class EffectsManager {
  readonly composer: EffectComposer;
  private afterimage: AfterimagePass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private ao: N8AOPass;
  private fxCanvas: HTMLCanvasElement;
  private fxCtx: CanvasRenderingContext2D;
  private afterTarget = 0.1;
  private afterCurrent = 0.1;
  private speedLines = 0;
  private speedLinesTarget = 0;
  private flash = 0;
  private lines: { a: number; len: number; w: number; off: number }[] = [];
  private slowMoTint = 0;
  private highQuality = false;
  private pixelRatio = 1;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, fxCanvas: HTMLCanvasElement) {
    const size = renderer.getSize(new THREE.Vector2());
    this.pixelRatio = renderer.getPixelRatio();
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // 스크린 스페이스 앰비언트 오클루전 — 발밑·접촉면이 땅에 붙어 보이게 (N8AO)
    this.ao = new N8AOPass(scene, camera, size.x, size.y);
    this.ao.configuration.aoRadius = 1.6;
    this.ao.configuration.distanceFalloff = 1.2;
    this.ao.configuration.intensity = 2.2;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.gammaCorrection = false;
    this.ao.setQualityMode('Performance');
    this.ao.enabled = false;
    this.composer.addPass(this.ao);
    // 컬러 그레이딩 (거리 안개는 재질 셰이더의 HSV 안개가 담당)
    this.grade = makeGradePass();
    // 동화책 톤: 채도 살짝 ↑, 크림색 오버레이, 대비 부드럽게
    this.grade.uniforms.uVibrance.value = 0.3;
    this.grade.uniforms.uContrast.value = 0.08;
    this.grade.uniforms.uOverlayAmount.value = 0.1;
    this.grade.uniforms.uOverlay.value = new THREE.Color('#fff4e0');
    this.composer.addPass(this.grade);
    this.afterimage = new AfterimagePass(0.1);
    this.composer.addPass(this.afterimage);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.15, 0.5, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.fxCanvas = fxCanvas;
    this.fxCtx = fxCanvas.getContext('2d')!;
    for (let i = 0; i < 70; i++) {
      this.lines.push({ a: Math.random() * Math.PI * 2, len: 0.2 + Math.random() * 0.5, w: 1 + Math.random() * 2.5, off: Math.random() });
    }
    this.resize(size.x, size.y);
  }

  setCamera(camera: THREE.Camera): void {
    const rp = this.composer.passes[0] as RenderPass;
    rp.camera = camera;
    (this.ao as unknown as { camera: THREE.Camera }).camera = camera;
  }

  resize(w: number, h: number): void {
    this.composer.setSize(w, h);
    // 블룸은 원본보다 낮은 해상도에서도 형태 차이가 거의 없다.
    const bloomScale = this.highQuality ? 0.65 : 0.4;
    this.bloom.setSize(w * this.pixelRatio * bloomScale, h * this.pixelRatio * bloomScale);
    this.fxCanvas.width = Math.floor(w * this.pixelRatio);
    this.fxCanvas.height = Math.floor(h * this.pixelRatio);
  }

  /** 고급 모드도 AO는 반 해상도로 유지해 프레임 급락을 막고 샘플 품질만 높인다. */
  setHighQuality(high: boolean, pixelRatio: number): void {
    this.highQuality = high;
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    // AO 는 가장 비싼 패스 — 고급 모드에서만, 그것도 Performance 프리셋·반 해상도로
    this.ao.enabled = false; // 동화책 톤: 접촉 그림자는 그림자맵으로 충분
    this.ao.setQualityMode('Performance');
    this.ao.configuration.halfRes = true;
    this.ao.configuration.transparencyAware = false;
  }

  /** 잔상 강도 0..1 (0.1 = 거의 없음, 1 = 매우 강함) */
  setAfterimage(intensity: number): void {
    this.afterTarget = THREE.MathUtils.lerp(0.08, 0.93, THREE.MathUtils.clamp(intensity, 0, 1));
  }

  setSpeedLines(intensity: number): void {
    this.speedLinesTarget = THREE.MathUtils.clamp(intensity, 0, 1);
  }

  setSlowMo(v: number): void {
    this.slowMoTint = v;
  }

  flashScreen(strength = 1): void {
    this.flash = Math.max(this.flash, strength);
  }

  update(dt: number, cameraVelocity: number): void {
    this.afterCurrent = THREE.MathUtils.lerp(this.afterCurrent, this.afterTarget, Math.min(1, dt * 6));
    (this.afterimage.uniforms as { damp: { value: number } }).damp.value = this.afterCurrent;
    this.bloom.strength = 0.22 + this.speedLines * 0.15;
    this.speedLines = THREE.MathUtils.lerp(this.speedLines, this.speedLinesTarget, Math.min(1, dt * 5));
    this.flash = Math.max(0, this.flash - dt * 3);
    this.drawOverlay(dt, cameraVelocity);
  }

  private drawOverlay(dt: number, camVel: number): void {
    const ctx = this.fxCtx;
    const w = this.fxCanvas.width;
    const h = this.fxCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const s = this.speedLines + THREE.MathUtils.clamp((camVel - 25) / 60, 0, 0.4);
    if (s > 0.02) {
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.hypot(w, h) / 2;
      ctx.lineCap = 'round';
      for (const l of this.lines) {
        l.off = (l.off + dt * (3 + s * 6)) % 1;
        const inner = R * (0.35 + (1 - s) * 0.3 + l.off * 0.2);
        const outer = inner + R * l.len * s;
        const x1 = cx + Math.cos(l.a) * inner;
        const y1 = cy + Math.sin(l.a) * inner;
        const x2 = cx + Math.cos(l.a) * outer;
        const y2 = cy + Math.sin(l.a) * outer;
        ctx.strokeStyle = `rgba(255,255,255,${0.18 * s})`;
        ctx.lineWidth = l.w * s;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    if (this.slowMoTint > 0.01) {
      ctx.fillStyle = `rgba(120,160,255,${0.12 * this.slowMoTint})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.8})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  render(): void {
    this.composer.render();
  }
}
