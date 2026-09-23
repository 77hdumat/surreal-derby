import * as THREE from 'three';
import type { ItemBox, Projectile } from '../game/Items';
import type { KartState } from '../game/KartPhysics';

/** 물방울/UFO 에 갇힌 동안 공중 높이 (초반 빠르게 떠오르고 마지막 0.4초에 떨어진다) */
export function bubbleLift(bubbleT: number): number {
  if (bubbleT <= 0) return 0;
  const fall = Math.min(1, bubbleT / 0.4); // 마지막 0.4초 낙하
  return 4.5 * fall;
}

/**
 * 아이템 상자·투사체·말 위 효과(물방울·실드·UFO·환각) 씬 객체.
 */
export class ItemVisuals {
  readonly group = new THREE.Group();
  private boxMeshes = new Map<number, THREE.Group>();
  private projMeshes = new Map<number, THREE.Object3D>();
  private bubbles: THREE.Mesh[] = [];
  private shields: THREE.Mesh[] = [];
  private ufos: THREE.Group[] = [];
  private gasRings: THREE.Mesh[] = [];
  private boxMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.35, metalness: 0.1, emissive: 0xffb300, emissiveIntensity: 0.25 });
  private ribbonMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.4 });
  private missileMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, roughness: 0.4, metalness: 0.3, emissive: 0xff2200, emissiveIntensity: 0.5 });
  private bombMat = new THREE.MeshPhysicalMaterial({ color: 0x4fc3f7, roughness: 0.1, transmission: 0.6, transparent: true, opacity: 0.85 });
  private bananaMat = new THREE.MeshStandardMaterial({ color: 0xffe14d, roughness: 0.6 });
  private gasMat = new THREE.MeshStandardMaterial({ color: 0xb06cff, transparent: true, opacity: 0.45, roughness: 1, emissive: 0x7a2cff, emissiveIntensity: 0.4 });
  private bubbleMat = new THREE.MeshPhysicalMaterial({ color: 0x9be7ff, roughness: 0.05, transmission: 0.7, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  private shieldMat = new THREE.MeshBasicMaterial({ color: 0x4dffb5, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  private boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  private tmp = new THREE.Vector3();
  /** 종류별 메시 풀 — 아이템을 쓰는 순간 만들지 않아 끊김이 없다 */
  private pool: Record<string, THREE.Object3D[]> = {};
  private poolBuilt = false;

  build(boxes: ItemBox[]): void {
    this.clear();
    this.buildPool();
    for (const b of boxes) {
      const g = new THREE.Group();
      const cube = new THREE.Mesh(this.boxGeo, this.boxMat);
      cube.castShadow = true;
      g.add(cube);
      for (const rot of [0, Math.PI / 2]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(1.56, 1.56, 0.3), this.ribbonMat);
        r.rotation.y = rot;
        g.add(r);
      }
      g.position.set(b.x, 1.3, b.z);
      this.group.add(g);
      this.boxMeshes.set(b.id, g);
    }
  }

  /** 투사체 메시를 미리 만들어 둔다 (지오메트리·셰이더 컴파일을 레이스 전에) */
  private buildPool(): void {
    if (this.poolBuilt) return;
    this.poolBuilt = true;
    const counts: [string, number][] = [
      ['missile', 6],
      ['waterfly', 6],
      ['banana', 18],
      ['mine', 25],
      ['gas', 4],
    ];
    for (const [kind, n] of counts) {
      this.pool[kind] = [];
      for (let i = 0; i < n; i++) {
        const m = this.createProjectileMesh(kind as Projectile['kind']);
        m.visible = false;
        this.group.add(m);
        this.pool[kind].push(m);
      }
    }
  }

  /** 셰이더 프리컴파일용: 풀 전체를 잠시 보이게 한다 */
  setPrewarm(on: boolean): void {
    for (const arr of Object.values(this.pool)) for (const m of arr) m.visible = on;
    for (const m of [...this.bubbles, ...this.shields, ...this.ufos, ...this.gasRings]) m.visible = on;
    if (!on) for (const [, m] of this.projMeshes) m.visible = true;
  }

  /** 풀에서 하나 꺼내기 (모자라면 그때 만든다) */
  private takeFromPool(kind: Projectile['kind']): THREE.Object3D {
    const arr = this.pool[kind];
    const free = arr?.find((m) => !m.visible);
    if (free) {
      free.visible = true;
      return free;
    }
    const m = this.createProjectileMesh(kind);
    this.group.add(m);
    (this.pool[kind] ??= []).push(m);
    return m;
  }

  /** 말별 효과 메시 준비 (슬롯 수만큼) */
  setSlots(n: number, heights: number[]): void {
    for (const m of [...this.bubbles, ...this.shields, ...this.ufos, ...this.gasRings]) this.group.remove(m);
    this.bubbles = [];
    this.shields = [];
    this.ufos = [];
    this.gasRings = [];
    for (let i = 0; i < n; i++) {
      const h = Math.max(2.2, heights[i] ?? 2.2);
      const bub = new THREE.Mesh(new THREE.SphereGeometry(h * 0.85, 24, 16), this.bubbleMat);
      bub.visible = false;
      this.group.add(bub);
      this.bubbles.push(bub);
      const sh = new THREE.Mesh(new THREE.SphereGeometry(h * 0.8, 20, 14), this.shieldMat);
      sh.visible = false;
      this.group.add(sh);
      this.shields.push(sh);
      const ufo = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0x9aa5b1, metalness: 0.8, roughness: 0.3 }));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x7fe0ff, transmission: 0.5, transparent: true, opacity: 0.7 }));
      dome.position.y = 0.25;
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x9cffb0, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
      beam.position.y = -3.2;
      ufo.add(disc, dome, beam);
      ufo.visible = false;
      this.group.add(ufo);
      this.ufos.push(ufo);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 24), this.gasMat);
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      this.group.add(ring);
      this.gasRings.push(ring);
    }
  }

  private createProjectileMesh(kind: Projectile['kind']): THREE.Object3D {
    const p = { kind } as Projectile;
    if (p.kind === 'missile') {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 12), this.missileMat);
      body.rotation.z = -Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 12), this.missileMat);
      nose.rotation.z = -Math.PI / 2;
      nose.position.x = 0.9;
      const fins = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.05), this.ribbonMat);
      fins.position.x = -0.5;
      const fins2 = fins.clone();
      fins2.rotation.x = Math.PI / 2;
      g.add(body, nose, fins, fins2);
      return g;
    }
    if (p.kind === 'waterfly') {
      // 물파리: 파란 몸통 + 날개 두 장
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), this.bombMat);
      body.scale.set(1.3, 0.8, 0.9);
      g.add(body);
      const wingMat = new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), wingMat);
        w.position.set(-0.1, 0.35, side * 0.5);
        w.rotation.set(Math.PI / 2 - side * 0.5, 0, 0);
        w.name = 'wing';
        g.add(w);
      }
      return g;
    }
    if (p.kind === 'gas') return new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), this.gasMat);
    if (p.kind === 'mine') {
      // 지뢰: 검은 반구 + 빨간 점멸등 + 뿔
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.6 }));
      g.add(body);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 1.6 }));
      lamp.position.y = 0.72;
      lamp.name = 'lamp';
      g.add(lamp);
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, metalness: 0.7, roughness: 0.4 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 6), spikeMat);
        sp.position.set(Math.cos(a) * 0.62, 0.32, Math.sin(a) * 0.62);
        sp.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6);
        g.add(sp);
      }
      return g;
    }
    // 바나나: 휘어진 토러스 조각
    const b = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.3, 8, 14, Math.PI * 0.9), this.bananaMat);
    b.rotation.set(Math.PI / 2, 0, 0.5);
    b.position.y = 0.35;
    return b;
  }

  update(dt: number, time: number, boxes: ItemBox[], projectiles: Projectile[], karts: KartState[], roots: THREE.Object3D[]): void {
    for (const b of boxes) {
      const m = this.boxMeshes.get(b.id);
      if (!m) continue;
      m.visible = b.takenT < 0;
      m.rotation.y = time * 1.4 + b.id;
      m.rotation.x = Math.sin(time * 2 + b.id) * 0.2;
      m.position.y = 1.3 + Math.sin(time * 2.5 + b.id * 0.7) * 0.2;
    }
    const alive = new Set<number>();
    for (const p of projectiles) {
      if (p.done) continue;
      alive.add(p.id);
      let m = this.projMeshes.get(p.id);
      if (!m) {
        m = this.takeFromPool(p.kind);
        m.scale.setScalar(1);
        this.projMeshes.set(p.id, m);
      }
      m.position.set(p.x, p.y + (p.kind === 'banana' ? 0 : 0.4), p.z);
      if (p.kind === 'missile' || p.kind === 'waterfly') m.rotation.y = p.yaw;
      if (p.kind === 'waterfly') m.children.forEach((c) => { if (c.name === 'wing') c.rotation.x = Math.PI / 2 + Math.sin(time * 60 + c.position.z) * 0.6; });
      if (p.kind === 'gas') {
        // 착지 뒤엔 구름 반경으로 커진다
        m.scale.setScalar(p.age > 1.1 ? 6.5 : 1);
      }
      if (p.kind === 'banana') m.rotation.y = time * 2;
      if (p.kind === 'mine') {
        m.rotation.y = time * 0.8;
        const lamp = m.children.find((c) => c.name === 'lamp') as THREE.Mesh | undefined;
        if (lamp) (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + Math.abs(Math.sin(time * 6)) * 1.8;
      }
    }
    for (const [id, m] of this.projMeshes) {
      if (alive.has(id)) continue;
      m.visible = false; // 풀로 반환
      this.projMeshes.delete(id);
    }
    // 말 위 효과
    karts.forEach((k, i) => {
      const root = roots[i];
      const bub = this.bubbles[i];
      const sh = this.shields[i];
      const ufo = this.ufos[i];
      const ring = this.gasRings[i];
      if (!root || !bub) return;
      this.tmp.copy(root.position);
      const h = bub.geometry.boundingSphere?.radius ?? 2;
      bub.visible = k.bubbleT > 0;
      if (bub.visible) {
        // 물방울에 갇혀 공중으로 떠올랐다가 끝날 때 떨어진다 (root 높이는 RacerManager 가 같은 곡선으로 올린다)
        const lift = bubbleLift(k.bubbleT);
        bub.position.set(this.tmp.x, h * 0.9 + lift + Math.sin(time * 4) * 0.15, this.tmp.z);
        // 탈출 진행도만큼 부풀고 흔들린다 (곧 터질 것처럼)
        bub.scale.setScalar(0.9 + Math.sin(time * 6) * 0.05 + k.escape * 0.35);
        (bub.material as THREE.MeshPhysicalMaterial).opacity = 0.55 - k.escape * 0.25;
      }
      sh.visible = k.shieldT > 0;
      if (sh.visible) {
        sh.position.set(this.tmp.x, h * 0.85, this.tmp.z);
        sh.rotation.y = time * 2;
        (sh.material as THREE.MeshBasicMaterial).opacity = k.shieldT < 1.5 ? 0.28 * (0.5 + 0.5 * Math.abs(Math.sin(time * 12))) : 0.28;
      }
      ufo.visible = k.bubbleT > 2.45 || (k.bubbleT > 0 && ufo.visible);
      if (ufo.visible) {
        ufo.position.set(this.tmp.x, h * 2 + 5.5, this.tmp.z);
        ufo.rotation.y = time * 3;
      }
      ring.visible = k.confuseT > 0;
      if (ring.visible) {
        ring.position.set(this.tmp.x, h * 1.3 + Math.sin(time * 5) * 0.2, this.tmp.z);
        ring.rotation.z = time * 4;
        ring.scale.setScalar(1 + Math.sin(time * 8) * 0.15);
      }
    });
    void dt;
  }

  clear(): void {
    for (const m of this.boxMeshes.values()) this.group.remove(m);
    this.boxMeshes.clear();
    for (const m of this.projMeshes.values()) m.visible = false;
    this.projMeshes.clear();
  }
}
