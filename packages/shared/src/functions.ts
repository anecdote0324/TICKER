// 기능 목록. 후보 줄, 도움말 카드, 문법 요약, 오류 메시지, 시작 목록이 모두 여기서 문구를 가져와요(05 §12.4).

import { FUNCTION_CATALOG } from './function-catalog.generated';
import type { AssetClass } from './instrument';

export type SecurityNeed = 'none' | 'one' | 'optional';

/** 기능 뒤에 붙이는 인자(05 §3.1, v0.2). MOST는 시장 하나 */
export interface FunctionArgs {
  kind: 'market';
  /** 자리 표시와 오류 문구에 쓰는 이름: '시장' */
  label: string;
  /** 고를 수 있는 값. 첫 번째가 기본값이에요 */
  choices: Array<{ code: string; label: string }>;
}

/** MOST 시장 인자: 코스피·코스닥·미국(나스닥+뉴욕)·코인(Binance) */
export const MOST_MARKETS: FunctionArgs['choices'] = [
  { code: 'KS', label: '코스피' },
  { code: 'KQ', label: '코스닥' },
  { code: 'US', label: '미국' },
  { code: 'CRYPTO', label: '코인' },
];

export interface FunctionDef {
  code: string;
  nameKo: string;
  nameEn: string;
  /** 후보 줄에 보이는 한 줄 설명 */
  summary: string;
  /** 설명 창에 보이는 긴 설명 */
  detail?: string;
  security: SecurityNeed;
  /** 종목이 필요한 기능이 지원하는 자산군 */
  assetClasses: AssetClass[];
  /** 분봉 같은 특별한 데이터가 필요한지. 소스가 주지 않으면 그 종목에서 빠져요(05 §3.4) */
  needs?: Array<'intraday'>;
  /** 한국어 키워드(05 §12.3). 첫 번째 키워드가 대표예요 */
  keywords: string[];
  /** 'v0.1' 같은 단계 */
  version: string;
  implemented: boolean;
  /** 데이터 속도(02 신선도 표시와 같은 말) */
  speed: string;
  examples: string[];
  similar?: string[];
  /** 대표 기능의 탭으로 여는 블룸버그 별칭 */
  aliases?: string[];
  /** 블룸버그 코드가 아닌 자체 코드(K 접두) */
  notBloomberg?: boolean;
  approx?: boolean;
  /** 기능 뒤에 붙이는 인자 */
  args?: FunctionArgs;
}

const ALL_ASSETS: AssetClass[] = ['EQUITY', 'CRYPTO', 'CURNCY', 'INDEX'];

