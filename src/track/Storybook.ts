import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { loadAsset } from '../racers/rig/Assets';
import type { TrackGeometry } from './TrackGeometry';

/**
 * 동화책 스타일 월드: 파스텔 그라데이션 하늘, 로우폴리(CC0 Quaternius) 나무·덤불·꽃·바위·산·구름.
 * 실사 HDRI·위성 산·PBR 잔디를 대신한다.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const M = (n: string) => `${BASE}/models/storybook/${n}.glb`;

export const PALETTE = {
  skyTop: 0x4fa8ec,
  skyHorizon: 0xffe6c4,
  ground: 0x8fd06a,
  groundDark: 0x7cbd58,
  // 흙 트랙: 초록 잔디와 확실히 구분되는 붉은 흙색
  track: 0xc49a76,
  trackStripe: 0xba8f6b,
  trackEdge: 0x8a5a36,
  pond: 0x5fc6e0,
};

/** 태양 방향: 늦은 오후(고도 ~24°) — 긴 그림자와 따뜻한 빛 (three.js keyframes 예제의 Sky 설정 참고) */
export const STORY_SUN = new THREE.Vector3(0.62, 0.42, 0.66).normalize();

let toonGradient: THREE.DataTexture | null = null;
/** 셀 셰이딩 3단계 램프 (그림자 · 중간 · 밝음) */
export function toonRamp(): THREE.DataTexture {
  if (toonGradient) return toonGradient;
  const data = new Uint8Array([110, 110, 185, 185, 255, 255]);
  toonGradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  toonGradient.minFilter = THREE.NearestFilter;
  toonGradient.magFilter = THREE.NearestFilter;
  toonGradient.needsUpdate = true;
  return toonGradient;
}

/** MeshStandardMaterial → 카툰 셀 셰이딩 재질 (색·텍스처·투명도 유지) */
export function toToon(mat: THREE.Material): THREE.Material {
  const sm = mat as THREE.MeshStandardMaterial;
  if (!sm.isMeshStandardMaterial) return mat;
  const t = new THREE.MeshToonMaterial({
    color: sm.color.clone(),
    map: sm.map,
    gradientMap: toonRamp(),
    transparent: sm.transparent,
    opacity: sm.opacity,
    side: sm.side,
    alphaTest: sm.alphaTest,
    vertexColors: sm.vertexColors,
    emissive: sm.emissive.clone(),
    emissiveIntensity: sm.emissiveIntensity,
  });
  t.name = sm.name;
  return t;
}

/** 오브젝트 전체 재질을 카툰으로 */
export function toonify(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map(toToon) : toToon(m.material);
  });
}

/** 물리 하늘: 맑고(탁도 0) 푸른 산란 + 낮은 해의 따뜻한 지평선 (three.js keyframes 예제 설정) */
export function makeCartoonSky(): THREE.Mesh {
  const sky = new Sky();
  sky.scale.setScalar(4500);
  const u = sky.material.uniforms;
  u.turbidity.value = 0;
  u.rayleigh.value = 3;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.7;
  u.sunPosition.value.copy(STORY_SUN);
  sky.userData.noShadow = true;
  sky.frustumCulled = false;
  return sky;
}

/** 하늘 돔: 위는 하늘색, 지평선은 크림색 (안개·조명 영향 없음) */
export function makeSkyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.8));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.noShadow = true;
  return dome;
}

/** 로우폴리 모델 재질을 동화책 톤으로: 거칠고 무광, 약간 밝게 */
function soften(root: THREE.Object3D, shadow = true): void {
  toonify(root);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = shadow;
    m.receiveShadow = true;
  });
}

async function proto(name: string, targetHeight: number, shadow = true): Promise<THREE.Object3D> {
  const gltf = await loadAsset(M(name));
  const src = gltf.scene.clone(true);
  const box = new THREE.Box3().setFromObject(src);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const s = targetHeight / h;
  src.scale.setScalar(s);
  src.position.y = -box.min.y * s;
  const holder = new THREE.Group();
  holder.add(src);
  soften(holder, shadow);
  return holder;
}

/** 정적 복제본을 많이 뿌리므로 행렬 갱신을 끈다 */
function freeze(o: THREE.Object3D): void {
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    c.matrixAutoUpdate = false;
  });
}

export interface StorybookWorld {
  group: THREE.Group;
  clouds: THREE.Object3D[];
}

