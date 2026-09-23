import * as THREE from 'three';

const avgCache = new WeakMap<THREE.Texture, THREE.Color>();

/** 텍스처 평균색 (8×8 로 줄여 샘플) */
function averageColor(tex: THREE.Texture): THREE.Color | null {
  const cached = avgCache.get(tex);
  if (cached) return cached;
  const img = tex.image as CanvasImageSource & { width?: number; height?: number };
  if (!img || !img.width || !img.height) return null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      gg += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    const col = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
    avgCache.set(tex, col);
    return col;
  } catch {
    return null;
  }
}

/**
 * 실사 PBR 재질을 동화책 로우폴리 톤으로: 텍스처 평균색 한 가지 + 플랫 셰이딩 + 무광.
 * 대체할 CC0 로우폴리 모델이 없는 캐릭터(코끼리·기린 등)에 쓴다.
 */
export function storybookify(root: THREE.Object3D, brighten = 1.12): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial) continue;
      if (sm.map) {
        const avg = averageColor(sm.map);
        if (avg) sm.color.multiply(avg).multiplyScalar(brighten);
        sm.map = null;
      }
      sm.normalMap = null;
      sm.roughnessMap = null;
      sm.metalnessMap = null;
      sm.aoMap = null;
      sm.bumpMap = null;
      sm.roughness = 1;
      sm.metalness = 0;
      sm.flatShading = true;
      sm.needsUpdate = true;
    }
  });
}
