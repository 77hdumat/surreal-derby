# 초현실 경마 그랑프리 — 대결 모드 (Surreal Derby Kart Battle)

브라우저에서 바로 실행되는 3D 엽기 경마 레이싱. 말 9종 × 기수 6명 조합을 골라 3.9km 굴곡 서킷(코너 35개 + 이중 나선 구간)에서 최대 4인이 2바퀴 대결한다.
Vite + TypeScript + Three.js, 멀티플레이는 PeerJS(WebRTC) P2P — 별도 서버 없음.

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # vitest (물리·트랙·프로토콜)
npm run build      # dist/
npm run preview    # http://localhost:4173
```

외부 공개(임시): `cloudflared tunnel --url http://localhost:4173`

## 조작

| 키 | 동작 |
|---|---|
| ↑ / W | 가속 |
| ↓ / S | 브레이크·후진 |
| ← → / A D | 조향 |
| Shift | 드리프트 (게이지 충전) |
| Space | 부스터 (최대 2개 저장, 3초). 2칸을 채운 뒤 계속 드리프트하면 **파란 부스터**(4.5초·더 빠름)로 승급, 파란 것부터 쓰인다 |
| 드리프트 직후 ↑ | 순간부스터 (톡톡이 연속 가능) |
| GO 직전 ↑ | 출발 부스터 |
| X / Ctrl | 아이템 사용 |

드리프트 중 벽·다른 말에 부딪히면 그 드리프트로 모으던 게이지를 잃는다. Shift 를 오래 누를수록 깊게(유턴급) 꺾이고, 살짝 끌면 얕게 미끄러지며 게이지 효율이 좋다. 드리프트 중 ↑ 를 떼면 덜 미끄러진다.

**아이템전**: 한 바퀴 5구간 선물 상자(8초 리젠, 2개까지 보관). 미사일·물파리(유도)·바나나·지뢰·부스터·실드·자석(추월 추진)·UFO(1등 전용)·환각 가스(나 빼고 전원 3초 조작 반대). 뒤에 있을수록 강한 아이템. 1등 골인 후 10초 안에 못 들어오면 리타이어. 부스트 중엔 말마다 고유 모션이 나온다
(말탈 브라더스: 탈을 들고 질주 / 트로이 목마: 병사들이 밀어줌 / 코끼리: 물대포 / 휴먼 러너: 이족보행 / 소: 분노 / 서커스: 뒷발 깡충 / 롱바디·기린: 늘어남).

## 멀티플레이

메뉴 → **방 만들기** → 5자리 코드(또는 `?r=CODE` 링크)를 친구에게 전달 → 참가자가 말·기수 고르고 **준비** → 방장이 시작. 빈 자리는 CPU.

네트워크 모델은 카트라이더식 **클라이언트 권위**: 자기 말은 자기 기기에서만 물리를 돌리고(되감기·밀림 없음) 상태를 30Hz 로 보낸다.
남의 말은 받은 상태를 재생 지연 보간으로 그린다. 충돌은 각자 자기 말에만 적용. 호스트는 CPU 를 돌리고 상태를 중계하며 결과만 판정한다.
NAT 뒤 기기용 TURN 자격증명은 `src/net/Net.ts` 의 `TURN_ENDPOINT` (Cloudflare Worker) 에서 받는다.

## 구조

```
src/
  main.ts                    부트스트랩
  game/Game.ts               루프·화면 전환·네트워크 배선 (solo/host/client)
  game/KartPhysics.ts        순수 물리: 가속·조향·드리프트·게이지·부스터·벽·랩·충돌
  game/KartRace.ts           레이스 상태기: 슬롯, 카운트다운, 순위, 결과
  game/CpuDriver.ts          봇 입력
  game/Input.ts              키보드·터치
  net/Net.ts                 PeerJS 래퍼 (방코드, fast 채널, 하트비트, TURN)
  net/Protocol.ts            메시지·상태 인코딩
  net/RemoteKart.ts          원격 말 보간 버퍼
  racers/Jockeys.ts          기수 정의 + 말×기수 파라미터
  racers/RacerDefinitions.ts 말 9종
  racers/RacerManager.ts     KartState → 비주얼 배치·애니메이션·파티클
  racers/rig/                리깅 GLB 비주얼
  camera/GameCamera.ts       인트로 / 추적 / 결과 카메라
  track/TrackGeometry.ts     서킷 기하: 제어점 → 닫힌 스플라인 → 1m 샘플 (project: 월드 → 트랙 좌표). 코스 수정은 CIRCUIT_POINTS
  track/RaceTrack.ts         경마장 씬
  effects/                   후처리·파티클·발자국
  audio/AudioManager.ts      효과음 (public/sfx)
  ui/UIManager.ts            메뉴·로비·HUD·결과
```

- 효과음 출처: `public/sfx/CREDITS.md`, 모델 출처: `public/models/CREDITS.md`
- 설계: `docs/superpowers/specs/2026-09-22-kart-multiplayer-design.md`
