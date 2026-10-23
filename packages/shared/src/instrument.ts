// 종목(시세를 볼 수 있는 대상) 정의

/** 자산군. GOVT·CORP·COMDTY는 v0.7 이후에 열지만 문법 자리는 지금 예약해요(05 §3.7). */
export type AssetClass = 'EQUITY' | 'CRYPTO' | 'CURNCY' | 'INDEX';
export type ReservedAssetClass = 'GOVT' | 'CORP' | 'COMDTY';

/** 주식 시장. 코인·환율·지수에는 시장 칸이 없어요. */
export type Market = 'KS' | 'KQ' | 'US';

export const ASSET_CLASSES: readonly AssetClass[] = ['EQUITY', 'CRYPTO', 'CURNCY', 'INDEX'];

export const ASSET_LABEL: Record<AssetClass, string> = {
  EQUITY: '주식',
  CRYPTO: '코인',
  CURNCY: '환율',
  INDEX: '지수',
};

export const MARKET_LABEL: Record<Market, string> = {
  KS: '코스피',
  KQ: '코스닥',
  US: '미국',
};

/** 후보 줄과 설명 창의 표시(05 §4.5) */
/** LOOKUP: 마스터에 없어서 한국투자증권에서 직접 조회한 종목 */
export type InstrumentFlag = 'PREF' | 'ETF' | 'ETN' | 'SPAC' | 'ADR' | 'REIT' | 'HALT' | 'DELISTED' | 'LOOKUP';

export interface Instrument {
  /** 'EQ:KS:005930', 'EQ:US:AAPL', 'CRY:BTC', 'CUR:USDKRW', 'IDX:KOSPI' */
  id: string;
  assetClass: AssetClass;
  market?: Market;
  /** 화면에 보이는 코드: 005930, AAPL, BTC, USDKRW, KOSPI */
  code: string;
  nameKo?: string;
  nameEn?: string;
  /** 같은 종목을 가리키는 다른 코드: BTCUSDT, BRKB 등 */
  aliases?: string[];
  flags?: InstrumentFlag[];
  /** 거래소 세부: NAS, NYS, AMS, KRX, BINANCE */
  exchange?: string;
  /** 자산군 안의 인기 순위를 0~1로 바꾼 값(1이 가장 인기) */
  popularity?: number;
  /** 가격 통화: KRW, USD, USDT */
  currency?: string;
  /** 시세를 받을 때 쓰는 원천 심볼(KIS 실시간 심볼, Binance 심볼 등) */
  feedSymbol?: string;
  /** 우선주라면 보통주 id. 목록에서 보통주 바로 아래에 둬요 */
  commonId?: string;
  /** 마스터 파일의 기준가(전일 종가). 데모 시세의 출발점이에요 */
  refPrice?: number;
}

export function instrumentId(assetClass: AssetClass, code: string, market?: Market): string {
  switch (assetClass) {
    case 'EQUITY':
      return `EQ:${market ?? 'KS'}:${code}`;
    case 'CRYPTO':
      return `CRY:${code}`;
    case 'CURNCY':
      return `CUR:${code}`;
    case 'INDEX':
      return `IDX:${code}`;
  }
}

/** 표준형 명령에 쓰는 종목 부분: '005930 KS EQUITY', 'BTC CRYPTO' */
export function canonicalSecurity(inst: Pick<Instrument, 'code' | 'market' | 'assetClass'>): string {
  return inst.market ? `${inst.code} ${inst.market} ${inst.assetClass}` : `${inst.code} ${inst.assetClass}`;
}

/** 화면 표시용 짧은 이름 */
export function displayName(inst: Pick<Instrument, 'nameKo' | 'nameEn' | 'code'>): string {
  return inst.nameKo || inst.nameEn || inst.code;
}

/** 후보 줄 배지(05 §4.5): EQ·KS, CRY, CUR, IDX */
export function assetBadge(inst: Pick<Instrument, 'assetClass' | 'market'>): string {
  switch (inst.assetClass) {
    case 'EQUITY':
      return `EQ·${inst.market ?? ''}`;
    case 'CRYPTO':
      return 'CRY';
    case 'CURNCY':
      return 'CUR';
    case 'INDEX':
      return 'IDX';
  }
}
