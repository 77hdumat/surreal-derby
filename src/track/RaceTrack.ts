import * as THREE from 'three';
import { makeGrassField, makeTree, applyCloudShadow } from './Vegetation';

const UP = new THREE.Vector3(0, 1, 0);

export interface TrackFrame {
  pos: THREE.Vector3;
  tan: THREE.Vector3;
  right: THREE.Vector3;
  curvature: number;
}

/**
 * 타원형(스타디움형) 잔디 경마장.
 * s = 트랙 중심선을 따라 진행한 거리. s=0 은 정면 직선주로 시작(출발 게이트).
 * lat = 중심선 기준 횡방향 위치, 음수 = 안쪽(왼쪽, 좌회전 트랙).
 */
export class RaceTrack {
  readonly straight = 200;
  readonly radius = 60;
  readonly width = 30;
  readonly laneCount = 10;
  readonly length: number;
  /** 결승선 s 위치 (정면 직선주로 중간) */
  readonly finishS = 165;
  /** 전체 레이스 거리 (1바퀴 + 결승선까지) */
  readonly raceDistance: number;
  readonly group = new THREE.Group();

  gate = new THREE.Group();
  private gateDoors: THREE.Object3D[] = [];
  private gateOpen = 0;
  private gateDrive = 0;

  private screenCanvas!: HTMLCanvasElement;
  private screenCtx!: CanvasRenderingContext2D;
  private screenTex!: THREE.CanvasTexture;
  private crowdMesh?: THREE.InstancedMesh;
  private crowdBase: Float32Array = new Float32Array(0);
  private crowdPhase: Float32Array = new Float32Array(0);
  private lightTowers: THREE.Mesh[] = [];
  private clouds: THREE.Group[] = [];

  private tmpFrame: TrackFrame = {
    pos: new THREE.Vector3(),
    tan: new THREE.Vector3(),
    right: new THREE.Vector3(),
    curvature: 0,
  };

  constructor() {
    this.length = 2 * this.straight + 2 * Math.PI * this.radius;
    this.raceDistance = this.length + this.finishS;
    this.build();
  }

  laneToLat(lane: number): number {
    return -this.width / 2 + (lane + 0.5) * (this.width / this.laneCount);
  }

  wrap(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  isCorner(s: number): boolean {
    return this.getFrame(s).curvature > 0;
  }

  /** 0..1 코너 진입/이탈 부드러운 가중치 */
  cornerWeight(s: number): number {
    const w = this.wrap(s);
    const L1 = this.straight;
    const arc = Math.PI * this.radius;
    const blend = 12;
    const seg = (start: number, end: number) => {
      const a = THREE.MathUtils.clamp((w - start) / blend, 0, 1);
      const b = THREE.MathUtils.clamp((end - w) / blend, 0, 1);
      return Math.min(a, b);
    };
    return Math.max(seg(L1, L1 + arc), seg(2 * L1 + arc, 2 * L1 + 2 * arc));
  }

  getFrame(sIn: number, out: TrackFrame = this.tmpFrame): TrackFrame {
    const s = this.wrap(sIn);
    const L1 = this.straight;
    const R = this.radius;
    const arc = Math.PI * R;
    if (s < L1) {
      out.pos.set(-L1 / 2 + s, 0, R);
      out.tan.set(1, 0, 0);
      out.curvature = 0;
    } else if (s < L1 + arc) {
      const th = (s - L1) / R;
      out.pos.set(L1 / 2 + R * Math.sin(th), 0, R * Math.cos(th));
      out.tan.set(Math.cos(th), 0, -Math.sin(th));
      out.curvature = 1 / R;
    } else if (s < 2 * L1 + arc) {
      const u = s - L1 - arc;
      out.pos.set(L1 / 2 - u, 0, -R);
      out.tan.set(-1, 0, 0);
      out.curvature = 0;
    } else {
      const th = (s - 2 * L1 - arc) / R;
      out.pos.set(-L1 / 2 - R * Math.sin(th), 0, -R * Math.cos(th));
      out.tan.set(-Math.cos(th), 0, Math.sin(th));
      out.curvature = 1 / R;
    }
    out.right.crossVectors(out.tan, UP).normalize();
    return out;
  }

  getPoint(s: number, lat: number, out = new THREE.Vector3()): THREE.Vector3 {
    const f = this.getFrame(s);
    return out.copy(f.pos).addScaledVector(f.right, lat);
  }

  getTangent(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.getFrame(s).tan);
  }

