// MON 트레이딩뷰 묶음(v0.6): 트레이딩뷰에서 공유한 관심 목록 링크(https://www.tradingview.com/watchlists/<번호>/)를 읽어
// 앱 종목으로 바꿔요. 앱을 켤 때마다(그리고 링크를 넣거나 ↻을 누르면) 다시 읽어 트레이딩뷰 목록과 같게 맞춰요.

/** 공유 링크 모양인지(다른 곳으로 요청하지 않게 tradingview.com의 watchlists 주소만) → 정리한 주소 */
export function normalizeTvWatchlistUrl(raw: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return undefined;
  }
  const hostOk = u.protocol === 'https:' && (u.hostname === 'tradingview.com' || u.hostname.endsWith('.tradingview.com'));
  const id = u.pathname.match(/^\/watchlists\/(\d+)\/?$/)?.[1];
  return hostOk && id ? `https://www.tradingview.com/watchlists/${id}/` : undefined;
}

export interface TvWatchlist {
  name?: string;
  /** 'NASDAQ:AAPL', 'KRX:005930' 모양(구역 머리글 ###은 뺐어요) */
  symbols: string[];
}

/**
 * 공유 목록 페이지 HTML → 목록 이름과 종목. 페이지 안 목록 자료(JSON)의 "symbols" 배열만 읽어요.
 * 페이지 위아래의 시세 띠(티커 테이프) 같은 다른 종목은 읽지 않아요
 */
export function parseTvWatchlist(html: string): TvWatchlist | undefined {
  let best: string[] | undefined;
  for (const m of html.matchAll(/"symbols"\s*:\s*\[((?:\s*"(?:[^"\\]|\\.)*"\s*,?)*)\]/g)) {
    const list = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).filter((s) => s && !s.startsWith('###'));
    if (list.length && (!best || list.length > best.length)) best = list;
  }
  if (!best) return undefined;
  // 목록 이름은 symbols 바로 앞의 "name"(요금제 이름 같은 다른 "name"은 아니에요)
  const name = html.match(/"name"\s*:\s*"((?:[^"\\]|\\.){1,80})"\s*,\s*"symbols"/)?.[1];
  return { name: name ? JSON.parse(`"${name}"`) : undefined, symbols: [...new Set(best)] };
}

/** 트레이딩뷰 지수 → 앱 지수 코드 */
const TV_INDEX: Record<string, string> = {
  'SP:SPX': 'SPX',
  'TVC:SPX': 'SPX',
  'NASDAQ:NDX': 'NDX',
  'NASDAQ:IXIC': 'CCMP',
  'TVC:IXIC': 'CCMP',
  'DJ:DJI': 'INDU',
  'TVC:DJI': 'INDU',
  'NASDAQ:SOX': 'SOX',
  'KRX:KOSPI': 'KOSPI',
  'KRX:KOSDAQ': 'KOSDAQ',
  'KRX:KOSPI200': 'KOSPI2',
  'TVC:UKX': 'UKX',
  'XETR:DAX': 'DAX',
  'TVC:DAX': 'DAX',
  'TVC:CAC40': 'CAC',
  'EURONEXT:PX1': 'CAC',
  'TVC:SX5E': 'SX5E',
  'TVC:NI225': 'NKY',
  'TVC:HSI': 'HSI',
  'HSI:HSI': 'HSI',
  'SSE:000001': 'SHCOMP',
  'TVC:SHCOMP': 'SHCOMP',
  'TWSE:TAIEX': 'TWSE',
};

const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'NYSEARCA', 'BATS', 'CBOE', 'OTC']);
const FX_SOURCES = new Set(['FX', 'FX_IDC', 'OANDA', 'FOREXCOM', 'SAXO', 'FXCM', 'ICE', 'PEPPERSTONE', 'CAPITALCOM', 'TVC']);

/**
 * 트레이딩뷰 기호 → 앱 종목 id 후보(앞에서부터 있는 것을 써요). 모르는 거래소면 빈 배열.
 * 국내 주식은 코스피·코스닥 둘 다, 미국 주식은 'BRK.B'와 'BRK/B' 둘 다 시도해요
 */
export function tvSymbolCandidates(sym: string): string[] {
  const [ex, rawCode] = sym.toUpperCase().split(':');
  if (!rawCode) return [];
  const idx = TV_INDEX[`${ex}:${rawCode}`];
  if (idx) return [`IDX:${idx}`];
  if (ex === 'KRX') return /^[0-9A-Z]{6}$/.test(rawCode) ? [`EQ:KS:${rawCode}`, `EQ:KQ:${rawCode}`] : [];
  if (US_EXCHANGES.has(ex)) {
    const out = [`EQ:US:${rawCode}`];
    if (rawCode.includes('.')) out.push(`EQ:US:${rawCode.replace('.', '/')}`, `EQ:US:${rawCode.replace('.', '')}`);
    return out;
  }
  // 코인: BINANCE:BTCUSDT, UPBIT:BTCKRW, COINBASE:BTCUSD 등 → 기초 자산
  const coin = rawCode.match(/^([A-Z0-9]{2,10}?)(USDT|USDC|USD|KRW|BUSD|FDUSD)(\.P)?$/);
  if (coin && !FX_SOURCES.has(ex)) return [`CRY:${coin[1]}`];
  if (FX_SOURCES.has(ex) && /^[A-Z]{6}$/.test(rawCode)) return [`CUR:${rawCode}`];
  return [];
}

export interface TvSyncResult {
  ids: string[];
  /** 앱에서 찾지 못한 트레이딩뷰 기호 */
  unmatched: string[];
}

/** 기호 목록 → 앱 종목 id(트레이딩뷰 순서 그대로, 겹치면 한 번) */
export function mapTvSymbols(symbols: string[], exists: (id: string) => boolean): TvSyncResult {
  const ids: string[] = [];
  const unmatched: string[] = [];
  for (const s of symbols) {
    const id = tvSymbolCandidates(s).find(exists);
    if (!id) unmatched.push(s);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unmatched };
}

export interface TvWatchlistResponse {
  name?: string;
  symbols: string[];
  error?: string;
}
