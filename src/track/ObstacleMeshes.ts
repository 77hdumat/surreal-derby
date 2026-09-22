import * as THREE from 'three';
import type { Obstacle } from '../game/Obstacles';

/**
 * 장애물 씬 객체: 건초더미(원통) / 진흙(어두운 원판) / 부스트 패드(빛나는 화살표 판).
 * 레이스마다 build → dispose.
 */
export class ObstacleMeshes {
  readonly group = new THREE.Group();
  private pads: THREE.Mesh[] = [];
  private padMat: THREE.MeshStandardMaterial;

  constructor() {
    this.padMat = new THREE.MeshStandardMaterial({ color: 0xff8a00, emissive: 0xff6a00, emissiveIntensity: 1.2, roughness: 0.4 });
  }

  build(obstacles: Obstacle[]): void {
    this.clear();
    const hay = new THREE.MeshStandardMaterial({ color: 0xd2a94a, roughness: 0.95 });
    const hayGeo = new THREE.CylinderGeometry(0.75, 0.75, 1.6, 14);
    const strap = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.8 });
    const mudMat = new THREE.MeshStandardMaterial({ color: 0x3d2a17, roughness: 1, transparent: true, opacity: 0.9 });
    const arrow = new THREE.Shape();
    arrow.moveTo(-0.9, -0.6);
    arrow.lineTo(0.3, -0.6);
    arrow.lineTo(0.3, -1.1);
    arrow.lineTo(1.3, 0);
    arrow.lineTo(0.3, 1.1);
    arrow.lineTo(0.3, 0.6);
    arrow.lineTo(-0.9, 0.6);
    arrow.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrow);
    const padBase = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6, metalness: 0.3 });
    for (const o of obstacles) {
      if (o.kind === 'bale') {
        // 건초 두 덩이 (누운 원통) + 끈
        const g = new THREE.Group();
        for (let i = 0; i < 2; i++) {
          const m = new THREE.Mesh(hayGeo, hay);
          m.rotation.z = Math.PI / 2;
          m.position.set(0, 0.75, (i - 0.5) * 1.55);
          m.castShadow = true;
          m.receiveShadow = true;
          g.add(m);
          for (const off of [-0.45, 0.45]) {
            const b = new THREE.Mesh(new THREE.TorusGeometry(0.77, 0.04, 6, 20), strap);
            b.position.set(off, 0.75, (i - 0.5) * 1.55);
            b.rotation.y = Math.PI / 2;
            g.add(b);
          }
        }
        g.position.set(o.x, 0, o.z);
        g.rotation.y = o.yaw + 0.3;
        this.group.add(g);
      } else if (o.kind === 'mud') {
        const m = new THREE.Mesh(new THREE.CircleGeometry(o.radius, 24), mudMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(o.x, 0.02, o.z);
        m.scale.set(1.25, 0.85, 1);
        m.rotation.z = o.yaw;
        m.receiveShadow = true;
        this.group.add(m);
      } else {
        const base = new THREE.Mesh(new THREE.CircleGeometry(o.radius, 24), padBase);
        base.rotation.x = -Math.PI / 2;
        base.position.set(o.x, 0.02, o.z);
        this.group.add(base);
        const a = new THREE.Mesh(arrowGeo, this.padMat);
        a.rotation.x = -Math.PI / 2;
        a.rotation.z = o.yaw; // 평면 +x 가 트랙 진행 방향
        a.position.set(o.x, 0.04, o.z);
        a.scale.setScalar(1.15);
        this.group.add(a);
        this.pads.push(a);
      }
    }
  }

  update(time: number): void {
    this.padMat.emissiveIntensity = 0.9 + Math.sin(time * 6) * 0.5;
    for (const p of this.pads) p.position.y = 0.04 + Math.sin(time * 6) * 0.01;
  }

  clear(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    this.pads = [];
  }
}
