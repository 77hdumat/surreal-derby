import * as THREE from 'three';
import { instantiate } from '../racers/rig/Assets';

/**
 * 엽기 관중: 관중석 앞에서 춤추는 애니메이션 캐릭터들 (Sketchfab CC-BY 팬 모델, public/models/CREDITS.md).
 * 각자 자기 댄스 클립을 루프하고, 시작 위상을 흩뜨려 군무처럼 보이지 않게 한다.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface DancerSpec {
  file: string;
  /** 목표 키(m) */
  height: number;
  /** 모델이 +z 를 보지 않을 때 보정 */
  yaw?: number;
  clip?: string | RegExp;
}

const SPECS: DancerSpec[] = [
  { file: 'dancer_spongebob', height: 3.4 },
  { file: 'dancer_patrick', height: 3.6 },
  { file: 'dancer_shrek', height: 3.8 },
  { file: 'dancer_pikachu', height: 2.8 },
  { file: 'dancer_banana', height: 3.6, clip: /AfroHouse|Boogie/ },
  { file: 'dancer_crab', height: 2.0 },
  { file: 'dancer_rabbit', height: 3.0 },
  { file: 'dancer_bboy', height: 2.6 },
  { file: 'dancer_spongebob2', height: 3.4 },
];

export class Dancers {
  readonly group = new THREE.Group();
  private mixers: THREE.AnimationMixer[] = [];

  /**
   * @param positions 세울 자리(월드 xz) 목록. 스펙보다 많으면 순환.
   * @param faceZ 바라볼 z 방향 (-1 = 트랙 쪽)
   */
  async load(positions: [number, number][], faceZ = -1): Promise<void> {
    const tasks = positions.map(async ([x, z], i) => {
      const spec = SPECS[i % SPECS.length];
      try {
        const asset = await instantiate(`${BASE}/models/${spec.file}.glb`);
        const model = asset.scene;
        model.updateMatrixWorld(true);
        model.traverse((o) => {
          const sm = o as THREE.SkinnedMesh;
          if (sm.isSkinnedMesh) {
            sm.skeleton.update();
            sm.computeBoundingBox();
            sm.computeBoundingSphere();
            if (sm.boundingSphere) {
              sm.boundingSphere.radius *= 2;
              sm.frustumCulled = true;
            }
          }
        });
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = spec.height / Math.max(1e-6, size.y);
        const center = box.getCenter(new THREE.Vector3());
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        const holder = new THREE.Group();
        holder.add(model);
        holder.position.set(x, 0, z);
        holder.rotation.y = (faceZ < 0 ? Math.PI : 0) + (spec.yaw ?? 0) + (Math.random() - 0.5) * 0.5;
        this.group.add(holder);
        if (asset.animations.length) {
          const mixer = new THREE.AnimationMixer(model);
          const pick = spec.clip ? asset.animations.find((c) => (typeof spec.clip === 'string' ? c.name === spec.clip : (spec.clip as RegExp).test(c.name))) : undefined;
          const clip: THREE.AnimationClip = pick ?? asset.animations[0];
          const action = mixer.clipAction(clip);
          action.play();
          action.time = Math.random() * clip.duration;
          mixer.timeScale = 0.9 + Math.random() * 0.25;
          this.mixers.push(mixer);
        }
      } catch (e) {
        console.warn('[dancers]', spec.file, e);
      }
    });
    await Promise.allSettled(tasks);
  }

  update(dt: number): void {
    for (const m of this.mixers) m.update(dt);
  }
}
