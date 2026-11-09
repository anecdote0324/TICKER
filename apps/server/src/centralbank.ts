// v0.6 중앙은행(CENB·FOMC·DOTS·WIRP): 정책금리(BIS, 키 없음), 회의 일정(연준·ECB·일본은행·한국은행 웹 페이지),
// 성명·의사록(연준 RSS와 성명 페이지, 한국은행 보도자료 RSS), 점도표(연준 경제 전망 자료). 출처마다 따로 받아 하나가 실패해도 나머지는 보여요.
// 6시간 캐시. 받은 값은 데이터 폴더(centralbank-cache.json)에 두고, 받지 못한 출처는 앞 값을 써요.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  POLICY_BANKS,
  bokKind,
  fedKind,
  parseBisCsv,
  parseBojSchedule,
  parseBokSchedule,
  parseEcbSchedule,
  parseFedStatement,
  parseFomcCalendar,
  parseSep,
  summarizePolicy,
  type CbDocument,
  type CentralBankResponse,
  type Meeting,
} from '@bt/shared';
import { fetchText, type Logger } from './util';

const BIS = 'https://stats.bis.org/api/v1/data/WS_CBPOL/D.';
const FOMC_CAL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
const FED_RSS = 'https://www.federalreserve.gov/feeds/press_monetary.xml';
const BOK_SCHEDULE = 'https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755&pYear=';
const BOK_PRESS_RSS = 'https://www.bok.or.kr/portal/bbs/P0000559/news.rss?menuNo=200690';
const ECB_SCHEDULE = 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html';
const BOJ_SCHEDULE = 'https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm';
const TTL = 6 * 3600_000;
const UA = { 'User-Agent': 'TICKER-app' };

const get = (url: string, timeoutMs = 25_000) => fetchText(url, { headers: UA, timeoutMs });

interface Saved {
  rates?: CentralBankResponse['rates'];
  meetings?: Partial<Record<Meeting['bank'], Meeting[]>>;
  documents?: CbDocument[];
  dots?: CentralBankResponse['dots'];
}

function rssItems(xml: string): Array<{ title: string; link: string; date?: string; desc: string }> {
  const out: Array<{ title: string; link: string; date?: string; desc: string }> = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag: string) => (m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
    const pub = pick('pubDate');
    const t = pub ? Date.parse(pub) : NaN;
    out.push({
      title: pick('title').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"'),
      link: pick('link'),
      // 한국·미국 기준 날짜가 다를 수 있어 발표 나라 날짜로(한국은 +9시간, 미국은 -5시간 근사)
      date: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : undefined,
      desc: pick('description'),
    });
  }
  return out;
}

