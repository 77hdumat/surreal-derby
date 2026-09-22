import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  /** 삼각형 수 (배치 예산용) */
  tris: number;
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
      c.castShadow = !leafy; // 잎 알파 그림자는 비용이 커서 줄기만 그림자
      c.receiveShadow = !leafy;
      g.add(c);
    }
    const tris = meshes.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
    protos.push({ group: g, height: size.y, tris });
  }
  // 가벼운 나무부터 (먼 곳엔 앞쪽 = 가벼운 것만 쓴다)
  protos.sort((a, b) => a.tris - b.tris);
  return protos;
}

/** 프로토타입 복제 (지오메트리·재질 공유) */
export function cloneTree(proto: TreePrototype, targetHeight: number): THREE.Group {
  const g = proto.group.clone(true);
  g.scale.setScalar(targetHeight / proto.height);
  return g;
}

/**
 * 먼 산: 위성 텍스처 DEM 타일. 타일 가장자리가 수직 절벽처럼 잘려 보이지 않도록
 * 가장자리로 갈수록 높이를 0 으로 눌러(테이퍼) 산줄기 섬처럼 만들고, 8각 링으로 둘러 배치한다.
 */
export async function loadMountains(): Promise<THREE.Group> {
  const gltf = await loadAsset(`${BASE}/models/mountains.glb`);
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const center = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = true;
    // 지오메트리 테이퍼 (월드 좌표 기준으로 판정 후 다시 로컬로)
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    inv.copy(m.matrixWorld).invert();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const ex = Math.abs(v.x - center.x) / half.x;
      const ez = Math.abs(v.z - center.z) / half.z;
      const e = Math.max(ex, ez); // 0 중심 … 1 가장자리
      const taper = 1 - THREE.MathUtils.smoothstep(e, 0.55, 1.0);
      v.y = box.min.y + (v.y - box.min.y) * taper;
      v.applyMatrix4(inv);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    m.geometry.computeVertexNormals();
    m.geometry.computeBoundingSphere();
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.roughness = 1;
    mat.metalness = 0;
    // 위성 텍스처가 어두워 조금 밝히고, 먼 산의 대기 산란은 옅은 하늘색 발광으로
    mat.color.setRGB(1.25, 1.25, 1.2);
    mat.emissive.set(0x8fa6c4);
    mat.emissiveIntensity = 0.16;
    mat.fog = false;
    mat.needsUpdate = true;
  });
  const group = new THREE.Group();
  const scale = 0.55;
  const ring = 1550; // 서킷(±620m)과 안 겹치게 멀리
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const tile = src.clone(true);
    tile.scale.setScalar(scale);
    tile.position.set(-center.x * scale, -box.min.y * scale - 3, -center.z * scale);
    const holder = new THREE.Group();
    holder.add(tile);
    holder.position.set(Math.cos(a) * ring, 0, Math.sin(a) * ring);
    holder.rotation.y = -a + Math.PI / 2 + (i % 2 ? Math.PI : 0);
    group.add(holder);
  }
  group.userData.noShadow = true;
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
  gltf.scene.updateMatrixWorld(true);
  // 좌석 하나하나가 별도 메쉬(수백 개) → 재질별로 병합해 드로우콜을 모듈당 몇 개로 줄인다
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // 양자화(int16 normalized) 속성은 월드 행렬을 적용하면 [-1,1] 로 잘리므로 float 로 풀어서 병합
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv'] as const) {
      const a = m.geometry.getAttribute(k) as THREE.BufferAttribute | undefined;
      if (!a) continue;
      const item = a.itemSize;
      const arr = new Float32Array(a.count * item);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < item; c++) arr[i * item + c] = a.getComponent(i, c);
      g.setAttribute(k, new THREE.BufferAttribute(arr, item));
    }
    if (m.geometry.index) g.setIndex(m.geometry.index.clone());
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.applyMatrix4(m.matrixWorld);
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g);
  });
  const src = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    src.add(mesh);
  }
  src.updateMatrixWorld(true);
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

/** 호수: 환경맵(HDRI) 반사 + 흐르는 노멀맵. 평면 반사 패스(Water) 대신 써서 렌더 비용을 아낀다 */
export function makeLake(radiusX: number, radiusZ: number, _sunDir: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.CircleGeometry(1, 48);
  geo.scale(radiusX, radiusZ, 1);
  const normals = waterNormals();
  normals.repeat.set(radiusX / 4, radiusZ / 4);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2f6b78,
    roughness: 0.06,
    metalness: 0.15,
    normalMap: normals,
    normalScale: new THREE.Vector2(0.35, 0.35),
    envMapIntensity: 1.6,
    transparent: true,
    opacity: 0.94,
  });
  const water = new THREE.Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.userData.noShadow = true;
  water.userData.waterNormals = normals;
  return water;
}
