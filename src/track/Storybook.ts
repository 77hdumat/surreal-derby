import * as THREE from 'three';
import { loadAsset } from '../racers/rig/Assets';
import type { TrackGeometry } from './TrackGeometry';

/**
 * 동화책 스타일 월드: 파스텔 그라데이션 하늘, 로우폴리(CC0 Quaternius) 나무·덤불·꽃·바위·산·구름.
 * 실사 HDRI·위성 산·PBR 잔디를 대신한다.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const M = (n: string) => `${BASE}/models/storybook/${n}.glb`;

export const PALETTE = {
  skyTop: 0x78c4f0,
  skyHorizon: 0xfff3dc,
  ground: 0x9fd67a,
  groundDark: 0x86c466,
  track: 0xf0d9a6,
  trackStripe: 0xe8cd92,
  pond: 0x7fd3e6,
};

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
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = shadow;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial) continue;
      sm.roughness = 1;
      sm.metalness = 0;
      sm.flatShading = true;
      sm.needsUpdate = true;
    }
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
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.isMeshStandardMaterial) {
        mat.color.set(0xffffff);
        mat.emissive.set(0xffffff);
        mat.emissiveIntensity = 0.35;
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
