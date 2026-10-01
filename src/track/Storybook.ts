import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/**
 * 동화책 스타일 월드: 파스텔 그라데이션 하늘, 로우폴리(CC0 Quaternius) 나무·덤불·꽃·바위·산·구름.
 * 실사 HDRI·위성 산·PBR 잔디를 대신한다.
 */

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
