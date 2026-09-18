import * as THREE from 'three';

/**
 * "여름 오후" 풍 식생: 바람에 흔들리는 인스턴스 잔디 + 둥근 수관 나무.
 * 바람은 MeshStandardMaterial 의 onBeforeCompile 로 정점 셰이더에 주입한다.
 */
const windMaterials: THREE.Material[] = [];
const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

export function applyWind(mat: THREE.Material, strength: number, byHeight = true): THREE.Material {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.uniforms.uStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime; uniform float uWind; uniform float uStrength;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec4 wp = modelMatrix * vec4(position, 1.0);
  #ifdef USE_INSTANCING
  wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #endif
  float h = ${byHeight ? 'clamp(uv.y, 0.0, 1.0)' : '1.0'};
  float ph = wp.x * 0.25 + wp.z * 0.18;
  float sway = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 3.1 + ph * 1.7) * 0.25 + sin(uTime * 0.7 + ph * 0.3) * 0.4;
  transformed.x += sway * uStrength * uWind * h * h;
  transformed.z += cos(uTime * 1.3 + ph) * 0.5 * uStrength * uWind * h * h;
}`,
      );
  };
  mat.customProgramCacheKey = () => `wind-${strength}-${byHeight}`;
  windMaterials.push(mat);
  return mat;
}

export function updateWind(time: number, strength = 1): void {
  windUniforms.uTime.value = time;
  windUniforms.uWind.value = strength;
}

/** 잔디 블레이드 인스턴스 */
export function makeGrassField(
  count: number,
  sampler: () => [number, number] | null,
  colors: number[] = [0x4f9a2e, 0x63b23a, 0x3f8a27, 0x76c447],
): THREE.InstancedMesh {
  // 두 장을 십자로 겹친 블레이드
  const blade = new THREE.PlaneGeometry(0.08, 0.42, 1, 3);
  blade.translate(0, 0.21, 0);
  const cross = blade.clone().rotateY(Math.PI / 2);
  const merged = mergeGeometries([blade, cross]);
  // 끝으로 갈수록 좁아지게
  const pos = merged.attributes.position as THREE.BufferAttribute;
  const uv = merged.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = uv.getY(i);
    const w = 1 - t * 0.85;
    pos.setX(i, pos.getX(i) * w);
    pos.setZ(i, pos.getZ(i) * w);
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfd6c8, roughness: 1, side: THREE.DoubleSide, vertexColors: false });
  applyWind(mat, 0.09, true);
  const mesh = new THREE.InstancedMesh(merged, mat, count);
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  let placed = 0;
  let tries = 0;
  while (placed < count && tries < count * 4) {
    tries++;
    const p = sampler();
    if (!p) continue;
    dummy.position.set(p[0], 0, p[1]);
    dummy.rotation.set((Math.random() - 0.5) * 0.25, Math.random() * Math.PI, (Math.random() - 0.5) * 0.25);
    const s = 0.7 + Math.random() * 0.9;
    dummy.scale.set(s, s * (0.8 + Math.random() * 0.7), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    c.setHex(colors[Math.floor(Math.random() * colors.length)]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
    mesh.setColorAt(placed, c);
    placed++;
  }
  mesh.count = placed;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** 둥근 수관 나무 (여러 구 겹침) */
export function makeTree(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const trunkH = (2.2 + Math.random() * 1.4) * scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16 * scale, 0.28 * scale, trunkH, 7),
    new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 0.95 }),
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);
  const palette = [0x7cb26a, 0x9ccb6e, 0x5f9a55, 0x86c46b, 0xa9d477];
  const n = 3 + Math.floor(Math.random() * 3);
  const base = palette[Math.floor(Math.random() * palette.length)];
  const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.9 });
  applyWind(mat, 0.12, false);
  const R = (1.4 + Math.random() * 0.9) * scale;
  for (let i = 0; i < n; i++) {
    const r = R * (0.6 + Math.random() * 0.5);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat);
    m.position.set((Math.random() - 0.5) * R * 1.1, trunkH + R * 0.5 + (Math.random() - 0.3) * R * 0.8, (Math.random() - 0.5) * R * 1.1);
    m.scale.y = 0.8 + Math.random() * 0.25;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** 간단 병합 (position/uv/normal 만) */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + offset);
    offset += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(indices);
  return out;
}