  // ---------------------------------------------------------------- build

  private build(): void {
    this.buildGround();
    this.buildTrackSurface();
    this.buildRails();
    this.buildFinishLine();
    this.buildGate();
    this.buildGrandstand();
    this.buildBillboards();
    this.buildBigScreen();
    this.buildInfield();
    this.buildBackground();
    this.buildLightTowers();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && m.userData.noShadow !== true) {
        const mat = m.material as THREE.Material;
        if (!mat.transparent && mat.type !== 'ShaderMaterial') m.castShadow = true;
      }
    });
  }

  private stripeTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    // 잔디 깎은 줄무늬 (레인당 한 줄) + 잔디 결 노이즈
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#6da86f' : '#5f9a64';
      ctx.fillRect(0, i * 64, 256, 64);
    }
    let seed = 3;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 9000; i++) {
      const g = 130 + rnd() * 60;
      ctx.fillStyle = `rgba(${70 + rnd() * 30},${g},${90 + rnd() * 30},${0.2 + rnd() * 0.25})`;
      const x = rnd() * 256;
      const y = rnd() * 512;
      ctx.fillRect(x, y, 1 + rnd() * 2, 2 + rnd() * 5);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  private grassTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#5f9a6a';
    ctx.fillRect(0, 0, 512, 512);
    let seed = 11;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    // 큰 얼룩(저주파) + 잔디 결(고주파) — 타일 경계가 눈에 띄지 않게 낮은 대비
    for (let i = 0; i < 60; i++) {
      const r = 40 + rnd() * 90;
      const grd = ctx.createRadialGradient(rnd() * 512, rnd() * 512, 0, 0, 0, r);
      const x = rnd() * 512;
      const y = rnd() * 512;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, `rgba(${80 + rnd() * 30},${150 + rnd() * 30},${110 + rnd() * 20},0.18)`);
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      void grd;
      ctx.fillStyle = g2;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 14000; i++) {
      ctx.fillStyle = `rgba(${70 + rnd() * 30},${140 + rnd() * 40},${95 + rnd() * 25},${0.12 + rnd() * 0.18})`;
      ctx.fillRect(rnd() * 512, rnd() * 512, 1, 2 + rnd() * 3);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  private buildGround(): void {
    const geo = new THREE.PlaneGeometry(1600, 1600);
    const mat = new THREE.MeshStandardMaterial({ map: this.grassTexture(), roughness: 1, metalness: 0 });
    applyCloudShadow(mat, 0.3);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.05;
    m.receiveShadow = true;
    m.userData.noShadow = true;
    this.group.add(m);
  }

  private buildTrackSurface(): void {
    const steps = Math.ceil(this.length / 3);
    const halfW = this.width / 2 + 1.5;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const f: TrackFrame = {
      pos: new THREE.Vector3(),
      tan: new THREE.Vector3(),
      right: new THREE.Vector3(),
      curvature: 0,
    };
    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * this.length;
      this.getFrame(s, f);
      const l = f.pos.clone().addScaledVector(f.right, -halfW);
      const r = f.pos.clone().addScaledVector(f.right, halfW);
      positions.push(l.x, 0.01, l.z, r.x, 0.01, r.z);
      uvs.push(s / 20, 0, s / 20, 1);
      if (i < steps) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: this.stripeTexture(), roughness: 1, metalness: 0 });
    applyCloudShadow(mat, 0.3);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildRails(): void {
    const step = 5;
    const count = Math.ceil(this.length / step);
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.15, 6);
    postGeo.translate(0, 0.575, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    const barGeo = new THREE.BoxGeometry(step + 0.2, 0.09, 0.09);
    const barMat = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.95, metalness: 0 });
    const dummy = new THREE.Object3D();
    for (const side of [-1, 1]) {
      const lat = side * (this.width / 2 + 0.4);
      const posts = new THREE.InstancedMesh(postGeo, postMat, count);
      const bars = new THREE.InstancedMesh(barGeo, barMat, count * 2);
      posts.castShadow = true;
      bars.castShadow = true;
      for (let i = 0; i < count; i++) {
        const s = i * step;
        const f = this.getFrame(s);
        dummy.position.copy(f.pos).addScaledVector(f.right, lat);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
        // 다음 포스트와의 중간에 바
        const fm = this.getFrame(s + step / 2);
        const yaw = Math.atan2(fm.tan.x, fm.tan.z) - Math.PI / 2;
        for (let b = 0; b < 2; b++) {
          dummy.position.copy(fm.pos).addScaledVector(fm.right, lat);
          dummy.position.y = b === 0 ? 1.1 : 0.7;
          dummy.rotation.set(0, yaw, 0);
          dummy.updateMatrix();
          bars.setMatrixAt(i * 2 + b, dummy.matrix);
        }
      }
      this.group.add(posts, bars);
    }
  }

  private makeTextTexture(
    text: string,
    w: number,
    h: number,
    bg: string,
    fg: string,
    font = 'bold 90px sans-serif',
  ): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildFinishLine(): void {
    const f = this.getFrame(this.finishS);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, this.width + 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.copy(f.pos);
    line.position.y = 0.03;
    line.rotation.z = Math.atan2(f.tan.x, f.tan.z) - Math.PI / 2;
    this.group.add(line);

    // 결승 게이트(현수막)
    const postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.95, metalness: 0 });
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7, 8), postMat);
      p.position.copy(f.pos).addScaledVector(f.right, side * (this.width / 2 + 1.2));
      p.position.y = 3.5;
      this.group.add(p);
    }
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width + 2.4, 1.6),
      new THREE.MeshBasicMaterial({
        map: this.makeTextTexture('GOAL  결승선  GOAL', 1024, 128, '#d81e1e', '#ffffff', 'bold 80px sans-serif'),
        side: THREE.DoubleSide,
      }),
    );
    banner.position.copy(f.pos);
    banner.position.y = 6.2;
    banner.rotation.y = Math.atan2(f.tan.x, f.tan.z);
    this.group.add(banner);
  }

  private buildGate(): void {
    const f = this.getFrame(0);
    this.gate.position.copy(f.pos);
    this.gate.rotation.y = Math.atan2(f.tan.x, f.tan.z);
    const laneW = this.width / this.laneCount;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b6fd6, roughness: 0.95, metalness: 0 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.95, metalness: 0 });
    const grille = new THREE.MeshStandardMaterial({ color: 0x9fb8e8, transparent: true, opacity: 0.6, roughness: 0.95, metalness: 0 });
    // 로컬 좌표: 진행방향 = +z, 오른쪽 = +x? gate.rotation 은 tan 을 +z 에 맞춤. right 는 -x.
    for (let i = 0; i <= this.laneCount; i++) {
      const lat = -this.width / 2 + i * laneW;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.8, 0.16), frameMat);
      post.position.set(-lat, 1.4, 0);
      this.gate.add(post);
      const back = post.clone();
      back.position.z = -3.2;
      this.gate.add(back);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.2), frameMat);
      top.position.set(-lat, 2.8, -1.6);
      this.gate.add(top);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(this.width + 0.6, 0.12, 3.4), frameMat);
    roof.position.set(0, 2.9, -1.6);
    this.gate.add(roof);
    for (let i = 0; i < this.laneCount; i++) {
      const lat = this.laneToLat(i);
      // 양문형 도어 — 힌지가 좌우 포스트에 있음
      for (const side of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.position.set(-lat + side * (laneW / 2 - 0.1), 0, 0.02);
        const door = new THREE.Mesh(new THREE.BoxGeometry(laneW / 2 - 0.12, 2.3, 0.06), doorMat);
        door.position.set(-side * (laneW / 4 - 0.06), 1.25, 0);
        hinge.add(door);
        const num = new THREE.Mesh(
          new THREE.PlaneGeometry(0.6, 0.6),
          new THREE.MeshBasicMaterial({
            map: this.makeTextTexture(String(i + 1), 128, 128, '#ffffff', '#111111', 'bold 96px sans-serif'),
          }),
        );
        num.position.set(-side * (laneW / 4 - 0.06), 1.9, 0.04);
        hinge.add(num);
        hinge.userData.side = side;
        this.gate.add(hinge);
        this.gateDoors.push(hinge);
      }
      // 뒷문(닫힘)
      const rear = new THREE.Mesh(new THREE.BoxGeometry(laneW - 0.2, 2.0, 0.06), grille);
      rear.position.set(-lat, 1.1, -3.2);
      this.gate.add(rear);
    }
    // 바퀴 (게이트는 견인차량이다)
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.95, metalness: 0 });
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(-this.width / 2 + 1 + (i * (this.width - 2)) / 3, 0.4, -3.6);
      w.visible = false; // 출발 후 이동 시 표시
      w.userData.wheel = true;
      this.gate.add(w);
    }
    this.group.add(this.gate);
  }

  /** 0..1 게이트 문 열림 */
  setGateOpen(v: number): void {
    this.gateOpen = v;
    for (const h of this.gateDoors) {
      const side = h.userData.side as number;
      h.rotation.y = side * v * (Math.PI * 0.55);
    }
  }

  /** 출발 후 게이트가 트랙 밖으로 이동 (0..1) */
  setGateDrive(v: number): void {
    this.gateDrive = v;
    const f = this.getFrame(0);
    const off = THREE.MathUtils.smoothstep(v, 0, 1) * 40;
    this.gate.position.copy(f.pos).addScaledVector(f.right, off);
    this.gate.position.y = 0;
    this.gate.children.forEach((c) => {
      if (c.userData.wheel) c.visible = v > 0.02;
    });
    this.gate.visible = v < 0.999;
  }

  resetGate(): void {
    this.setGateOpen(0);
    this.setGateDrive(0);
    this.gate.visible = true;
  }

  get gateOpenAmount(): number {
    return this.gateOpen;
  }
  get gateDriveAmount(): number {
    return this.gateDrive;
  }

  private buildGrandstand(): void {
    const zBase = this.radius + this.width / 2 + 6; // 트랙 바깥
    const len = this.straight + 40;
    const tiers = 7;
    const tierMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.95, metalness: 0 });
    const stand = new THREE.Group();
    for (let t = 0; t < tiers; t++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(len, 1.4, 3.5), tierMat);
      box.position.set(0, 0.7 + t * 1.4, zBase + 1.75 + t * 3.5);
      stand.add(box);
    }
    // 뒷벽 + 지붕
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(len, tiers * 1.4 + 6, 1),
      new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.95, metalness: 0 }),
    );
    wall.position.set(0, (tiers * 1.4 + 6) / 2, zBase + tiers * 3.5 + 0.5);
    stand.add(wall);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(len + 4, 0.5, tiers * 3.5 + 6),
      new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.95, metalness: 0 }),
    );
    roof.position.set(0, tiers * 1.4 + 6, zBase + (tiers * 3.5) / 2 + 0.5);
    roof.rotation.x = 0.08;
    stand.add(roof);
    for (let i = -4; i <= 4; i++) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, tiers * 1.4 + 6, 8),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 }),
      );
      col.position.set((i * len) / 8.5, (tiers * 1.4 + 6) / 2, zBase - 0.5);
      stand.add(col);
    }
    // 관중 — InstancedMesh, 색상 랜덤, 응원 시 상하 진동
    const perTier = 150;
    const total = tiers * perTier;
    const crowdGeo = new THREE.BoxGeometry(0.5, 0.9, 0.4);
    crowdGeo.translate(0, 0.45, 0);
    const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, total);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    this.crowdBase = new Float32Array(total * 3);
    this.crowdPhase = new Float32Array(total);
    let idx = 0;
    for (let t = 0; t < tiers; t++) {
      for (let i = 0; i < perTier; i++) {
        const x = -len / 2 + 2 + Math.random() * (len - 4);
        const y = 1.4 + t * 1.4;
        const z = zBase + 0.6 + t * 3.5 + Math.random() * 1.6;
        this.crowdBase[idx * 3] = x;
        this.crowdBase[idx * 3 + 1] = y;
        this.crowdBase[idx * 3 + 2] = z;
        this.crowdPhase[idx] = Math.random() * Math.PI * 2;
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        crowd.setMatrixAt(idx, dummy.matrix);
        color.setHSL(Math.random(), 0.6 + Math.random() * 0.3, 0.45 + Math.random() * 0.25);
        crowd.setColorAt(idx, color);
        idx++;
      }
    }
    crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    stand.add(crowd);
    this.crowdMesh = crowd;
    this.group.add(stand);
  }

  /** 구름 표류 */
  updateAmbient(dt: number): void {
    for (const c of this.clouds) {
      c.position.x += (c.userData.speed as number) * dt;
      if (c.position.x > 800) c.position.x = -800;
    }
  }

  /** 관중 응원 강도 0..1 */
  updateCrowd(time: number, excitement: number): void {
    if (!this.crowdMesh) return;
    const dummy = new THREE.Object3D();
    const n = this.crowdPhase.length;
    const amp = 0.05 + excitement * 0.45;
    for (let i = 0; i < n; i++) {
      const ph = this.crowdPhase[i];
      const jump = Math.max(0, Math.sin(time * (6 + excitement * 6) + ph)) * amp;
      dummy.position.set(this.crowdBase[i * 3], this.crowdBase[i * 3 + 1] + jump, this.crowdBase[i * 3 + 2]);
      dummy.updateMatrix();
      this.crowdMesh.setMatrixAt(i, dummy.matrix);
    }
    this.crowdMesh.instanceMatrix.needsUpdate = true;
  }

  private buildBillboards(): void {
    const ads: [string, string, string][] = [
      ['달려라 두부', '#fff5d6', '#c0392b'],
      ['롱넥 생명보험', '#1a4fa0', '#ffffff'],
      ['미라클 골판지 공업', '#c9964f', '#3b2200'],
      ['슈퍼 당근 에너지', '#ff7a00', '#ffffff'],
      ['코끼리 이삿짐센터', '#e8e8e8', '#333333'],
      ['레이지 우유', '#ffffff', '#1d8a3c'],
      ['스탤리온 모터스', '#111111', '#ff6a00'],
      ['휴먼 러닝 아카데미', '#b02a8f', '#ffe14d'],
      ['초현실 경마 그랑프리', '#f5c400', '#111111'],
      ['정상적인 말 협회', '#8a2be2', '#ffffff'],
    ];
    const boardW = 14;
    const positions: number[] = [];
    // 뒷 직선주로 + 코너 바깥
    const L1 = this.straight;
    const arc = Math.PI * this.radius;
    for (let i = 0; i < 6; i++) positions.push(L1 + arc + 15 + i * ((L1 - 30) / 5));
    positions.push(L1 + arc * 0.3, L1 + arc * 0.7, 2 * L1 + arc + arc * 0.3, 2 * L1 + arc + arc * 0.7);
    positions.forEach((s, i) => {
      const ad = ads[i % ads.length];
      const f = this.getFrame(s);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(boardW, 3.2),
        new THREE.MeshBasicMaterial({
          map: this.makeTextTexture(ad[0], 1024, 240, ad[1], ad[2], 'bold 110px sans-serif'),
          side: THREE.DoubleSide,
        }),
      );
      board.position.copy(f.pos).addScaledVector(f.right, this.width / 2 + 4);
      board.position.y = 2.2;
      board.lookAt(board.position.clone().addScaledVector(f.right, -1));
      this.group.add(board);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.95, metalness: 0 });
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, 0.2), legMat);
        leg.position.copy(board.position).addScaledVector(f.tan, side * (boardW / 2 - 0.5));
        leg.position.y = 1;
        this.group.add(leg);
      }
    });
  }

  private buildBigScreen(): void {
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 512;
    this.screenCanvas.height = 288;
    this.screenCtx = this.screenCanvas.getContext('2d')!;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const group = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(26, 14.5, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x1b1f2a, roughness: 0.95, metalness: 0 }),
    );
    frame.position.y = 12;
    group.add(frame);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 13),
      new THREE.MeshBasicMaterial({ map: this.screenTex }),
    );
    screen.position.set(0, 12, 0.65);
    group.add(screen);
    for (const x of [-9, 9]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 5, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x555b66, roughness: 0.95, metalness: 0 }),
      );
      leg.position.set(x, 2.5, 0);
      group.add(leg);
    }
    // 인필드, 결승선 부근에서 정면 직선주로(+z) 를 향함
    group.position.set(this.finishS - this.straight / 2 - 30, 0, 12);
    this.group.add(group);
    this.updateBigScreen('제1회 초현실 경마 그랑프리', [], 0);
  }

  updateBigScreen(title: string, lines: string[], time: number): void {
    const ctx = this.screenCtx;
    const w = this.screenCanvas.width;
    const h = this.screenCanvas.height;
    ctx.fillStyle = '#0a1a3a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f5c400';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, 18, 14);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(time.toFixed(1) + 's', w - 18, 16);
    ctx.textAlign = 'left';
    ctx.font = 'bold 28px sans-serif';
    lines.slice(0, 6).forEach((l, i) => {
      ctx.fillStyle = i === 0 ? '#ffe14d' : '#e8eefc';
      ctx.fillText(l, 22, 70 + i * 36);
    });
    this.screenTex.needsUpdate = true;
  }

  private buildInfield(): void {
    // 연못 (살짝 반사되는 물)
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(22, 32),
      new THREE.MeshStandardMaterial({ color: 0x5a7aa2, roughness: 0.12, metalness: 0.15 }),
    );
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(-40, 0.02, -8);
    pond.scale.set(1.6, 1, 1);
    pond.userData.noShadow = true;
    this.group.add(pond);
    const inPond = (x: number, z: number) => Math.hypot(x + 40, (z + 8) / 1.6) < 24;
    const nearScreen = (x: number, z: number) => Math.abs(x - (this.finishS - this.straight / 2 - 30)) < 22 && z > 0 && z < 24;
    // 인필드 나무
    const trees = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const x = (Math.random() - 0.5) * (this.straight + 30);
      const z = (Math.random() - 0.5) * 70;
      if (inPond(x, z) || nearScreen(x, z)) continue;
      const t = makeTree(1 + Math.random() * 0.6);
      t.position.set(x, 0, z);
      t.rotation.y = Math.random() * Math.PI * 2;
      trees.add(t);
    }
    // 트랙 바깥 나무 (관중석 반대편·코너)
    for (let i = 0; i < 90; i++) {
      const s = Math.random() * this.length;
      const f = this.getFrame(s);
      if (f.pos.z > 20 && Math.abs(f.pos.x) < this.straight / 2 + 40) continue;
      const p = f.pos.clone().addScaledVector(f.right, this.width / 2 + 10 + Math.random() * 60);
      const t = makeTree(1.2 + Math.random() * 1.2);
      t.position.set(p.x, 0, p.z);
      t.rotation.y = Math.random() * Math.PI * 2;
      trees.add(t);
    }
    this.group.add(trees);

    // 바람에 흔들리는 잔디: 인필드 + 트랙 바깥 띠
    const halfW = this.width / 2;
    const infield = makeGrassField(14000, () => {
      const x = (Math.random() - 0.5) * (this.straight + 2 * this.radius - 2 * halfW - 8);
      const z = (Math.random() - 0.5) * (2 * this.radius - 2 * halfW - 8);
      // 타원 내부 판정 (스타디움형)
      const cx = THREE.MathUtils.clamp(x, -this.straight / 2, this.straight / 2);
      const rIn = this.radius - halfW - 3;
      if (Math.hypot(x - cx, z) > rIn) return null;
      if (inPond(x, z) || nearScreen(x, z)) return null;
      return [x, z];
    });
    this.group.add(infield);
    const outer = makeGrassField(16000, () => {
      const s = Math.random() * this.length;
      const f = this.getFrame(s);
      if (f.pos.z > 20 && Math.abs(f.pos.x) < this.straight / 2 + 30) return null; // 관중석 앞 제외
      const p = f.pos.clone().addScaledVector(f.right, halfW + 2 + Math.random() * 28);
      return [p.x, p.z];
    });
    this.group.add(outer);
  }

  private buildBackground(): void {
    // 하늘 그라데이션 돔
    const skyGeo = new THREE.SphereGeometry(900, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x248fd5) },
        mid: { value: new THREE.Color(0xcaf0fe) },
        bottom: { value: new THREE.Color(0xfff4e2) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = normalize(vP).y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.55, h)) : mix(bottom, mid, smoothstep(-0.04, 0.08, h)); gl_FragColor = vec4(c,1.0); }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.userData.noShadow = true;
    this.group.add(sky);
    // 오후의 태양
    const sun = new THREE.Mesh(new THREE.SphereGeometry(28, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
    sun.position.set(420, 330, 260);
    sun.userData.noShadow = true;
    this.group.add(sun);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(60, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe9b8, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    halo.position.copy(sun.position);
    halo.userData.noShadow = true;
    this.group.add(halo);

    // 구름 (납작한 스프라이트 느낌의 박스)
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xfff1de, emissive: 0xffe5c4, emissiveIntensity: 0.7, roughness: 1, transparent: true, opacity: 0.94 });
    for (let i = 0; i < 18; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const s = 12 + Math.random() * 18;
        const m = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), cloudMat);
        m.position.set(j * s * 0.9 - (n * s) / 2, Math.random() * 4, (Math.random() - 0.5) * 10);
        m.scale.y = 0.5;
        c.add(m);
      }
      const ang = Math.random() * Math.PI * 2;
      const r = 350 + Math.random() * 350;
      c.position.set(Math.cos(ang) * r, 90 + Math.random() * 60, Math.sin(ang) * r);
      c.userData.cloud = true;
      c.userData.speed = 0.6 + Math.random() * 0.8;
      this.group.add(c);
      this.clouds.push(c);
    }

    // 먼 산
    const mtnMat = new THREE.MeshStandardMaterial({ color: 0x9db4cf, roughness: 0.95, metalness: 0 });
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
      const r = 620 + Math.random() * 120;
      const h = 60 + Math.random() * 110;
      const m = new THREE.Mesh(new THREE.ConeGeometry(70 + Math.random() * 60, h, 5), mtnMat);
      m.position.set(Math.cos(ang) * r, h / 2 - 5, Math.sin(ang) * r);
      this.group.add(m);
    }
    // 먼 건물 (관중석 뒤)
    const bMat = new THREE.MeshStandardMaterial({ color: 0xd9d3cb, roughness: 0.95, metalness: 0 });
    for (let i = 0; i < 30; i++) {
      const w = 10 + Math.random() * 20;
      const h = 15 + Math.random() * 50;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), bMat);
      b.position.set(-250 + Math.random() * 500, h / 2, 170 + Math.random() * 120);
      this.group.add(b);
    }
  }

  private buildLightTowers(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.95, metalness: 0 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6d5 });
    const spots: [number, number][] = [
      [-this.straight / 2 - 30, this.radius + 30],
      [this.straight / 2 + 30, this.radius + 30],
      [-this.straight / 2 - 30, -this.radius - 30],
      [this.straight / 2 + 30, -this.radius - 30],
    ];
    for (const [x, z] of spots) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 38, 8), poleMat);
      pole.position.set(x, 19, z);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 1.2), lampMat);
      lamp.position.set(x, 38, z);
      lamp.lookAt(0, 20, 0);
      this.group.add(pole, lamp);
      this.lightTowers.push(lamp);
    }
  }
}
