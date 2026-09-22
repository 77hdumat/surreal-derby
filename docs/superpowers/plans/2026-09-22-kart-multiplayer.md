# Kart Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자동 시뮬 경마를 플레이어 조작(가속·드리프트·부스터) 3바퀴 대결 + PeerJS 4인 멀티로 교체한다.

**Architecture:** 순수 물리(KartPhysics) + 레이스 상태기(KartRace)를 Three.js 와 분리. 호스트/솔로가 시뮬, 게스트는 입력 전송 + 보간 + 자기 말 로컬 예측. UI 는 메뉴→로비→HUD→결과.

**Tech Stack:** Vite, TypeScript, Three.js 0.170, peerjs (npm), vitest

**Spec:** docs/superpowers/specs/2026-09-22-kart-multiplayer-design.md

## Global Constraints
- 3바퀴: finishAt = track.finishS + 2 * track.length
- 최대 4슬롯, 빈 슬롯 CPU
- 스냅샷 30Hz droppable, 입력 60Hz fast 채널
- 기존 RacerFactory/rig 비주얼 코드는 수정 최소화 (색은 def 복사본으로 주입)
- TURN endpoint: https://the-fighting-turn.77hdumat.workers.dev/turn

---

### Task 1: 테스트 도구 + RaceTrack.project
**Files:** Modify `package.json`(vitest, peerjs), `src/track/RaceTrack.ts`; Test `src/track/RaceTrack.test.ts`
**Produces:** `RaceTrack.project(x: number, z: number, out?: {s:number; lat:number}): {s:number; lat:number}` — getPoint 의 역변환. 트랙 밖 점도 최근접 s 반환.
- [x] vitest 설치, `npm test` 스크립트
- [x] 테스트: 여러 (s,lat) 에 대해 getPoint → project 왕복 오차 < 1e-3 (s 는 wrap 비교)
- [x] 구현: 직선 구간(|x| ≤ straight/2)은 z 부호로 앞/뒤 직선 선택 후 s 계산, 그 외는 반원 중심 (±straight/2, 0) 기준 atan2. 후보 두 직선/두 호 중 |lat| 최소 선택
- [x] 커밋

### Task 2: KartPhysics
**Files:** Create `src/game/KartPhysics.ts`; Test `src/game/KartPhysics.test.ts`
**Produces:**
```ts
export interface KartInput { steer: number; throttle: number; brake: number; drift: boolean; boost: boolean }
export interface KartParams { maxSpeed: number; accel: number; handling: number; mass: number; gaugeRate: number; boostMul: number; radius: number }
export interface KartState { x; z; yaw; speed; slip; drifting; gauge; boostT; progress; lap; lat; s; bumpT; bumpDir; finished; finishTime: number|null }
export interface TrackLike { width: number; length: number; finishS: number; project(x,z,out?): {s,lat}; getPoint(s,lat,out?): Vector3-like }
export function createKartState(x,z,yaw): KartState
export function stepKart(st, input, p, track, dt): KartEvent[]   // 이벤트: {k:'wall'}|{k:'boost'}|{k:'lap', lap}
export function resolveKartCollision(a, pa, b, pb): boolean       // 원 충돌, 밀어냄 + 감속
export const BOOST_DURATION = 2.0
```
- [x] 테스트: 직진 throttle → speed 가 maxSpeed 초과 안 함 / 드리프트(steer=1, drift) 1초 → gauge > 0, slip ≠ 0 / gauge=1 + boost → boostT=BOOST_DURATION, gauge=0, maxSpeed 상승 / 벽 밖 위치 → lat 클램프 + 'wall' 이벤트 / progress 랩 언랩
- [x] 구현 (spec 물리 절 수식 그대로)
- [x] 커밋

### Task 3: Jockeys + 파라미터 합성
**Files:** Create `src/racers/Jockeys.ts`; Test `src/racers/Jockeys.test.ts`
**Produces:** `JOCKEYS: Jockey[]` ({id,name,desc,silks,cloth,helmet, mul:{maxSpeed,accel,handling,mass,gaugeRate,boostMul}}), `kartParamsFor(def: RacerDefinition, j: Jockey): KartParams` — maxSpeed = def.speed*1.15*mul, accel = def.acceleration*1.6*mul, handling = (0.9+def.cornering*0.9)*mul, mass = def.weight*mul, gaugeRate = 0.55*mul, boostMul = mul.boostMul, radius 1.3
- [x] 테스트: balance 기수는 배수 1 / speed 기수 maxSpeed > balance
- [x] 커밋

