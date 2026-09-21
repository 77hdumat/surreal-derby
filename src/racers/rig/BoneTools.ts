import * as THREE from 'three';

/**
 * 뼈를 "모델 공간" 축 기준으로 추가 회전/이동한다.
 * 에셋마다 뼈의 로컬 축 방향이 제각각이라, 로컬 축 대신 모델(root) 공간 축을 지정하면
 * 어떤 리그든 같은 코드로 "목을 아래로", "몸통을 뒤로 젖히기" 를 표현할 수 있다.
 *
 * 호출 전 root.updateWorldMatrix(true, true) 가 되어 있어야 하며,
 * 부모→자식 순서로 호출하면 앞선 변경이 반영된다 (내부에서 부모 월드 행렬을 갱신한다).
 */
const qParent = new THREE.Quaternion();
const qRoot = new THREE.Quaternion();
const qDelta = new THREE.Quaternion();
const qTmp = new THREE.Quaternion();
const vTmp = new THREE.Vector3();

function parentToRoot(bone: THREE.Object3D, root: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  // 부모의 회전 (root 기준)
  bone.parent!.updateWorldMatrix(true, false);
  bone.parent!.getWorldQuaternion(qParent);
  root.getWorldQuaternion(qRoot);
  return out.copy(qRoot).invert().multiply(qParent);
}

export function rotateBoneModelSpace(bone: THREE.Object3D, root: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  if (Math.abs(angle) < 1e-5 || !bone.parent) return;
  const pr = parentToRoot(bone, root, qTmp); // parent rotation in root space
  // 원하는 회전 R(root 공간) → 부모 로컬: pr^-1 * R * pr
  qDelta.setFromAxisAngle(axis, angle);
  const inv = qParent.copy(pr).invert();
  inv.multiply(qDelta).multiply(pr);
  bone.quaternion.premultiply(inv);
}

const sTmp = new THREE.Vector3();
const sRoot = new THREE.Vector3();
export function translateBoneModelSpace(bone: THREE.Object3D, root: THREE.Object3D, delta: THREE.Vector3): void {
  if (!bone.parent) return;
  const pr = parentToRoot(bone, root, qTmp);
  // 모델(root) 공간 미터 → 부모 로컬 단위: 부모/루트 스케일 비로 나눈다 (균등 스케일 가정)
  bone.parent.getWorldScale(sTmp);
  root.getWorldScale(sRoot);
  const k = sRoot.x / Math.max(1e-6, sTmp.x);
  vTmp.copy(delta).applyQuaternion(qParent.copy(pr).invert()).multiplyScalar(k);
  bone.position.add(vTmp);
}

/** 뼈의 월드 위치를 target(로컬 좌표계)로 변환 */
export function boneLocalPosition(bone: THREE.Object3D, target: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  bone.getWorldPosition(out);
  return target.worldToLocal(out);
}

export const AXIS_X = new THREE.Vector3(1, 0, 0);
export const AXIS_Y = new THREE.Vector3(0, 1, 0);
export const AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * 소켓: 뼈의 로컬 축을 몰라도 "바인드 포즈 기준 모델 공간 오프셋" 으로 장식을 붙인다.
 * 매 프레임 뼈가 바인드 포즈에서 얼마나 회전했는지(delta)를 구해 오프셋과 자세에 적용한다.
 * obj 는 root 의 직접 자식이어야 한다 (root 로컬 = 모델 공간).
 */
export class BoneSocket {
  private bindInv = new THREE.Quaternion();
  private delta = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private rootInv = new THREE.Quaternion();
  private rot = new THREE.Quaternion();

  constructor(
    readonly bone: THREE.Object3D,
    readonly root: THREE.Object3D,
    readonly obj: THREE.Object3D,
    readonly offset: THREE.Vector3,
    readonly baseQuat = new THREE.Quaternion(),
  ) {
    root.updateWorldMatrix(true, true);
    root.getWorldQuaternion(this.rootInv).invert();
    bone.getWorldQuaternion(this.bindInv);
    this.bindInv.premultiply(this.rootInv).invert();
  }

  update(): void {
    this.root.getWorldQuaternion(this.rootInv).invert();
    this.bone.getWorldQuaternion(this.delta).premultiply(this.rootInv);
    this.rot.copy(this.delta).multiply(this.bindInv); // 바인드 대비 회전 (모델 공간)
    this.bone.getWorldPosition(this.pos);
    this.root.worldToLocal(this.pos);
    this.obj.position.copy(this.offset).applyQuaternion(this.rot).add(this.pos);
    this.obj.quaternion.copy(this.rot).multiply(this.baseQuat);
  }
}

const aimTmpA = new THREE.Vector3();
const aimTmpB = new THREE.Vector3();
const aimQ = new THREE.Quaternion();
const aimRootInv = new THREE.Quaternion();
/**
 * 뼈가 tip(자식 뼈)을 향하는 방향을 모델(root) 공간의 dir 로 맞춘다.
 * 바인드 포즈에서 뼈의 로컬 축이 어디를 향하든 동작하므로 사지 자세를 "방향" 으로 정의할 수 있다.
 */
export function aimBoneModelSpace(bone: THREE.Object3D, tip: THREE.Object3D, root: THREE.Object3D, dir: THREE.Vector3): void {
  if (!bone.parent) return;
  tip.updateWorldMatrix(true, false);
  bone.getWorldPosition(aimTmpA);
  tip.getWorldPosition(aimTmpB);
  root.getWorldQuaternion(aimRootInv).invert();
  const cur = aimTmpB.sub(aimTmpA).applyQuaternion(aimRootInv).normalize();
  if (cur.lengthSq() < 1e-8) return;
  aimQ.setFromUnitVectors(cur, aimTmpA.copy(dir).normalize());
  const pr = parentToRoot(bone, root, qTmp);
  const inv = qParent.copy(pr).invert();
  inv.multiply(aimQ).multiply(pr);
  bone.quaternion.premultiply(inv);
}
