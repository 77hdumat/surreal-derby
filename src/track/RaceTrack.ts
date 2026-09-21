import * as THREE from 'three';
import { makeGrassField, makeTree, applyCloudShadow } from './Vegetation';
import { grassMaterial, buildMountainRing } from './Environment';
import { loadTreePrototypes, cloneTree, loadMountains, loadGrandstand, makeLake } from './SceneAssets';
import type { Water } from 'three/examples/jsm/objects/Water.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

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
  private crowdHeadMesh?: THREE.InstancedMesh;
  private crowdArmMeshes: THREE.InstancedMesh[] = [];
  private crowdBase: Float32Array = new Float32Array(0);
  private crowdPhase: Float32Array = new Float32Array(0);
  private crowdScale: Float32Array = new Float32Array(0);
  private lightTowers: THREE.Mesh[] = [];
  private clouds: THREE.Group[] = [];
  /** 절차 나무 자리 — 실사 나무 로드 후 교체 */
  private treeSlots: { group: THREE.Group; height: number }[] = [];
  private standGroup?: THREE.Group;
  private crowdGroup?: THREE.Group;
  private pond?: THREE.Mesh;
  private lake?: Water;
  sky!: Sky;
  /** 태양 방향 (정규화) — 조명·하늘·태양 원반 공통 */
  static readonly SUN_DIR = new THREE.Vector3(0.35, 1.05, 0.3).normalize();

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

  private buildGround(): void {
    const geo = new THREE.PlaneGeometry(1600, 1600);
    geo.setAttribute('uv2', geo.attributes.uv);
    // 실사 잔디 PBR: 1600m 를 약 3.2m 타일로
    const mat = grassMaterial(500);
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
    geo.setAttribute('uv2', geo.attributes.uv);
    // u = 20m 당 1, v = 트랙 폭(≈17m) 당 1 → 약 3m 타일 + 잔디깎기 줄무늬
    const mat = grassMaterial(6.5, 5.5, { stripes: true });
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

    // 결승 게이트·현수막 없음 — 바닥 흰 선만 (카메라 시야를 가리지 않게)
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
    this.standGroup = stand;
    this.group.add(stand);
    // 관중 좌석 (절차 스탠드 기준) — 실사 스탠드 로드 후 모듈 좌석으로 다시 만든다
    const seats: THREE.Vector3[] = [];
    for (let t = 0; t < tiers; t++) {
      for (let i = 0; i < 150; i++) {
        seats.push(new THREE.Vector3(-len / 2 + 2 + Math.random() * (len - 4), 1.4 + t * 1.4, zBase + 0.6 + t * 3.5 + Math.random() * 1.6));
      }
    }
    this.buildCrowd(seats);
  }

  /** 관중 — 몸/머리/팔을 분리한 저폴리 실루엣 인스턴스. seats = 서 있는 발 위치(월드) */
  private buildCrowd(seats: THREE.Vector3[]): void {
    if (this.crowdGroup) {
      this.group.remove(this.crowdGroup);
      this.crowdGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    const total = seats.length;
    const crowdGeo = new THREE.CapsuleGeometry(0.17, 0.45, 4, 8);
    crowdGeo.translate(0, 0.42, 0);
    const headGeo = new THREE.SphereGeometry(0.155, 10, 8);
    const armGeo = new THREE.CapsuleGeometry(0.052, 0.3, 3, 6);
    const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, total);
    const heads = new THREE.InstancedMesh(headGeo, skinMat, total);
    const armL = new THREE.InstancedMesh(armGeo, crowdMat, total);
    const armR = new THREE.InstancedMesh(armGeo, crowdMat, total);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const skin = new THREE.Color();
    this.crowdBase = new Float32Array(total * 3);
    this.crowdPhase = new Float32Array(total);
    this.crowdScale = new Float32Array(total);
    seats.forEach((sp, idx) => {
      this.crowdBase[idx * 3] = sp.x;
      this.crowdBase[idx * 3 + 1] = sp.y;
      this.crowdBase[idx * 3 + 2] = sp.z;
      this.crowdPhase[idx] = Math.random() * Math.PI * 2;
      this.crowdScale[idx] = 0.85 + Math.random() * 0.3;
      dummy.position.copy(sp);
      dummy.scale.setScalar(this.crowdScale[idx]);
      dummy.updateMatrix();
      crowd.setMatrixAt(idx, dummy.matrix);
      color.setHSL(Math.random(), 0.6 + Math.random() * 0.3, 0.45 + Math.random() * 0.25);
      crowd.setColorAt(idx, color);
      armL.setColorAt(idx, color);
      armR.setColorAt(idx, color);
      skin.setHSL(0.07, 0.28 + Math.random() * 0.22, 0.55 + Math.random() * 0.28);
      heads.setColorAt(idx, skin);
    });
    for (const mesh of [crowd, heads, armL, armR]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    const g = new THREE.Group();
    g.add(crowd, heads, armL, armR);
    this.crowdGroup = g;
    this.crowdMesh = crowd;
    this.crowdHeadMesh = heads;
    this.crowdArmMeshes = [armL, armR];
    this.group.add(g);
  }

  /**
   * 실사 배경 모델 로드 (비동기): 나무·먼 산·관중석·호수.
   * 실패해도 절차 버전이 남아 있으므로 각각 독립적으로 시도한다.
   */
  async loadRealAssets(sunDir: THREE.Vector3): Promise<void> {
    const tasks: Promise<void>[] = [];
    tasks.push(
      loadTreePrototypes().then((protos) => {
        if (!protos.length) return;
        for (const slot of this.treeSlots) {
          const tree = cloneTree(protos[Math.floor(Math.random() * protos.length)], slot.height);
          slot.group.clear();
          slot.group.add(tree);
        }
      }),
    );
    tasks.push(
      loadMountains().then((m) => {
        this.group.add(m);
      }),
    );
    tasks.push(
      loadGrandstand(this.radius + this.width / 2 + 6, this.straight + 40).then((stand) => {
        if (this.standGroup) this.group.remove(this.standGroup);
        this.group.add(stand.group);
        this.buildCrowd(stand.seats);
      }),
    );
    // 호수: 반사 물
    try {
      const lake = makeLake(22 * 1.6, 22, sunDir);
      lake.position.set(-40, 0.04, -8);
      if (this.pond) this.group.remove(this.pond);
      this.group.add(lake);
      this.lake = lake;
    } catch (e) {
      console.warn('[env] lake', e);
    }
    const results = await Promise.allSettled(tasks);
    for (const r of results) if (r.status === 'rejected') console.warn('[env] 로드 실패', r.reason);
  }

  /** 구름 표류 */
  updateAmbient(dt: number): void {
    if (this.lake) this.lake.material.uniforms.time.value += dt * 0.6;
    for (const c of this.clouds) {
      c.position.x += (c.userData.speed as number) * dt;
      if (c.position.x > 800) c.position.x = -800;
    }
  }

  /** 관중 응원 강도 0..1 */
  updateCrowd(time: number, excitement: number): void {
    if (!this.crowdMesh || !this.crowdHeadMesh || this.crowdArmMeshes.length !== 2) return;
    const dummy = new THREE.Object3D();
    const n = this.crowdPhase.length;
    const amp = 0.05 + excitement * 0.45;
    for (let i = 0; i < n; i++) {
      const ph = this.crowdPhase[i];
      const scale = this.crowdScale[i];
      const jump = Math.max(0, Math.sin(time * (6 + excitement * 6) + ph)) * amp;
      dummy.position.set(this.crowdBase[i * 3], this.crowdBase[i * 3 + 1] + jump, this.crowdBase[i * 3 + 2]);
      dummy.rotation.set(0, 0, Math.sin(time * 2.2 + ph) * 0.035 * excitement);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      this.crowdMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.y = this.crowdBase[i * 3 + 1] + jump + 0.92 * scale;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      this.crowdHeadMesh.setMatrixAt(i, dummy.matrix);

      const wave = Math.sin(time * (3.5 + excitement * 4) + ph) * (0.25 + excitement * 0.7);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        dummy.position.set(
          this.crowdBase[i * 3] + sign * 0.23 * scale,
          this.crowdBase[i * 3 + 1] + jump + 0.62 * scale,
          this.crowdBase[i * 3 + 2],
        );
        dummy.rotation.set(0, 0, sign * (0.45 + wave));
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        this.crowdArmMeshes[side].setMatrixAt(i, dummy.matrix);
      }
    }
    this.crowdMesh.instanceMatrix.needsUpdate = true;
    this.crowdHeadMesh.instanceMatrix.needsUpdate = true;
    this.crowdArmMeshes[0].instanceMatrix.needsUpdate = true;
    this.crowdArmMeshes[1].instanceMatrix.needsUpdate = true;
  }

  /** 식스샵(sixshop.com) 광고 간판 텍스처: 헤드라인 + 서브카피 + 로고 워드마크 */
  private makeAdTexture(headline: string, sub: string, bg: string, fg: string, accent: string): THREE.CanvasTexture {
    const w = 1024;
    const h = 240;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // 좌측 워드마크 블록
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 250, h);
    ctx.fillStyle = bg;
    ctx.font = '900 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SIXSHOP', 125, h / 2 - 22);
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('식스샵', 125, h / 2 + 30);
    // 우측 카피
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.font = 'bold 74px sans-serif';
    ctx.fillText(headline, 290, sub ? 88 : h / 2);
    if (sub) {
      ctx.font = '500 38px sans-serif';
      ctx.globalAlpha = 0.85;
      ctx.fillText(sub, 292, 168);
      ctx.globalAlpha = 1;
    }
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.7;
    ctx.fillText('sixshop.com', w - 24, h - 26);
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  private buildBillboards(): void {
    // [헤드라인, 서브카피, 배경, 글자, 워드마크 블록]
    const ads: [string, string, string, string, string][] = [
      ['쉽고 빠른 쇼핑몰·홈페이지 제작', '코딩 없이, 오늘 바로 오픈', '#111111', '#ffffff', '#ffffff'],
      ['프롬프트 한 줄로 쇼핑몰 완성', 'AI 웹사이트 제작', '#ffffff', '#111111', '#111111'],
      ['웹빌더의 한계를 없애다', '식스샵 프로', '#111111', '#ffffff', '#f5c400'],
      ['20만 브랜드가 선택한 식스샵', '지금 무료로 시작하세요', '#ffffff', '#111111', '#111111'],
      ['말보다 빠른 쇼핑몰 오픈', '결승선까지 3분, 사이트는 1분', '#1a1a1a', '#ffffff', '#ff4d2e'],
      ['AI 에이전트가 쇼핑몰 운영 자동화', '주문·CS·마케팅을 한 번에', '#ffffff', '#111111', '#111111'],
      ['몇 번의 클릭으로 마케팅 캠페인', '마케팅 자동화', '#111111', '#ffffff', '#ffffff'],
      ['60개 이상의 앱·마켓 연동', '네이버·쿠팡·인스타 한 곳에서', '#f7f7f5', '#111111', '#111111'],
      ['200개 이상의 전문가 디자인 블록', '블록 마켓플레이스', '#111111', '#ffffff', '#4d8dff'],
      ['외부 디자인도 그대로 가져오기', 'Figma·이미지 → 사이트', '#ffffff', '#111111', '#111111'],
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
          map: this.makeAdTexture(ad[0], ad[1], ad[2], ad[3], ad[4]),
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
    this.pond = pond;
    const inPond = (x: number, z: number) => Math.hypot(x + 40, (z + 8) / 1.6) < 24;
    const finishCam = this.getPoint(this.finishS + 1.5, -this.width / 2 - 11);
    const nearFinishCam = (x: number, z: number) => Math.hypot(x - finishCam.x, z - finishCam.z) < 18;
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
      this.treeSlots.push({ group: t, height: 7 + Math.random() * 4 });
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
      this.treeSlots.push({ group: t, height: 9 + Math.random() * 7 });
    }
    this.group.add(trees);

    // 바람에 흔들리는 잔디: 인필드 + 트랙 바깥 띠
    const halfW = this.width / 2;
    const infield = makeGrassField(9000, () => {
      const x = (Math.random() - 0.5) * (this.straight + 2 * this.radius - 2 * halfW - 8);
      const z = (Math.random() - 0.5) * (2 * this.radius - 2 * halfW - 8);
      // 타원 내부 판정 (스타디움형)
      const cx = THREE.MathUtils.clamp(x, -this.straight / 2, this.straight / 2);
      const rIn = this.radius - halfW - 3;
      if (Math.hypot(x - cx, z) > rIn) return null;
      if (inPond(x, z) || nearScreen(x, z) || nearFinishCam(x, z)) return null;
      return [x, z];
    });
    this.group.add(infield);
    const outer = makeGrassField(11000, () => {
      const s = Math.random() * this.length;
      const f = this.getFrame(s);
      if (f.pos.z > 20 && Math.abs(f.pos.x) < this.straight / 2 + 30) return null; // 관중석 앞 제외
      const p = f.pos.clone().addScaledVector(f.right, halfW + 2 + Math.random() * 28);
      return [p.x, p.z];
    });
    this.group.add(outer);
  }

  private buildBackground(): void {
    // 물리 기반 하늘 (Preetham) — 태양 위치와 대기 산란으로 자연스러운 그라데이션
    const sky = new Sky();
    sky.scale.setScalar(1800);
    const u = sky.material.uniforms;
    u.turbidity.value = 1.8;
    u.rayleigh.value = 0.55;
    u.mieCoefficient.value = 0.0012;
    u.mieDirectionalG.value = 0.7;
    u.sunPosition.value.copy(RaceTrack.SUN_DIR);
    sky.userData.noShadow = true;
    this.sky = sky;
    this.group.add(sky);
    // 하늘·태양·구름은 HDRI(Game.applySky)가 담당한다. 먼 산은 능선 지형 링.
    const mountains = buildMountainRing();
    this.group.add(mountains);
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
