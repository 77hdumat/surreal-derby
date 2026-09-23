import * as THREE from 'three';

/**
 * 드리프트 스키드 마크: 미끄러지는 동안 뒷발 두 줄이 땅을 긁고 지나간 자국.
 * 사각형 조각을 링 버퍼로 이어 붙이고, 셰이더에서 나이에 따라 서서히 사라지게 한다.
 */
const LIFE = 7; // 초
const Y = 0.018;

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly birth: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly birthAttr: THREE.BufferAttribute;
  private readonly mat: THREE.ShaderMaterial;
  private next = 0;
  private dirty = false;
  /** 줄별 마지막 점 (선수id·줄 → 좌/우 가장자리) */
  private last = new Map<string, { x: number; z: number; lx: number; lz: number; rx: number; rz: number }>();

  constructor(capacity = 3000) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 4 * 3);
    this.birth = new Float32Array(capacity * 4).fill(-1e6);
    const idx = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.birthAttr = new THREE.BufferAttribute(this.birth, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.birthAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aBirth', this.birthAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide, // 조각 방향(좌/우 순서)에 상관없이 보이게
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aBirth; uniform float uTime; varying float vA;
        void main(){
          float age = uTime - aBirth;
          vA = clamp(1.0 - age / ${LIFE.toFixed(1)}, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying float vA;
        void main(){
          if (vA <= 0.0) discard;
          // 흙이 긁힌 짙은 갈색 (동화책 톤이라 새까맣지 않게)
          gl_FragColor = vec4(0.32, 0.2, 0.12, 0.5 * vA);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /**
   * 한 줄의 현재 점을 넘긴다. 미끄러지는 동안 매 프레임 호출, 멈추면 end() 로 줄을 끊는다.
   * @param width 자국 폭 (m)
   */
  add(key: string, x: number, z: number, dirX: number, dirZ: number, width: number, time: number): void {
    const len = Math.hypot(dirX, dirZ) || 1;
    // 진행 방향에 수직인 폭 벡터
    const px = (-dirZ / len) * width * 0.5;
    const pz = (dirX / len) * width * 0.5;
    const cur = { x, z, lx: x + px, lz: z + pz, rx: x - px, rz: z - pz };
    const prev = this.last.get(key);
    if (prev) {
      const d = Math.hypot(x - prev.x, z - prev.z);
      if (d < 0.35) return; // 너무 촘촘하면 건너뜀
      if (d < 6) this.quad(prev, cur, time); // 순간이동(리스폰 등)은 잇지 않는다
    }
    this.last.set(key, cur);
  }

  end(key: string): void {
    this.last.delete(key);
  }

  private quad(a: { lx: number; lz: number; rx: number; rz: number }, b: { lx: number; lz: number; rx: number; rz: number }, time: number): void {
    const i = this.next;
    const o = i * 12;
    const p = this.pos;
    p[o] = a.lx; p[o + 1] = Y; p[o + 2] = a.lz;
    p[o + 3] = a.rx; p[o + 4] = Y; p[o + 5] = a.rz;
    p[o + 6] = b.lx; p[o + 7] = Y; p[o + 8] = b.lz;
    p[o + 9] = b.rx; p[o + 10] = Y; p[o + 11] = b.rz;
    this.birth.fill(time, i * 4, i * 4 + 4);
    this.next = (i + 1) % this.capacity;
    this.dirty = true;
  }

  update(time: number): void {
    this.mat.uniforms.uTime.value = time;
    if (!this.dirty) return;
    this.dirty = false;
    this.posAttr.needsUpdate = true;
    this.birthAttr.needsUpdate = true;
  }

  clear(): void {
    this.birth.fill(-1e6);
    this.birthAttr.needsUpdate = true;
    this.last.clear();
    this.next = 0;
  }
}
