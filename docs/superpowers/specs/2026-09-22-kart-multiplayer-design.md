# Surreal Derby — 카트라이더식 대결 모드 + P2P 멀티플레이 설계

## 목표
자동 시뮬 경마를 플레이어가 직접 조작하는 3바퀴 레이싱 대결로 교체한다.
말(9종) × 기수(6명) 조합을 골라 최대 4인이 방코드로 붙는다. 빈 자리는 CPU.
가속·브레이크·조향·드리프트(게이지 충전)·부스터를 구현한다.

## 접근
dempsey-boxing 의 PeerJS 호스트 권위 스타형을 TS 로 이식한다. 서버 없음.
호스트가 물리 시뮬 → 30Hz 스냅샷. 게스트는 60Hz 입력 전송, 타인은 보간, 자기 말은 로컬 예측 + 보정.

## 구조
```
src/net/Net.ts            PeerJS 래퍼 (방코드, fast 채널 ordered:false/maxRetransmits:0, 하트비트, TURN fetch). 호스트 승계 없음
src/net/Protocol.ts       메시지 타입
src/game/KartPhysics.ts   순수 물리. step(state, input, params, track, dt)
src/game/KartRace.ts      4슬롯 레이스: 카운트다운, 랩, 충돌, 순위, 결과. 호스트/솔로 공통
src/game/CpuDriver.ts     봇 입력 생성
src/game/Input.ts         키보드 + 터치 → KartInput
src/racers/Jockeys.ts     기수 정의
src/track/RaceTrack.ts    + project(x,z) → {s, lat}
src/camera/ChaseCamera.ts 로컬 플레이어 추적
src/ui/UIManager.ts       메뉴 → 로비 → HUD → 결과
삭제: game/RaceEngine.ts, events/*, commentary/*, audio/VoiceManager.ts
```

## 물리
- 상태: x, z, yaw, speed, slip, drifting, gauge(0..1), boostT, progress, lap, lat, bumpT
- params(말×기수): maxSpeed, accel, handling, mass, gaugeRate, boostMul
- 가속: throttle → speed 를 accel 로 maxSpeed 까지. brake: 감속/후진(최대 -maxSpeed*0.3). 무입력: 마찰 감속
- 조향: yawRate = steer * handling * clamp(speed/8, 0, 1) * (1 - 0.35*min(speed/maxSpeed,1))
- 드리프트: drift 키 + |steer|>0 + speed > maxSpeed*0.4 일 때. yawRate ×1.8, slip → ±0.45rad 로 수렴(조향 반대쪽으로 미끄러짐), speed *= (1 - 0.35*dt). 이동 방향 = yaw + slip. gauge += |slip|/0.45 * speed/maxSpeed * gaugeRate * dt. 해제 시 slip → 0 (6/s)
- 부스트: gauge ≥ 1 && boost 키 → boostT = 2.0, gauge = 0. 부스트 중 maxSpeed × boostMul(≈1.35), accel ×2
- 벽: project → lat. |lat| > width/2 - 1.0 → lat 클램프, 위치 재투영, speed ×0.6, bumpT = 0.4
- 말끼리: 반지름 1.3m 원 충돌. 밀림 비율 = 상대 mass / (mass 합). 양쪽 속도 ×0.9
- 랩: progress = 언랩 s (한 프레임에 |Δs| > L/2 면 랩 경계). 결승선 = finishS(165). finishAt = finishS + 2L. lap = clamp(floor((progress - finishS)/L) + 1, 1, 3) (progress < finishS → 1)
- 결과: 골인 순, 골인 시간. 1등 골인 후 20초 지나면 미골인자 자동 완주 처리(순위 = 현재 progress 순)

## 네트워크
- 호스트: 고정 60Hz 스텝(누적기). 30Hz `snap {t:'snap', q, ts, r:[{x,z,yaw,sp,slip,st,g,bt,prog,lap,rank,ft}]}` broadcastDroppable. `ev {t:'ev', ev:[{k:'bump'|'wall'|'boost'|'finish', s:slot,...}]}` 신뢰
- 게스트: 60Hz `{t:'in', q, d:[steer, throttle, drift, boost]}` fast. 타인: dempsey 재생시계 보간. 자기 말: 로컬 KartPhysics 예측, 스냅샷 수신 시 위치 오차를 0.25/프레임 비율로 흡수, 오차 > 3m 면 스냅. gauge/boostT/lap/rank 는 호스트 값
- 로비: `lobby {slots:[{name,mount,jockey,ready,cpu}]}` 브로드캐스트. 게스트 `hello {name}`, `pick {mount,jockey}`, `ready {v}`. 호스트 `start {slots, seed}`. `countdown {n}`, `over {result}`, `tolobby`
- 솔로: Net 없이 KartRace 호스트 경로. CPU 3
- TURN: window.TURN_ENDPOINT = dempsey 워커 URL

## 기수 (Jockeys.ts)
| id | 이름 | 특성 |
|---|---|---|
| speed | 스피드 마스터 | maxSpeed +8%, handling -5% |
| accel | 스타트 대시 | accel +20%, maxSpeed -3% |
| drift | 드리프트 킹 | handling +15%, gaugeRate +25% |
| boost | 부스트 매니아 | boostMul 1.5, gaugeRate -10% |
| balance | 올라운더 | 전부 1.0 |
| heavy | 헤비 가드 | mass +40%, accel -10% |
유니폼색은 기수별. RiderRig/makeRider 색 인자로 주입.

## UI 흐름
메뉴(닉네임, 혼자 달리기 / 방 만들기 / 코드 참가) → 로비(방코드 표시·복사, 슬롯 4개: 이름·말·기수·준비, 내 슬롯은 말/기수 카드 선택 + 스탯 바, 호스트 시작 버튼) → 카운트다운 3·2·1·GO → HUD(랩 x/3, 순위, 속도, 게이지 바, 부스트 표시) → 결과(순위·기록·다시 / 로비)

## 카메라
ChaseCamera: 목표 = 말 뒤 7m 위 3m, 주시점 = 말 앞 6m. 위치 lerp k=8, 부스트 시 FOV +12, 드리프트 시 살짝 옆으로. 인트로/결과는 기존 CameraManager 모드.

## 테스트
vitest: KartPhysics(가속 상한, 드리프트 게이지 충전, 부스트 소모/속도), RaceTrack.project(getPoint 역변환 오차 < 1cm), 랩 카운트, Protocol 스냅샷 인코딩/디코딩.
수동: 탭 2개 호스트/게스트 연결, 솔로 3바퀴 완주.

## 범위 밖
아이템, 호스트 승계, 채팅, 미니맵, 게임패드.