### Task 4: KartRace (레이스 상태기) + CpuDriver
**Files:** Create `src/game/KartRace.ts`, `src/game/CpuDriver.ts`; Test `src/game/KartRace.test.ts`
**Produces:**
```ts
export interface SlotConfig { slot: number; name: string; mountId: string; jockeyId: string; cpu: boolean }
export type RacePhaseK = 'IDLE'|'COUNTDOWN'|'RACING'|'OVER'
export class KartRace {
  constructor(track: RaceTrack, defs: RacerDefinition[])
  setup(slots: SlotConfig[]): void          // 그리드 배치 (s = -4 - slot*3, lat = laneToLat(2+slot*2))
  startCountdown(): void                    // 3초 후 RACING
  setInput(slot, input): void
  step(dt): void                            // 고정 dt 호출. CPU 입력 생성, 물리, 충돌, 랩, 순위, 종료
  readonly karts: KartState[]; readonly params: KartParams[]; readonly slots: SlotConfig[]
  phase; time; countdown; ranking: number[]  // slot 순위 배열
  events: RaceEventK[]                       // step 마다 비움 (호스트가 브로드캐스트)
  results: {slot, time: number|null}[]
}
export function cpuInput(st: KartState, p: KartParams, track, others: KartState[], seed: number): KartInput
```
- [x] 테스트: 4 CPU setup → startCountdown → step 3s → RACING / 충분히 step → 전원 finished, ranking 길이 4, results 시간 오름차순
- [x] 커밋

### Task 5: Net + Protocol (peerjs)
**Files:** Create `src/net/Net.ts`, `src/net/Protocol.ts`; Test `src/net/Protocol.test.ts`
**Produces:** dempsey Net.js 와 동일 API (host/join/broadcast/broadcastDroppable/send/sendFast/close, onOpen/onJoin/onLeave/onMessage/onError, mySlot, rtt). `encodeSnap(race): SnapMsg`, `applySnapTo(kart, snapEntry)`. 메시지 union `NetMsg`.
- [x] 테스트: encodeSnap → 배열 필드 순서/개수 고정, 소수 2자리 반올림
- [x] 커밋

### Task 6: Input (키보드/터치)
**Files:** Create `src/game/Input.ts`; Modify `index.html`(터치 버튼), `src/style.css`
**Produces:** `class InputManager { readonly input: KartInput; attach(); detach() }` ↑W/↓S/←→AD/Shift/Space·Ctrl. 터치: `#touch` 오버레이 버튼 pointerdown/up.
- [x] 커밋

### Task 7: RacerManager 슬롯 기반 배치 + ChaseCamera
**Files:** Modify `src/racers/RacerManager.ts`, `src/camera/CameraManager.ts`; Create `src/camera/ChaseCamera.ts`
**Produces:** `RacerManager.setLineup(slots: SlotConfig[], jockeys): Promise<void>` (슬롯별 visual 생성, 색 주입), `RacerManager.updateKarts(karts: KartState[], params, dt, time, camPos)` (x,z,yaw 직접 배치, ctx 채움), `worldPosition(slot)`. `ChaseCamera.update(dt, kart, boost)`. CameraManager 는 인트로/결과 전용으로 축소 (engine 의존 제거).
- [x] 커밋

### Task 8: UI (메뉴·로비·HUD·결과)
**Files:** Modify `index.html`, `src/style.css`, `src/ui/UIManager.ts`
**Produces:** `showMenu()`, `showLobby(code|null, isHost)`, `renderLobby(slots, mySlot, ready)`, `setLobbyMsg`, `showHud()`, `updateHud({lap, laps, rank, total, speed, gauge, boosting})`, `setCountdown`, `showResult(rows)`, 콜백 onSolo/onHost/onJoin(code)/onPick(mount,jockey)/onReady/onStartRace/onLeave/onAgain. 닉네임 localStorage.
- [x] 커밋

### Task 9: Game 배선 (솔로/호스트/게스트)
**Files:** Rewrite `src/game/Game.ts`; Delete `src/game/RaceEngine.ts`, `src/events/*`, `src/commentary/*`, `src/audio/VoiceManager.ts`; Modify `README.md`
- 솔로/호스트: 고정 60Hz 누적기로 race.step, 호스트는 30Hz snap + ev 브로드캐스트
- 게스트: 입력 60Hz 전송, 스냅샷 버퍼 보간(dempsey playT 방식), 자기 말 로컬 stepKart 예측 + 보정
- 사운드: 부스트/벽/충돌/골인, 갤럽 루프 speedNorm
- [x] typecheck + build 통과
- [x] 커밋

### Task 10: 검증
- [x] `npm test`, `npm run build`
- [x] 브라우저: 솔로 3바퀴 완주, 탭 2개 호스트/게스트 연결 후 레이스
