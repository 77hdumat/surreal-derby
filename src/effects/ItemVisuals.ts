import * as THREE from 'three';
import type { ItemBox, Projectile } from '../game/Items';
import type { KartState } from '../game/KartPhysics';

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

  build(boxes: ItemBox[]): void {
    this.clear();
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

  private makeProjectile(p: Projectile): THREE.Object3D {
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
    if (p.kind === 'waterbomb') return new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), this.bombMat);
    if (p.kind === 'gas') return new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), this.gasMat);
    // 바나나: 휘어진 토러스 조각
    const b = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.16, 8, 12, Math.PI * 0.9), this.bananaMat);
    b.rotation.set(Math.PI / 2, 0, 0.5);
    b.position.y = 0.2;
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
        m = this.makeProjectile(p);
        this.group.add(m);
        this.projMeshes.set(p.id, m);
      }
      m.position.set(p.x, p.y + (p.kind === 'banana' ? 0 : 0.4), p.z);
      if (p.kind === 'missile') m.rotation.y = p.yaw;
      if (p.kind === 'waterbomb' || p.kind === 'gas') {
        // 착지 뒤엔 폭발/구름 반경으로 커진다
        const exploded = p.age > 1.1;
        const s = exploded ? (p.kind === 'gas' ? 6.5 : 6.5) : 1;
        m.scale.setScalar(s);
        (m as THREE.Mesh).material = exploded && p.kind === 'waterbomb' ? this.bubbleMat : (m as THREE.Mesh).material;
      }
      if (p.kind === 'banana') m.rotation.y = time * 2;
    }
    for (const [id, m] of this.projMeshes) {
      if (alive.has(id)) continue;
      this.group.remove(m);
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
        bub.position.set(this.tmp.x, h * 0.9 + Math.sin(time * 4) * 0.15, this.tmp.z);
        bub.scale.setScalar(0.9 + Math.sin(time * 6) * 0.05);
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
    for (const m of this.projMeshes.values()) this.group.remove(m);
    this.projMeshes.clear();
  }
}
