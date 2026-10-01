import * as THREE from 'three';

/**
 * 셸 털: 같은 메시를 표면 법선 방향으로 조금씩 부풀린 껍질 여러 장을 겹치고,
 * 바인드 포즈 좌표 격자마다 털 한 가닥을 두어 바깥 껍질일수록 가늘게 남긴다 → 북슬북슬한 실루엣.
 * 스킨 메시는 스키닝 전에 밀어내므로 뼈를 따라 같이 움직인다.
 */
export interface FurOptions {
  color: number;
  /** 껍질 수 */
  shells: number;
  /** 가장 바깥 껍질까지 거리 (지오메트리 단위) */
  length: number;
  /** 털 가닥 밀도 (지오메트리 단위당 격자 수) */
  freq: number;
  /** 털을 빼는 자리: vFurP(바인드 위치)·vFurN(법선)으로 true 면 discard 하는 GLSL 식 */
  mask?: string;
  /** 마스크가 쓰는 uniform */
  uniforms?: Record<string, THREE.IUniform>;
}

export function furShellMaterial(o: FurOptions, k: number): THREE.MeshStandardMaterial {
  const shell = (k + 1) / o.shells; // 0..1 (뿌리 → 끝)
  const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, o.uniforms ?? {});
    shader.uniforms.uFurOffset = { value: o.length * shell };
    shader.uniforms.uFurShell = { value: shell };
    shader.uniforms.uFurFreq = { value: o.freq };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFurOffset;\nvarying vec3 vFurP;\nvarying vec3 vFurN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurP = position;\nvFurN = normal;\ntransformed += normal * uFurOffset;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uFurShell;
uniform float uFurFreq;
varying vec3 vFurP;
varying vec3 vFurN;
${Object.keys(o.uniforms ?? {})
  .map((n) => {
    const v = o.uniforms![n].value;
    const t = v instanceof THREE.Vector3 || v instanceof THREE.Color ? 'vec3' : v instanceof THREE.Vector4 ? 'vec4' : 'float';
    return `uniform ${t} ${n};`;
  })
  .join('\n')}
float furHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  ${o.mask ? `if (${o.mask}) discard;` : ''}
  vec3 q = vFurP * uFurFreq;
  vec3 cell = floor(q);
  float strand = furHash(cell);
  // 가닥은 칸 중심에서 끝으로 갈수록 가늘다. 일부 칸은 짧은 털
  float r = length(fract(q) - 0.5);
  if (strand < uFurShell * 0.85 || r > 0.55 * (1.0 - uFurShell * 0.7)) discard;
  diffuseColor.rgb *= mix(0.72, 1.12, uFurShell) * (0.9 + 0.2 * strand);
}`,
      );
  };
  mat.customProgramCacheKey = () => `fur-${o.mask ?? ''}-${shell.toFixed(3)}`;
  return mat;
}

/** 스킨 메시에 털 껍질을 붙인다 (같은 뼈대를 공유) */
export function addSkinnedFur(src: THREE.SkinnedMesh, o: FurOptions): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  for (let k = 0; k < o.shells; k++) {
    const m = new THREE.SkinnedMesh(src.geometry, furShellMaterial(o, k));
    m.bind(src.skeleton, src.bindMatrix);
    m.position.copy(src.position);
    m.quaternion.copy(src.quaternion);
    m.scale.copy(src.scale);
    m.castShadow = false;
    m.receiveShadow = true;
    m.frustumCulled = src.frustumCulled;
    if (src.boundingSphere) m.boundingSphere = src.boundingSphere.clone();
    src.parent!.add(m);
    out.push(m);
  }
  return out;
}
