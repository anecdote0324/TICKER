import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Instrument } from '@bt/shared';
import { NewsArchive, dartItems, matchTerms, parseCorpCodes, parseRss, titleMatches, type RssFeed } from './news';

const feed: RssFeed = { id: 'test', name: '테스트', url: 'https://example.com/rss', lang: 'ko' };

describe('RSS 읽기', () => {
  it('CDATA·엔티티를 풀고 제목·링크·시각만 꺼내요', () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>무시</title>
      <item><title><![CDATA[삼성전자, 실적 &quot;호조&quot;]]></title><link>https://example.com/a?x=1&amp;y=2</link><pubDate>Tue, 03 Nov 2026 19:40:28 +0900</pubDate><description>본문은 저장 안 함</description></item>
      <item><title>Fed &amp; markets</title><link><![CDATA[https://example.com/b]]></link></item>
      <item><title>링크 없음</title></item>
    </channel></rss>`;
    const now = Date.parse('2026-11-03T12:00:00Z');
    const items = parseRss(xml, feed, now);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: '삼성전자, 실적 "호조"', url: 'https://example.com/a?x=1&y=2', published: Date.parse('2026-11-03T10:40:28Z'), source: '테스트', kind: 'news' });
    // 시각이 없으면 받은 시각
    expect(items[1]).toMatchObject({ title: 'Fed & markets', published: now });
  });
  it('Atom entry도 읽어요', () => {
    const items = parseRss('<feed><entry><title>Atom 제목</title><link href="https://example.com/c"/><updated>2026-11-03T01:00:00Z</updated></entry></feed>', feed);
    expect(items[0]).toMatchObject({ title: 'Atom 제목', url: 'https://example.com/c' });
  });
});

describe('DART', () => {
  it('공시 목록: 오늘 것은 받은 시각, 지난 것은 날짜만, 공시 뷰어 주소', () => {
    const now = Date.parse('2026-11-03T05:00:00Z');
    const items = dartItems(
      {
        status: '000',
        message: '정상',
        list: [
          { corp_code: '00126380', corp_name: '삼성전자', stock_code: '005930', corp_cls: 'Y', report_nm: '주요사항보고서(자기주식취득결정)', rcept_no: '20261103000123', flr_nm: '삼성전자', rcept_dt: '20261103' },
          { corp_code: '00126380', corp_name: '삼성전자', stock_code: '005930', corp_cls: 'Y', report_nm: '분기보고서 (2026.09)', rcept_no: '20261030000456', flr_nm: '삼성전자', rcept_dt: '20261030' },
        ],
      },
      now,
    );
    expect(items[0]).toMatchObject({ id: 'dart-20261103000123', kind: 'disclosure', published: now, corpName: '삼성전자', stockCode: '005930', url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261103000123' });
    expect(items[0].dateOnly).toBeFalsy();
    expect(items[1]).toMatchObject({ dateOnly: true, published: Date.parse('2026-10-30T00:00:00+09:00') });
  });
  it('고유번호 파일: 상장사만 종목코드 → 고유번호', () => {
    const xml = '<result><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list><list><corp_code>00999999</corp_code><corp_name>비상장</corp_name><stock_code> </stock_code></list></result>';
    expect([...parseCorpCodes(xml)]).toEqual([['005930', '00126380']]);
  });
});

describe('종목에 맞는 헤드라인', () => {
  const apple: Instrument = { id: 'EQ:US:AAPL', assetClass: 'EQUITY', market: 'US', code: 'AAPL', nameKo: '애플', nameEn: 'Apple Inc.' };
  it('한글 이름, 접미사를 뺀 영문 이름, 3글자 이상 티커(단어로)', () => {
    const t = matchTerms(apple);
    expect(t.words).toEqual(['애플', 'Apple']);
    expect(titleMatches('Apple shares rise after earnings', t)).toBe(true);
    expect(titleMatches('애플, 신제품 공개', t)).toBe(true);
    expect(titleMatches('Why AAPL is up', t)).toBe(true);
    expect(titleMatches('Pineapple prices jump', t)).toBe(false);
    expect(titleMatches("Apple's iPhone sales", t)).toBe(true);
    expect(titleMatches('AAPLX fund news', { words: [], tickers: ['AAPL'] })).toBe(false);
  });
});

describe('뉴스 아카이브', () => {
  it('같은 줄은 한 번만, 최신순, 회사 공시만 거르기', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bt-news-'));
    const a = new NewsArchive(join(dir, 'news.db'));
    const base = { kind: 'news' as const, source: 'S', sourceId: 's', lang: 'ko' as const, url: 'https://x' };
    expect(a.add([{ ...base, id: '1', title: 'a', published: 1 }, { ...base, id: '2', title: 'b', published: 3 }])).toBe(2);
    expect(a.add([{ ...base, id: '2', title: 'b', published: 3 }, { ...base, id: '3', title: 'c', published: 2, kind: 'disclosure', stockCode: '005930' }])).toBe(1);
    expect(a.recent({ limit: 10 }).map((x) => x.id)).toEqual(['2', '3', '1']);
    expect(a.recent({ limit: 10, kinds: ['disclosure'], stockCode: '005930' }).map((x) => x.id)).toEqual(['3']);
    expect(a.count()).toBe(3);
    a.close();
  });
});
