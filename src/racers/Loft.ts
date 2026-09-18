import * as THREE from 'three';

export interface LoftPoint {
  /** 로컬 위치 (+x 전방, +y 위) */
  p: [number, number, number];
  /** 단면 반지름 */
  r: number;
  /** 단면 타원 비율 (수평 z, 수직 y). 기본 [1, 1] */
  s?: [number, number];
}

/**
 * 스플라인을 따라 가변 반지름 단면을 이어 붙인 유기적 튜브 (몸통·목·머리·다리 등).
 * 찰흙 덩어리처럼 보이던 캡슐/구 조합 대신 실루엣이 연속되는 한 덩어리 메쉬를 만든다.
 */
export function loft(points: LoftPoint[], segments = 28, sides = 16, closeStart = true, closeEnd = true): THREE.BufferGeometry {
  const pts = points.map((q) => new THREE.Vector3(...q.p));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // 각 샘플의 반지름/타원비: 제어점 사이 선형 보간
  const radiusAt = (t: number): [number, number, number] => {
    const f = t * (points.length - 1);
    const i = Math.min(points.length - 2, Math.floor(f));
    const k = f - i;
    const a = points[i];
    const b = points[i + 1];
    const sa = a.s ?? [1, 1];
    const sb = b.s ?? [1, 1];
    const smooth = k * k * (3 - 2 * k);
    return [
      THREE.MathUtils.lerp(a.r, b.r, smooth),
      THREE.MathUtils.lerp(sa[0], sb[0], smooth),
      THREE.MathUtils.lerp(sa[1], sb[1], smooth),
    ];
  };
  const P = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, P);
    const [r, sz, sy] = radiusAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      // N/B 는 경로 기준 프레임이라 y/z 축에 딱 맞지 않을 수 있어 월드 up 기준으로 재정렬
      const T = frames.tangents[i];
      // 경로가 거의 수직이면 up 과 평행해져 프레임이 무너지므로 기준축을 바꿈
      const up = Math.abs(T.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(T, up).normalize();
      const vUp = new THREE.Vector3().crossVectors(side, T).normalize();
      void N;
      void B;
      const x = P.x + (side.x * Math.cos(a) * sz + vUp.x * Math.sin(a) * sy) * r;
      const y = P.y + (side.y * Math.cos(a) * sz + vUp.y * Math.sin(a) * sy) * r;
      const z = P.z + (side.z * Math.cos(a) * sz + vUp.z * Math.sin(a) * sy) * r;
      positions.push(x, y, z);
      uvs.push(t, j / sides);
    }
  }
  const ring = sides + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j;
      const b = a + ring;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  // 끝 캡
  let base = positions.length / 3;
  if (closeStart) {
    const c = curve.getPointAt(0);
    positions.push(c.x, c.y, c.z);
    uvs.push(0, 0.5);
    for (let j = 0; j < sides; j++) indices.push(base, j + 1, j);
    base++;
  }
  if (closeEnd) {
    const c = curve.getPointAt(1);
    positions.push(c.x, c.y, c.z);
    uvs.push(1, 0.5);
    const off = segments * ring;
    for (let j = 0; j < sides; j++) indices.push(base, off + j, off + j + 1);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // 감김 방향 검사: 법선이 안쪽을 향하면 뒷면 컬링으로 구멍처럼 보이므로 인덱스를 뒤집는다
  {
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const mid = Math.floor(segments / 2) * ring;
    const center = curve.getPointAt(0.5);
    let dot = 0;
    for (let j = 0; j < sides; j++) {
      const k = mid + j;
      dot += (pos.getX(k) - center.x) * nrm.getX(k) + (pos.getY(k) - center.y) * nrm.getY(k) + (pos.getZ(k) - center.z) * nrm.getZ(k);
    }
    if (dot < 0) {
      const idx = geo.getIndex()!;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
      idx.needsUpdate = true;
      geo.computeVertexNormals();
    }
  }
  return geo;
}

let furBump: THREE.CanvasTexture | null = null;
/** 털/가죽 결 느낌의 미세 범프 — 플라스틱 같은 매끈함을 깬다 */
export function furBumpTexture(): THREE.CanvasTexture {
  if (furBump) return furBump;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  let seed = 3;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 9000; i++) {
    const v = 90 + rnd() * 76;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(rnd() * 256, rnd() * 256, 1, 1 + rnd() * 4);
  }
  furBump = new THREE.CanvasTexture(c);
  furBump.wrapS = furBump.wrapT = THREE.RepeatWrapping;
  furBump.repeat.set(3, 3);
  return furBump;
}

export function hideMaterial(color: number, opts: { map?: THREE.Texture; roughness?: number; sheen?: boolean } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.78,
    metalness: 0,
    bumpMap: furBumpTexture(),
    bumpScale: 0.012,
  });
  if (opts.map) m.map = opts.map;
  return m;
}
