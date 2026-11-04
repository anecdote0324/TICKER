import { describe, expect, it } from 'vitest';
import type { NewsItem } from '@bt/shared';
import { NewsArchive } from './news';
import { breakingItems, jaccard, searchItems, titleTokens, topNews, topicItems } from './news-views';

const now = Date.parse('2026-11-05T03:00:00Z');
let n = 0;
const item = (title: string, sourceId: string, minsAgo: number, kind: NewsItem['kind'] = 'news'): NewsItem => ({
  id: `i${n++}`,
  kind,
  source: sourceId,
  sourceId,
  lang: 'ko',
  title,
  url: `https://x/${n}`,
  published: now - minsAgo * 60_000,
});

describe('뉴스 보기', () => {
  it('제목 낱말: 괄호 머리말과 문장부호를 빼요', () => {
    expect([...titleTokens('[속보] 삼성전자, HBM4 양산 시작(종합)')]).toEqual(['삼성전자', 'hbm4', '양산', '시작']);
    expect(jaccard(titleTokens('삼성전자 HBM4 양산 시작'), titleTokens('삼성전자 HBM4 양산 본격 시작'))).toBeGreaterThan(0.45);
  });
  it('TOP: 여러 곳이 다룬 이야기를 묶어 위로, 오래된 줄은 빼요', () => {
    const list = topNews(
      [
        item('삼성전자 HBM4 양산 시작', 'hankyung', 30),
        item('삼성전자, HBM4 양산 본격 시작', 'sedaily', 40),
        item('삼성전자 HBM4 양산 시작했다', 'etnews', 50),
        item('코스피 소폭 상승 마감', 'mw-top', 5),
        item('어제 이야기', 'hankyung', 60 * 30),
      ],
      now,
    );
    expect(list[0].title).toBe('삼성전자 HBM4 양산 시작');
    expect(list[0].dupes).toBe(2);
    expect(list[0].otherSources.sort()).toEqual(['etnews', 'sedaily']);
    expect(list.map((x) => x.title)).not.toContain('어제 이야기');
  });
  it('NI 주제·NSE 검색(빼기 낱말)', () => {
    const items = [item('미 국채 금리 급등', 'a', 1), item('반도체 수출 증가', 'b', 2), item('삼성 HBM 중국 수출', 'c', 3), item('삼성 HBM 엔비디아 공급', 'd', 4)];
    expect(topicItems(items, 'rates').map((x) => x.title)).toEqual(['미 국채 금리 급등']);
    expect(topicItems(items, 'nope')).toEqual([]);
    expect(searchItems(items, '삼성 hbm -중국').map((x) => x.title)).toEqual(['삼성 HBM 엔비디아 공급']);
    expect(searchItems(items, '-중국')).toEqual([]);
  });
  it('FIRS: 속보 표시, 최근 MW Pulse, 주요 공시', () => {
    const items = [
      item('[속보] 한은 기준금리 동결', 'hankyung', 30),
      item('Stocks edge higher', 'mw-pulse', 60),
      item('Stocks edge lower', 'mw-pulse', 60 * 5),
      item('유상증자결정', 'dart', 20, 'disclosure'),
      item('기업설명회(IR)개최', 'dart', 10, 'disclosure'),
      item('평범한 기사', 'sedaily', 5),
    ];
    expect(breakingItems(items, now).map((x) => x.title)).toEqual(['유상증자결정', '[속보] 한은 기준금리 동결', 'Stocks edge higher']);
  });
  it('아카이브 제목 검색(SQLite): 모든 낱말, 빼기, 시각', () => {
    const a = new NewsArchive(':memory:');
    a.add([item('삼성 HBM 중국 수출', 'c', 3), item('삼성 HBM 엔비디아 공급', 'd', 4), item('100% 상승_테스트', 'e', 5)]);
    expect(a.searchTitles('삼성 HBM -중국', 0, 10).map((x) => x.title)).toEqual(['삼성 HBM 엔비디아 공급']);
    expect(a.searchTitles('100%', 0, 10).map((x) => x.title)).toEqual(['100% 상승_테스트']);
    expect(a.searchTitles('삼성', now - 3.5 * 60_000, 10).map((x) => x.title)).toEqual(['삼성 HBM 중국 수출']);
  });
});
