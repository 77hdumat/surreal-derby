# 제1회 초현실 경마 그랑프리 (Surreal Derby)

브라우저에서 바로 실행되는 3D 엽기 경마 게임. Vite + TypeScript + Three.js.

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # dist/
npm run preview    # http://localhost:4173 (빌드 결과)
```

외부 공개(임시): `cloudflared tunnel --url http://localhost:4173`

## 구조

```
src/
  main.ts                    부트스트랩
  game/Game.ts               루프·페이즈·매니저 배선
  game/RaceEngine.ts         레이스 시뮬레이션 (Three.js 무관)
  game/RaceState.ts          상태 타입
  racers/RacerDefinitions.ts 출전 선수 9명 정의 (여기에 추가)
  racers/RacerFactory.ts     선수별 placeholder 모델 + 연출
  racers/RacerVisual.ts      공통 베이스 (재질/다리/기수/갤럽 클립)
  racers/RacerManager.ts     엔진 상태 → 트랙 좌표 → 모델
  events/                    이벤트 타임라인 (3~7개/레이스)
  camera/CameraManager.ts    자동 중계 카메라 (9종)
  effects/                   AfterimagePass·Bloom·스피드라인·파티클
  audio/AudioManager.ts      Pixabay 샘플 (public/sfx, 거리 감쇠)
  commentary/                중계 자막
  ui/UIManager.ts            시작·HUD·결과 화면 (이름 편집 → localStorage)
  track/RaceTrack.ts         경마장
```

- `RacerDefinition.modelUrl` 에 GLB 경로를 넣으면 placeholder 대신 GLTF 모델 + AnimationMixer 를 사용한다.
- 효과음 출처: `public/sfx/CREDITS.md`
