import * as THREE from 'three';
import { makeSkyDome, loadStorybookWorld, driftClouds, PALETTE } from './Storybook';

import { TrackGeometry, type TrackFrame } from './TrackGeometry';
export type { TrackFrame } from './TrackGeometry';

/**
 * 타원형(스타디움형) 잔디 경마장 — 씬 객체. 기하는 TrackGeometry.
 */
export class RaceTrack extends TrackGeometry {
  readonly group = new THREE.Group();


  private screenCanvas!: HTMLCanvasElement;
  private screenCtx!: CanvasRenderingContext2D;
  private screenTex!: THREE.CanvasTexture;
  private clouds: THREE.Group[] = [];
  /** 연못 (동화책 물) */
  pond?: THREE.Mesh;
  /** 호수/연못 자리 (트랙에서 가장 먼 곳) */
  private lakeSpot = new THREE.Vector3();
  /** 하늘 돔 (Game 이 환경맵을 구울 때 쓴다) */
  sky!: THREE.Object3D;
  private storyClouds: THREE.Object3D[] = [];
  /** 태양 방향 (정규화) — 조명·하늘·태양 원반 공통 */
  static readonly SUN_DIR = new THREE.Vector3(0.35, 1.05, 0.3).normalize();

  constructor() {
    super();
    this.build();
  }

  // ---------------------------------------------------------------- build

