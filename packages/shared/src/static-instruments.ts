// 정해 둔 종목 목록: 지수, 환율, 코인 한글 이름, 미국 인기 종목(05 §6.1)

import type { Instrument } from './instrument';

export interface IndexDef {
  code: string;
  nameKo: string;
  nameEn: string;
  region: '한국' | '미주' | '유럽' | '아시아';
  /** 장 시간 판정에 쓰는 거래소(time.ts EXCHANGES) */
  exchange: string;
  /** KIS 조회 코드. 국내 업종지수는 업종코드, 해외는 해외지수 코드(확인 필요) */
  kis?: { kind: 'domestic' | 'overseas'; code: string };
  aliasesKo?: string[];
}

export const INDICES: IndexDef[] = [
  { code: 'KOSPI', nameKo: '코스피', nameEn: 'KOSPI', region: '한국', exchange: 'KRX', kis: { kind: 'domestic', code: '0001' } },
  { code: 'KOSDAQ', nameKo: '코스닥', nameEn: 'KOSDAQ', region: '한국', exchange: 'KRX', kis: { kind: 'domestic', code: '1001' } },
  { code: 'KOSPI2', nameKo: '코스피200', nameEn: 'KOSPI 200', region: '한국', exchange: 'KRX', kis: { kind: 'domestic', code: '2001' } },
  { code: 'SPX', nameKo: 'S&P 500', nameEn: 'S&P 500', region: '미주', exchange: 'US', kis: { kind: 'overseas', code: 'SPX' } },
  { code: 'INDU', nameKo: '다우존스', nameEn: 'Dow Jones Industrial', region: '미주', exchange: 'US', kis: { kind: 'overseas', code: '.DJI' } },
  { code: 'CCMP', nameKo: '나스닥 종합', nameEn: 'NASDAQ Composite', region: '미주', exchange: 'US', kis: { kind: 'overseas', code: 'COMP' }, aliasesKo: ['나스닥'] },
  { code: 'NDX', nameKo: '나스닥 100', nameEn: 'NASDAQ 100', region: '미주', exchange: 'US', kis: { kind: 'overseas', code: 'NDX' } },
  { code: 'SOX', nameKo: '필라델피아 반도체', nameEn: 'PHLX Semiconductor', region: '미주', exchange: 'US', kis: { kind: 'overseas', code: 'SOX' } },
  { code: 'UKX', nameKo: 'FTSE 100', nameEn: 'FTSE 100', region: '유럽', exchange: 'LSE', kis: { kind: 'overseas', code: 'FTSE100' } },
  { code: 'DAX', nameKo: '독일 DAX', nameEn: 'DAX', region: '유럽', exchange: 'LSE', kis: { kind: 'overseas', code: 'DAX' } },
  { code: 'CAC', nameKo: '프랑스 CAC 40', nameEn: 'CAC 40', region: '유럽', exchange: 'LSE', kis: { kind: 'overseas', code: 'CAC40' } },
  { code: 'SX5E', nameKo: '유로스톡스 50', nameEn: 'Euro Stoxx 50', region: '유럽', exchange: 'LSE', kis: { kind: 'overseas', code: 'SX5E' } },
  { code: 'NKY', nameKo: '니케이 225', nameEn: 'Nikkei 225', region: '아시아', exchange: 'TSE', kis: { kind: 'overseas', code: 'N225' }, aliasesKo: ['닛케이'] },
  { code: 'HSI', nameKo: '항셍', nameEn: 'Hang Seng', region: '아시아', exchange: 'TSE', kis: { kind: 'overseas', code: 'HSI' } },
  { code: 'SHCOMP', nameKo: '상하이 종합', nameEn: 'Shanghai Composite', region: '아시아', exchange: 'TSE', kis: { kind: 'overseas', code: 'SHANG' } },
  { code: 'TWSE', nameKo: '대만 가권', nameEn: 'TAIEX', region: '아시아', exchange: 'TSE', kis: { kind: 'overseas', code: 'TWII' } },
];

