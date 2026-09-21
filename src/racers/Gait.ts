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

/**
 * 갤럽 한 보폭 안에서 발굽 목표 위치.
 *  - stance(지면 접촉, 40%): 앞으로 뻗은 위치에서 뒤로 곧게 쓸어 미는 구간
 *  - swing(공중, 60%): 발을 뒤에서 앞으로 되돌리는 구간. 이탈 직후 무릎을 크게 접어 발굽이
 *    몸 아래로 높이 올라왔다가(lift 최대), 착지 직전 앞으로 쭉 뻗으며 펴진다.
 * lift 가 클수록 IK 가 다리를 많이 접으므로 "막대기처럼 뻗은 다리" 대신 무릎·비절이 보인다.
 */
export function strideTarget(phase: number, length: number, amount: number): { x: number; lift: number; stance: boolean } {
  const u = ((phase % 1) + 1) % 1;
  const stanceLen = 0.4;
  const stance = u < stanceLen;
  const reachF = 0.36 * length * amount; // 앞으로 뻗는 거리
  const reachB = 0.3 * length * amount; // 뒤로 쓸리는 거리
  if (stance) {
    const t = u / stanceLen;
    return { x: reachF - (reachF + reachB) * t, lift: 0, stance: true };
  }
  const t = (u - stanceLen) / (1 - stanceLen);
  // 발굽 이동: 초반은 천천히(무릎 접기), 후반에 빠르게 앞으로 뻗음
  const ease = t * t * (3 - 2 * t);
  const x = -reachB + (reachF + reachB) * ease;
  // 접힘: t≈0.38 에서 최대, 착지(t=1) 전에 완전히 펴짐
  const bell = Math.sin(Math.PI * Math.min(1, t / 0.76)) ** 1.4;
  return { x, lift: bell * 0.46 * length * Math.min(1, amount + 0.15), stance: false };
}
