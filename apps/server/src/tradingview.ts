// MON 트레이딩뷰 묶음(v0.6): 공유한 관심 목록 페이지를 받아 종목 기호를 꺼내요. 링크는 tradingview.com의 watchlists 주소만 받아요.

import { normalizeTvWatchlistUrl, parseTvWatchlist, type TvWatchlistResponse } from '@bt/shared';
import { HttpError, fetchText } from './util';

export async function fetchTvWatchlist(raw: string): Promise<TvWatchlistResponse> {
  const url = normalizeTvWatchlistUrl(raw);
  if (!url) return { symbols: [], error: '트레이딩뷰 관심 목록 공유 링크(https://www.tradingview.com/watchlists/번호/)만 쓸 수 있어요' };
  try {
    const html = await fetchText(url, { headers: { 'User-Agent': 'TICKER-app', 'Accept-Language': 'ko,en' }, timeoutMs: 20_000 });
    const list = parseTvWatchlist(html);
    if (!list) return { symbols: [], error: '페이지에서 목록을 찾지 못했어요(트레이딩뷰에서 공유가 켜져 있는지 확인해 주세요)' };
    return list;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { symbols: [], error: '목록이 없거나 공유가 꺼져 있어요(트레이딩뷰 목록의 공유를 켜 주세요)' };
    return { symbols: [], error: `트레이딩뷰에 연결하지 못했어요: ${(e as Error).message}` };
  }
}
