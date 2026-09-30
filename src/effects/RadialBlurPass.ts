import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * 부스트 속도감: 화면 가장자리를 소실점 쪽으로 끌어당기는 줌 블러 + 뿌연 공기(헤이즈).
 * 가운데(말이 있는 곳)는 선명하게 두고 바깥으로 갈수록 번지고 밝게 뿌얘진다.
 */
export const RadialBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.56) },
    uHaze: { value: new THREE.Color('#fff6e6') },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uStrength; uniform vec2 uCenter; uniform vec3 uHaze; uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - uCenter;
      float r = length(d * vec2(1.3, 1.0));
      // 가운데는 선명, 바깥으로 갈수록 강하게
      float mask = smoothstep(0.12, 0.62, r);
      float amt = uStrength * mask;
      vec3 col = vec3(0.0);
      // 샘플 시작점을 픽셀마다 살짝 흔들어 계단 무늬 대신 부드러운 번짐
      float jitter = hash(vUv * 731.0 + uTime) ;
      const int N = 8;
      for (int i = 0; i < N; i++) {
        float t = (float(i) + jitter) / float(N);
        col += texture2D(tDiffuse, vUv - d * t * amt * 0.22).rgb;
      }
      col /= float(N);
      // 공기가 뿌얘지는 헤이즈 (바깥일수록)
      col = mix(col, uHaze, uStrength * mask * mask * 0.32);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function makeRadialBlurPass(): ShaderPass {
  const pass = new ShaderPass(RadialBlurShader);
  pass.enabled = false;
  return pass;
}
