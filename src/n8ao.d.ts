declare module 'n8ao' {
  import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
  import type { Scene, Camera } from 'three';
  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      halfRes: boolean;
      screenSpaceRadius: boolean;
      color: import('three').Color;
      gammaCorrection: boolean;
      transparencyAware: boolean;
      accumulate: boolean;
    };
    setSize(w: number, h: number): void;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}
