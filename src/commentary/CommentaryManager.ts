import type { RaceEvent, RaceEventType } from '../events/RaceEvent';
import type { Racer } from '../racers/Racer';
import type { RaceEngine } from '../game/RaceEngine';
import { BANKS_JA, DESTINY_JA } from './CommentaryJa';

type BankKey = RaceEventType | 'FINISH_FIRST' | 'FINISH_OTHER' | 'GENERIC' | 'OUTSIDE' | 'CORNER' | 'BACKSTRAIGHT' | 'GAP' | 'TIGHT' | 'COUNTDOWN' | 'PHOTO';

const BANKS: Record<BankKey, string[]> = {
  START: ['출발했습니다!', '게이트가 열렸습니다! 일제히 뛰쳐나갑니다!', '스타트! 8두... 아니, 8명의 선수가 출발합니다!'],
  COUNTDOWN: ['게이트 인 완료. 모든 선수 대기 중입니다.', '출발 준비. 관중 여러분 주목해 주십시오.'],
  COSTUME_COLLAPSE: [
    '아아아아아!! {n}번 선수가 무너집니다!!',
    '말탈이... 말탈이 벗겨졌습니다!',
    '믿을 수 없는 상황입니다! 안에 사람이 두 명!!',
    '잠깐만요! {n}번 선수, 쓰러졌습니다!',
  ],
  COSTUME_CARRY: ['말탈을 들고 뜁니다!!! 두 사람이 탈을 들고 뜁니다!!', '이게 됩니까?! 탈을 벗어 들고 전력질주!!', '말탈 브라더스, 탈은 손에 들고 발은 전속력!!'],
  GIRAFFE_MEGA_NECK: ['목이... 목이 화면 밖으로 나갑니다!!!', '롱넥 미라클, 목이 결승선을 먼저 통과합니다!!', '카메라가 목을 따라갈 수 없습니다!!'],
  COSTUME_RECOVER: ['{n}번 선수 다시 일어납니다!', '탈을 다시 뒤집어썼습니다! 대단한 근성!', '안에 계신 두 분 괜찮으신가요? 다시 달립니다!'],
  TROJAN_AMBUSH: ['목마 문이 열립니다!! 병사들이 나옵니다!!', '{n}번 트로이 목마, 안에서 사람이... 밀고 있습니다!', '이건 반칙 아닙니까! 병사 출동!!', '트로이 목마가 굴러갑니다! 엄청난 속도!'],
  CIRCUS_ACT: ['{n}번 서커스 스타, 뒷발로 섰습니다!!', '서커스가 시작됐습니다! 그런데... 더 빨라집니다?!', '관중 여러분 박수!! 공연 중에 속도가 올라갑니다!', '저건 경주가 아니라 공연입니다!'],
  ELEPHANT_CHARGE: ['잠깐만요! 코끼리가 뛰기 시작했습니다!', '{n}번 킹 엘리펀트, 갑자기 돌진합니다!!', '땅이 울립니다! 코끼리의 최후의 돌진!', '주변 선수들이 밀려납니다!!'],
  ELEPHANT_TRUNK: ['코가... 코가 늘어납니다!!', '{n}번 코끼리, 코로 {tn}번 선수를 붙잡았습니다!!', '저 코 길이가 말이 됩니까?! 앞 선수를 끌어내립니다!'],
  ELEPHANT_STOMP: ['쿵!!! 땅이 흔들립니다!', '코끼리가 발을 굴렀습니다! 주변 선수 전원 휘청!', '지진입니다! 코끼리 지진!!'],
  ELEPHANT_SPRAY: ['물을 뿜습니다!! 앞 선수들 미끄러집니다!', '코끼리 물대포!! 잔디가 젖었습니다!', '{n}번 킹 엘리펀트, 코로 물 발사!'],
  COW_RAGE: ['{n}번 선수, 흥분했습니다!', '소가... 소가 폭주합니다!!', '머리를 흔들며 돌진합니다! 위험합니다!', '레이지 불, 눈이 빨갛게 변했습니다!'],
  MOTORCYCLE_BOOST: ['엔진 소리가 들립니다!', '갑자기 속도를 올립니다!', '엄청난 가속입니다!!', '{n}번 모터 스탤리온, 부스터 점화!!', '이건 말이 아닙니다! 아니, 말입니다!'],
  ENGINE_FAILURE: ['엔진이... 엔진이 멈췄습니다!', '{n}번 선수, 연기가 납니다!', '고장입니다! 모터 스탤리온 정지!'],
  ENGINE_RESTART: ['재시동 성공! 다시 달립니다!', '엔진이 다시 돌아갑니다!'],
  HUMAN_EXHAUSTED: ['{n}번 휴먼 러너, 완전히 지쳤습니다...', '인간에게 이 거리는 무리였을까요!', '네 발로 뛰는 건 역시 힘듭니다!'],
  HUMAN_BIPEDAL: ['일어섰습니다! 두 발로 뜁니다!!', '{n}번 선수, 규정 위반 아닙니까?! ...문제없답니다!', '인간의 본능입니다! 두 발 전력질주!'],
  GIRAFFE_NECK_ATTACK: ['{n}번 기린의 목이 옆 선수를 쳤습니다!', '롱넥 미라클, 목으로 공격!! {tn}번 선수 휘청!', '이건 반칙 아닙니까! 목 공격입니다!'],
  GIRAFFE_PHOTO_FINISH: ['목을 뻗습니다!! 사진 판정입니다!', '기린의 목이 먼저 들어갔습니다!'],
  PHOTO: ['접전입니다!! 사진 판정으로 갑니다!', '나란히!! 나란히 들어옵니다!!'],
  LONGBODY_STRETCH: ['몸이... 몸이 늘어납니다!!!', '{n}번 롱바디 익스프레스, 쭈우우우욱!!', '저게 규정상 말입니까?! 몸통이 늘어나요!', '앞기수와 뒷기수 사이가 벌어집니다!! 늘어납니다!!'],
  LONGBODY_RETRACT: ['다시 줄어듭니다.', '몸통이 원래대로 돌아왔습니다.', '뒷기수분, 살아계시죠?'],
  RIDER_FALL: ['아앗! {n}번 기수 낙마!!', '기수가 떨어졌습니다! {name}, 혼자 달립니다!', '낙마입니다! 안전 요원 대기해 주세요!'],
  TRIP: ['{n}번 선수 발이 걸렸습니다!', '휘청거립니다! {name} 크게 흔들려요!', '넘어질 뻔했습니다!!'],
  SUPER_SPRINT: ['{n}번 선수 엄청난 스퍼트!!', '{name}, 여기서 승부를 겁니다!', '무서운 속도로 올라옵니다!'],
  COLLISION: ['충돌! 충돌입니다!!', '{n}번과 {tn}번이 부딪혔습니다!', '아아! {name}, 사고에 휘말립니다!', '정면 충돌입니다!'],
  TWIST_FALL: ['아아앗!! {n}번, 결승선 코앞에서 넘어집니다!!!', '{name}, 대자로 뻗었습니다!! 이럴 수가!', '결승선 앞에서 미끄러졌습니다! 기수도 날아갑니다!'],
  TWIST_REVERSE: ['{n}번이... 뒤로 갑니다?! 뒤로 갑니다!!', '{name}, 결승선을 앞에 두고 뒷걸음질!! 왜죠?!', '거꾸로 달립니다! 문워크입니까?!'],
  TWIST_WHEEL_OFF: ['바퀴가!! 바퀴가 빠졌습니다!!', '트로이 목마, 결승선 앞에서 멈춰 섰습니다! 바퀴가 굴러갑니다!', '목마 정지!! 안의 병사들은 어쩌죠?!'],
  TWIST_SLEEP: ['{n}번이... 잡니다. 결승선 앞에서 잡니다!!', '서커스 스타, 공연 끝나고 낮잠?! 지금요?!', '드르렁... 믿을 수 없습니다, 결승선 20m 앞에서 취침!'],
  TWIST_ROCKET: ['잠깐만요!! 뒤에서 뭔가 옵니다!! {n}번!!', '{name}, 로켓입니까?! 전부 제칩니다!!!', '후방에서 총알처럼!! {n}번 {name}!!'],
  TWIST_SHOELACE: ['{n}번 휴먼 러너, 멈춰서... 신발끈을 묶습니다?!', '지금 신발끈 묶을 때가 아닙니다!!', '결승선 앞에서 신발끈! 인간적입니다!'],
  TWIST_STUBBORN: ['{n}번이 멈춰서 풀을 뜯습니다!!', '{name}, 결승선보다 잔디가 더 중요했나 봅니다!', '여기서 식사를?! 기수가 울부짖습니다!'],
  LAUNCHED: ['날아갑니다!!! {n}번이 하늘로 날아갑니다!!!', '코끼리에게 받혔습니다!! {name}, 공중 3회전!!', '아아아!! {n}번 선수, 하늘 높이!!'],
  PLANTED: ['꽂혔습니다... 머리부터 땅에 꽂혔습니다.', '{name}, 경기 속행 불가. 다리만 허우적댑니다.', '착지... 라기보다는 착근입니다. {n}번 기권.'],
  COMEBACK: ['{n}번 선수 후방에서 올라옵니다!!', '기적입니다! {name}{iga} 추격을 시작합니다!', '포기하지 않았습니다! {n}번!'],
  BUMP: ['{n}번이 {tn}번을 밀어냅니다!', '접촉이 있었습니다!', '몸싸움입니다!'],
  LEAD_CHANGE: ['{n}번 {name}{iga} 선두로 나섭니다!', '선두 교체! {n}번!', '{name}, 앞으로 나옵니다!'],
  FINAL_STRETCH: ['마지막 직선주로입니다!!', '결승선까지 150미터!', '최후의 직선! 승부는 여기서 갈립니다!'],
  FINISH_LINE: ['{n}번 선수 골인.', '{name} 결승선 통과.'],
  FINISH_FIRST: ['{n}번 {name}, 1위로 골인!!', '골인!! 우승은 {name}!!', '결승선 통과! {name}{iga} 이겼습니다!!'],
  FINISH_OTHER: ['{n}번 선수 골인.', '{name} 결승선 통과.'],
  RACE_OVER: ['경기 종료입니다! 정말 대단한 레이스였습니다.', '여러분, 이것이 초현실 경마입니다.'],
  GENERIC: [
    '{n}번 {name}{iga} 선두!',
    '치열한 선두 다툼입니다!',
    '후방 그룹도 열심히 달리고 있습니다.',
    '선두 그룹은 {n}번, {n2}번!',
    '{n}번 선수, 페이스가 좋습니다.',
    '관중석의 열기가 뜨겁습니다!',
    '{n2}번 선수가 바짝 붙습니다.',
  ],
  OUTSIDE: ['{n}번 선수가 바깥쪽에서 올라옵니다!', '{n}번 {name}, 순위를 끌어올립니다!', '{n}번, 무섭게 치고 올라옵니다!'],
  CORNER: ['코너에 진입합니다!', '첫 번째 코너! 안쪽 자리 싸움!', '코너에서 대열이 흔들립니다!'],
  BACKSTRAIGHT: ['뒷 직선주로에 들어섰습니다.', '뒷 직선, 여기서 페이스가 올라갑니다.'],
  GAP: ['2위와의 차이가 벌어집니다!', '선두가 독주합니다!'],
  TIGHT: ['선두권이 나란히!', '아주 근소한 차이입니다!'],
};

