import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { loadAsset } from '../racers/rig/Assets';

/**
 * 실사 배경 모델 (Sketchfab CC-BY, public/models/CREDITS.md)
 *  - trees.glb     "Realistic Trees Collection" — 나무 4종, 이름 접두사로 분리해 프로토타입 → 복제 배치
 *  - mountains.glb "Tatra Mountains" — 위성 텍스처 DEM 타일, 트랙 둘레 4방향에 배치
 *  - stand.glb     "Race Track Viewing Stand" — 관중석 모듈, 직선주로를 따라 타일링
 *  - 호수: three Water (반사 + 절차 노멀맵)
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export interface TreePrototype {
  group: THREE.Group;
  /** 프로토타입 높이(m, 스케일 1 기준) */
  height: number;
}

/** 나무 프로토타입: 메쉬 이름 접두사별로 묶고 밑동 중심을 원점으로 옮긴다 */
export async function loadTreePrototypes(): Promise<TreePrototype[]> {
  const gltf = await loadAsset(`${BASE}/models/trees.glb`);
  gltf.scene.updateMatrixWorld(true);
  const byTree = new Map<string, THREE.Mesh[]>();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const key = m.name.split('_')[0]; // "Tree EZTree0.Large" 등
    if (!byTree.has(key)) byTree.set(key, []);
    byTree.get(key)!.push(m);
  });
  const protos: TreePrototype[] = [];
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const meshes of byTree.values()) {
    box.makeEmpty();
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      box.union(tmp);
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const g = new THREE.Group();
    for (const m of meshes) {
      const c = new THREE.Mesh(m.geometry, m.material);
      c.applyMatrix4(m.matrixWorld);
      c.position.x -= center.x;
      c.position.z -= center.z;
      c.position.y -= box.min.y;
      const mat = c.material as THREE.MeshStandardMaterial;
      const leafy = /leaves/i.test(mat.name) || /leaves/i.test(m.name);
      if (leafy) {
        mat.alphaTest = 0.45;
        mat.transparent = false;
        mat.side = THREE.DoubleSide;
        mat.depthWrite = true;
      }
      mat.roughness = 0.9;
      c.castShadow = true;
      c.receiveShadow = !leafy;
      g.add(c);
    }
    protos.push({ group: g, height: size.y });
  }
  // 큰 나무부터
  protos.sort((a, b) => b.height - a.height);
  return protos;
}

/** 프로토타입 복제 (지오메트리·재질 공유) */
export function cloneTree(proto: TreePrototype, targetHeight: number): THREE.Group {
  const g = proto.group.clone(true);
  g.scale.setScalar(targetHeight / proto.height);
  return g;
}

/** 먼 산: DEM 타일을 스케일해 4방향에 배치 */
export async function loadMountains(): Promise<THREE.Group> {
  const gltf = await loadAsset(`${BASE}/models/mountains.glb`);
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = true;
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.roughness = 1;
    mat.metalness = 0;
  });
  const group = new THREE.Group();
  const scale = 0.75;
  const ring = 1500; // 타일 중심 거리
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const tile = src.clone(true);
    tile.scale.setScalar(scale);
    // 타일 중심을 원점으로, 바닥(min.y)을 -5m 에
    tile.position.set(-center.x * scale, -box.min.y * scale - 5, -center.z * scale);
    const holder = new THREE.Group();
    holder.add(tile);
    holder.position.set(Math.cos(a) * ring, 0, Math.sin(a) * ring);
    holder.rotation.y = -a + Math.PI / 2 + (i % 2 ? Math.PI : 0); // 긴 변이 접선 방향
    group.add(holder);
  }
  group.userData.noShadow = true;
  void size;
  return group;
}

export interface StandModule {
  group: THREE.Group;
  /** 관중 좌석 위치 (월드) 생성기 */
  seats: THREE.Vector3[];
}

/** 관중석 모듈 타일링. front = 트랙 쪽 z, length = 덮을 길이 */
export async function loadGrandstand(frontZ: number, length: number): Promise<StandModule> {
  const gltf = await loadAsset(`${BASE}/models/stand.glb`);
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const scale = 9.5 / size.y; // 높이 9.5m
  const moduleLen = size.z * scale;
  const count = Math.max(1, Math.round(length / moduleLen));
  const group = new THREE.Group();
  const seats: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const m = src.clone(true);
    m.scale.setScalar(scale);
    // 모델: 낮은 줄이 -x, 길이 방향이 z. -π/2 회전 → 앞(-x)이 -z(트랙) 를 보고 길이는 x 방향
    const holder = new THREE.Group();
    holder.add(m);
    m.position.set(-box.min.x * scale, -box.min.y * scale, -(box.min.z + box.max.z) * 0.5 * scale);
    holder.rotation.y = -Math.PI / 2;
    holder.position.set(-length / 2 + moduleLen * (i + 0.5), 0, frontZ);
    group.add(holder);
    holder.updateMatrixWorld(true);
    // 좌석: 7줄, 줄마다 x(깊이) 3.1·y 2.3 간격 (모델 단위), 길이 방향 z
    for (let r = 0; r < 7; r++) {
      const lx = -11.3 + 3.1 * r + 1.1 - box.min.x;
      const ly = 7.7 + 2.3 * r + 1.6 - box.min.y;
      for (let k = 0; k < 28; k++) {
        const lz = -32 + (k + 0.5) * (66 / 28) - (box.min.z + box.max.z) * 0.5;
        p.set(lx * scale, ly * scale, lz * scale);
        holder.localToWorld(p);
        seats.push(p.clone());
      }
    }
  }
  return { group, seats };
}

/** 절차 물결 노멀맵 (sin 합성) */
function waterNormals(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const h = (x: number, y: number) =>
    Math.sin(x * 0.11 + y * 0.07) * 0.5 + Math.sin(x * 0.05 - y * 0.13) * 0.35 + Math.sin((x + y) * 0.21) * 0.2 + Math.sin(x * 0.31 - y * 0.02) * 0.1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const nx = -dx * 0.9;
      const ny = -dy * 0.9;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * n + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 반사되는 3D 호수 */
export function makeLake(radiusX: number, radiusZ: number, sunDir: THREE.Vector3): Water {
  const geo = new THREE.CircleGeometry(1, 48);
  geo.scale(radiusX, radiusZ, 1);
  const water = new Water(geo, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: waterNormals(),
    sunDirection: sunDir.clone(),
    sunColor: 0xffffff,
    waterColor: 0x2a5f6e,
    distortionScale: 2.2,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.material.uniforms.size.value = 6;
  water.userData.noShadow = true;
  return water;
}