/** v0.1에서 만든 기능. 다른 코드는 카탈로그에서 와요. */
const BUILT: FunctionDef[] = [
  {
    code: 'GP',
    nameKo: '가격 차트',
    nameEn: 'Price Graph',
    summary: '일·주·월봉 캔들',
    detail: '일봉·주봉·월봉 캔들 차트와 거래량, 20일·60일 이동평균선을 보여 줘요.',
    security: 'one',
    assetClasses: ALL_ASSETS,
    keywords: ['차트', '그래프', '일봉', '주봉', '월봉'],
    version: 'v0.1',
    implemented: true,
    speed: '봉은 일별, 마지막 봉은 시세와 같은 속도(실시간·주기 조회)',
    examples: ['005930 GP', 'AAPL US GP', 'BTC GP'],
    similar: ['GIP'],
    aliases: ['GPO', 'GPC'],
  },
  {
    code: 'GIP',
    nameKo: '장중 차트',
    nameEn: 'Intraday Price',
    summary: '오늘 장중 움직임(분봉)',
    detail: '오늘 장중 분봉 차트예요. 데이터 소스가 분봉을 줄 때만 쓸 수 있어요.',
    security: 'one',
    assetClasses: ALL_ASSETS,
    needs: ['intraday'],
    keywords: ['분봉', '장중'],
    version: 'v0.1',
    implemented: true,
    speed: '분봉, 마지막 봉은 시세와 같은 속도',
    examples: ['005930 GIP', 'AAPL US GIP', 'BTC GIP'],
    similar: ['GP'],
  },
  {
    code: 'MON',
    nameKo: '관심종목',
    nameEn: 'Monitor',
    summary: '내가 고른 종목 시세 모음',
    detail: '국내·미국 주식, 코인, 환율, 지수를 한 목록에 섞어서 보여 줘요. 행을 고르면 같은 연동 그룹의 차트가 바뀌어요.',
    security: 'none',
    assetClasses: [],
    keywords: ['관심', '관심종목', '워치'],
    version: 'v0.1',
    implemented: true,
    speed: '주식·코인 실시간(구독 한도를 넘으면 주기 조회), 환율 주기 조회',
    examples: ['MON'],
  },
  {
    code: 'WEI',
    nameKo: '세계 지수',
    nameEn: 'World Equity Indices',
    summary: '미주·유럽·아시아 주요 지수',
    security: 'none',
    assetClasses: [],
    keywords: ['지수', '세계증시', '해외증시'],
    version: 'v0.1',
    implemented: true,
    speed: '주기 조회(지연 여부는 지수마다 배지로 표시)',
    examples: ['WEI'],
  },
  {
    code: 'FXC',
    nameKo: '환율 매트릭스',
    nameEn: 'Currency Matrix',
    summary: '주요 통화끼리의 환율 표',
    detail: '각 칸은 왼쪽(행) 통화 1단위가 위쪽(열) 통화로 얼마인지 보여 줘요.',
    security: 'none',
    assetClasses: [],
    keywords: ['환율', '외환'],
    version: 'v0.1',
    implemented: true,
    speed: '주기 조회',
    examples: ['FXC'],
    aliases: ['WCR'],
  },
  {
    code: 'CRYP',
    nameKo: '코인 시세판',
    nameEn: 'Crypto Monitor',
    summary: 'Binance USDT 주요 코인',
    security: 'none',
    assetClasses: [],
    keywords: ['코인', '암호화폐', '가상자산'],
    version: 'v0.1',
    implemented: true,
    speed: '실시간',
    examples: ['CRYP'],
  },
  {
    code: 'DES',
    nameKo: '종목 개요',
    nameEn: 'Description',
    summary: '시가총액·PER·52주 고저·업종',
    detail: '주식의 시가총액, PER·PBR·EPS·BPS, 52주 최고·최저, 업종, 상장일, 매출액·영업이익·ROE(국내 종목 마스터)를 한 화면에 보여 줘요.',
    security: 'one',
    assetClasses: ['EQUITY'],
    keywords: ['개요', '종목개요', '기업개요'],
    version: 'v0.2',
    implemented: true,
    speed: '시세는 실시간, 가치 지표는 60초마다 조회, 실적·업종은 하루 한 번(종목 마스터)',
    examples: ['005930 DES', 'AAPL US DES'],
    similar: ['GP'],
    aliases: ['ISSD'],
  },
  {
    code: 'MOST',
    nameKo: '상위 종목',
    nameEn: 'Most Active',
    summary: '거래량·거래대금·등락률 상위',
    detail: '시장 하나의 거래량·거래대금·상승률·하락률 상위 종목이에요. 기능 뒤에 시장을 붙여요: MOST KS(코스피), MOST KQ(코스닥), MOST US(미국), MOST CRYPTO(코인).',
    security: 'none',
    assetClasses: [],
    keywords: ['상위', '상위종목', '거래량상위'],
    version: 'v0.2',
    implemented: true,
    speed: '국내·미국 30초마다 조회(한국투자증권 순위), 코인 30초마다(Binance 24시간)',
    examples: ['MOST', 'MOST KQ', 'MOST US', 'MOST CRYPTO'],
    aliases: ['LVI'],
    args: { kind: 'market', label: '시장', choices: MOST_MARKETS },
  },
];