export const FX_CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'AUD', 'KRW'] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

export const CURRENCY_NAME: Record<string, string> = {
  USD: '미국 달러',
  EUR: '유로',
  JPY: '일본 엔',
  GBP: '영국 파운드',
  CNY: '중국 위안',
  AUD: '호주 달러',
  KRW: '원',
  HKD: '홍콩 달러',
  CAD: '캐나다 달러',
  CHF: '스위스 프랑',
};

export interface FxPairDef {
  code: string;
  base: string;
  quote: string;
  nameKo: string;
  aliasesKo?: string[];
}

export const FX_PAIRS: FxPairDef[] = [
  { code: 'USDKRW', base: 'USD', quote: 'KRW', nameKo: '원/달러', aliasesKo: ['원달러', '달러', '달러환율'] },
  { code: 'EURKRW', base: 'EUR', quote: 'KRW', nameKo: '원/유로', aliasesKo: ['원유로', '유로'] },
  { code: 'JPYKRW', base: 'JPY', quote: 'KRW', nameKo: '원/엔', aliasesKo: ['원엔', '엔', '엔화'] },
  { code: 'GBPKRW', base: 'GBP', quote: 'KRW', nameKo: '원/파운드', aliasesKo: ['파운드'] },
  { code: 'CNYKRW', base: 'CNY', quote: 'KRW', nameKo: '원/위안', aliasesKo: ['위안'] },
  { code: 'AUDKRW', base: 'AUD', quote: 'KRW', nameKo: '원/호주달러' },
  { code: 'EURUSD', base: 'EUR', quote: 'USD', nameKo: '유로/달러' },
  { code: 'USDJPY', base: 'USD', quote: 'JPY', nameKo: '달러/엔' },
  { code: 'GBPUSD', base: 'GBP', quote: 'USD', nameKo: '파운드/달러' },
  { code: 'USDCNY', base: 'USD', quote: 'CNY', nameKo: '달러/위안' },
  { code: 'AUDUSD', base: 'AUD', quote: 'USD', nameKo: '호주달러/달러' },
];

/** 주요 코인 한글 이름(05 §6.1). 순서가 인기도예요 */
export const CRYPTO_KO: Array<[string, string]> = [
  ['BTC', '비트코인'],
  ['ETH', '이더리움'],
  ['XRP', '리플'],
  ['SOL', '솔라나'],
  ['BNB', '바이낸스코인'],
  ['DOGE', '도지코인'],
  ['ADA', '에이다'],
  ['TRX', '트론'],
  ['LINK', '체인링크'],
  ['AVAX', '아발란체'],
  ['SUI', '수이'],
  ['XLM', '스텔라루멘'],
  ['TON', '톤코인'],
  ['SHIB', '시바이누'],
  ['HBAR', '헤데라'],
  ['BCH', '비트코인캐시'],
  ['LTC', '라이트코인'],
  ['DOT', '폴카닷'],
  ['UNI', '유니스왑'],
  ['PEPE', '페페'],
  ['AAVE', '에이브'],
  ['NEAR', '니어프로토콜'],
  ['APT', '앱토스'],
  ['ETC', '이더리움클래식'],
  ['ICP', '인터넷컴퓨터'],
  ['POL', '폴리곤'],
  ['ARB', '아비트럼'],
  ['OP', '옵티미즘'],
  ['ATOM', '코스모스'],
  ['FIL', '파일코인'],
  ['ALGO', '알고랜드'],
  ['SAND', '샌드박스'],
  ['WLD', '월드코인'],
  ['ENA', '에테나'],
];

/**
 * 코인 검색 목록에서 뺄 기초 자산: 법정화폐·스테이블코인(05 §6.1). 색인을 만들 때 검토해요.
 */
export const CRYPTO_EXCLUDED_BASES = new Set([
  'USDT', 'EUR', 'EURI', 'USDC', 'FDUSD', 'TUSD', 'USDE', 'USD1', 'RLUSD', 'XUSD', 'BFUSD', 'USDP', 'DAI', 'AEUR',
  'PAXG', 'TRY', 'BRL', 'GBP', 'AUD', 'JPY', 'UAH', 'ARS', 'MXN', 'ZAR', 'PLN', 'RON', 'COP', 'CZK',
]);

