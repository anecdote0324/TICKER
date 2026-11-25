import { describe, expect, it } from 'vitest';
import { mapTvSymbols, normalizeTvWatchlistUrl, parseTvWatchlist, tvSymbolCandidates } from './tradingview';

describe('트레이딩뷰 공유 목록', () => {
  it('링크: tradingview.com의 watchlists 주소만, 나라 주소는 www로', () => {
    expect(normalizeTvWatchlistUrl('https://kr.tradingview.com/watchlists/317851469/')).toBe('https://www.tradingview.com/watchlists/317851469/');
    expect(normalizeTvWatchlistUrl('https://www.tradingview.com/watchlists/123')).toBe('https://www.tradingview.com/watchlists/123/');
    expect(normalizeTvWatchlistUrl('https://evil.example/watchlists/1/')).toBeUndefined();
    expect(normalizeTvWatchlistUrl('https://tradingview.com.evil.example/watchlists/1/')).toBeUndefined();
    expect(normalizeTvWatchlistUrl('https://www.tradingview.com/chart/abc/')).toBeUndefined();
  });
  it('페이지의 목록 자료만 읽고 구역 머리글·요금제 이름은 빼요', () => {
    const html =
      '<script>{"ticker":["NASDAQ:AAPL"]}</script><script>window.initData={"list":{"id":317851469,"name":"Anecdote","symbols":["NASDAQ:NDX","###한국","KRX:005930","AMEX:QLD","KRX:005930"]}}</script>' +
      '<script>{"plans":[{"name":"Essential","description":"x"}]}</script>';
    expect(parseTvWatchlist(html)).toEqual({ name: 'Anecdote', symbols: ['NASDAQ:NDX', 'KRX:005930', 'AMEX:QLD'] });
    expect(parseTvWatchlist('<html>Page not found</html>')).toBeUndefined();
  });
  it('기호 → 앱 종목', () => {
    expect(tvSymbolCandidates('NASDAQ:NDX')).toEqual(['IDX:NDX']);
    expect(tvSymbolCandidates('SP:SPX')).toEqual(['IDX:SPX']);
    expect(tvSymbolCandidates('KRX:005930')).toEqual(['EQ:KS:005930', 'EQ:KQ:005930']);
    expect(tvSymbolCandidates('NYSE:BRK.B')).toEqual(['EQ:US:BRK.B', 'EQ:US:BRK/B', 'EQ:US:BRKB']);
    expect(tvSymbolCandidates('BINANCE:BTCUSDT')).toEqual(['CRY:BTC']);
    expect(tvSymbolCandidates('COINBASE:ETHUSDC')).toEqual(['CRY:ETH']);
    expect(tvSymbolCandidates('FX_IDC:USDKRW')).toEqual(['CUR:USDKRW']);
    expect(tvSymbolCandidates('CME_MINI:NQ1!')).toEqual([]);
  });
  it('목록 맞추기: 순서 그대로, 없는 것은 따로', () => {
    const have = new Set(['IDX:NDX', 'EQ:KQ:263750', 'EQ:US:QLD']);
    expect(mapTvSymbols(['NASDAQ:NDX', 'KRX:263750', 'AMEX:QLD', 'CME_MINI:NQ1!'], (id) => have.has(id))).toEqual({ ids: ['IDX:NDX', 'EQ:KQ:263750', 'EQ:US:QLD'], unmatched: ['CME_MINI:NQ1!'] });
  });
});
