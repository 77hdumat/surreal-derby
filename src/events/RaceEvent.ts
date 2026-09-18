export type RaceEventType =
  | 'START'
  | 'COSTUME_COLLAPSE'
  | 'COSTUME_RECOVER'
  | 'ELEPHANT_CHARGE'
  | 'ELEPHANT_TRUNK'
  | 'ELEPHANT_STOMP'
  | 'ELEPHANT_SPRAY'
  | 'COW_RAGE'
  | 'MOTORCYCLE_BOOST'
  | 'ENGINE_FAILURE'
  | 'ENGINE_RESTART'
  | 'HUMAN_EXHAUSTED'
  | 'HUMAN_BIPEDAL'
  | 'GIRAFFE_NECK_ATTACK'
  | 'GIRAFFE_PHOTO_FINISH'
  | 'LONGBODY_STRETCH'
  | 'CIRCUS_ACT'
  | 'TROJAN_AMBUSH'
  | 'LONGBODY_RETRACT'
  | 'RIDER_FALL'
  | 'TRIP'
  | 'SUPER_SPRINT'
  | 'COLLISION'
  | 'COMEBACK'
  | 'BUMP'
  | 'LEAD_CHANGE'
  | 'FINAL_STRETCH'
  | 'FINISH_LINE'
  | 'RACE_OVER';

export interface RaceEvent {
  /** 레이스 시간(초) */
  time: number;
  racerId: string;
  event: RaceEventType;
  /** 상호작용 이벤트의 상대 */
  targetId?: string;
  duration?: number;
  /** 결과 화면에 표시되는 요약 */
  label?: string;
  /** 카메라가 즉시 전환되는 큰 사건인지 */
  major: boolean;
}

/** 레이스 시작 시 미리 생성되는 예정 이벤트 */
export interface ScheduledEvent {
  time: number;
  racerId: string | 'DYNAMIC';
  event: RaceEventType;
  fired: boolean;
}

export const MAJOR_EVENTS = new Set<RaceEventType>([
  'COSTUME_COLLAPSE',
  'ELEPHANT_CHARGE',
  'ELEPHANT_TRUNK',
  'ELEPHANT_STOMP',
  'ELEPHANT_SPRAY',
  'COW_RAGE',
  'MOTORCYCLE_BOOST',
  'ENGINE_FAILURE',
  'HUMAN_BIPEDAL',
  'GIRAFFE_NECK_ATTACK',
  'LONGBODY_STRETCH',
  'CIRCUS_ACT',
  'TROJAN_AMBUSH',
  'RIDER_FALL',
  'TRIP',
  'SUPER_SPRINT',
  'COLLISION',
  'COMEBACK',
]);

export const EVENT_LABELS: Record<RaceEventType, string> = {
  START: '출발',
  COSTUME_COLLAPSE: '말탈 벗겨짐 (붕괴)',
  COSTUME_RECOVER: '말탈 다시 착용',
  CIRCUS_ACT: '서커스 퍼포먼스',
  TROJAN_AMBUSH: '트로이 목마 병사 출동',
  ELEPHANT_CHARGE: '코끼리 돌진',
  ELEPHANT_TRUNK: '코끼리 코 늘어남 (붙잡기)',
  ELEPHANT_STOMP: '코끼리 발구르기 (지진)',
  ELEPHANT_SPRAY: '코끼리 물대포',
  COW_RAGE: '소 폭주',
  MOTORCYCLE_BOOST: '모터사이클 엔진 가동',
  ENGINE_FAILURE: '엔진 고장',
  ENGINE_RESTART: '엔진 재시동',
  HUMAN_EXHAUSTED: '인간 말 탈진',
  HUMAN_BIPEDAL: '인간 말 두 발 전력질주',
  GIRAFFE_NECK_ATTACK: '기린 목 공격',
  GIRAFFE_PHOTO_FINISH: '기린 사진 판정',
  LONGBODY_STRETCH: '롱바디 몸통 늘어남',
  LONGBODY_RETRACT: '롱바디 몸통 복귀',
  RIDER_FALL: '기수 낙마',
  TRIP: '발 걸림',
  SUPER_SPRINT: '초강력 스퍼트',
  COLLISION: '선수 충돌',
  COMEBACK: '기적의 추격',
  BUMP: '접촉',
  LEAD_CHANGE: '선두 교체',
  FINAL_STRETCH: '마지막 직선주로',
  FINISH_LINE: '결승선 통과',
  RACE_OVER: '경기 종료',
};