/** 링크의 monetaryYYYYMMDD → 날짜 */
const fedDate = (url: string, fallback?: string) => {
  const m = url.match(/(\d{4})(\d{2})(\d{2})[a-z]?\.htm/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : (fallback ?? '');
};

export class CentralBankService {
  private cache?: { at: number; p: Promise<CentralBankResponse> };
  /** 성명 본문은 바뀌지 않으니 한 번 받으면 계속 써요 */
  private statementText = new Map<string, string>();

  constructor(
    private dataDir: string,
    private log: Logger,
  ) {}

  get(): Promise<CentralBankResponse> {
    if (this.cache && Date.now() - this.cache.at < TTL) return this.cache.p;
    const p = this.load();
    this.cache = { at: Date.now(), p };
    p.catch(() => (this.cache = undefined));
    return p;
  }

  private async rates(): Promise<CentralBankResponse['rates']> {
    const start = new Date(Date.now() - 3 * 365 * 86400_000).toISOString().slice(0, 10);
    const csv = await get(`${BIS}${POLICY_BANKS.map((b) => b.area).join('+')}?startPeriod=${start}&format=csv`, 40_000);
    const byArea = parseBisCsv(csv);
    return POLICY_BANKS.map((b) => summarizePolicy(b.area, byArea.get(b.area) ?? [])).filter((x): x is NonNullable<typeof x> => !!x);
  }

  private async fed(): Promise<{ meetings: Meeting[]; documents: CbDocument[]; dots?: CentralBankResponse['dots'] }> {
    const meetings = parseFomcCalendar(await get(FOMC_CAL));
    const documents: CbDocument[] = [];
    try {
      for (const it of rssItems(await get(FED_RSS))) {
        const kind = fedKind(it.title);
        if (kind === 'other') continue;
        documents.push({ bank: 'FED', kind, title: it.title, date: fedDate(it.link, it.date), url: it.link });
      }
    } catch (e) {
      this.log.warn(`연준 보도자료 RSS를 받지 못했어요: ${(e as Error).message}`);
    }
    // 최근 성명 3개는 본문까지
    for (const d of documents.filter((x) => x.kind === 'statement').slice(0, 3)) {
      let text = this.statementText.get(d.url);
      if (!text) {
        try {
          text = parseFedStatement(await get(d.url));
          if (text) this.statementText.set(d.url, text);
        } catch {
          text = undefined;
        }
      }
      if (text) d.text = text;
    }
    // 가장 최근 경제 전망(점도표)
    let dots: CentralBankResponse['dots'];
    const today = new Date().toISOString().slice(0, 10);
    const sep = meetings.filter((m) => m.projectionsUrl && m.date <= today).pop();
    if (sep?.projectionsUrl) {
      try {
        dots = parseSep(await get(sep.projectionsUrl, 40_000), sep.projectionsUrl, sep.date);
      } catch (e) {
        this.log.warn(`연준 점도표를 받지 못했어요: ${(e as Error).message}`);
      }
    }
    return { meetings, documents, dots };
  }

  private async bok(): Promise<{ meetings: Meeting[]; documents: CbDocument[] }> {
    const year = Number(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 4));
    const meetings: Meeting[] = [];
    for (const y of [year, year + 1]) {
      try {
        meetings.push(...parseBokSchedule(await get(BOK_SCHEDULE + y), y));
      } catch (e) {
        if (y === year) throw e;
      }
    }
    const documents: CbDocument[] = [];
    try {
      for (const it of rssItems(await get(BOK_PRESS_RSS))) {
        const kind = bokKind(it.title);
        if (kind !== 'statement' && kind !== 'minutes') continue;
        const d = it.title.match(/\((\d{4})\.(\d{1,2})\.(\d{1,2})\)/);
        const date = d ? `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}` : (it.date ?? '');
        const doc: CbDocument = { bank: 'BOK', kind, title: it.title, date, url: it.link };
        if (kind === 'statement') {
          const html = it.desc.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          doc.text = html
            .replace(/<\/(p|div|li)>|<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .split('\n')
            .map((l) => l.replace(/\s+/g, ' ').replace(/ ([.,)])/g, '$1').replace(/\( /g, '(').trim())
            .filter(Boolean)
            .join('\n');
        }
        documents.push(doc);
      }
    } catch (e) {
      this.log.warn(`한국은행 보도자료 RSS를 받지 못했어요: ${(e as Error).message}`);
    }
    return { meetings: meetings.sort((a, b) => a.date.localeCompare(b.date)), documents };
  }

  private async load(): Promise<CentralBankResponse> {
    const file = join(this.dataDir, 'centralbank-cache.json');
    let saved: Saved = {};
    try {
      saved = JSON.parse(await readFile(file, 'utf8')) as Saved;
    } catch {
      saved = {};
    }
    const errors: string[] = [];
    const next: Saved = { meetings: {} };

    const [rates, fed, bok, ecb, boj] = await Promise.allSettled([
      this.rates(),
      this.fed(),
      this.bok(),
      get(ECB_SCHEDULE).then(parseEcbSchedule),
      get(BOJ_SCHEDULE).then(parseBojSchedule),
    ]);

    if (rates.status === 'fulfilled' && rates.value.length) next.rates = rates.value;
    else {
      next.rates = saved.rates;
      errors.push(`BIS 정책금리: ${rates.status === 'rejected' ? (rates.reason as Error).message : '값이 없어요'}`);
    }
    const documents: CbDocument[] = [];
    if (fed.status === 'fulfilled') {
      next.meetings!.FED = fed.value.meetings;
      documents.push(...fed.value.documents);
      next.dots = fed.value.dots ?? saved.dots;
    } else {
      next.meetings!.FED = saved.meetings?.FED;
      documents.push(...(saved.documents ?? []).filter((d) => d.bank === 'FED'));
      next.dots = saved.dots;
      errors.push(`연준: ${(fed.reason as Error).message}`);
    }
    if (bok.status === 'fulfilled') {
      next.meetings!.BOK = bok.value.meetings;
      documents.push(...(bok.value.documents.length ? bok.value.documents : (saved.documents ?? []).filter((d) => d.bank === 'BOK')));
    } else {
      next.meetings!.BOK = saved.meetings?.BOK;
      documents.push(...(saved.documents ?? []).filter((d) => d.bank === 'BOK'));
      errors.push(`한국은행: ${(bok.reason as Error).message}`);
    }
    for (const [bank, r] of [['ECB', ecb], ['BOJ', boj]] as const) {
      if (r.status === 'fulfilled' && r.value.length) next.meetings![bank] = r.value;
      else {
        next.meetings![bank] = saved.meetings?.[bank];
        errors.push(`${bank} 일정: ${r.status === 'rejected' ? (r.reason as Error).message : '일정을 찾지 못했어요'}`);
      }
    }
    next.documents = documents.sort((a, b) => b.date.localeCompare(a.date));
    void writeFile(file, JSON.stringify(next)).catch(() => undefined);
    if (errors.length) this.log.warn(`중앙은행 자료 일부를 받지 못했어요: ${errors.join(' / ')}`);

    const meetings = Object.values(next.meetings ?? {})
      .flatMap((m) => m ?? [])
      .sort((a, b) => a.date.localeCompare(b.date));
    const now = Date.now();
    return { rates: next.rates ?? [], meetings, documents: next.documents, dots: next.dots, errors, fresh: { source: 'BIS', mode: 'daily', asOf: now, receivedAt: now, asOfFromReceipt: true } };
  }
}
