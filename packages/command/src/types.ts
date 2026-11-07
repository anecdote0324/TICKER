// 해석기·완성기의 입출력 형식

import type { AssetClass, AssistLevel, FunctionDef, Instrument, Market } from '@bt/shared';
import type { CommandWord } from './lexicon';
import type { Range } from './search-index';

export interface PanelContext {
  /** 패널에 띄운 종목 */
  security?: Instrument;
  /** 패널의 지금 기능 */
  fn?: string;
  /** 연동 그룹 표시(예: '파랑') */
  linkLabel?: string;
}

export interface EngineContext {
  panel: PanelContext;
  assist: AssistLevel;
  hanEng: boolean;
  tabAutofill: boolean;
  /** 이 기능을 이 종목에 쓸 수 있는지(데이터 소스 능력, 05 §3.4). 없으면 모두 가능 */
  supports?: (fnCode: string, inst: Instrument) => boolean;
  /** 사용 점수 0~1(05 §6.6) */
  usage?: (instrumentId: string) => number;
  /** 이 자산군에서 자주 쓴 기능(많이 쓴 순) */
  fnUsage?: (asset: AssetClass) => string[];
  /** 기억된 선택(↺): 검색어 → 줄 id */
  remembered?: (query: string) => string | undefined;
  /** 겹침에서 사용자가 정한 기본값: 코드 키 → 종목 id */
  userDefault?: (key: string) => string | undefined;
  watchlist?: Set<string>;
  /** 사용자가 고른 토큰의 뜻. 그 토큰의 글자가 그대로인 동안만 유지돼요 */
  chosen?: ChosenToken[];
  /** 최근 실행한 명령(표준형, 최신순) */
  recent?: string[];
  /** 목록에 없는 코드를 한국투자증권에서 직접 조회할 수 있는지(키가 있을 때, 05 §4.5) */
  lookup?: boolean;
  /** 사용자 별칭(ALIAS, v0.2): 별칭 키(aliasKey) → 종목 id */
  aliases?: (key: string) => string | undefined;
  /** 종목만 입력하고 Enter(06): 지금 기능 유지(기본) 또는 블룸버그식 기능 메뉴(v0.2) */
  securityEnter?: 'keep-function' | 'menu';
  /** 패널이 기능 메뉴 페이지일 때 번호 → 기능 코드(숫자 + Enter, 05 §10.2) */
  menu?: string[];
  /** 자산군별 기본 기능(v0.2, 06). 없으면 GP */
  defaultFn?: (asset: AssetClass) => string | undefined;
}

export interface ChosenToken {
  /** 줄 안의 토큰 시작 위치 */
  start: number;
  text: string;
  rowId: string;
}

export type SlotKind = 'security' | 'market' | 'asset' | 'function' | 'command' | 'go' | 'arg' | 'closed' | 'unknown';

export type SegmentStatus =
  /** 정확 */
  | 'exact'
  /** 교정(KQ → KS, 헤 → GP) */
  | 'corrected'
  /** 사용자가 고른 토큰 */
  | 'chosen'
  /** 무시하는 토큰(BN 등) */
  | 'ignored'
  /** 고르기가 필요(앞부분, 짧은 입력, 초성, 겹침 등) */
  | 'choose'
  /** 잘못됨 */
  | 'invalid'
  /** 아직 만들지 않은 기능·자산군 */
  | 'unavailable'
  /** 일치 없음 */
  | 'nomatch';

export interface Segment {
  index: number;
  start: number;
  end: number;
  /** 원래 글자(여러 단어 이름이면 공백 포함) */
  text: string;
  slot: SlotKind;
  status: SegmentStatus;
  inst?: Instrument;
  market?: Market;
  asset?: AssetClass;
  fn?: FunctionDef;
  /** 별칭으로 들어왔으면 그 별칭(GPO → GP) */
  fnVia?: string;
  cmd?: CommandWord;
  /** 교정·변환 표시: '헤 → GP', 'KQ → KS' */
  note?: string;
  /** 사용자가 정한 기본값으로 정해졌는지 */
  byUserDefault?: boolean;
  /** 덮어쓰기 표로 정해졌는지 */
  byOverride?: boolean;
  error?: string;
  /** 고침 줄이 만들 줄 전체 */
  fixLine?: string;
  /** 고르기 상태일 때 이유 */
  chooseReason?: 'prefix' | 'short' | 'ambiguous' | 'fuzzy' | 'convert';
  /** 목록에 없지만 직접 조회해 볼 만한 코드 모양(05 §4.5) */
  lookup?: { code: string; market: 'KR' | 'US' };
  /** 기능 인자의 값(MOST KQ의 'KQ') */
  arg?: string;
  /** 종목 인자(COMP의 비교 종목). 해석한 종목은 inst, 붙인 시장은 market */
  argSecurity?: boolean;
  /** 사용자 별칭으로 정해졌는지(그 별칭 글자) */
  byAlias?: string;
}

