import * as THREE from 'three';
import { toonRamp } from './Storybook';
import type { TrackGeometry } from './TrackGeometry';

/** 빌리지(도시) 테마 색 — 카트라이더 붐힐 마을처럼 밝은 파스텔 건물 + 푸른 아스팔트 */
export const CITY = {
  ground: 0xd9d3c7,
  sidewalk: 0xeae6de,
  curb: 0xb9b4ab,
  asphalt: '#566074',
  asphaltStripe: '#5d677b',
  barrier: 0xf1efe9,
  pole: 0x5f6b78,
  lamp: 0xfff2b0,
  buildings: [0xffd6a5, 0xfdffb6, 0xcaffbf, 0x9bf6ff, 0xa0c4ff, 0xbdb2ff, 0xffc6ff, 0xffadad, 0xf7ede2, 0xe9edc9],
  skyline: [0xb8c4d6, 0xc9d3e2, 0xaebbd0],
  banners: [0xffd23f, 0x9b5de5],
};

/** 창문 격자 텍스처 (흰 벽 + 푸른 창). 인스턴스 색이 곱해져 건물마다 벽색이 달라진다 */
function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#7f9fc4';
  for (let row = 0; row < 6; row++) for (let col = 0; col < 3; col++) g.fillRect(6 + col * 20, 8 + row * 20, 12, 12);
  // 1층 띠 (상가 차양 느낌)
  g.fillStyle = '#c9c2b6';
  g.fillRect(0, 120, 64, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  yaw: number;
  color: number;
}

/** 트랙 양옆 띠 (인도) — lat0..lat1 사이를 채우는 리본 */
function ribbon(track: TrackGeometry, lat0: number, lat1: number, y: number, color: number): THREE.Mesh {
  const steps = Math.ceil(track.length / 3);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * track.length;
    const a = track.getPoint(s, lat0);
    const b = track.getPoint(s, lat1);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    if (i < steps) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), side: THREE.DoubleSide }));
  m.receiveShadow = true;
  m.userData.noShadow = true;
  return m;
}

/**
 * 도시 풍경: 인도 + 트랙 둘레 건물 블록 + 가로등·배너 + 먼 스카이라인.
 * 건물은 트랙 방향에 맞춰 돌려 세워 길가 블록처럼 보이게 하고, 네 모서리가 모두 트랙(+인도)에서 떨어져 있어야 세운다.
 */
