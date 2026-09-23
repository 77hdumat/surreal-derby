import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadAsset } from '../racers/rig/Assets';
import { PALETTE, STORY_SUN, makeSkyDome, toonify, toonRamp } from '../track/Storybook';

/**
 * 시작 화면 배경: 바람 부는 동화책 들판.
 * 흔들리는 풀 · 기울어지는 나무 · 날리는 꽃잎과 바람결 · 흘러가는 구름 · 들판을 가로질러 달리는 말들.
 * 메뉴가 보일 때만 그린다.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const M = (n: string) => `${BASE}/models/storybook/${n}.glb`;

/** 바람: 모든 흔들림이 공유하는 방향·세기 (돌풍이 주기적으로 분다) */
const WIND_DIR = new THREE.Vector2(1, 0.25).normalize();
const gust = (t: number) => 0.55 + 0.45 * Math.max(0, Math.sin(t * 0.45) * Math.sin(t * 0.17 + 1.3));

export class MenuScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
  private readonly clock = new THREE.Clock();
  private readonly grassUniforms = { uTime: { value: 0 }, uGust: { value: 1 } };
  private readonly swayers: { o: THREE.Object3D; phase: number; amp: number }[] = [];
  private readonly clouds: THREE.Object3D[] = [];
  private readonly runners: { o: THREE.Object3D; mixer: THREE.AnimationMixer; speed: number; z: number }[] = [];
  private petals!: THREE.InstancedMesh;
  private readonly petalState: { p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3; r: THREE.Euler }[] = [];
  private streaks!: THREE.InstancedMesh;
  private readonly streakState: { p: THREE.Vector3; len: number; speed: number; life: number }[] = [];
  private readonly dummy = new THREE.Object3D();
  private running = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly isVisible: () => boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const s = this.scene;
    s.fog = new THREE.Fog(new THREE.Color(0.95, 0.2, 0), 140, 1100); // 전역 HSV 안개: r = 목표 명도, g = 목표 채도 (멀수록 파스텔)
    s.add(makeSkyDome());
    s.add(new THREE.HemisphereLight(0xe4f1ff, 0xb6d88c, 1.1));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
    sun.position.copy(STORY_SUN).multiplyScalar(200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 60; sc.bottom = -60; sc.far = 500;
    sun.shadow.bias = -0.0005;
    s.add(sun);

    // 완만한 언덕 들판
    const groundGeo = new THREE.PlaneGeometry(2400, 2400, 120, 120);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.hill(pos.getX(i), pos.getZ(i)));
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshToonMaterial({ color: PALETTE.ground, gradientMap: toonRamp() }));
    ground.receiveShadow = true;
    s.add(ground);

    this.buildGrass();
    this.buildPetals();
    this.buildStreaks();

    this.camera.position.set(0, 7.5, 34);
    this.camera.lookAt(0, 4, -20);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    void this.loadModels();
  }

  /** 카메라 앞 들판의 높이 */
  private hill(x: number, z: number): number {
    return Math.sin(x * 0.012) * 3 + Math.cos(z * 0.015 + 1) * 2.5 + Math.sin((x + z) * 0.03) * 0.8 - 2;
  }

  private lastW = 0;

  private resize(): void {
    this.lastW = this.canvas.clientWidth;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 풀잎 수천 장: 셰이더에서 끝으로 갈수록 바람 방향으로 휘어진다 */
  private buildGrass(): void {
    const blade = new THREE.BufferGeometry();
    // 가늘고 뾰족한 잎 (아래 폭 0.18, 높이 1)
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.09, 0, 0, 0.09, 0, 0, -0.05, 0.5, 0, 0.05, 0.5, 0, 0, 1, 0], 3));
    blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uGust: { value: 1 },
        uBase: { value: new THREE.Color(0x5fa844) },
        uTip: { value: new THREE.Color(0xd6f08a) },
        uWind: { value: WIND_DIR },
      }]),
      vertexShader: `
        #include <fog_pars_vertex>
        uniform float uTime; uniform float uGust; uniform vec2 uWind;
        varying float vH; varying float vShade;
        void main(){
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          float h = position.y;
          // 바람 물결: 들판을 따라 흘러가는 파도 + 잎마다 떨림
          float wave = sin(dot(wp.xz, uWind) * 0.18 - uTime * 2.6) * 0.5 + 0.5;
          float flutter = sin(uTime * 7.0 + wp.x * 1.7 + wp.z * 1.3) * 0.12;
          float bend = (0.25 + 0.75 * wave) * uGust + flutter;
          wp.xz += uWind * bend * h * h * 0.9;
          wp.y -= bend * h * h * 0.25;
          vH = h; vShade = 0.8 + 0.35 * wave;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform vec3 uBase; uniform vec3 uTip; varying float vH; varying float vShade;
        void main(){
          vec3 c = mix(uBase, uTip, smoothstep(0.1, 1.0, vH)) * vShade;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const u = mat.uniforms as unknown as typeof this.grassUniforms;
    this.grassUniforms.uTime = u.uTime;
    this.grassUniforms.uGust = u.uGust;
    const N = 14000;
    const grass = new THREE.InstancedMesh(blade, mat, N);
    const d = this.dummy;
    for (let i = 0; i < N; i++) {
      // 카메라 앞 부채꼴에 촘촘히 (가까울수록 조밀)
      const r = 6 + Math.pow(Math.random(), 1.7) * 150;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const x = Math.cos(a) * r * 1.3;
      const z = 34 + Math.sin(a) * r;
      d.position.set(x, this.hill(x, z) - 0.05, z);
      d.rotation.set(0, Math.random() * Math.PI, 0);
      const h = 0.7 + Math.random() * 1.1;
      d.scale.set(1 + Math.random(), h, 1);
      d.updateMatrix();
      grass.setMatrixAt(i, d.matrix);
    }
    grass.frustumCulled = false;
    this.scene.add(grass);
  }

  /** 바람에 날리는 꽃잎·나뭇잎 */
  private buildPetals(): void {
    const geo = new THREE.PlaneGeometry(0.35, 0.22);
    const mat = new THREE.MeshToonMaterial({ vertexColors: false, gradientMap: toonRamp(), side: THREE.DoubleSide });
    const N = 160;
    this.petals = new THREE.InstancedMesh(geo, mat, N);
    const colors = [0xffffff, 0xffc4dc, 0xfff1a8, 0xa8e07a, 0xffd0a8];
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      this.petals.setColorAt(i, col.set(colors[i % colors.length]));
      this.petalState.push({ p: this.randomPetalPos(true), v: new THREE.Vector3(), spin: new THREE.Vector3(Math.random() * 4, Math.random() * 5, Math.random() * 3), r: new THREE.Euler() });
    }
    this.petals.frustumCulled = false;
    this.scene.add(this.petals);
  }

  private randomPetalPos(anywhere: boolean): THREE.Vector3 {
    const x = anywhere ? -70 + Math.random() * 140 : -75 - Math.random() * 15;
    const z = -40 + Math.random() * 70;
    return new THREE.Vector3(x, this.hill(x, z) + 0.5 + Math.random() * 14, z);
  }

  /** 바람결: 하얗게 스쳐 지나가는 가느다란 선 */
  private buildStreaks(): void {
    const geo = new THREE.PlaneGeometry(1, 0.07);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    const N = 22;
    this.streaks = new THREE.InstancedMesh(geo, mat, N);
    for (let i = 0; i < N; i++) this.streakState.push({ p: new THREE.Vector3(), len: 0, speed: 0, life: -Math.random() * 4 });
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);
  }

  private async proto(name: string, height: number): Promise<THREE.Object3D> {
    const gltf = await loadAsset(M(name));
    const src = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(src);
    const s = height / Math.max(0.01, box.max.y - box.min.y);
    src.scale.setScalar(s);
    src.position.y = -box.min.y * s;
    const g = new THREE.Group();
    g.add(src);
    toonify(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    return g;
  }

  private place(o: THREE.Object3D, x: number, z: number, rotY = Math.random() * Math.PI * 2): THREE.Object3D {
    o.position.set(x, this.hill(x, z) - 0.1, z);
    o.rotation.y = rotY;
    this.scene.add(o);
    return o;
  }

  private async loadModels(): Promise<void> {
    try {
      const [treeA, treeC, bush, flowers, rock, mountains, cloudA, cloudC] = await Promise.all([
        this.proto('tree_a', 13), this.proto('tree_c', 15), this.proto('bush', 2.4), this.proto('flowers', 1.3),
        this.proto('rock', 2.6), this.proto('mountains', 160), this.proto('cloud_a', 16), this.proto('cloud_c', 12),
      ]);
      // 나무: 양옆과 뒤쪽 숲 — 바람에 줄기째 기울며 흔들린다
      const trees: [number, number][] = [[-34, -6], [-46, -30], [-28, -52], [38, -12], [52, -36], [30, -60], [-62, -80], [70, -85], [-10, -95], [15, -120], [-90, -40], [95, -50]];
      trees.forEach(([x, z], i) => {
        const t = this.place((i % 2 ? treeC : treeA).clone(true), x, z);
        t.scale.setScalar(0.8 + Math.random() * 0.5);
        this.swayers.push({ o: t, phase: Math.random() * 6, amp: 0.035 });
      });
      for (let i = 0; i < 26; i++) {
        const x = (Math.random() - 0.5) * 140;
        const z = -10 - Math.random() * 90;
        if (Math.abs(x) < 12 && z > -40) continue; // 말이 달리는 길목은 비워 둔다
        const b = this.place(bush.clone(true), x, z);
        this.swayers.push({ o: b, phase: Math.random() * 6, amp: 0.06 });
      }
      for (let i = 0; i < 70; i++) {
        const x = (Math.random() - 0.5) * 120;
        const z = 20 - Math.random() * 90;
        const f = this.place(flowers.clone(true), x, z);
        this.swayers.push({ o: f, phase: Math.random() * 6, amp: 0.12 });
      }
      for (let i = 0; i < 8; i++) this.place(rock.clone(true), (Math.random() - 0.5) * 130, -20 - Math.random() * 80);
      for (let i = 0; i < 5; i++) {
        const m = this.place(mountains.clone(true), -800 + i * 400 + (Math.random() - 0.5) * 120, -760 - Math.random() * 140);
        m.scale.setScalar(0.7 + Math.random() * 0.4);
        // 원경: 초록·청회색으로 물들여 들판과 하늘 사이에 가라앉힌다
        m.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = (mesh.material as THREE.MeshToonMaterial).clone();
          mat.color.lerp(new THREE.Color(0x8fb4c4), 0.75);
          mesh.material = mat;
          mesh.castShadow = false;
        });
      }
      for (let i = 0; i < 9; i++) {
        const c = (i % 2 ? cloudA : cloudC).clone(true);
        c.position.set(-500 + Math.random() * 1000, 90 + Math.random() * 70, -250 - Math.random() * 300);
        c.scale.setScalar(1 + Math.random() * 1.2);
        c.userData.speed = 6 + Math.random() * 6;
        c.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = false;
          // 뭉게구름은 새하얗게 (HSV 안개는 색조를 유지하므로 재질 자체를 흰색으로)
          const mat = (m.material as THREE.MeshToonMaterial).clone();
          mat.color.set(0xffffff);
          mat.map = null;
          mat.emissive.set(0xdfeaf5);
          mat.emissiveIntensity = 0.35;
          m.material = mat;
        });
        this.scene.add(c);
        this.clouds.push(c);
      }
    } catch (e) {
      console.warn('[menu] scenery load failed', e);
    }
    try {
      // 들판을 가로질러 달리는 말들 (Quaternius 로우폴리, Gallop 클립)
      const herd: [string, RegExp, number, number][] = [
        ['horse', /^Gallop$/, -4, 15], ['whitehorse', /^Gallop$/, -11, 14], ['zebra', /Run$/, -17, 14.5], ['horse', /^Gallop$/, -8, 13.5],
      ];
      for (const [name, clipRe, z, speed] of herd) {
        const gltf = await loadAsset(M(name));
        const model = SkeletonUtils.clone(gltf.scene);
        // 스킨 박스는 이 에셋에서 어긋나므로 뼈 위치 범위로 높이를 잰다 (AnimalVisual 과 같은 방식)
        model.updateMatrixWorld(true);
        const box = new THREE.Box3();
        const bp = new THREE.Vector3();
        model.traverse((o) => {
          if ((o as THREE.Bone).isBone) box.expandByPoint(o.getWorldPosition(bp));
        });
        if (box.isEmpty()) box.setFromObject(model);
        const s = 2.6 / Math.max(1e-6, box.max.y - box.min.y);
        model.scale.setScalar(s);
        model.position.y = -box.min.y * s;
        toonify(model);
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
        });
        const holder = new THREE.Group();
        holder.add(model);
        holder.rotation.y = Math.PI / 2; // 모델 정면(+z) → 바람 방향(+x)
        const mixer = new THREE.AnimationMixer(model);
        const clip = gltf.animations.find((c) => clipRe.test(c.name)) ?? gltf.animations[0];
        if (clip) mixer.clipAction(clip).setEffectiveTimeScale(speed / 15).play();
        mixer.update(Math.random());
        holder.position.x = -50 + this.runners.length * 22;
        this.scene.add(holder);
        this.runners.push({ o: holder, mixer, speed, z });
      }
    } catch (e) {
      console.warn('[menu] horse load failed', e);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      const vis = this.isVisible();
      this.canvas.style.display = vis ? 'block' : 'none';
      if (!vis) return;
      if (this.canvas.width === 0 || this.canvas.clientWidth !== this.lastW) this.resize();
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private update(dt: number): void {
    const t = this.clock.elapsedTime;
    const g = gust(t);
    this.grassUniforms.uTime.value = t;
    this.grassUniforms.uGust.value = g;

    // 나무·덤불·꽃: 바람 방향으로 기울어진 채 흔들림 (돌풍 때 더 크게)
    for (const s of this.swayers) {
      const lean = s.amp * (0.6 * g + 0.4 * Math.sin(t * 1.9 + s.phase)) + s.amp * 0.3 * Math.sin(t * 5.3 + s.phase * 2);
      s.o.rotation.z = -WIND_DIR.x * lean;
      s.o.rotation.x = WIND_DIR.y * lean;
    }
    for (const c of this.clouds) {
      c.position.x += (c.userData.speed as number) * (0.6 + 0.6 * g) * dt;
      if (c.position.x > 650) c.position.x = -650;
    }

    // 말: 바람과 함께 왼쪽→오른쪽으로 질주, 화면 밖으로 나가면 다시 왼쪽에서
    for (const r of this.runners) {
      r.mixer.update(dt);
      r.o.position.x += r.speed * dt;
      if (r.o.position.x > 55) r.o.position.x = -55 - Math.random() * 20;
      r.o.position.z = r.z + Math.sin(t * 0.3 + r.speed) * 1.5;
      r.o.position.y = this.hill(r.o.position.x, r.o.position.z) - 0.1;
    }

    // 꽃잎: 바람 + 돌풍 + 소용돌이
    const d = this.dummy;
    for (let i = 0; i < this.petalState.length; i++) {
      const s = this.petalState[i];
      const wx = WIND_DIR.x * (6 + 10 * g);
      const wz = WIND_DIR.y * (6 + 10 * g);
      s.v.x += (wx - s.v.x) * Math.min(1, 1.5 * dt);
      s.v.z += (wz - s.v.z) * Math.min(1, 1.5 * dt);
      s.v.y = Math.sin(t * 1.3 + i) * 1.2 - 0.4;
      s.p.addScaledVector(s.v, dt);
      if (s.p.x > 80 || s.p.y < this.hill(s.p.x, s.p.z)) s.p.copy(this.randomPetalPos(false));
      s.r.x += s.spin.x * dt; s.r.y += s.spin.y * dt; s.r.z += s.spin.z * dt;
      d.position.copy(s.p);
      d.rotation.copy(s.r);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.petals.setMatrixAt(i, d.matrix);
    }
    this.petals.instanceMatrix.needsUpdate = true;

    // 바람결: 짧게 나타났다 스쳐 사라짐
    for (let i = 0; i < this.streakState.length; i++) {
      const s = this.streakState[i];
      s.life += dt;
      if (s.life > 1.4) {
        s.life = 0;
        s.len = 4 + Math.random() * 7;
        s.speed = 35 + Math.random() * 25;
        const z = -30 + Math.random() * 50;
        const x = -60 + Math.random() * 60;
        s.p.set(x, this.hill(x, z) + 2 + Math.random() * 9, z);
      }
      const on = s.life >= 0 && g > 0.6;
      s.p.x += s.speed * dt;
      const fade = on ? Math.sin(Math.min(1, s.life / 1.4) * Math.PI) : 0;
      d.position.copy(s.p);
      d.rotation.set(0, -Math.atan2(WIND_DIR.y, WIND_DIR.x), Math.sin(s.life * 3 + i) * 0.08);
      d.scale.set(s.len * fade + 1e-4, fade + 1e-4, 1);
      d.updateMatrix();
      this.streaks.setMatrixAt(i, d.matrix);
    }
    this.streaks.instanceMatrix.needsUpdate = true;

    // 카메라: 아주 천천히 흔들리는 핸드헬드 느낌
    this.camera.position.set(Math.sin(t * 0.08) * 6, 7.5 + Math.sin(t * 0.13) * 0.6, 34);
    this.camera.lookAt(Math.sin(t * 0.08) * 3, 4, -20);
  }
}
