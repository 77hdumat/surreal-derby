import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

/**
 * 실사 환경: Poly Haven CC0 에셋 (public/env/CREDITS.md)
 *  - 하늘: HDRI (배경 + 환경광). 가장 밝은 픽셀에서 태양 방향을 뽑아 DirectionalLight 와 맞춘다.
 *  - 잔디: PBR (diffuse / normal / ARM) 타일링. 트랙은 같은 잔디에 잔디깎기 줄무늬를 셰이더로 곱한다.
 *  - 먼 산: 능선 노이즈 링 지형 + 바위 텍스처 + 고도별 색(초원→숲→바위→설선).
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export interface GrassMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  aoMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  metalnessMap: THREE.Texture;
}

const texLoader = new THREE.TextureLoader();

function loadTex(url: string, srgb: boolean, repeat: number): THREE.Texture {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 잔디 PBR 맵 세트. repeat = 텍스처 한 장이 덮는 UV 단위당 반복 수 */
export function grassMaps(repeatU: number, repeatV = repeatU): GrassMaps {
  const mk = (name: string, srgb: boolean) => {
    const t = loadTex(`${BASE}/env/${name}`, srgb, repeatU);
    t.repeat.set(repeatU, repeatV);
    return t;
  };
  const arm = mk('grass_arm.webp', false);
  return { map: mk('grass_diff.webp', true), normalMap: mk('grass_nor.webp', false), aoMap: arm, roughnessMap: arm, metalnessMap: arm };
}

export function grassMaterial(repeatU: number, repeatV = repeatU, opts: { stripes?: boolean } = {}): THREE.MeshStandardMaterial {
  const maps = grassMaps(repeatU, repeatV);
  const mat = new THREE.MeshStandardMaterial({
    ...maps,
    color: 0xdcefc0, // 살짝 밝고 푸르게 (HDRI 노출에 맞춤)
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
  if (opts.stripes) {
    // 잔디깎기 줄무늬: 트랙 폭 방향(vUv.y)으로 4줄, 결 방향에 따라 밝기 ±7%
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float stripe = step(0.5, fract(vMapUv.y * 0.42));
  diffuseColor.rgb *= 0.93 + 0.14 * stripe;
}`,
      );
    };
  }
  return mat;
}

export function rockMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: loadTex(`${BASE}/env/rock_diff.webp`, true, 40),
    normalMap: loadTex(`${BASE}/env/rock_nor.webp`, false, 40),
    normalScale: new THREE.Vector2(0.8, 0.8),
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
}

/** 결정적 2D 노이즈 (능선용) */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct = 5): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    sum += noise(x * f, y * f) * amp;
    f *= 2.1;
    amp *= 0.5;
  }
  return sum;
}

/**
 * 먼 산 링 지형: 안쪽(r0)은 평지에 녹아들고 바깥으로 갈수록 능선이 솟는다.
 * 관중석 뒤(+z 방향)는 낮게 두어 하늘이 보이게 한다.
 */
export function buildMountainRing(r0 = 380, r1 = 1150, segA = 220, segR = 14): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const cGrass = new THREE.Color(0x7c9a4c);
  const cForest = new THREE.Color(0x3f6231);
  const cRock = new THREE.Color(0x8d8a84);
  const cSnow = new THREE.Color(0xf2f4f6);
  const c = new THREE.Color();
  for (let j = 0; j <= segR; j++) {
    const t = j / segR;
    const r = THREE.MathUtils.lerp(r0, r1, t);
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // 능선: 각도 기반 저주파 + 고주파, 반경 방향 종 모양(안쪽 0 → 중간 최대 → 바깥 완만)
      const ridge = fbm(Math.cos(a) * 2.2 + 5, Math.sin(a) * 2.2 + 3, 5);
      const detail = fbm(x * 0.006, z * 0.006, 4);
      const profile = Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 1.3;
      const openSouth = THREE.MathUtils.clamp(1 - Math.max(0, Math.sin(a)) * 0.75, 0.25, 1); // +z(관중석 뒤)는 낮게
      const h = (40 + ridge * 240 + detail * 70) * profile * openSouth;
      pos.push(x, h, z);
      uv.push((i / segA) * 24, t * 6);
      // 고도별 색 (약간의 노이즈로 경계 흐림)
      const hn = h + (detail - 0.5) * 40;
      if (hn < 45) c.copy(cGrass).lerp(cForest, THREE.MathUtils.clamp(hn / 45, 0, 1));
      else if (hn < 140) c.copy(cForest).lerp(cRock, (hn - 45) / 95);
      else c.copy(cRock).lerp(cSnow, THREE.MathUtils.clamp((hn - 140) / 60, 0, 1));
      col.push(c.r, c.g, c.b);
      if (i < segA && j < segR) {
        const a0 = j * (segA + 1) + i;
        const a1 = a0 + segA + 1;
        idx.push(a0, a1, a0 + 1, a0 + 1, a1, a1 + 1);
      }
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, rockMaterial());
  mesh.position.y = -2;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.userData.noShadow = true;
  return mesh;
}

export interface SkyResult {
  texture: THREE.DataTexture;
  /** 가장 밝은 픽셀 방향 (월드, 정규화) */
  sunDir: THREE.Vector3;
}

/** HDRI 로드 + 태양 방향 추정 */
export function loadSky(highQuality: boolean): Promise<SkyResult> {
  return new Promise((resolve, reject) => {
    new RGBELoader().load(
      `${BASE}/env/sky_${highQuality ? 2 : 1}k.hdr`,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const { width, height, data } = tex.image as unknown as { width: number; height: number; data: ArrayLike<number> };
        // 가장 밝은 픽셀 → 방향. three 의 equirect 규약: u = atan(z, x)/2π + 0.5, v = asin(y)/π + 0.5 (v 는 위가 1)
        let best = -1;
        let bx = 0;
        let by = 0;
        const isHalf = tex.type === THREE.HalfFloatType;
        const stride = 4;
        const px = (k: number): number => (isHalf ? THREE.DataUtils.fromHalfFloat(data[k] as number) : (data[k] as number));
        for (let y = 0; y < height; y += 2) {
          for (let x = 0; x < width; x += 2) {
            const k = (y * width + x) * stride;
            const lum = px(k) + px(k + 1);
            if (lum > best) {
              best = lum;
              bx = x;
              by = y;
            }
          }
        }
        const u = bx / width;
        const v = tex.flipY ? by / height : 1 - by / height;
        const phi = (u - 0.5) * Math.PI * 2;
        let el = (v - 0.5) * Math.PI;
        if (el < 0) el = -el; // 데이터 행 순서가 뒤집힌 경우 보정 (태양은 지평선 위)
        const sunDir = new THREE.Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)).normalize();
        resolve({ texture: tex, sunDir });
      },
      undefined,
      reject,
    );
  });
}
