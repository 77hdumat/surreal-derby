import type { RaceEventType } from './RaceEvent';

/** 시나리오 안의 예약 이벤트 — time 은 예상 레이스 시간 대비 비율 */
export interface ScenarioEvent {
  at: number;
  event: RaceEventType;
  racerId: string | 'DYNAMIC';
}

/**
 * 우승 시나리오. 레이스 시작 시 하나를 무작위로 고르고,
 * finale 이벤트가 결승선 `finaleDistance` m 앞에서 발동하면 우승자에게 '운명 보정'이 붙는다.
 */
export interface Scenario {
  id: string;
  title: string;
  /** 우승자. null 이면 순수 랜덤(카오스) */
  winnerId: string | null;
  weight: number;
  events: ScenarioEvent[];
  finale?: { event: RaceEventType; distance: number; extensionMax?: number; duration?: number };
  /** 랜덤 필러 이벤트 개수 */
  fillers: number;
  /** 시나리오 시작 시 중계 멘트 (복선) */
  teaser?: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'costume-comeback',
    title: '말탈 브라더스의 대역전',
    winnerId: 'costume',
    weight: 1,
    events: [
      { at: 0.32, event: 'COSTUME_COLLAPSE', racerId: 'costume' },
      { at: 0.5, event: 'COLLISION', racerId: 'DYNAMIC' },
      { at: 0.58, event: 'COW_RAGE', racerId: 'cow' },
    ],
    finale: { event: 'COSTUME_CARRY', distance: 260, duration: 40 },
    fillers: 2,
    teaser: '1번 말탈 브라더스, 오늘 컨디션이 좋아 보이지 않습니다.',
  },
  {
    id: 'circus-miracle',
    title: '서커스 스타의 기적',
    winnerId: 'circus',
    weight: 1,
    events: [
      { at: 0.35, event: 'CIRCUS_ACT', racerId: 'circus' },
      { at: 0.5, event: 'MOTORCYCLE_BOOST', racerId: 'motorcycle' },
    ],
    finale: { event: 'CIRCUS_ACT', distance: 200, duration: 30 },
    fillers: 2,
    teaser: '9번 서커스 스타, 관중석을 계속 쳐다보고 있습니다.',
  },
  {
    id: 'elephant-rampage',
    title: '킹 엘리펀트 대난동',
    winnerId: 'elephant',
    weight: 1,
    events: [
      { at: 0.3, event: 'ELEPHANT_STOMP', racerId: 'elephant' },
      { at: 0.45, event: 'ELEPHANT_SPRAY', racerId: 'elephant' },
      { at: 0.58, event: 'ELEPHANT_CHARGE', racerId: 'elephant' },
    ],
    finale: { event: 'ELEPHANT_TRUNK', distance: 190, extensionMax: 22, duration: 30 },
    fillers: 1,
    teaser: '3번 킹 엘리펀트, 오늘따라 눈빛이 심상치 않습니다.',
  },
  {
    id: 'longbody-mega',
    title: '롱바디 익스프레스 100m 스트레치',
    winnerId: 'longbody',
    weight: 1,
    events: [
      { at: 0.3, event: 'LONGBODY_STRETCH', racerId: 'longbody' },
      { at: 0.55, event: 'SUPER_SPRINT', racerId: 'DYNAMIC' },
    ],
    finale: { event: 'LONGBODY_STRETCH', distance: 150, extensionMax: 115, duration: 40 },
    fillers: 2,
    teaser: '2번 롱바디, 뒷기수가 안전벨트를 확인하고 있습니다.',
  },
  {
    id: 'moto-nitro',
    title: '모터 스탤리온 니트로',
    winnerId: 'motorcycle',
    weight: 1,
    events: [
      { at: 0.28, event: 'ENGINE_FAILURE', racerId: 'motorcycle' },
      { at: 0.5, event: 'ELEPHANT_CHARGE', racerId: 'elephant' },
    ],
    finale: { event: 'MOTORCYCLE_BOOST', distance: 240, duration: 40 },
    fillers: 2,
    teaser: '5번 모터 스탤리온, 정비팀이 뭔가를 추가로 달았다는 소문입니다.',
  },
  {
    id: 'human-awakening',
    title: '휴먼 러너의 각성',
    winnerId: 'human',
    weight: 1,
    events: [
      { at: 0.4, event: 'HUMAN_EXHAUSTED', racerId: 'human' },
      { at: 0.55, event: 'GIRAFFE_NECK_ATTACK', racerId: 'giraffe' },
    ],
    finale: { event: 'HUMAN_BIPEDAL', distance: 230, duration: 40 },
    fillers: 2,
    teaser: '6번 휴먼 러너, 출전 전 육상 코치와 통화했다고 합니다.',
  },
  {
    id: 'giraffe-neck',
    title: '롱넥 미라클, 화면 밖의 목',
    winnerId: 'giraffe',
    weight: 1,
    events: [
      { at: 0.35, event: 'GIRAFFE_NECK_ATTACK', racerId: 'giraffe' },
      { at: 0.5, event: 'COLLISION', racerId: 'DYNAMIC' },
    ],
    finale: { event: 'GIRAFFE_MEGA_NECK', distance: 130, extensionMax: 34, duration: 30 },
    fillers: 2,
    teaser: '7번 롱넥 미라클, 목 스트레칭을 유난히 오래 했습니다.',
  },
  {
    id: 'cow-stampede',
    title: '레이지 불 스탬피드',
    winnerId: 'cow',
    weight: 1,
    events: [
      { at: 0.35, event: 'COW_RAGE', racerId: 'cow' },
      { at: 0.5, event: 'TRIP', racerId: 'DYNAMIC' },
    ],
    finale: { event: 'COW_RAGE', distance: 220, duration: 40 },
    fillers: 2,
    teaser: '4번 레이지 불, 아침 여물을 거른 것이 확인됐습니다.',
  },
  {
    id: 'trojan-army',
    title: '트로이 목마, 전군 출동',
    winnerId: 'trojan',
    weight: 1,
    events: [
      { at: 0.3, event: 'COLLISION', racerId: 'DYNAMIC' },
      { at: 0.45, event: 'RIDER_FALL', racerId: 'DYNAMIC' },
    ],
    finale: { event: 'TROJAN_AMBUSH', distance: 250, extensionMax: 1, duration: 40 },
    fillers: 2,
    teaser: '10번 트로이 목마, 안에서 인원 점검 소리가 들렸다고 합니다.',
  },
  {
    id: 'classic-justice',
    title: '정상적인 말의 정상적인 승리',
    winnerId: 'classic',
    weight: 0.9,
    events: [
      { at: 0.3, event: 'COSTUME_COLLAPSE', racerId: 'costume' },
      { at: 0.42, event: 'ENGINE_FAILURE', racerId: 'motorcycle' },
      { at: 0.55, event: 'ELEPHANT_STOMP', racerId: 'elephant' },
      { at: 0.68, event: 'RIDER_FALL', racerId: 'DYNAMIC' },
    ],
    finale: { event: 'SUPER_SPRINT', distance: 200, duration: 40 },
    fillers: 1,
    teaser: '8번 클래식 호스, 오늘만큼은 평범하게 달리고 싶다고 합니다.',
  },
  {
    id: 'chaos',
    title: '대혼돈 — 아무도 모르는 결말',
    winnerId: null,
    weight: 1.2,
    events: [],
    fillers: 6,
  },
];

const WINNER_IDS = ['costume', 'longbody', 'elephant', 'cow', 'motorcycle', 'human', 'giraffe', 'classic', 'circus', 'trojan'];

/**
 * 우승자를 10명 중 균등 확률(10%)로 먼저 뽑고, 그 선수의 각본 시나리오(75%) 또는
 * 각본 없는 대혼돈 + 일반 스퍼트 피날레(25%)를 돌린다. 어느 쪽이든 운명 보정으로 우승은 보장.
 */
export function pickScenario(): Scenario {
  const winnerId = WINNER_IDS[Math.floor(Math.random() * WINNER_IDS.length)];
  const scripted = SCENARIOS.filter((s) => s.winnerId === winnerId);
  if (scripted.length && Math.random() < 0.75) return scripted[Math.floor(Math.random() * scripted.length)];
  const chaos = SCENARIOS.find((s) => s.id === 'chaos')!;
  return {
    ...chaos,
    id: 'chaos',
    title: `대혼돈 — 아무도 모르는 결말`,
    winnerId,
    finale: { event: 'SUPER_SPRINT', distance: 210, duration: 40 },
  };
}
