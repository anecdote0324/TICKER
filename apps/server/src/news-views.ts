// v0.4 뉴스 보기: TOP(출처 가중치와 중복 묶기), NI(주제), NSE(아카이브 검색), FIRS(속보). 모두 뉴스 아카이브(news.db)에서 골라요.

import { BREAKING_PATTERN, NEWS_TOPICS, type NewsItem, type TopNewsItem } from '@bt/shared';

/** 출처 가중치(크게 다루는 곳일수록 높게). 목록에 없는 출처는 1 */
export const SOURCE_WEIGHT: Record<string, number> = {
  hankyung: 1.2,
  'hankyung-economy': 1.1,
  sedaily: 1.0,
  etnews: 0.8,
  'mw-top': 1.3,
  'mw-pulse': 0.9,
  investing: 1.0,
  dart: 0.6,
};

/** 제목 → 비교용 낱말(괄호 머리말·문장부호를 빼고 두 글자 이상) */
export function titleTokens(title: string): Set<string> {
  const t = title
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return new Set(t.split(/\s+/).filter((w) => w.length >= 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * TOP: 최근 hours시간 헤드라인을 비슷한 제목끼리 묶고(낱말 겹침 45% 이상), 묶음마다 점수를 매겨요.
 * 점수 = 서로 다른 출처 가중치 합 + 같은 이야기 줄 수 × 0.3 + 최근일수록(최대 2) + 속보·단독 1
 */
export function topNews(items: NewsItem[], now: number, hours = 24, limit = 40): TopNewsItem[] {
  const recent = items.filter((x) => x.kind === 'news' && now - x.published <= hours * 3600_000).sort((a, b) => b.published - a.published);
  const clusters: Array<{ items: NewsItem[]; tokens: Set<string> }> = [];
  for (const x of recent) {
    const tk = titleTokens(x.title);
    const c = clusters.find((cl) => jaccard(cl.tokens, tk) >= 0.45);
    if (c) {
      c.items.push(x);
      for (const w of tk) c.tokens.add(w);
    } else clusters.push({ items: [x], tokens: tk });
  }
  const breaking = new RegExp(BREAKING_PATTERN, 'i');
  return clusters
    .map((c) => {
      const sources = [...new Set(c.items.map((x) => x.sourceId))];
      const lead = [...c.items].sort((a, b) => (SOURCE_WEIGHT[b.sourceId] ?? 1) - (SOURCE_WEIGHT[a.sourceId] ?? 1) || b.published - a.published)[0];
      const newest = Math.max(...c.items.map((x) => x.published));
      const age = (now - newest) / 3600_000;
      const score = sources.reduce((t, s) => t + (SOURCE_WEIGHT[s] ?? 1), 0) + (c.items.length - 1) * 0.3 + Math.max(0, 2 * (1 - age / hours)) + (c.items.some((x) => breaking.test(x.title)) ? 1 : 0);
      return { ...lead, published: newest, score: Math.round(score * 100) / 100, dupes: c.items.length - 1, otherSources: [...new Set(c.items.filter((x) => x.sourceId !== lead.sourceId).map((x) => x.source))] };
    })
    .sort((a, b) => b.score - a.score || b.published - a.published)
    .slice(0, limit);
}

/** NI: 주제에 맞는 줄 */
export function topicItems(items: NewsItem[], topic: string): NewsItem[] {
  const t = NEWS_TOPICS.find((x) => x.code === topic);
  if (!t) return [];
  const re = new RegExp(t.pattern, 'i');
  return items.filter((x) => re.test(x.title));
}

/** NSE: 띄어 쓴 낱말이 모두 들어간 줄(대소문자 무시). "-낱말"은 빼기 */
export function searchItems(items: NewsItem[], query: string): NewsItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const plus = words.filter((w) => !w.startsWith('-'));
  const minus = words.filter((w) => w.startsWith('-') && w.length > 1).map((w) => w.slice(1));
  if (!plus.length) return [];
  return items.filter((x) => {
    const t = `${x.title} ${x.corpName ?? ''}`.toLowerCase();
    return plus.every((w) => t.includes(w)) && !minus.some((w) => t.includes(w));
  });
}

/** 속보로 볼 주요 공시 */
const MAJOR_DISCLOSURE = /유상증자|무상증자|자기주식|합병|분할|공개매수|최대주주.*변경|영업정지|부도|회생|상장폐지|거래정지|횡령|배임|소송|단일판매|공급계약/;

/** FIRS: 최근 hours시간의 속보 표시 헤드라인, MW Pulse(짧은 시장 속보) 2시간, 주요 공시 */
export function breakingItems(items: NewsItem[], now: number, hours = 12): NewsItem[] {
  const re = new RegExp(BREAKING_PATTERN, 'i');
  return items
    .filter((x) => {
      const age = now - x.published;
      if (age > hours * 3600_000) return false;
      if (x.kind === 'disclosure') return !x.dateOnly && MAJOR_DISCLOSURE.test(x.title);
      return re.test(x.title) || (x.sourceId === 'mw-pulse' && age <= 2 * 3600_000);
    })
    .sort((a, b) => b.published - a.published);
}
