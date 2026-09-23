import * as THREE from 'three';

/**
 * 부스트 화염: 말 뒤로 뻗는 십자 평면 두 장에 절차 노이즈 불꽃 셰이더 (additive).
 * 로컬 규약 +x 전방 → 불꽃은 -x 로 뻗는다. setIntensity(0..1) 로 켜고 끈다.
 */
export class BoostFlame {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private intensity = 0;

  constructor(length = 3.2, height = 1.1) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uSeed: { value: Math.random() * 10 }, uBlue: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform float uIntensity; uniform float uSeed; uniform float uBlue;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        void main(){
          // t: 0 = 말 쪽(뿌리), 1 = 꼬리 끝. uv.x 는 평면 +x 가 앞이라 뒤집는다
          float t = 1.0 - vUv.x;
          float y = vUv.y - 0.5;
          // 불꽃 폭: 뿌리는 두껍고 꼬리로 갈수록 좁아지며 흔들린다
          float wob = noise(vec2(t * 3.0 - uTime * 6.0, uTime * 2.0)) - 0.5;
          float halfW = mix(0.42, 0.06, t) * (0.8 + 0.4 * noise(vec2(t * 5.0 - uTime * 9.0, 3.0)));
          float body = smoothstep(halfW, halfW * 0.35, abs(y - wob * 0.25 * t));
          // 결: 뒤로 흘러가는 노이즈 + 잘게 찢어지는 끝
          float n = noise(vec2(t * 6.0 - uTime * 11.0, vUv.y * 4.0 + uSeed));
          float n2 = noise(vec2(t * 14.0 - uTime * 18.0, vUv.y * 9.0));
          float a = body * (0.55 + 0.45 * n) * smoothstep(1.0, 0.2, t) * step(0.18 * t, n2 * (1.0 - t) + 0.25);
          a *= uIntensity;
          if (a < 0.02) discard;
          // 색: 뿌리 흰노랑 → 주황 → 꼬리 빨강
          vec3 col = mix(vec3(1.0, 0.95, 0.55), vec3(1.0, 0.45, 0.05), smoothstep(0.0, 0.45, t));
          col = mix(col, vec3(0.9, 0.1, 0.02), smoothstep(0.4, 1.0, t));
          // 파란 부스터: 흰→하늘→파랑
          vec3 blue = mix(vec3(0.85, 0.98, 1.0), vec3(0.15, 0.55, 1.0), smoothstep(0.0, 0.5, t));
          blue = mix(blue, vec3(0.05, 0.2, 0.95), smoothstep(0.45, 1.0, t));
          col = mix(col, blue, uBlue);
          gl_FragColor = vec4(col * (1.2 + 0.6 * n), a);
        }`,
    });
    // 평면은 x 축을 따라 [-length, 0], 중심을 뒤로 밀어 뿌리가 원점
    const geo = new THREE.PlaneGeometry(length, height, 1, 1);
    geo.translate(-length / 2, 0, 0);
    const a = new THREE.Mesh(geo, this.mat);
    const b = new THREE.Mesh(geo, this.mat);
    b.rotation.x = Math.PI / 2;
    a.frustumCulled = b.frustumCulled = false;
    this.group.add(a, b);
    this.group.visible = false;
  }

  /** 0 = 주황(일반), 1 = 파랑(강화) */
  setBlue(v: number): void {
    this.mat.uniforms.uBlue.value = v;
  }

  setIntensity(v: number): void {
    this.intensity = v;
    this.mat.uniforms.uIntensity.value = v;
    this.group.visible = v > 0.02;
  }

  get value(): number {
    return this.intensity;
  }

  update(time: number): void {
    this.mat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.mat.dispose();
    (this.group.children[0] as THREE.Mesh).geometry.dispose();
  }
}
