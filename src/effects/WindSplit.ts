import * as THREE from 'three';
import { toonRamp } from '../track/Storybook';

/**
 * 부스트 바람 가르기 — 시작 화면 들판의 "지나가는 바람"을 말 주위로 모은 연출.
 *  · 바람결: 코끝에서 갈라져 말과 기수 몸을 감싸 휘돌며 뒤로 쓸려 가는 하얀 곡선 리본.
 *    일부는 꼬리 끝이 동화책 바람처럼 동그랗게 말린다.
 *  · 꽃잎·잎사귀: 바람에 휩쓸려 빙글빙글 흩날린다.
 * 로컬 규약 +x 전방. setIntensity(0..1) 로 켜고 끈다 (부스트 1, 순간부스터 0.55).
 */
const STREAKS = 26;
const SEG = 14; // 리본 한 줄의 마디 수
const PETALS = 36;
const PETAL_COLORS = [0xffffff, 0xffc4dc, 0xfff1a8, 0xa8e07a, 0xffd0a8, 0xff9ec4];

interface Streak {
  t: number; // 0..1 수명
  rate: number; // 초당 수명
  theta: number; // 몸 둘레 각도 (0 = 위)
  twist: number; // 뒤로 가며 몸을 감아 도는 양
  len: number; // 리본 길이 (경로 비율)
  curl: number; // 꼬리 말림 (0 = 없음)
  width: number;
}

interface Petal {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  spin: THREE.Vector3;
  age: number;
  life: number;
}

