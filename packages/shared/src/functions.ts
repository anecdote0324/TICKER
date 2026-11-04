// 기능 목록. 후보 줄, 도움말 카드, 문법 요약, 오류 메시지, 시작 목록이 모두 여기서 문구를 가져와요(05 §12.4).

import { FUNCTION_CATALOG } from './function-catalog.generated';
import type { AssetClass } from './instrument';
import { MAP_INDEXES, SECTOR_INDEXES } from './sectors';

export type SecurityNeed = 'none' | 'one' | 'optional';

/** 기능 뒤에 붙이는 인자(05 §3.1, v0.2). MOST는 시장 하나, HMAP·IMAP은 지수 하나, COMP는 비교할 종목 여러 개 */
export interface FunctionArgs {
  kind: 'market' | 'index' | 'securities' | 'curve';
  /** 자리 표시와 오류 문구에 쓰는 이름: '시장' */
  label: string;
  /** 고를 수 있는 값. 첫 번째가 기본값이에요(시장·지수 인자). aliases도 그 값으로 읽어요(KS → KOSPI) */
  choices: Array<{ code: string; label: string; aliases?: string[] }>;
  /** 받을 수 있는 인자 수 */
  max?: number;
}

/** COMP에 겹칠 수 있는 비교 종목 수 */
export const COMP_MAX = 5;

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