/** 앞으로 만들 기능 중 v0.2~v0.3의 자세한 문구(03 문서). 나머지는 카탈로그 문구를 써요. */
const PLANNED_DETAIL: Record<string, Partial<FunctionDef>> = {
  N: { security: 'optional', assetClasses: ALL_ASSETS, keywords: ['뉴스', '공시'], summary: '뉴스·공시 헤드라인' },
  COMP: { security: 'one', assetClasses: ALL_ASSETS, keywords: ['비교'], summary: '여러 종목 겹쳐 비교' },
  HMAP: { security: 'none', assetClasses: [], keywords: ['히트맵'], summary: '업종 기간별 등락 색' },
  IMAP: { security: 'none', assetClasses: [], keywords: ['업종'], summary: '업종별 등락 타일' },
  FA: { security: 'one', assetClasses: ['EQUITY'], keywords: ['재무', '재무제표'], summary: '손익·재무상태·현금흐름' },
  ECO: { security: 'none', assetClasses: [], keywords: ['경제지표', '캘린더'], summary: '경제지표 발표 일정' },
  GC: { security: 'none', assetClasses: [], keywords: ['금리', '커브'], summary: '국고채·미국채 금리 커브' },
  GRID: { security: 'none', assetClasses: [], keywords: ['격자'], summary: '소형 차트 격자' },
  MAP: { security: 'none', assetClasses: [], keywords: ['지도', '세계지도'], summary: '지역별 시장 현황 지도' },
  PORT: { security: 'none', assetClasses: [], keywords: ['포트폴리오', '보유'], summary: '보유 종목 손익' },
  ALRT: { security: 'optional', assetClasses: ALL_ASSETS, keywords: ['알림'], summary: '가격·뉴스 조건 알림' },
};

/** 블룸버그 코드가 아닌 자체 코드(08 §1.4) */
const K_CODES = new Set(['KINV', 'KPGM', 'KCRD', 'KWRN', 'KCB', 'KELS']);

/** 명령 단어: 기능 패널이 아니라 앱 동작(05 §3.2) */
const COMMAND_CODES = new Set(['HELP', 'PDF', 'BLP', 'FXTF']);

function fromCatalog(): FunctionDef[] {
  const built = new Set(BUILT.map((f) => f.code));
  const out: FunctionDef[] = [];
  for (const e of FUNCTION_CATALOG) {
    if (built.has(e.code) || COMMAND_CODES.has(e.code)) continue;
    const extra = PLANNED_DETAIL[e.code] ?? {};
    out.push({
      code: e.code,
      nameKo: e.nameKo,
      nameEn: '',
      summary: e.desc.split(/[.,(]/)[0].slice(0, 40) || e.nameKo,
      detail: e.desc,
      security: 'optional',
      assetClasses: [],
      keywords: [],
      version: e.version,
      implemented: false,
      speed: e.speed,
      examples: [],
      aliases: e.aliases,
      notBloomberg: K_CODES.has(e.code),
      approx: e.approx,
      ...extra,
    });
  }
  return out;
}

export const FUNCTIONS: FunctionDef[] = [...BUILT, ...fromCatalog()];

const byCode = new Map<string, FunctionDef>();
const byAlias = new Map<string, FunctionDef>();
for (const f of FUNCTIONS) {
  byCode.set(f.code, f);
  for (const a of f.aliases ?? []) if (!byAlias.has(a)) byAlias.set(a, f);
}

export function getFunction(code: string): FunctionDef | undefined {
  return byCode.get(code.toUpperCase());
}

/** 별칭이면 대표 기능을 돌려줘요: GPO → GP */
export function resolveFunctionAlias(code: string): { fn: FunctionDef; via?: string } | undefined {
  const up = code.toUpperCase();
  const f = byCode.get(up);
  if (f) return { fn: f };
  const a = byAlias.get(up);
  return a ? { fn: a, via: up } : undefined;
}

export function versionLabel(v: string): string {
  return v === 'later' ? '후순위' : v;
}

/** 자산군별 기본 순서(05 §6.7, 03) */
export const FUNCTION_ORDER: Record<AssetClass, string[]> = {
  EQUITY: ['GP', 'GIP', 'DES', 'N', 'COMP', 'FA'],
  CRYPTO: ['GP', 'GIP', 'COMP'],
  CURNCY: ['GP', 'GIP', 'COMP'],
  INDEX: ['GP', 'GIP', 'COMP'],
};

/** 자산군의 대표 기능: CRYPTO⏎ → CRYP 등(05 §3.2) */
export const ASSET_HOME_FUNCTION: Partial<Record<AssetClass, string>> = {
  EQUITY: 'MOST',
  CRYPTO: 'CRYP',
  CURNCY: 'FXC',
  INDEX: 'WEI',
};

export const DEFAULT_FUNCTION = 'GP';

/** 종목이 필요한 기능인지 */
export function isSecurityFunction(f: FunctionDef): boolean {
  return f.security === 'one';
}