export class WindSplit {
  readonly group = new THREE.Group();
  private intensity = 0;
  private readonly h: number;
  private readonly ribbonMat: THREE.ShaderMaterial;
  private readonly ribbon: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly streaks: Streak[] = [];
  private readonly petals: THREE.InstancedMesh;
  private readonly petalState: Petal[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly cam = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private lastTime = -1;

  /** @param height 말+기수 키 (m) — 크기 기준 */
  constructor(height: number) {
    this.h = height;

    // 바람결 리본: 마디마다 두 점 (카메라를 향해 폭을 벌린다)
    const vCount = STREAKS * SEG * 2;
    this.pos = new Float32Array(vCount * 3);
    this.alpha = new Float32Array(vCount);
    const across = new Float32Array(vCount);
    for (let i = 0; i < vCount; i++) across[i] = i % 2 ? 1 : -1;
    const idx: number[] = [];
    for (let s = 0; s < STREAKS; s++) {
      for (let j = 0; j < SEG - 1; j++) {
        const v = (s * SEG + j) * 2;
        idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
    geo.setIndex(idx);
    this.ribbonMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uBlue: { value: 0 } },
      vertexShader: `
        attribute float aAlpha; attribute float aAcross;
        varying float vA; varying float vX;
        void main(){ vA = aAlpha; vX = aAcross; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uBlue; varying float vA; varying float vX;
        void main(){
          // 가운데는 하얗고 가장자리는 부드럽게 (시작 화면 바람결과 같은 흰 결)
          float a = vA * smoothstep(1.0, 0.35, abs(vX));
          if (a < 0.01) discard;
          vec3 col = mix(vec3(1.0), vec3(0.78, 0.93, 1.0), uBlue);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.ribbon = new THREE.Mesh(geo, this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 4;
    this.group.add(this.ribbon);
    for (let i = 0; i < STREAKS; i++) {
      const s = {} as Streak;
      this.respawn(s, Math.random());
      this.streaks.push(s);
    }

    // 꽃잎·잎사귀 (시작 화면과 같은 카툰 재질)
    const pg = new THREE.PlaneGeometry(0.3, 0.19);
    const pm = new THREE.MeshToonMaterial({ gradientMap: toonRamp(), side: THREE.DoubleSide });
    this.petals = new THREE.InstancedMesh(pg, pm, PETALS);
    this.petals.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < PETALS; i++) {
      this.petals.setColorAt(i, col.set(PETAL_COLORS[i % PETAL_COLORS.length]));
      const st: Petal = { p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), spin: new THREE.Vector3(), age: 0, life: 0 };
      this.spawnPetal(st);
      st.age = Math.random() * st.life;
      this.petalState.push(st);
    }
    this.group.add(this.petals);
    this.group.visible = false;
  }

  private respawn(s: Streak, t = 0): void {
    s.t = t;
    s.rate = 1.9 + Math.random() * 1.3;
    // 아래(땅 쪽)는 비우고 위·옆으로
    s.theta = (Math.random() * 2 - 1) * Math.PI * 0.78;
    s.twist = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.9);
    s.len = 0.28 + Math.random() * 0.22;
    s.curl = Math.random() < 0.4 ? 0.5 + Math.random() * 0.6 : 0;
    s.width = 0.05 + Math.random() * 0.05;
  }

  private spawnPetal(st: Petal): void {
    const h = this.h;
    // 코끝~기수 머리 근처에서 생겨 뒤·바깥으로 휩쓸려 간다
    st.p.set(h * (0.2 + Math.random() * 0.8), h * (0.35 + Math.random() * 0.75), (Math.random() - 0.5) * h * 0.6);
    const out = Math.random() < 0.5 ? -1 : 1;
    st.v.set(-(14 + Math.random() * 12), (Math.random() - 0.2) * 4, out * (2 + Math.random() * 5));
    st.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    st.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
    st.age = 0;
    st.life = 0.45 + Math.random() * 0.4;
  }

  /**
   * 경로: q=0 코끝 → q=1 몸 뒤. 몸 둘레로 벌어지며(갈라짐) twist 만큼 감아 돈다.
   * curl 이 있으면 끝부분이 동그랗게 말린다.
   */
  private pathPoint(s: Streak, q: number, out: THREE.Vector3): THREE.Vector3 {
    const h = this.h;
    const x = h * 1.0 - q * h * 3.6;
    const r = h * (0.16 + 0.8 * Math.pow(Math.max(0, q), 0.5));
    const th = s.theta + s.twist * q;
    let y = h * 0.58 + Math.cos(th) * r;
    let z = Math.sin(th) * r * 1.15;
    let xx = x;
    if (s.curl > 0 && q > 0.72) {
      // 꼬리 말림: 진행 방향과 바깥 방향이 이루는 평면에서 원을 그린다
      const f = (q - 0.72) / 0.28;
      const ang = f * Math.PI * 1.6;
      const rc = h * 0.22 * s.curl;
      const ox = Math.cos(th);
      const oz = Math.sin(th);
      xx += -Math.sin(ang) * rc;
      y += ox * (1 - Math.cos(ang)) * rc;
      z += oz * (1 - Math.cos(ang)) * rc;
    }
    return out.set(xx, Math.max(0.12, y), z);
  }

  setBlue(v: number): void {
    this.ribbonMat.uniforms.uBlue.value = v;
  }

  setIntensity(v: number): void {
    this.intensity = v;
    this.group.visible = v > 0.02;
  }

  get value(): number {
    return this.intensity;
  }

  /** @param cameraWorld 카메라 위치 — 리본이 카메라를 향해 폭을 벌린다 */
  update(time: number, cameraWorld?: THREE.Vector3): void {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.05, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    if (!this.group.visible) return;
    const k = this.intensity;
    if (cameraWorld) this.group.worldToLocal(this.cam.copy(cameraWorld));
    else this.cam.set(-20, 8, 0);

    // 바람결 리본
    const P = this.pos;
    const A = this.alpha;
    const active = Math.round(STREAKS * (0.4 + 0.6 * k));
    for (let si = 0; si < STREAKS; si++) {
      const s = this.streaks[si];
      s.t += s.rate * dt;
      if (s.t >= 1) this.respawn(s);
      const on = si < active ? 1 : 0;
      // 머리는 수명 동안 경로를 따라 전진, 꼬리는 len 만큼 뒤
      const head = s.t * (1 + s.len);
      const fade = Math.sin(Math.PI * Math.min(1, s.t)) * on * k * 0.9;
      for (let j = 0; j < SEG; j++) {
        const u = j / (SEG - 1); // 0 = 머리, 1 = 꼬리
        const q = head - u * s.len;
        const qc = Math.min(1, Math.max(0, q));
        this.pathPoint(s, qc, this.a);
        this.pathPoint(s, Math.max(0, qc - 0.02), this.b);
        this.tan.subVectors(this.a, this.b);
        if (this.tan.lengthSq() < 1e-6) this.tan.set(1, 0, 0);
        this.side.subVectors(this.cam, this.a).cross(this.tan).normalize();
        // 머리 쪽이 굵고 꼬리로 가늘게, 경로 밖(q<0, q>1)은 투명
        const w = s.width * (1 - u * 0.75) * (0.7 + 0.5 * k) * this.h * 0.5;
        const vis = q < 0 || q > 1 ? 0 : fade * (1 - u * 0.85);
        const o = (si * SEG + j) * 2;
        P[o * 3] = this.a.x + this.side.x * w;
        P[o * 3 + 1] = this.a.y + this.side.y * w;
        P[o * 3 + 2] = this.a.z + this.side.z * w;
        P[o * 3 + 3] = this.a.x - this.side.x * w;
        P[o * 3 + 4] = this.a.y - this.side.y * w;
        P[o * 3 + 5] = this.a.z - this.side.z * w;
        A[o] = vis;
        A[o + 1] = vis;
      }
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;

    // 꽃잎: 세기만큼만 보이고, 바람에 휩쓸려 빙글빙글
    const d = this.dummy;
    const showPetals = Math.round(PETALS * k);
    for (let i = 0; i < PETALS; i++) {
      const st = this.petalState[i];
      st.age += dt;
      if (st.age >= st.life) this.spawnPetal(st);
      st.p.addScaledVector(st.v, dt);
      st.v.y += Math.sin(time * 9 + i) * 6 * dt;
      st.r.x += st.spin.x * dt;
      st.r.y += st.spin.y * dt;
      st.r.z += st.spin.z * dt;
      const grow = Math.min(1, st.age / 0.08) * (1 - Math.max(0, (st.age / st.life - 0.7) / 0.3));
      d.position.copy(st.p);
      d.rotation.copy(st.r);
      d.scale.setScalar(i < showPetals ? grow * (0.8 + 0.6 * ((i * 7) % 5) / 5) : 0.0001);
      d.updateMatrix();
      this.petals.setMatrixAt(i, d.matrix);
    }
    this.petals.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.ribbonMat.dispose();
    this.ribbon.geometry.dispose();
    this.petals.geometry.dispose();
    (this.petals.material as THREE.Material).dispose();
  }
}
