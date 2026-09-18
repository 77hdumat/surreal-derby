import * as THREE from 'three';

/**
 * 참고 사이트(Summer Afternoon)의 안개 방식: 색을 안개색으로 섞는 대신
 * 멀어질수록 채도를 낮추고 명도를 파스텔 톤으로 수렴시킨다.
 * three 의 fog 청크를 전역으로 바꿔치기하므로 scene.fog 가 있는 모든 재질에 적용된다.
 */
export function installHsvFog(): void {
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  vec3 hsvfog_rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
  vec3 hsvfog_hsv2rgb(vec3 c){ vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
#endif`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  {
    // fogColor 는 수렴 목표(명도·채도)로만 사용: r = 목표 명도, g = 목표 채도
    vec3 hsvF = hsvfog_rgb2hsv(gl_FragColor.rgb);
    hsvF.z = mix(hsvF.z, fogColor.r, fogFactor * 0.7);
    hsvF.y = mix(hsvF.y, fogColor.g, fogFactor);
    gl_FragColor.rgb = hsvfog_hsv2rgb(hsvF);
  }
#endif`;
}
