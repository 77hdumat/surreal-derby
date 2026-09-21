import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * GLB 에셋 캐시. 같은 파일은 한 번만 내려받고, 인스턴스마다 SkeletonUtils.clone 으로
 * 스켈레톤을 복제해 독립적으로 애니메이션한다. 재질은 인스턴스별로 복제해 색을 바꿀 수 있게 한다.
 */
export interface LoadedAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const cache = new Map<string, Promise<GLTF>>();
const loader = new GLTFLoader();

export function loadAsset(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<GLTF>((resolve, reject) => loader.load(url, resolve, undefined, reject));
    cache.set(url, p);
  }
  return p;
}

// ---------------------------------------------------------------- 로드 큐 / 진행률
// 스켈레톤 복제·재질 복제는 메인 스레드를 수십 ms 씩 막는다. 인스턴스를 한 프레임에 하나씩만 만들어
// 첫 진입 렉을 여러 프레임으로 분산하고, 전체 진행률을 UI 에 알린다.
let pending = 0;
let done = 0;
let chain: Promise<void> = Promise.resolve();
const progressListeners = new Set<(done: number, total: number) => void>();
const idleResolvers: (() => void)[] = [];

export function onAssetProgress(fn: (done: number, total: number) => void): () => void {
  progressListeners.add(fn);
  fn(done, done + pending);
  return () => progressListeners.delete(fn);
}

/** 큐에 남은 작업이 없을 때 resolve (호출 시점에 비어 있으면 즉시) */
export function whenAssetsIdle(): Promise<void> {
  if (pending === 0) return Promise.resolve();
  return new Promise((r) => idleResolvers.push(r));
}

function notify(): void {
  for (const fn of progressListeners) fn(done, done + pending);
  if (pending === 0) {
    for (const r of idleResolvers.splice(0)) r();
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** 스켈레톤·재질을 독립 복제한 인스턴스 (한 프레임에 하나씩) */
export function instantiate(url: string): Promise<LoadedAsset> {
  pending++;
  notify();
  void loadAsset(url).catch(() => undefined); // 다운로드는 큐와 무관하게 즉시 병렬 시작
  const run = chain.then(async () => {
    try {
      const gltf = await loadAsset(url);
      await nextFrame();
      return instantiateNow(gltf);
    } finally {
      pending--;
      done++;
      notify();
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function instantiateNow(gltf: GLTF): LoadedAsset {
  const scene = skeletonClone(gltf.scene) as THREE.Group;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = false;
    // 스키닝 메쉬는 바운드가 갱신되지 않아 카메라 각도에 따라 컬링되므로 끈다.
    m.frustumCulled = false;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const cloned = mats.map((mat) => {
      const c = (mat as THREE.Material).clone();
      c.side = THREE.FrontSide;
      c.shadowSide = THREE.FrontSide;
      return c;
    });
    m.material = Array.isArray(m.material) ? cloned : cloned[0];
  });
  return { scene, animations: gltf.animations };
}

/** 디버그: 뼈 계층을 콘솔에 출력 (에셋 맵핑용) */
export function dumpSkeleton(root: THREE.Object3D, label = ''): void {
  const lines: string[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    let depth = 0;
    let p = o.parent;
    while (p && (p as THREE.Bone).isBone) {
      depth++;
      p = p.parent;
    }
    const w = new THREE.Vector3();
    o.getWorldPosition(w);
    lines.push(`${'  '.repeat(depth)}${o.name}  (${w.x.toFixed(2)}, ${w.y.toFixed(2)}, ${w.z.toFixed(2)})`);
  });
  console.info(`[rig] ${label} bones:\n${lines.join('\n')}`);
}

export function findBone(root: THREE.Object3D, pattern: string | RegExp): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((o) => {
    if (found || !(o as THREE.Bone).isBone) return;
    if (typeof pattern === 'string' ? o.name === pattern : pattern.test(o.name)) found = o as THREE.Bone;
  });
  return found;
}

export function findClip(clips: THREE.AnimationClip[], pattern?: string | RegExp): THREE.AnimationClip | null {
  if (!pattern) return null;
  return clips.find((c) => (typeof pattern === 'string' ? c.name === pattern : pattern.test(c.name))) ?? null;
}