export function buildCityScape(track: TrackGeometry, rnd: () => number): THREE.Group {
  const group = new THREE.Group();
  const halfW = track.width / 2;
  const coord = { s: 0, lat: 0 };

  // ---- 인도 (양쪽) + 연석
  for (const side of [-1, 1]) {
    group.add(ribbon(track, side * (halfW + 1.2), side * (halfW + 9), 0.02, CITY.sidewalk));
    group.add(ribbon(track, side * (halfW + 1.2), side * (halfW + 1.9), 0.04, CITY.curb));
  }

  // ---- 건물
  const b = track.bounds;
  const boxes: Box[] = [];
  const clearOf = (x: number, z: number, margin: number) => Math.abs(track.project(x, z, coord).lat) >= halfW + margin;
  const fits = (bx: Box) => {
    const c = Math.cos(bx.yaw);
    const s = Math.sin(bx.yaw);
    for (const [u, v] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const lx = (u * bx.w) / 2;
      const lz = (v * bx.d) / 2;
      if (!clearOf(bx.x + lx * c + lz * s, bx.z - lx * s + lz * c, 11)) return false;
    }
    for (const o of boxes) {
      const need = (Math.max(bx.w, bx.d) + Math.max(o.w, o.d)) * 0.5;
      if (Math.hypot(o.x - bx.x, o.z - bx.z) < need) return false;
    }
    return true;
  };
  for (let tries = 0; tries < 5000 && boxes.length < 320; tries++) {
    const x = THREE.MathUtils.lerp(b.minX - 160, b.maxX + 160, rnd());
    const z = THREE.MathUtils.lerp(b.minZ - 160, b.maxZ + 160, rnd());
    const c = track.project(x, z, coord);
    const dist = Math.abs(c.lat);
    if (dist < halfW + 14 || dist > 190) continue;
    const near = dist < 60;
    const f = track.getFrame(c.s);
    const bx: Box = {
      x,
      z,
      w: 12 + rnd() * 16,
      d: 12 + rnd() * 14,
      // 길가는 낮은 상가·주택, 뒤로 갈수록 높은 빌딩
      h: near ? 8 + rnd() * 14 : 14 + rnd() * 36,
      yaw: Math.atan2(f.tan.x, f.tan.z),
      color: CITY.buildings[Math.floor(rnd() * CITY.buildings.length)],
    };
    if (fits(bx)) boxes.push(bx);
  }
  // 먼 스카이라인: 서킷을 둘러싼 고층 빌딩 링
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const ring = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 330;
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rnd() * 0.05;
    const r = ring + rnd() * 220;
    boxes.push({
      x: cx + Math.cos(a) * r,
      z: cz + Math.sin(a) * r,
      w: 26 + rnd() * 30,
      d: 26 + rnd() * 30,
      h: 50 + rnd() * 110,
      yaw: -a,
      color: CITY.skyline[Math.floor(rnd() * CITY.skyline.length)],
    });
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const wallMat = new THREE.MeshToonMaterial({ map: windowTexture(), gradientMap: toonRamp() });
  const roofMat = new THREE.MeshToonMaterial({ color: 0xe8e2d8, gradientMap: toonRamp() });
  // BoxGeometry 면 순서: +x, -x, +y(지붕), -y, +z, -z
  const buildings = new THREE.InstancedMesh(boxGeo, [wallMat, wallMat, roofMat, roofMat, wallMat, wallMat], boxes.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  boxes.forEach((bx, i) => {
    dummy.position.set(bx.x, 0, bx.z);
    dummy.rotation.set(0, bx.yaw, 0);
    dummy.scale.set(bx.w, bx.h, bx.d);
    dummy.updateMatrix();
    buildings.setMatrixAt(i, dummy.matrix);
    buildings.setColorAt(i, col.set(bx.color));
  });
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  group.add(buildings);

  // ---- 가로등 + 배너 (양쪽 번갈아 36m 간격)
  const lampStep = 36;
  const lampCount = Math.floor(track.length / lampStep);
  const poleGeo = new THREE.CylinderGeometry(0.16, 0.2, 8, 6);
  poleGeo.translate(0, 4, 0);
  const armGeo = new THREE.BoxGeometry(2.6, 0.18, 0.18);
  const headGeo = new THREE.BoxGeometry(1.1, 0.35, 0.6);
  const bannerGeo = new THREE.PlaneGeometry(1.2, 2.6);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshToonMaterial({ color: CITY.pole, gradientMap: toonRamp() }), lampCount);
  const arms = new THREE.InstancedMesh(armGeo, new THREE.MeshToonMaterial({ color: CITY.pole, gradientMap: toonRamp() }), lampCount);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: CITY.lamp }), lampCount);
  const banners = new THREE.InstancedMesh(bannerGeo, new THREE.MeshToonMaterial({ gradientMap: toonRamp(), side: THREE.DoubleSide }), lampCount);
  for (let i = 0; i < lampCount; i++) {
    const s = (i + 0.5) * lampStep;
    const side = i % 2 ? 1 : -1;
    const f = track.getFrame(s);
    const yaw = Math.atan2(f.right.x, f.right.z); // 로컬 +z 가 트랙 오른쪽
    const base = f.pos.clone().addScaledVector(f.right, side * (halfW + 4));
    dummy.position.copy(base);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    // 팔은 트랙 쪽으로
    const toward = base.clone().addScaledVector(f.right, -side * 1.2);
    dummy.position.set(toward.x, 7.9, toward.z);
    dummy.rotation.set(0, Math.atan2(f.tan.x, f.tan.z) + Math.PI / 2, 0);
    dummy.updateMatrix();
    arms.setMatrixAt(i, dummy.matrix);
    const head = base.clone().addScaledVector(f.right, -side * 2.4);
    dummy.position.set(head.x, 7.7, head.z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    // 배너: 기둥 옆, 진행 방향을 향해
    const bpos = base.clone().addScaledVector(f.right, -side * 0.75);
    dummy.position.set(bpos.x, 5, bpos.z);
    dummy.rotation.set(0, Math.atan2(f.tan.x, f.tan.z), 0);
    dummy.updateMatrix();
    banners.setMatrixAt(i, dummy.matrix);
    banners.setColorAt(i, col.set(CITY.banners[Math.floor(i / 2) % CITY.banners.length]));
  }
  poles.castShadow = true;
  group.add(poles, arms, heads, banners);
  return group;
}
