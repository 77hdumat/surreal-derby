import * as THREE from 'three';

/** Two-bone sagittal IK, with a straight stance sweep and a lifted recovery arc. */
export function solveLeg(leg: THREE.Object3D, x: number, drop: number, bend = -1): void {
  const upper = leg.userData.upperLength as number;
  const lower = leg.userData.lowerLength as number;
  const knee = leg.getObjectByName(leg.name + '_lower');
  if (!upper || !lower || !knee) return;
  const distance = THREE.MathUtils.clamp(Math.hypot(x, drop), Math.abs(upper - lower) + 0.001, upper + lower - 0.001);
  const angle = bend * Math.acos(THREE.MathUtils.clamp((distance * distance - upper * upper - lower * lower) / (2 * upper * lower), -1, 1));
  leg.rotation.z = Math.atan2(x, drop) - Math.atan2(lower * Math.sin(angle), upper + lower * Math.cos(angle));
  knee.rotation.z = angle;
}

export function strideTarget(phase: number, length: number, amount: number): { x: number; lift: number; stance: boolean } {
  const u = ((phase % 1) + 1) % 1;
  const stance = u < 0.52;
  const t = stance ? u / 0.52 : (u - 0.52) / 0.48;
  const ease = t * t * (3 - 2 * t);
  return {
    x: length * amount * 0.33 * (stance ? 1 - 2 * t : -1 + 2 * ease),
    lift: stance ? 0 : Math.sin(Math.PI * t) ** 2 * length * 0.24 * amount,
    stance,
  };
}