export type RowKind = 'security' | 'function' | 'market' | 'asset' | 'command' | 'convert' | 'fix' | 'unavailable' | 'nomatch' | 'lookup' | 'history' | 'header' | 'arg';

export interface Row {
  id: string;
  kind: RowKind;
  /** 'EQ·KS', 'CRY', 'FN', 'HIST' 등 */
  badge: string;
  code: string;
  name: string;
  nameEn?: string;
  /** '코스피 · 보통주', '일·주·월봉 캔들' */
  info: string;
  /** PREF, ETF, ADR, 한/영, 영→한 등 */
  flags: string[];
  /** 이 줄이 만드는 표준형 또는 가장 짧은 명령 */
  canonical: string;
  codeRanges?: Range[];
  nameRanges?: Range[];
  remembered?: boolean;
  tier: number;
  /** Tab이 토큰에 쓸 글자 */
  insert: string;
  instrumentId?: string;
  fnCode?: string;
  disabled?: boolean;
  /** 우선주처럼 위 줄에 딸린 줄(└) */
  child?: boolean;
  /** 입문의 '● 현재' 표시 */
  current?: boolean;
  /** 줄을 고르면 바꿀 줄 전체(고침·기록 줄) */
  replaceLine?: string;
}

export type EnterPlan =
  | { kind: 'execute'; exec: Execution }
  | { kind: 'select'; segment: number; rowId: string; label: string }
  | { kind: 'need-security'; fn: FunctionDef }
  | { kind: 'error'; segment: number; message: string }
  | { kind: 'nomatch'; text: string }
  | { kind: 'empty' };

export interface Execution {
  kind: 'function' | 'command' | 'asset-list' | 'lookup';
  fn?: string;
  /** 별칭으로 불렀으면 그 별칭(GPO·GPC → GP 표시 모드, v0.5) */
  via?: string;
  /** lookup: 한국투자증권에서 직접 조회할 코드와 시장. 찾으면 fn으로 열어요 */
  lookup?: { code: string; market: 'KR' | 'US' };
  /** 실행할 종목 id(종목이 필요 없는 기능이면 패널이 기억할 종목) */
  instrumentId?: string;
  cmd?: CommandWord;
  asset?: AssetClass;
  /** 패널과 기록에 남는 표준형: '005930 KS EQUITY GP' */
  canonical: string;
  /** 종목이 필요 없는 기능에 종목을 함께 친 경우: 띄운 종목만 바꿔요 */
  setsSecurityOnly?: boolean;
  /** 기능 인자(MOST의 시장, COMP의 비교 종목 id) */
  args?: string[];
  /** 종목만 입력해서 지금 기능을 유지할 때: 패널의 인자(COMP 비교 종목)도 그대로 둬요 */
  keepArgs?: boolean;
  /** ⏎ 라벨에 붙은 설명 */
  notes: string[];
}

export interface ProgressItem {
  slot: 'security' | 'market' | 'asset' | 'function';
  label: string;
  state: 'done' | 'current' | 'empty' | 'error';
  text: string;
}

export interface Ghost {
  /** Tab이 넣을 부분 */
  tab: string;
  /** Enter·→가 쓰는 나머지(경계 ¦ 뒤) */
  rest: string;
  /** 확정: 지금 Enter를 누르면 이 내용대로 실행 */
  confirmed: boolean;
  /** 입력의 뒤에 이어 붙는 글자가 아니라 바꿔 쓰는 글자인지(삼성 → 005930) */
  replace: boolean;
}

export interface Analysis {
  input: string;
  cursor: number;
  segments: Segment[];
  /** 커서가 있는 칸. 줄 끝 공백 뒤면 새 칸(segments.length) */
  current: number;
  /** 목록을 보여 줄 칸 */
  listSegment: number;
  rows: Row[];
  /** 8줄 밖에 남은 줄 수 */
  more: number;
  ghost: Ghost | null;
  plan: EnterPlan;
  label: string;
  progress: ProgressItem[];
  message: string;
  /** 'AAPL US' 처럼 함축된 종목 칩 */
  contextChip?: string;
  security?: Instrument;
  fn?: FunctionDef;
  /** 목록을 자동으로 열 만한 상태인지(전문가: 애매·오류일 때) */
  needsAttention: boolean;
}