/** 덮어쓰기 표(05 §7.1): 같은 글자의 다른 종목이 있어도 이 자산군으로 읽어요 */
export const OVERRIDE_TABLE: Record<string, 'CRYPTO' | 'CURNCY'> = {
  BTC: 'CRYPTO',
  ETH: 'CRYPTO',
  SOL: 'CRYPTO',
  XRP: 'CRYPTO',
};

/** 통화 코드 하나만 입력했을 때(05 §3.2): EUR → EURKRW, KRW → USDKRW */
export function singleCurrencyPair(ccy: string): string | undefined {
  const up = ccy.toUpperCase();
  if (up === 'KRW') return 'USDKRW';
  if (FX_PAIRS.some((p) => p.code === `${up}KRW`)) return `${up}KRW`;
  return undefined;
}

/**
 * 미국 인기 종목(앱에 넣는 유동성 목록). 인기도 순위에만 써요. 출처는 확인 필요(07)이고, 지금은 대형주·대표 ETF를 손으로 골랐어요.
 */
export const US_POPULAR: string[] = [
  'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'PLTR', 'AMD', 'SPY', 'QQQ', 'TQQQ', 'SOXL',
  'NFLX', 'GOOG', 'JPM', 'COST', 'LLY', 'V', 'MA', 'UNH', 'XOM', 'WMT', 'ORCL', 'MU', 'INTC', 'COIN', 'MSTR',
  'SMCI', 'ARM', 'TSM', 'ASML', 'QCOM', 'TXN', 'AMAT', 'LRCX', 'KLAC', 'ADBE', 'CRM', 'NOW', 'SHOP', 'UBER',
  'BAC', 'GS', 'MS', 'WFC', 'C', 'BRK/B', 'JNJ', 'PG', 'KO', 'PEP', 'MCD', 'SBUX', 'NKE', 'DIS', 'HD', 'LOW',
  'BA', 'CAT', 'GE', 'IBM', 'CSCO', 'T', 'VZ', 'PFE', 'MRK', 'ABBV', 'TMO', 'ABT', 'CVX', 'IONQ', 'RKLB', 'HOOD',
  'SOFI', 'RIVN', 'LCID', 'NIO', 'BABA', 'PDD', 'IWM', 'DIA', 'VOO', 'VTI', 'TLT', 'SCHD', 'JEPI', 'ARKK',
  'GLD', 'SLV', 'SOXX', 'SMH', 'XLK', 'XLF', 'XLE', 'SQQQ', 'SOXS', 'TSLL', 'NVDL', 'CONL', 'UPRO', 'TMF',
];

export function staticInstruments(): Instrument[] {
  const out: Instrument[] = [];
  INDICES.forEach((d, i) =>
    out.push({
      id: `IDX:${d.code}`,
      assetClass: 'INDEX',
      code: d.code,
      nameKo: d.nameKo,
      nameEn: d.nameEn,
      aliases: d.aliasesKo,
      exchange: d.exchange,
      popularity: 1 - i / INDICES.length,
    }),
  );
  FX_PAIRS.forEach((p, i) =>
    out.push({
      id: `CUR:${p.code}`,
      assetClass: 'CURNCY',
      code: p.code,
      nameKo: p.nameKo,
      nameEn: `${p.base}/${p.quote}`,
      // 통화 코드 하나만 입력해도 그 통화의 원화 환율로(05 §3.2): EUR → EURKRW, KRW·USD → USDKRW
      aliases: [...(p.aliasesKo ?? []), ...(p.quote === 'KRW' ? [p.base] : []), ...(p.code === 'USDKRW' ? ['KRW'] : [])],
      currency: p.quote,
      popularity: 1 - i / FX_PAIRS.length,
    }),
  );
  return out;
}