function iga(name: string): string {
  const c = name.charCodeAt(name.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return '가';
  return (c - 0xac00) % 28 === 0 ? '가' : '이';
}

export interface CommentaryLine {
  text: string;
  /** 음성용 일본어 */
  ja: string;
  major: boolean;
}

/**
 * 이벤트/상황에 따라 중계 자막을 고른다. 같은 문장 반복 최소화.
 */
export class CommentaryManager {
  private recent = new Map<string, number[]>();
  private queue: CommentaryLine[] = [];
  onSpeak: ((ja: string, major: boolean) => void) | null = null;
  private current: CommentaryLine | null = null;
  private showTimer = 0;
  private tickTimer = 4;
  private lastCorner = 0;
  private rankHistory = new Map<string, { rank: number; t: number }[]>();
  private outsideCooldown = 0;
  private photoSaid = false;
  onLine: ((line: CommentaryLine | null) => void) | null = null;

  reset(): void {
    this.queue = [];
    this.current = null;
    this.showTimer = 0;
    this.tickTimer = 4;
    this.lastCorner = 0;
    this.rankHistory.clear();
    this.outsideCooldown = 0;
    this.photoSaid = false;
    this.onLine?.(null);
  }

  private pick(key: BankKey): [string, string] {
    const bank = BANKS[key];
    const used = this.recent.get(key) ?? [];
    let candidates = bank.map((_, i) => i).filter((i) => !used.includes(i));
    if (!candidates.length) candidates = bank.map((_, i) => i);
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    used.push(idx);
    while (used.length > Math.min(2, bank.length - 1)) used.shift();
    this.recent.set(key, used);
    const jaBank = BANKS_JA[key];
    return [bank[idx], jaBank ? jaBank[Math.min(idx, jaBank.length - 1)] : bank[idx]];
  }

  private fill(template: string, r?: Racer, t?: Racer, second?: Racer, ja = false): string {
    return template
      .replace(/\{n\}/g, r ? String(r.def.number) : '')
      .replace(/\{name\}/g, r ? (ja ? r.def.nameJa : r.def.name) : '')
      .replace(/\{iga\}/g, r ? iga(r.def.name) : '')
      .replace(/\{tn\}/g, t ? String(t.def.number) : '')
      .replace(/\{tname\}/g, t ? t.def.name : '')
      .replace(/\{n2\}/g, second ? String(second.def.number) : '');
  }

  sayRaw(text: string, major: boolean, ja = text): void {
    this.push(text, major, ja);
  }

  say(key: BankKey, major: boolean, r?: Racer, t?: Racer, second?: Racer): void {
    const [ko, jaT] = this.pick(key);
    this.push(this.fill(ko, r, t, second), major, this.fill(jaT, r, t, second, true));
  }

  private push(text: string, major: boolean, ja: string): void {
    if (major) {
      this.queue = this.queue.filter((q) => q.major);
      this.queue.unshift({ text, ja, major });
      this.showTimer = 0; // 즉시 교체
    } else {
      if (this.queue.length > 2) return;
      this.queue.push({ text, ja, major });
    }
  }

  onEvent(ev: RaceEvent, engine: RaceEngine): void {
    const r = engine.racerById(ev.racerId);
    const t = ev.targetId ? engine.racerById(ev.targetId) : undefined;
    switch (ev.event) {
      case 'START':
        this.say('START', true);
        return;
      case 'FINISH_LINE': {
        const finished = engine.racers.filter((x) => x.state.finishTime !== null).length;
        if (finished === 1) this.say('FINISH_FIRST', true, r);
        else if (finished <= 3) this.say('FINISH_OTHER', false, r);
        return;
      }
      case 'LEAD_CHANGE':
        if (engine.time > 4) this.say('LEAD_CHANGE', false, r);
        return;
      case 'BUMP':
        if (Math.random() < 0.5) this.say('BUMP', false, r, t);
        return;
      case 'RACE_OVER':
        this.say('RACE_OVER', true);
        return;
      default:
        if (ev.event in BANKS) this.say(ev.event as BankKey, ev.major, r, t);
        if (ev.destiny) this.push('믿을 수 없는 역전이 시작됩니다!!', true, DESTINY_JA);
    }
  }

  /** 상황 멘트 — 순위 변화, 코너 진입 등 */
  update(dt: number, engine: RaceEngine, racing: boolean): void {
    this.showTimer -= dt;
    this.outsideCooldown -= dt;
    if (this.showTimer <= 0) {
      const next = this.queue.shift();
      if (next) {
        this.current = next;
        this.showTimer = next.major ? 2.6 : 2.0;
        this.onLine?.(next);
        this.onSpeak?.(next.ja, next.major);
      } else if (this.current) {
        this.current = null;
        this.onLine?.(null);
      }
    }
    if (!racing) return;
    // 순위 기록
    for (const r of engine.racers) {
      const h = this.rankHistory.get(r.def.id) ?? [];
      h.push({ rank: r.state.rank, t: engine.time });
      while (h.length && engine.time - h[0].t > 3) h.shift();
      this.rankHistory.set(r.def.id, h);
      if (this.outsideCooldown <= 0 && h.length > 5 && h[0].rank - r.state.rank >= 2 && r.state.rank <= 4 && engine.time > 6) {
        this.outsideCooldown = 6;
        this.say('OUTSIDE', false, r);
      }
    }
    // 코너 진입/이탈
    const leader = engine.ranking[0] ? engine.racerById(engine.ranking[0].id) : undefined;
    if (leader) {
      const cw = engine.track.cornerWeight(leader.state.distance);
      if (cw > 0.5 && this.lastCorner <= 0.5 && Math.random() < 0.7) this.say('CORNER', false, leader);
      const L1 = engine.track.straight;
      const arc = Math.PI * engine.track.radius;
      const s = engine.track.wrap(leader.state.distance);
      if (cw < 0.5 && this.lastCorner >= 0.5 && s > L1 + arc && s < L1 + arc + 30 && Math.random() < 0.7) this.say('BACKSTRAIGHT', false, leader);
      this.lastCorner = cw;
    }
    // 사진 판정
    if (!this.photoSaid && engine.photoFinishTension() > 0.4) {
      this.photoSaid = true;
      this.say('PHOTO', true);
    }
    // 일반 상황 멘트
    this.tickTimer -= dt;
    if (this.tickTimer <= 0 && this.queue.length === 0 && engine.time > 4) {
      this.tickTimer = 4 + Math.random() * 3;
      const second = engine.ranking[1] ? engine.racerById(engine.ranking[1].id) : undefined;
      const gap = engine.ranking[1]?.gapToLeader ?? 0;
      if (gap > 12 && Math.random() < 0.5) this.say('GAP', false, leader);
      else if (gap < 2 && Math.random() < 0.5) this.say('TIGHT', false, leader, undefined, second);
      else this.say('GENERIC', false, leader, undefined, second);
    }
  }
}