  private build(): void {
    this.buildGround();
    this.buildTrackSurface();
    this.buildRails();
    this.buildStartLine();
    this.buildBillboards();
    this.buildBigScreen();
    this.buildInfield();
    this.buildBackground();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && m.userData.noShadow !== true) {
        const mat = m.material as THREE.Material;
        if (!mat.transparent && mat.type !== 'ShaderMaterial') m.castShadow = true;
      }
    });
  }

  private buildGround(): void {
    // 동화책 톤: 텍스처 없는 파스텔 초록
    const geo = new THREE.PlaneGeometry(4000, 4000);
    const mat = new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1, metalness: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.05;
    m.receiveShadow = true;
    m.userData.noShadow = true;
    this.group.add(m);
  }

  private buildTrackSurface(): void {
    const steps = Math.ceil(this.length / 3);
    const halfW = this.width / 2 + 1.5;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const f: TrackFrame = {
      pos: new THREE.Vector3(),
      tan: new THREE.Vector3(),
      right: new THREE.Vector3(),
      curvature: 0,
    };
    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * this.length;
      this.getFrame(s, f);
      const l = f.pos.clone().addScaledVector(f.right, -halfW);
      const r = f.pos.clone().addScaledVector(f.right, halfW);
      positions.push(l.x, 0.01, l.z, r.x, 0.01, r.z);
      uvs.push(s / 20, 0, s / 20, 1);
      if (i < steps) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.setAttribute('uv2', geo.attributes.uv);
    // 모래빛 코스 + 가장자리 흰 띠 + 20m 마다 옅은 줄무늬 (캔버스 텍스처 하나)
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: RaceTrack.trackTexture(), roughness: 1, metalness: 0 }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** 캔버스 x = 진행 방향(u, 20m 당 1), y = 폭 방향(v 0..1) */
  private static trackTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const g = c.getContext('2d')!;
    const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
    // 10m 간격 옅은 줄무늬
    g.fillStyle = hex(PALETTE.track);
    g.fillRect(0, 0, 64, 128);
    g.fillStyle = hex(PALETTE.trackStripe);
    g.fillRect(0, 0, 32, 128);
    // 양쪽 가장자리 빨강·흰 커브 (폭의 약 4%)
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#f07a6e';
      g.fillRect(i * 8, 0, 8, 5);
      g.fillRect(i * 8, 123, 8, 5);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 8;
    return t;
  }

  private buildRails(): void {
    const step = 5;
    const count = Math.ceil(this.length / step);
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.15, 6);
    postGeo.translate(0, 0.575, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 1, metalness: 0 });
    const barGeo = new THREE.BoxGeometry(step + 0.2, 0.09, 0.09);
    const barMat = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.95, metalness: 0 });
    const dummy = new THREE.Object3D();
    for (const side of [-1, 1]) {
      const lat = side * (this.width / 2 + 0.4);
      const posts = new THREE.InstancedMesh(postGeo, postMat, count);
      const bars = new THREE.InstancedMesh(barGeo, barMat, count * 2);
      posts.castShadow = true;
      bars.castShadow = true;
      for (let i = 0; i < count; i++) {
        const s = i * step;
        const f = this.getFrame(s);
        dummy.position.copy(f.pos).addScaledVector(f.right, lat);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
        // 다음 포스트와의 중간에 바
        const fm = this.getFrame(s + step / 2);
        const yaw = Math.atan2(fm.tan.x, fm.tan.z) - Math.PI / 2;
        for (let b = 0; b < 2; b++) {
          dummy.position.copy(fm.pos).addScaledVector(fm.right, lat);
          dummy.position.y = b === 0 ? 1.1 : 0.7;
          dummy.rotation.set(0, yaw, 0);
          dummy.updateMatrix();
          bars.setMatrixAt(i * 2 + b, dummy.matrix);
        }
      }
      this.group.add(posts, bars);
    }
  }

  /** 출발선 = 결승선: s=0 바닥에 체커 무늬 띠 (게이트 없음) */
  private buildStartLine(): void {
    const f = this.getFrame(0);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#111111';
        ctx.fillRect(i * 8, j * 8, 8, 8);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1.6, this.width + 1), new THREE.MeshBasicMaterial({ map: tex }));
    line.rotation.x = -Math.PI / 2;
    line.position.copy(f.pos);
    line.position.y = 0.03;
    line.rotation.z = Math.atan2(f.tan.x, f.tan.z) - Math.PI / 2;
    this.group.add(line);
  }

  /** 게이트 없음 — 호환용 no-op */
  setGateOpen(_v: number): void {}
  setGateDrive(_v: number): void {}
  resetGate(): void {}

  /** 관중 — 몸/머리/팔을 분리한 저폴리 실루엣 인스턴스. seats = 서 있는 발 위치(월드) */
  /**
   * 실사 배경 모델 로드 (비동기): 나무·먼 산·관중석·호수.
   * 실패해도 절차 버전이 남아 있으므로 각각 독립적으로 시도한다.
   */
  async loadRealAssets(_sunDir: THREE.Vector3): Promise<void> {
    try {
      const world = await loadStorybookWorld(this);
      this.group.add(world.group);
      this.storyClouds = world.clouds;
    } catch (e) {
      console.warn('[storybook] 로드 실패', e);
    }
  }

  /** 구름 표류 */
  updateAmbient(dt: number): void {
    driftClouds(this.storyClouds, dt, this.bounds.minX, this.bounds.maxX);
    for (const c of this.clouds) {
      c.position.x += (c.userData.speed as number) * dt;
      if (c.position.x > 800) c.position.x = -800;
    }
  }

  /** 관중 없음 — 호환용 no-op */
  updateCrowd(_time: number, _excitement: number): void {}

  /** 식스샵(sixshop.com) 광고 간판 텍스처: 헤드라인 + 서브카피 + 로고 워드마크 */
  private makeAdTexture(headline: string, sub: string, bg: string, fg: string, accent: string): THREE.CanvasTexture {
    const w = 1024;
    const h = 240;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // 좌측 워드마크 블록
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 250, h);
    ctx.fillStyle = bg;
    ctx.font = '900 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SIXSHOP', 125, h / 2 - 22);
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('식스샵', 125, h / 2 + 30);
    // 우측 카피
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.font = 'bold 74px sans-serif';
    ctx.fillText(headline, 290, sub ? 88 : h / 2);
    if (sub) {
      ctx.font = '500 38px sans-serif';
      ctx.globalAlpha = 0.85;
      ctx.fillText(sub, 292, 168);
      ctx.globalAlpha = 1;
    }
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.7;
    ctx.fillText('sixshop.com', w - 24, h - 26);
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  private buildBillboards(): void {
    // [헤드라인, 서브카피, 배경, 글자, 워드마크 블록]
    const ads: [string, string, string, string, string][] = [
      ['쉽고 빠른 쇼핑몰·홈페이지 제작', '코딩 없이, 오늘 바로 오픈', '#111111', '#ffffff', '#ffffff'],
      ['프롬프트 한 줄로 쇼핑몰 완성', 'AI 웹사이트 제작', '#ffffff', '#111111', '#111111'],
      ['웹빌더의 한계를 없애다', '식스샵 프로', '#111111', '#ffffff', '#f5c400'],
      ['20만 브랜드가 선택한 식스샵', '지금 무료로 시작하세요', '#ffffff', '#111111', '#111111'],
      ['말보다 빠른 쇼핑몰 오픈', '결승선까지 3분, 사이트는 1분', '#1a1a1a', '#ffffff', '#ff4d2e'],
      ['AI 에이전트가 쇼핑몰 운영 자동화', '주문·CS·마케팅을 한 번에', '#ffffff', '#111111', '#111111'],
      ['몇 번의 클릭으로 마케팅 캠페인', '마케팅 자동화', '#111111', '#ffffff', '#ffffff'],
      ['60개 이상의 앱·마켓 연동', '네이버·쿠팡·인스타 한 곳에서', '#f7f7f5', '#111111', '#111111'],
      ['200개 이상의 전문가 디자인 블록', '블록 마켓플레이스', '#111111', '#ffffff', '#4d8dff'],
      ['외부 디자인도 그대로 가져오기', 'Figma·이미지 → 사이트', '#ffffff', '#111111', '#111111'],
    ];
    const boardW = 14;
    const positions: [number, number][] = [];
    // 서킷 전체에 ~120m 간격, 좌우 번갈아. 출발 직선(관중석) 구간은 건너뛴다
    const count = Math.floor(this.length / 120);
    for (let i = 0; i < count; i++) {
      const s = (i + 0.5) * (this.length / count);
      if (s < 280) continue;
      positions.push([s, i % 2 === 0 ? 1 : -1]);
    }
    positions.forEach(([s, side], i) => {
      const ad = ads[i % ads.length];
      const f = this.getFrame(s);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(boardW, 3.2),
        new THREE.MeshBasicMaterial({
          map: this.makeAdTexture(ad[0], ad[1], ad[2], ad[3], ad[4]),
          side: THREE.DoubleSide,
        }),
      );
      board.position.copy(f.pos).addScaledVector(f.right, side * (this.width / 2 + 4));
      board.position.y = 2.2;
      board.lookAt(board.position.clone().addScaledVector(f.right, -side));
      this.group.add(board);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.95, metalness: 0 });
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, 0.2), legMat);
        leg.position.copy(board.position).addScaledVector(f.tan, side * (boardW / 2 - 0.5));
        leg.position.y = 1;
        this.group.add(leg);
      }
    });
  }

  private buildBigScreen(): void {
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 512;
    this.screenCanvas.height = 288;
    this.screenCtx = this.screenCanvas.getContext('2d')!;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const group = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(26, 14.5, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x1b1f2a, roughness: 0.95, metalness: 0 }),
    );
    frame.position.y = 12;
    group.add(frame);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 13),
      new THREE.MeshBasicMaterial({ map: this.screenTex }),
    );
    screen.position.set(0, 12, 0.65);
    group.add(screen);
    for (const x of [-9, 9]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 5, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x555b66, roughness: 0.95, metalness: 0 }),
      );
      leg.position.set(x, 2.5, 0);
      group.add(leg);
    }
    // 결승선 60m 전, 트랙 왼쪽(관중석 반대편) 에서 트랙을 향함
    const sf = this.getFrame(this.finishS - 60);
    group.position.copy(sf.pos).addScaledVector(sf.right, -(this.width / 2 + 16));
    group.rotation.y = Math.atan2(sf.right.x, sf.right.z);
    this.group.add(group);
    this.updateBigScreen('제1회 초현실 경마 그랑프리', [], 0);
  }

  updateBigScreen(title: string, lines: string[], time: number): void {
    const ctx = this.screenCtx;
    const w = this.screenCanvas.width;
    const h = this.screenCanvas.height;
    ctx.fillStyle = '#0a1a3a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f5c400';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, 18, 14);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(time.toFixed(1) + 's', w - 18, 16);
    ctx.textAlign = 'left';
    ctx.font = 'bold 28px sans-serif';
    lines.slice(0, 6).forEach((l, i) => {
      ctx.fillStyle = i === 0 ? '#ffe14d' : '#e8eefc';
      ctx.fillText(l, 22, 70 + i * 36);
    });
    this.screenTex.needsUpdate = true;
  }

  private buildInfield(): void {
    // 연못: 트랙에서 가장 먼 안쪽 자리 — 평평한 파스텔 물
    this.lakeSpot = this.farthestPoint(50);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(22, 40), new THREE.MeshStandardMaterial({ color: PALETTE.pond, roughness: 0.35, metalness: 0 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.copy(this.lakeSpot).setY(0.03);
    pond.scale.set(1.6, 1, 1);
    pond.userData.noShadow = true;
    this.group.add(pond);
    const rim = new THREE.Mesh(new THREE.RingGeometry(22, 24, 40), new THREE.MeshStandardMaterial({ color: 0xfff3dc, roughness: 1 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.copy(this.lakeSpot).setY(0.02);
    rim.scale.set(1.6, 1, 1);
    rim.userData.noShadow = true;
    this.group.add(rim);
    this.pond = pond;
  }

  private buildBackground(): void {
    const sky = makeSkyDome();
    this.sky = sky;
    this.group.add(sky);
  }


}
