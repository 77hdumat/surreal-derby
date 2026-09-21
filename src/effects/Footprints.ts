import * as THREE from 'three';

/**
 * 발자국 데칼: 발굽/발이 땅에 닿는 순간 트랙에 눌린 자국을 남긴다.
 * InstancedMesh 링 버퍼 — 오래된 자국부터 덮어쓴다. 잔디가 눌린 어두운 흙색 U자 텍스처.
 */
function printTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  // 말발굽: U 자 테두리 + 안쪽 옅은 눌림
  ctx.fillStyle = 'rgba(40,28,16,0.35)';
  ctx.beginPath();
  ctx.ellipse(32, 32, 16, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,10,0.75)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(32, 30, 14, Math.PI * 0.15, Math.PI * 0.85, true);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Footprints {
  readonly mesh: THREE.InstancedMesh;
  private capacity: number;
  private next = 0;
  private dummy = new THREE.Object3D();
  /** 선수·발별 이전 프레임 발 높이 (착지 검출) */
  private lastY = new Map<string, number>();
  private lastDy = new Map<string, number>();
  /** 발별로 관측된 최저 높이 (발굽 뼈는 지면보다 조금 위에 있으므로 상대 기준) */
  private floor = new Map<string, number>();
  private cooldown = new Map<string, number>();

  constructor(capacity = 1600) {
    this.capacity = capacity;
    const geo = new THREE.PlaneGeometry(0.22, 0.28);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: printTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    // 미사용 인스턴스는 지면 아래로
    this.dummy.position.set(0, -10, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  /**
   * 발 위치(월드)와 진행 방향을 주면 착지 순간(공중→지면)에만 자국을 찍는다.
   * @param key 선수id+발index
   * @param size 자국 크기 배율 (코끼리 3, 사람 0.9 …)
   */
  track(key: string, foot: THREE.Vector3, forward: THREE.Vector3, dt: number, size = 1, speed = 10): void {
    const prev = this.lastY.get(key);
    const cd = (this.cooldown.get(key) ?? 0) - dt;
    this.cooldown.set(key, cd);
    this.lastY.set(key, foot.y);
    // 최저점 추적 (천천히 위로 회복해 자세 변화에 적응)
    const fl = Math.min(this.floor.get(key) ?? foot.y, foot.y) + dt * 0.02;
    this.floor.set(key, fl);
    if (prev === undefined) return;
    const dy = foot.y - prev;
    const prevDy = this.lastDy.get(key) ?? 0;
    this.lastDy.set(key, dy);
    // 내려오다 멈추는 순간(속도 부호 반전) + 최저점 근처 = 착지
    if (prevDy < -0.002 && dy >= 0 && foot.y - fl < 0.08 && cd <= 0 && speed > 1.5) {
      this.cooldown.set(key, 0.15);
      this.stamp(foot, forward, size);
    }
  }

  stamp(pos: THREE.Vector3, forward: THREE.Vector3, size = 1): void {
    const d = this.dummy;
    d.position.set(pos.x, 0.015, pos.z);
    d.rotation.set(0, Math.atan2(forward.x, forward.z), 0);
    d.scale.set(size, 1, size);
    d.updateMatrix();
    this.mesh.setMatrixAt(this.next, d.matrix);
    this.next = (this.next + 1) % this.capacity;
    this.mesh.count = Math.min(this.capacity, this.mesh.count + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.mesh.count = 0;
    this.next = 0;
    this.lastY.clear();
    this.lastDy.clear();
    this.floor.clear();
    this.cooldown.clear();
  }
}
