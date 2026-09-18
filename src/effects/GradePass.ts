import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * "Summer Afternoon" 풍 컬러 그레이딩:
 * - 따뜻한 크림 오버레이, 바이브런스, 부드러운 S 커브, 비네트
 */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uOverlay: { value: new THREE.Color('#fff4e2') },
    uOverlayAmount: { value: 0.22 },
    uVibrance: { value: 0.18 },
    uContrast: { value: 0.12 },
    uVignette: { value: 0.28 },
    uExposure: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 uOverlay; uniform float uOverlayAmount; uniform float uVibrance; uniform float uContrast; uniform float uVignette; uniform float uExposure;
    varying vec2 vUv;
    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb * uExposure;
      // 바이브런스 (이미 채도 높은 색은 덜)
      float avg = (col.r + col.g + col.b) / 3.0; float mx = max(col.r, max(col.g, col.b));
      col = mix(col, vec3(mx), (mx - avg) * (-uVibrance * 3.0));
      // 따뜻한 크림 오버레이 (소프트라이트 느낌)
      col = mix(col, col * uOverlay * 1.08 + uOverlay * 0.06, uOverlayAmount);
      // 부드러운 S 커브
      col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
      // 비네트
      vec2 q = vUv - 0.5; float v = 1.0 - dot(q, q) * 1.6;
      col *= mix(1.0, clamp(v, 0.0, 1.0), uVignette);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function makeGradePass(): ShaderPass {
  const pass = new ShaderPass(GradeShader);
  return pass;
}
