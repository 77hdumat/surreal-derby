import * as THREE from 'three';

export interface EmitOptions {
  pos: THREE.Vector3;
  count: number;
  /** 기본 속도 */
  vel?: THREE.Vector3;
  /** 랜덤 속도 폭 */
  spread?: number;
  size?: number;
  sizeVar?: number;
  life?: number;
  lifeVar?: number;
  colors?: number[];
  gravity?: number;
  drag?: number;
  /** 초당 크기 증가 */
  grow?: number;
  alpha?: number;
}

/**
 * Object pooling 기반 파티클. 단일 THREE.Points 로 모든 파티클을 그린다.
 */
export class ParticleManager {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private grow: Float32Array;
  private gravity: Float32Array;
  private drag: Float32Array;
  private baseAlpha: Float32Array;
  private colors: Float32Array;
  private alphaAttr: Float32Array;
  private sizeAttr: Float32Array;
  private free: number[] = [];
  private active = new Set<number>();
  private geo: THREE.BufferGeometry;
  private tmp = new THREE.Vector3();
  private tmpColor = new THREE.Color();

  constructor(max = 3000) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    this.colors = new Float32Array(max * 3);
    this.alphaAttr = new Float32Array(max);
    this.sizeAttr = new Float32Array(max);
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
    // 화면 밖으로
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1000;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.sizeAttr, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('palpha', new THREE.BufferAttribute(this.alphaAttr, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vColor = pcolor; vAlpha = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * (280.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  get activeCount(): number {
    return this.active.size;
  }

  emit(o: EmitOptions): void {
    const colors = o.colors ?? [0xc9a97a];
    const spread = o.spread ?? 1;
    for (let k = 0; k < o.count; k++) {
      const i = this.free.pop();
      if (i === undefined) return;
      this.active.add(i);
      const p = o.pos;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = p.y + Math.random() * 0.2;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.3;
      const v = o.vel ?? this.tmp.set(0, 0, 0);
      this.vel[i * 3] = v.x + (Math.random() - 0.5) * spread * 2;
      this.vel[i * 3 + 1] = v.y + Math.random() * spread;
      this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * spread * 2;
      const life = (o.life ?? 0.8) + (Math.random() - 0.5) * (o.lifeVar ?? 0.3);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.size[i] = (o.size ?? 0.5) + Math.random() * (o.sizeVar ?? 0.3);
      this.grow[i] = o.grow ?? 0.5;
      this.gravity[i] = o.gravity ?? 0.5;
      this.drag[i] = o.drag ?? 1.5;
      this.baseAlpha[i] = o.alpha ?? 0.7;
      this.tmpColor.setHex(colors[Math.floor(Math.random() * colors.length)]);
      this.tmpColor.offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
      this.colors[i * 3] = this.tmpColor.r;
      this.colors[i * 3 + 1] = this.tmpColor.g;
      this.colors[i * 3 + 2] = this.tmpColor.b;
    }
  }

  update(dt: number): void {
    for (const i of this.active) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.active.delete(i);
        this.free.push(i);
        this.pos[i * 3 + 1] = -1000;
        this.alphaAttr[i] = 0;
        continue;
      }
      const dragF = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dragF;
      this.vel[i * 3 + 2] *= dragF;
      this.vel[i * 3 + 1] -= this.gravity[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) {
        this.pos[i * 3 + 1] = 0.05;
        this.vel[i * 3 + 1] *= -0.2;
      }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alphaAttr[i] = this.baseAlpha[i] * Math.min(1, t * 2.5);
      this.sizeAttr[i] = this.size[i];
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.pcolor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.palpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (const i of this.active) {
      this.free.push(i);
      this.pos[i * 3 + 1] = -1000;
      this.alphaAttr[i] = 0;
    }
    this.active.clear();
  }

  // ---------------------------------------------------------------- presets

  hoofDust(pos: THREE.Vector3, backward: THREE.Vector3, strength: number): void {
    this.emit({
      pos,
      count: Math.round(1 + strength * 3),
      vel: this.tmp.copy(backward).multiplyScalar(2 + strength * 3).setY(1.2 + strength),
      spread: 1.2,
      size: 0.35,
      sizeVar: 0.4,
      life: 0.7,
      colors: [0xb08a5a, 0x9c7a4c, 0x6fbf4a, 0x8bd45e],
      gravity: 1.2,
      grow: 0.9,
      alpha: 0.55,
    });
  }

  exhaust(pos: THREE.Vector3, backward: THREE.Vector3, boost: boolean): void {
    this.emit({
      pos,
      count: boost ? 6 : 2,
      vel: this.tmp.copy(backward).multiplyScalar(boost ? 10 : 3).setY(0.6),
      spread: boost ? 1.8 : 0.8,
      size: boost ? 0.7 : 0.4,
      sizeVar: 0.4,
      life: boost ? 0.9 : 0.6,
      colors: boost ? [0xffa030, 0xff6a00, 0x888888, 0xdddddd] : [0xaaaaaa, 0xcccccc],
      gravity: -0.6,
      drag: 2,
      grow: boost ? 2.5 : 1.5,
      alpha: boost ? 0.8 : 0.45,
    });
  }

  blackSmoke(pos: THREE.Vector3): void {
    this.emit({
      pos,
      count: 4,
      vel: this.tmp.set(0, 2, 0),
      spread: 1,
      size: 0.6,
      sizeVar: 0.5,
      life: 1.4,
      colors: [0x222222, 0x333333, 0x444444],
      gravity: -1.2,
      drag: 1.5,
      grow: 1.8,
      alpha: 0.8,
    });
  }

  impact(pos: THREE.Vector3, strength = 1): void {
    this.emit({
      pos,
      count: Math.round(25 * strength),
      vel: this.tmp.set(0, 3, 0),
      spread: 4 * strength,
      size: 0.6,
      sizeVar: 0.6,
      life: 1.0,
      lifeVar: 0.5,
      colors: [0xc9a97a, 0xb08a5a, 0xe0d0b0],
      gravity: 2,
      drag: 2,
      grow: 1.6,
      alpha: 0.75,
    });
  }

  cardboard(pos: THREE.Vector3): void {
    this.emit({
      pos,
      count: 40,
      vel: this.tmp.set(0, 5, 0),
      spread: 5,
      size: 0.35,
      sizeVar: 0.35,
      life: 1.6,
      lifeVar: 0.8,
      colors: [0xc9964f, 0xd9b27a, 0xa87838, 0xf0e0c0],
      gravity: 6,
      drag: 1.2,
      grow: 0,
      alpha: 1,
    });
    this.impact(pos, 1.2);
  }

  steam(pos: THREE.Vector3, forward: THREE.Vector3): void {
    this.emit({
      pos,
      count: 3,
      vel: this.tmp.copy(forward).multiplyScalar(2.5).setY(0.8),
      spread: 0.8,
      size: 0.25,
      sizeVar: 0.2,
      life: 0.5,
      colors: [0xffffff, 0xeeeeee],
      gravity: -1.5,
      drag: 2,
      grow: 1.6,
      alpha: 0.7,
    });
  }

  sweat(pos: THREE.Vector3): void {
    this.emit({
      pos,
      count: 2,
      vel: this.tmp.set(0, 2.5, 0),
      spread: 2,
      size: 0.14,
      sizeVar: 0.08,
      life: 0.6,
      colors: [0x7fd4ff, 0xbfefff],
      gravity: 8,
      drag: 0.5,
      grow: 0,
      alpha: 0.95,
    });
  }

  sparkle(pos: THREE.Vector3): void {
    this.emit({
      pos,
      count: 20,
      vel: this.tmp.set(0, 4, 0),
      spread: 4,
      size: 0.25,
      sizeVar: 0.2,
      life: 0.8,
      colors: [0xffffff, 0xffe14d, 0x9cf5ff],
      gravity: 3,
      drag: 1,
      grow: 0,
      alpha: 1,
    });
  }
}
