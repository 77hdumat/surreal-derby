import * as THREE from 'three';

const avgCache = new WeakMap<THREE.Texture, THREE.Color>();

/** 텍스처 평균색 (8×8 로 줄여 샘플) */
function averageColor(tex: THREE.Texture): THREE.Color | null {
  const cached = avgCache.get(tex);
  if (cached) return cached;
  const img = tex.image as CanvasImageSource & { width?: number; height?: number };
  if (!img || !img.width || !img.height) return null;
  try {
    // 32×32 로 줄여 샘플. UV 아틀라스의 검은 여백(투명·거의 검정)은 빼고 평균낸다 — 안 빼면 기린처럼 까매진다
    const S = 32;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128 || Math.max(d[i], d[i + 1], d[i + 2]) < 28) continue;
      r += d[i];
      gg += d[i + 1];
      b += d[i + 2];
      n++;
    }
    if (n === 0) return null;
    const col = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
    avgCache.set(tex, col);
    return col;
  } catch {
    return null;
  }
}

/** 만화풍 3색 칠하기 팔레트: 어두운 무늬 · 바탕 · 밝은 부분 */
export interface CartoonPaint {
  spot: number;
  base: number;
  light: number;
}

const paintCache = new WeakMap<THREE.Texture, THREE.Texture>();

/**
 * 실사 텍스처를 같은 UV 그대로 3색 만화 무늬로 다시 칠한다 (기린 얼룩 → 주황 얼룩 + 노랑 바탕 + 크림).
 * 밝기 분위수로 경계를 정하므로 텍스처마다 알아서 맞는다. 검은 아틀라스 여백은 바탕색으로.
 */
function paintTexture(tex: THREE.Texture, paint: CartoonPaint): THREE.Texture | null {
  const cached = paintCache.get(tex);
  if (cached) return cached;
  const img = tex.image as CanvasImageSource & { width?: number; height?: number };
  if (!img || !img.width || !img.height) return null;
  try {
    const S = Math.min(512, img.width);
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, S, S);
    const data = g.getImageData(0, 0, S, S);
    const d = data.data;
    const lum = new Float32Array(S * S);
    const vals: number[] = [];
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const pad = Math.max(d[i], d[i + 1], d[i + 2]) < 28;
      lum[j] = pad ? -1 : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (!pad && (j & 3) === 0) vals.push(lum[j]);
    }
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    const tSpot = vals[Math.floor(vals.length * 0.42)];
    const tLight = vals[Math.floor(vals.length * 0.9)];
    const cs = new THREE.Color(paint.spot);
    const cb = new THREE.Color(paint.base);
    const cl = new THREE.Color(paint.light);
    const to8 = (col: THREE.Color): [number, number, number] => {
      const o = col.clone().convertLinearToSRGB();
      return [o.r * 255, o.g * 255, o.b * 255];
    };
    const [S0, S1, S2] = to8(cs);
    const [B0, B1, B2] = to8(cb);
    const [L0, L1, L2] = to8(cl);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const L = lum[j];
      const [r, gg, b] = L < 0 ? [B0, B1, B2] : L < tSpot ? [S0, S1, S2] : L < tLight ? [B0, B1, B2] : [L0, L1, L2];
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    const out = new THREE.CanvasTexture(c);
    out.colorSpace = THREE.SRGBColorSpace;
    out.flipY = tex.flipY;
    out.wrapS = tex.wrapS;
    out.wrapT = tex.wrapT;
    out.channel = tex.channel;
    paintCache.set(tex, out);
    return out;
  } catch {
    return null;
  }
}

/**
 * 실사 PBR 재질을 동화책 로우폴리 톤으로: 텍스처 평균색 한 가지 + 플랫 셰이딩 + 무광.
 * 대체할 CC0 로우폴리 모델이 없는 캐릭터(코끼리·기린 등)에 쓴다.
 * paint: 무늬가 정체성인 캐릭터(기린 얼룩)는 평균색 대신 무늬를 3색 만화풍으로 다시 칠한다.
 */
export function storybookify(root: THREE.Object3D, brighten = 1.12, paint?: CartoonPaint): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial) continue;
      if (sm.map && paint) {
        const painted = paintTexture(sm.map, paint);
        if (painted) {
          sm.map = painted;
          sm.color.set(0xffffff);
        }
      } else if (sm.map) {
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
