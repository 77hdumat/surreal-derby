import * as THREE from 'three';

export type JockeyHead = 'skull' | 'pig' | 'cat' | 'robot' | 'alien' | 'pumpkin';

const std = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
const R = 0.16; // 사람 머리(≈0.12)를 덮는 크기

function sphere(r: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * 기수 캐릭터 머리 (절차 메시). 로컬: +x 전방, +y 위, 원점 = 머리 중심. 헬멧 대신 머리뼈에 붙인다.
 */
export function makeJockeyHead(kind: JockeyHead): THREE.Group {
  const g = new THREE.Group();
  const black = std(0x101010, { roughness: 0.5 });
  switch (kind) {
    case 'skull': {
      const bone = std(0xf1ede2, { roughness: 0.55 });
      const cranium = sphere(R, bone);
      cranium.scale.set(1, 1.05, 0.95);
      g.add(cranium);
      for (const z of [-0.055, 0.055]) g.add(sphere(0.042, black, R * 0.78, 0.02, z)); // 눈구멍
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 3), black);
      nose.rotation.set(0, 0, -Math.PI / 2);
      nose.position.set(R * 0.92, -0.035, 0);
      g.add(nose);
      // 턱 + 이빨
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.13), bone);
      jaw.position.set(R * 0.45, -0.115, 0);
      g.add(jaw);
      const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.028, 0.11), black);
      teeth.position.set(R * 0.8, -0.085, 0);
      g.add(teeth);
      for (let i = 0; i < 5; i++) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.012), bone);
        t.position.set(R * 0.81, -0.085, -0.044 + i * 0.022);
        g.add(t);
      }
      break;
    }
    case 'pig': {
      const pink = std(0xf4a3b5);
      const head = sphere(R, pink);
      head.scale.set(1.05, 0.95, 1);
      g.add(head);
      const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.06, 20), std(0xf08aa0));
      snout.rotation.z = -Math.PI / 2;
      snout.position.set(R * 0.95, -0.02, 0);
      g.add(snout);
      for (const z of [-0.022, 0.022]) g.add(sphere(0.011, std(0x8a3a4c), R * 0.95 + 0.032, -0.02, z)); // 콧구멍
      for (const z of [-0.06, 0.06]) g.add(sphere(0.02, black, R * 0.75, 0.05, z)); // 눈
      for (const z of [-0.09, 0.09]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 4), std(0xef8fa6));
        ear.position.set(-0.02, R * 0.85, z);
        ear.rotation.set(z > 0 ? 0.35 : -0.35, 0, 0.2);
        g.add(ear);
      }
      break;
    }
    case 'cat': {
      const fur = std(0xe8a34a);
      const head = sphere(R, fur);
      head.scale.set(1, 0.92, 1.05);
      g.add(head);
      for (const z of [-0.085, 0.085]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.11, 4), fur);
        ear.position.set(0, R * 0.9, z);
        ear.rotation.y = Math.PI / 4;
        g.add(ear);
        const inner = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 4), std(0xf3b4c0));
        inner.position.set(0.015, R * 0.88, z);
        inner.rotation.y = Math.PI / 4;
        g.add(inner);
      }
      for (const z of [-0.06, 0.06]) {
        g.add(sphere(0.03, std(0x7fd36b, { roughness: 0.3 }), R * 0.78, 0.03, z));
        const pupil = sphere(0.012, black, R * 0.78 + 0.025, 0.03, z);
        pupil.scale.set(1, 1.6, 0.6);
        g.add(pupil);
      }
      g.add(sphere(0.016, std(0xf49ab0), R * 0.98, -0.02, 0)); // 코
      const whisk = std(0xfaf5ea);
      for (const side of [-1, 1]) for (const dy of [-0.012, 0.012]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.16, 4), whisk);
        w.position.set(R * 0.85, -0.03 + dy, side * 0.09);
        w.rotation.set(Math.PI / 2, 0, side * 0.25);
        g.add(w);
      }
      // 줄무늬
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.012), std(0xb56a1e));
        s.position.set(-0.03 + i * 0.03, R * 0.9, -0.03 + i * 0.03);
        g.add(s);
      }
      break;
    }
    case 'robot': {
      const metal = std(0x9aa5b1, { roughness: 0.35, metalness: 0.7 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.3, 0.27), metal);
      box.castShadow = true;
      g.add(box);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.22), std(0x0d1117, { roughness: 0.2 }));
      visor.position.set(0.135, 0.03, 0);
      g.add(visor);
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0x3ff2ff, emissive: 0x2ad7ff, emissiveIntensity: 1.6 });
      for (const z of [-0.06, 0.06]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.035, 0.05), eyeMat);
        e.position.set(0.147, 0.03, z);
        g.add(e);
      }
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.025, 0.14), eyeMat);
      mouth.position.set(0.14, -0.08, 0);
      g.add(mouth);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8), metal);
      ant.position.set(0, 0.21, 0);
      g.add(ant);
      g.add(sphere(0.022, new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 1.5 }), 0, 0.28, 0));
      for (const z of [-0.15, 0.15]) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8), std(0x6b7480, { metalness: 0.8, roughness: 0.4 }));
        bolt.rotation.x = Math.PI / 2;
        bolt.position.set(0, 0.02, z);
        g.add(bolt);
      }
      break;
    }
    case 'alien': {
      const skin = std(0x86d66f, { roughness: 0.45 });
      const head = sphere(R, skin);
      head.scale.set(0.95, 1.3, 1);
      head.position.y = 0.03;
      g.add(head);
      for (const z of [-0.065, 0.065]) {
        const eye = sphere(0.05, std(0x090909, { roughness: 0.15 }), R * 0.72, 0.04, z);
        eye.scale.set(0.6, 1.5, 1);
        eye.rotation.x = z > 0 ? -0.5 : 0.5;
        g.add(eye);
      }
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.008, 0.05), black);
      mouth.position.set(R * 0.9, -0.08, 0);
      g.add(mouth);
      for (const z of [-0.05, 0.05]) {
        const a = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), skin);
        a.position.set(-0.02, R * 1.3 + 0.03, z);
        a.rotation.x = z > 0 ? -0.4 : 0.4;
        g.add(a);
        g.add(sphere(0.018, std(0xfff36b, { emissive: 0xffe14d, emissiveIntensity: 0.8 }), -0.02, R * 1.3 + 0.09, z * 1.9));
      }
      break;
    }
    case 'pumpkin': {
      const orange = std(0xf28c28, { roughness: 0.6 });
      const body = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const seg = sphere(R * 0.92, orange);
        const a = (i / 6) * Math.PI;
        seg.position.set(Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02);
        seg.scale.set(1, 0.85, 1);
        body.add(seg);
      }
      g.add(body);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.07, 8), std(0x4e7a2a));
      stem.position.set(0, R * 0.85, 0);
      stem.rotation.z = 0.25;
      g.add(stem);
      const glow = new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffb300, emissiveIntensity: 1.4 });
      for (const z of [-0.055, 0.055]) {
        const eye = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.045, 3), glow);
        eye.rotation.set(0, 0, -Math.PI / 2);
        eye.rotation.y = Math.PI / 2;
        eye.position.set(R * 0.8, 0.03, z);
        g.add(eye);
      }
      const mouth = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.01, i % 2 ? 0.02 : 0.035, 0.022), glow);
        t.position.set(R * 0.82, -0.055 + (i % 2 ? 0.008 : 0), -0.05 + i * 0.025);
        mouth.add(t);
      }
      g.add(mouth);
      break;
    }
  }
  return g;
}