/**
 * 서킷 주변을 채운다. project() 로 트랙에서의 거리를 재서 트랙 위에는 아무것도 두지 않는다.
 */
export async function loadStorybookWorld(track: TrackGeometry, rnd: () => number = Math.random): Promise<StorybookWorld> {
  const group = new THREE.Group();
  const [treeA, treeC, bush, flowers, rock, mountains, mountainGroup, cloudA, cloudC] = await Promise.all([
    proto('tree_a', 11),
    proto('tree_c', 13),
    proto('bush', 2.2),
    proto('flowers', 1.2, false),
    proto('rock', 2.4),
    proto('mountains', 140, false),
    proto('mountain_group', 170, false),
    proto('cloud_a', 16, false),
    proto('cloud_c', 12, false),
  ]);
  const halfW = track.width / 2;
  const b = track.bounds;
  const coord = { s: 0, lat: 0 };
  const place = (p: THREE.Object3D, x: number, z: number, scale: number) => {
    const c = p.clone(true);
    c.position.set(x, 0, z);
    c.rotation.y = rnd() * Math.PI * 2;
    c.scale.multiplyScalar(scale);
    freeze(c);
    group.add(c);
  };
  const scatter = (p: THREE.Object3D, count: number, minLat: number, maxLat: number, sMin: number, sMax: number) => {
    let placed = 0;
    for (let tries = 0; tries < count * 12 && placed < count; tries++) {
      const x = THREE.MathUtils.lerp(b.minX - 80, b.maxX + 80, rnd());
      const z = THREE.MathUtils.lerp(b.minZ - 80, b.maxZ + 80, rnd());
      const lat = Math.abs(track.project(x, z, coord).lat);
      if (lat < minLat || lat > maxLat) continue;
      place(p, x, z, THREE.MathUtils.lerp(sMin, sMax, rnd()));
      placed++;
    }
  };
  // 나무: 트랙에서 12~120m
  scatter(treeA, 70, halfW + 12, 120, 0.8, 1.4);
  scatter(treeC, 50, halfW + 14, 120, 0.8, 1.3);
  // 덤불·꽃·바위: 트랙 가장자리 가까이 (펜스 바로 바깥)
  scatter(bush, 90, halfW + 5, 30, 0.8, 1.6);
  scatter(flowers, 140, halfW + 5, 26, 0.8, 1.4);
  scatter(rock, 40, halfW + 5, 60, 0.6, 1.5);
  // 먼 산: 서킷을 둘러싼 링
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const ring = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + 520;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.2;
    const r = ring + rnd() * 160;
    const m = (i % 2 ? mountainGroup : mountains).clone(true);
    m.position.set(cx + Math.cos(a) * r, -2, cz + Math.sin(a) * r);
    m.rotation.y = -a + Math.PI / 2 + rnd() * 0.6;
    m.scale.multiplyScalar(0.9 + rnd() * 0.7);
    freeze(m);
    group.add(m);
  }
  // 구름: 하늘에 떠서 천천히 흐른다
  const clouds: THREE.Object3D[] = [];
  for (let i = 0; i < 26; i++) {
    const c = (i % 3 ? cloudA : cloudC).clone(true);
    c.position.set(THREE.MathUtils.lerp(b.minX - 500, b.maxX + 500, rnd()), 120 + rnd() * 110, THREE.MathUtils.lerp(b.minZ - 500, b.maxZ + 500, rnd()));
    c.rotation.y = rnd() * Math.PI * 2;
    c.scale.multiplyScalar(1 + rnd() * 1.8);
    c.userData.speed = 3 + rnd() * 5;
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      const mat = m.material as THREE.MeshToonMaterial;
      if (mat.color) mat.color.set(0xffffff);
      if (mat.emissive) {
        mat.emissive.set(0xfff1dc);
        mat.emissiveIntensity = 0.45;
      }
    });
    group.add(c);
    clouds.push(c);
  }
  return { group, clouds };
}

/** 구름 흐름 (x 방향으로 흘러가다 반대편으로 돌아온다) */
export function driftClouds(clouds: THREE.Object3D[], dt: number, minX: number, maxX: number): void {
  for (const c of clouds) {
    c.position.x += (c.userData.speed as number) * dt;
    if (c.position.x > maxX + 600) c.position.x = minX - 600;
  }
}