/** GC 커브 인자(v0.3): 둘 다·미국채·국고채 */
export const GC_CURVES: FunctionArgs['choices'] = [
  { code: 'ALL', label: '전체', aliases: ['BOTH'] },
  { code: 'US', label: '미국채', aliases: ['UST', '미국'] },
  { code: 'KR', label: '국고채', aliases: ['KTB', '한국', 'KS'] },
];

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
    args: { kind: 'market', label: '시장', choices: MOST_MARKETS, max: 1 },
  },
  {
    code: 'COMP',
    nameKo: '비교 차트',
    nameEn: 'Comparative Returns',
    summary: '여러 종목 수익률 겹쳐 비교',
    detail: '기준 종목과 비교 종목들의 수익률(기간 시작 = 0%)을 한 차트에 겹쳐요. 기능 뒤에 비교할 종목을 붙여요: 005930 COMP 000660 KOSPI. 비교 종목을 안 붙이면 그 시장의 대표 지수와 비교해요.',
    security: 'one',
    assetClasses: ALL_ASSETS,
    keywords: ['비교', '수익률비교'],
    version: 'v0.2',
    implemented: true,
    speed: '일봉(마지막 봉은 시세와 같은 속도)',
    examples: ['005930 COMP', '005930 COMP 000660 KOSPI', 'AAPL US COMP MSFT US SPX'],
    similar: ['GP'],
    args: { kind: 'securities', label: '비교 종목', choices: [], max: COMP_MAX },
  },
  {
    code: 'HMAP',
    nameKo: '업종 히트맵',
    nameEn: 'Sector Heat Map',
    summary: '업종 지수 기간별 등락 색',
    detail: '지수의 업종마다 오늘·1주·1개월·3개월·올해 등락을 색 칸으로 보여 줘요. 업종을 누르면 그 업종의 큰 종목들. 기능 뒤에 지수를 붙여요: HMAP KOSPI, HMAP KOSDAQ, HMAP KOSPI2(코스피200).',
    security: 'none',
    assetClasses: [],
    keywords: ['히트맵', '업종히트맵'],
    version: 'v0.2',
    implemented: true,
    speed: '오늘 등락은 30초마다(업종 지수), 기간 등락은 업종 지수 일봉(하루 한 번)',
    examples: ['HMAP', 'HMAP KOSDAQ', 'HMAP KOSPI2'],
    similar: ['IMAP'],
    args: { kind: 'index', label: '지수', choices: SECTOR_INDEXES, max: 1 },
  },
  {
    code: 'IMAP',
    nameKo: '업종 타일',
    nameEn: 'Intraday Market Map',
    summary: '업종별 종목 등락 타일',
    detail: '업종별로 묶은 종목 타일이에요. 넓이는 시가총액, 색은 오늘 등락률. 타일을 누르면 연동 그룹이 그 종목으로 바뀌어요. 기능 뒤에 지수를 붙여요: IMAP KOSPI(시가총액 상위 200), IMAP KOSDAQ, IMAP KOSPI2, IMAP SPX(S&P 500), IMAP NDX(나스닥100). 미국 지수의 구성 종목과 넓이(비중)는 그 지수를 따르는 ETF(SPY·QQQ)의 보유 종목 파일에서 가져와요.',
    security: 'none',
    assetClasses: [],
    keywords: ['업종', '업종타일', '맵'],
    version: 'v0.2',
    implemented: true,
    speed: '종목 시세 1분마다(30종목씩 조회), 업종 지수 30초마다. 미국 지수는 시가총액 순위로 1분마다, 보유 종목 파일은 하루 한 번',
    examples: ['IMAP', 'IMAP KOSDAQ', 'IMAP KOSPI2', 'IMAP SPX', 'IMAP NDX'],
    similar: ['HMAP'],
    args: { kind: 'index', label: '지수', choices: MAP_INDEXES, max: 1 },
  },
  {
    code: 'LAST',
    nameKo: '최근 화면',
    nameEn: 'Last Screens',
    summary: '최근에 연 화면 목록',
    detail: '최근에 실행한 명령(화면)을 새것부터 보여 줘요. 줄을 누르면 이 패널에서 다시 열어요.',
    security: 'none',
    assetClasses: [],
    keywords: ['최근', '최근화면'],
    version: 'v0.2',
    implemented: true,
    speed: '정적',
    examples: ['LAST'],
  },
  {
    code: 'N',
    nameKo: '뉴스·공시',
    nameEn: 'News',
    summary: 'DART 공시와 국내외 뉴스 헤드라인',
    detail: 'DART 공시(인증키가 있을 때)와 국내외 RSS 뉴스 헤드라인이에요. 종목을 함께 치면 그 회사 공시와 제목에 이름이 들어간 헤드라인만 보여요. 줄을 누르면 원문을 열어요.',
    security: 'optional',
    assetClasses: ALL_ASSETS,
    keywords: ['뉴스', '공시'],
    version: 'v0.2',
    implemented: true,
    speed: 'RSS 5분마다, DART 2분마다',
    examples: ['N', '005930 N', 'AAPL US N'],
    similar: ['DES'],
  },
  {
    code: 'GC',
    nameKo: '금리 커브',
    nameEn: 'Graph Curves',
    summary: '미국채·국고채 금리 커브와 변동',
    detail: '미국채(재무부)와 국고채(BOK ECOS, 인증키) 금리 커브를 겹쳐 보고, 1주·1개월·1년 전 커브와 비교해요. 테너별 변동(bp)과 10년-2년 같은 스프레드도 보여 줘요.',
    security: 'none',
    assetClasses: [],
    keywords: ['금리', '커브', '국채', '국고채', '미국채'],
    version: 'v0.3',
    implemented: true,
    speed: '일별(미국채 재무부, 국고채 BOK ECOS)',
    examples: ['GC', 'GC US', 'GC KR'],
    aliases: ['YCRV', 'CRVF'],
    args: { kind: 'curve', label: '커브', choices: GC_CURVES, max: 1 },
  },
  {
    code: 'FA',
    nameKo: '재무제표',
    nameEn: 'Financial Analysis',
    summary: '손익·재무상태·현금흐름·비율',
    detail: '연간(6년)·분기(8분기) 손익계산서, 재무상태표, 현금흐름표와 영업이익률·ROE·부채비율·잉여현금흐름 같은 비율. 국내는 DART(인증키), 미국은 SEC EDGAR(설정의 연락처).',
    security: 'one',
    assetClasses: ['EQUITY'],
    keywords: ['재무', '재무제표', '실적표'],
    version: 'v0.3',
    implemented: true,
    speed: '분기마다 바뀌는 공시 값(12시간마다 다시 받아요)',
    examples: ['005930 FA', 'AAPL US FA'],
    similar: ['DES'],
  },
  {
    code: 'KINV',
    nameKo: '투자자별 매매동향',
    nameEn: 'Investor Flows (KR)',
    summary: '외국인·기관·개인 순매수(국내)',
    detail: '국내 주식의 날마다 외국인·기관·개인 순매수 금액과 수량, 기간 누적 순매수 선이에요. 한국투자증권 주식현재가 투자자 조회. 블룸버그 코드가 아닌 자체 코드예요.',
    security: 'one',
    assetClasses: ['EQUITY'],
    keywords: ['수급', '투자자', '외국인', '기관', '개인', '순매수'],
    version: 'v0.4',
    implemented: true,
    speed: '5분마다(장중에는 오늘 줄이 바뀌어요)',
    examples: ['005930 KINV'],
    similar: ['KPGM', 'KCRD'],
    notBloomberg: true,
  },
  {
    code: 'KPGM',
    nameKo: '프로그램 매매',
    nameEn: 'Program Trading (KR)',
    summary: '종목별 프로그램 순매수(국내)',
    detail: '국내 주식의 날마다 프로그램 매수·매도·순매수와 거래대금 대비 비중이에요. 한국투자증권 종목별 프로그램매매추이(일별). 블룸버그 코드가 아닌 자체 코드예요.',
    security: 'one',
    assetClasses: ['EQUITY'],
    keywords: ['프로그램', '프로그램매매', '차익', '비차익'],
    version: 'v0.4',
    implemented: true,
    speed: '5분마다',
    examples: ['005930 KPGM'],
    similar: ['KINV'],
    notBloomberg: true,
  },
  {
    code: 'KCRD',
    nameKo: '신용·대차 잔고',
    nameEn: 'Margin & Lending (KR)',
    summary: '신용 융자·대주 잔고, 대차거래(국내)',
    detail: '국내 주식의 날마다 신용 융자 잔고(주·금액·잔고율)와 대주 잔고, 대차거래 잔고·증감이에요. 위 버튼으로 신용·대차를 바꿔요. 블룸버그 코드가 아닌 자체 코드예요.',
    security: 'one',
    assetClasses: ['EQUITY'],
    keywords: ['신용', '신용잔고', '대차', '대주', '융자'],
    version: 'v0.4',
    implemented: true,
    speed: '5분마다(잔고는 결제일 기준이라 하루 늦어요)',
    examples: ['005930 KCRD'],
    similar: ['SI', 'KINV'],
    notBloomberg: true,
  },
  {
    code: 'SI',
    nameKo: '공매도',
    nameEn: 'Short Interest',
    summary: '공매도 거래량·금액과 비중(국내)',
    detail: '국내 주식의 날마다 공매도 체결 수량·금액, 거래량·거래대금 대비 비중, 평균가예요. 한국투자증권 공매도 일별추이. 미국 공매도 잔고(FINRA)는 뒤에 붙여요.',
    security: 'one',
    assetClasses: ['EQUITY'],
    keywords: ['공매도', '숏'],
    version: 'v0.4',
    implemented: true,
    speed: '5분마다',
    examples: ['005930 SI'],
    similar: ['KCRD'],
  },
  {
    code: 'KWRN',
    nameKo: '시장경보·VI',
    nameEn: 'Market Warnings & VI (KR)',
    summary: '종목 경보와 오늘 VI 발동 목록',
    detail: '종목의 투자주의·투자경고·투자위험, 관리종목, 거래정지, 단기과열, 정리매매와 오늘 시장 전체의 VI(변동성완화장치) 발동·해제 목록이에요. 종목 없이도 돼요. 블룸버그 코드가 아닌 자체 코드예요.',
    security: 'optional',
    assetClasses: ['EQUITY'],
    keywords: ['경보', '시장경보', 'VI', '변동성완화', '투자경고', '투자주의', '관리종목', '거래정지'],
    version: 'v0.4',
    implemented: true,
    speed: '30초마다',
    examples: ['KWRN', '005930 KWRN'],
    aliases: ['KVI'],
    similar: ['DES'],
    notBloomberg: true,
  },
  {
    code: 'ECO',
    nameKo: '경제 캘린더',
    nameEn: 'Economic Calendar',
    summary: '미국 지표 발표 일정과 최근 값, 한국 주요 지표',
    detail: '지난 2주와 앞으로 30일의 미국 지표 발표 일시(한국 시간)와 최근·이전 값, 한국 주요 지표의 최근 값이에요. BEA는 시각까지, FRED는 날짜만 줘서 관례 시각을 붙여요.',
    security: 'none',
    assetClasses: [],
    keywords: ['경제지표', '캘린더', '경제캘린더', '지표발표'],
    version: 'v0.3',
    implemented: true,
    speed: '일정은 하루 몇 번, 값은 발표 때(3시간마다 다시 받아요)',
    examples: ['ECO'],
    aliases: ['WECO'],
  },
  {
    code: 'PORT',
    nameKo: '포트폴리오',
    nameEn: 'Portfolio',
    summary: '보유 종목 원화 평가·손익',
    detail: '보유 종목을 직접 입력하거나 잔고 CSV(신한 등)로 가져와 평가금액·손익·수익률·오늘 손익·비중을 원화로 봐요. 미국 종목은 지금 원/달러로 환산해요.',
    security: 'none',
    assetClasses: [],
    keywords: ['포트폴리오', '보유', '잔고', '내종목'],
    version: 'v0.3',
    implemented: true,
    speed: '시세와 같은 속도(실시간·주기 조회)',
    examples: ['PORT'],
    aliases: ['BBU'],
  },
  {
    code: 'ALRT',
    nameKo: '알림',
    nameEn: 'Alerts',
    summary: '가격·등락률 조건 알림',
    detail: '종목의 가격 이상·이하, 등락률 이상·이하 조건을 만들어 두면 맞을 때 알려 줘요(앱 안 알림, 운영체제 알림, 소리). 종목을 함께 치면 그 종목으로 시작해요. 앱이 켜져 있을 때만 동작해요.',
    security: 'optional',
    assetClasses: ALL_ASSETS,
    keywords: ['알림', '가격알림'],
    version: 'v0.3',
    implemented: true,
    speed: '시세와 같은 속도',
    examples: ['ALRT', '005930 ALRT'],
  },
  {
    code: 'GRID',
    nameKo: '소형 차트 격자',
    nameEn: 'Chart Grid',
    summary: '여러 지수·환율·종목의 작은 차트',
    detail: '여러 지수·환율·코인·종목의 작은 일봉 차트를 격자로 보여 줘요. 칸을 누르면 연동 그룹이 그 종목으로 바뀌고, 편집으로 칸을 더하거나 빼요(패널마다 기억).',
    security: 'none',
    assetClasses: [],
    keywords: ['격자', '차트격자', '소형차트'],
    version: 'v0.3',
    implemented: true,
    speed: '시세는 종목마다(실시간·주기 조회), 선은 일봉',
    examples: ['GRID'],
    similar: ['WEI', 'MAP'],
  },
  {
    code: 'MAP',
    nameKo: '세계지도',
    nameEn: 'World Map',
    summary: '나라별 대표 지수 등락 지도',
    detail: '미주·유럽·아시아 나라별 대표 지수의 오늘 등락을 지도 위치에 놓은 칸으로 보여 줘요. 원화 대비 통화 등락과 장 상태도 함께. 칸을 누르면 연동 그룹이 그 지수로 바뀌어요.',
    security: 'none',
    assetClasses: [],
    keywords: ['지도', '세계지도'],
    version: 'v0.3',
    implemented: true,
    speed: '지수 1분 간격 조회(지연 여부는 WEI와 같아요)',
    examples: ['MAP'],
    aliases: ['WM'],
    similar: ['WEI', 'GRID'],
  },
];

/** 앞으로 만들 기능 중 v0.2~v0.3의 자세한 문구(03 문서). 나머지는 카탈로그 문구를 써요. */
const PLANNED_DETAIL: Record<string, Partial<FunctionDef>> = {
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
