// N 뉴스·공시(03 v0.2): RSS 헤드라인과 DART 공시를 주기적으로 받아 뉴스 아카이브(news.db)에 쌓아요.
// - 아카이브는 v0.4 뉴스 검색(NSE)용으로 앱이 켜져 있는 동안 계속 쌓아요(04 공시와 뉴스).
// - 제목·링크·시각만 보관하고 본문은 저장하지 않아요. 원문은 링크로 열어요.
// - DART는 인증키가 있을 때만(설정 → 데이터 연결).

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { unzipSync } from 'fflate';
import type { Freshness, Instrument, NewsItem, NewsResponse, NewsSourceStatus } from '@bt/shared';
import { fetchBytes, fetchJson, type Logger } from './util';

export interface RssFeed {
  id: string;
  /** 줄에 붙는 짧은 출처 이름 */
  name: string;
  url: string;
  lang: 'ko' | 'en';
}

/**
 * 기본 RSS. 이 앱의 이름(User-Agent)으로 받을 수 있는 것만 넣었어요(2026-11 확인).
 * 연합뉴스·매일경제·WSJ는 자동 요청을 403으로 막아서 넣지 않았어요. 막는 곳을 우회하지 않아요
 */
export const RSS_FEEDS: RssFeed[] = [
  { id: 'hankyung', name: '한경 증권', url: 'https://www.hankyung.com/feed/finance', lang: 'ko' },
  { id: 'hankyung-economy', name: '한경 경제', url: 'https://www.hankyung.com/feed/economy', lang: 'ko' },
  { id: 'sedaily', name: '서경', url: 'https://www.sedaily.com/rss/finance', lang: 'ko' },
  { id: 'etnews', name: '전자신문', url: 'https://rss.etnews.com/Section901.xml', lang: 'ko' },
  { id: 'mw-top', name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', lang: 'en' },
  { id: 'mw-pulse', name: 'MW Pulse', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse', lang: 'en' },
  { id: 'investing', name: 'Investing', url: 'https://www.investing.com/rss/news.rss', lang: 'en' },
];

export const RSS_INTERVAL_MS = 5 * 60_000;
export const DART_INTERVAL_MS = 2 * 60_000;
const DART_BASE = 'https://opendart.fss.or.kr/api';
/** 한 종목의 공시를 DART에서 다시 받는 간격 */
const CORP_CACHE_MS = 10 * 60_000;
const UA = 'Mozilla/5.0 (TICKER personal terminal)';

// ── RSS ──

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return undefined;
  const raw = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return decodeEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

export function newsId(url: string, title: string): string {
  return createHash('sha1').update(url || title).digest('hex').slice(0, 20);
}

/** RSS 2.0의 item(Atom이면 entry)에서 제목·링크·시각만 꺼내요 */
export function parseRss(xml: string, feed: RssFeed, now = Date.now()): NewsItem[] {
  const out: NewsItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const title = tag(b, 'title');
    let url = tag(b, 'link') ?? '';
    if (!url) url = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '';
    if (!title || !/^https?:\/\//.test(url)) continue;
    const when = tag(b, 'pubDate') ?? tag(b, 'dc:date') ?? tag(b, 'published') ?? tag(b, 'updated');
    const t = when ? Date.parse(when) : NaN;
    out.push({
      id: newsId(url, title),
      kind: 'news',
      source: feed.name,
      sourceId: feed.id,
      lang: feed.lang,
      title,
      url,
      // 시각이 없거나 앞날이면 받은 시각으로
      published: Number.isFinite(t) && t <= now + 5 * 60_000 ? t : now,
    });
  }
  return out;
}

/** 응답의 글자 인코딩(XML 선언·Content-Type)을 따라 읽어요. 국내 RSS 중에는 EUC-KR도 있어요 */
async function fetchFeed(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder('ascii').decode(bytes.subarray(0, 200));
    const enc = (head.match(/encoding=["']([\w-]+)["']/i)?.[1] ?? res.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1] ?? 'utf-8').toLowerCase();
    try {
      return new TextDecoder(enc === 'ks_c_5601-1987' ? 'euc-kr' : enc).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── DART ──

interface DartListResponse {
  status: string;
  message: string;
  list?: Array<{ corp_code: string; corp_name: string; stock_code: string; corp_cls: string; report_nm: string; rcept_no: string; flr_nm: string; rcept_dt: string; rm?: string }>;
}

const DART_STATUS: Record<string, string> = {
  '010': '등록되지 않은 인증키예요',
  '011': '사용할 수 없는 인증키예요',
  '012': '접근할 수 없는 IP예요',
  '020': '하루 요청 한도를 넘었어요',
  '100': '요청 값이 맞지 않아요',
  '800': 'DART 시스템 점검 중이에요',
  '900': 'DART에서 알 수 없는 오류가 났어요',
  '901': '인증키 기간이 끝났어요(다시 신청해 주세요)',
};

const ymd = (ms: number) => {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

/** 접수번호 앞 8자리가 접수일(YYYYMMDD). 시각이 없어서 그날 0시(한국 시간)로 두되, 오늘 것은 받은 시각으로 */
export function dartItems(r: DartListResponse, now: number): NewsItem[] {
  const today = ymd(now);
  return (r.list ?? []).map((x) => {
    const d = x.rcept_dt || x.rcept_no.slice(0, 8);
    const day = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00+09:00`);
    return {
      id: `dart-${x.rcept_no}`,
      kind: 'disclosure' as const,
      source: 'DART',
      sourceId: 'dart',
      lang: 'ko' as const,
      title: x.report_nm.replace(/\s+/g, ' ').trim(),
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${x.rcept_no}`,
      published: d === today ? now : day,
      dateOnly: d !== today,
      corpName: x.corp_name,
      stockCode: x.stock_code?.trim() || undefined,
    };
  });
}

export async function dartList(key: string, params: Record<string, string>): Promise<DartListResponse> {
  const q = new URLSearchParams({ crtfc_key: key, page_no: '1', page_count: '100', ...params });
  const r = await fetchJson<DartListResponse>(`${DART_BASE}/list.json?${q}`, { timeoutMs: 15_000, headers: { 'user-agent': UA } });
  // 013 = 조회된 데이터가 없음(정상)
  if (r.status !== '000' && r.status !== '013') throw new Error(DART_STATUS[r.status] ?? `DART 오류 ${r.status}: ${r.message}`);
  return r;
}

/** DART 고유번호 파일(corpCode.xml): 종목코드 → 고유번호. 하루 한 번 받아 데이터 폴더에 둬요 */
export function parseCorpCodes(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const corp = m[1].match(/<corp_code>(\d{8})<\/corp_code>/)?.[1];
    const stock = m[1].match(/<stock_code>\s*([0-9A-Z]{6})\s*<\/stock_code>/)?.[1];
    if (corp && stock) out.set(stock, corp);
  }
  return out;
}

// ── 아카이브 ──

/** 받은 헤드라인·공시를 모두 보관해요. SQLite를 쓸 수 없으면 메모리에만(앱을 끄면 사라져요) */
export class NewsArchive {
  private db?: DatabaseSync;
  private ins?: StatementSync;
  private mem = new Map<string, NewsItem>();

  constructor(file: string | undefined, log?: Logger) {
    if (!file) return;
    try {
      this.db = new DatabaseSync(file);
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS news (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL, lang TEXT NOT NULL,
          title TEXT NOT NULL, url TEXT NOT NULL, published INTEGER NOT NULL, fetched INTEGER NOT NULL,
          date_only INTEGER NOT NULL DEFAULT 0, corp_name TEXT, stock_code TEXT
        );
        CREATE INDEX IF NOT EXISTS news_published ON news (published DESC);
        CREATE INDEX IF NOT EXISTS news_stock ON news (stock_code, published DESC);
      `);
      this.ins = this.db.prepare(
        'INSERT OR IGNORE INTO news (id, kind, source, source_id, lang, title, url, published, fetched, date_only, corp_name, stock_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
    } catch (e) {
      log?.warn(`뉴스 아카이브를 쓸 수 없어요(메모리에만 둬요): ${(e as Error).message}`);
      this.db = undefined;
    }
  }

  /** 새로 들어간 수 */
  add(items: NewsItem[]): number {
    let added = 0;
    const now = Date.now();
    if (this.db && this.ins) {
      this.db.exec('BEGIN');
      try {
        for (const x of items) {
          const r = this.ins.run(x.id, x.kind, x.source, x.sourceId, x.lang, x.title, x.url, x.published, now, x.dateOnly ? 1 : 0, x.corpName ?? null, x.stockCode ?? null);
          added += Number(r.changes);
        }
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
      return added;
    }
    for (const x of items) {
      if (this.mem.has(x.id)) continue;
      this.mem.set(x.id, x);
      added++;
    }
    return added;
  }

  /** 최신순. stockCode를 주면 그 회사의 공시만, kinds로 종류를 걸러요 */
  recent(opts: { limit: number; kinds?: Array<NewsItem['kind']>; stockCode?: string; scan?: number }): NewsItem[] {
    if (this.db) {
      const where: string[] = [];
      const args: Array<string | number> = [];
      if (opts.kinds?.length === 1) {
        where.push('kind = ?');
        args.push(opts.kinds[0]);
      }
      if (opts.stockCode) {
        where.push('stock_code = ?');
        args.push(opts.stockCode);
      }
      const sql = `SELECT * FROM news ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY published DESC LIMIT ?`;
      const rows = this.db.prepare(sql).all(...args, opts.scan ?? opts.limit) as Array<Record<string, string | number | null>>;
      return rows.map((r) => ({
        id: String(r.id),
        kind: r.kind as NewsItem['kind'],
        source: String(r.source),
        sourceId: String(r.source_id),
        lang: r.lang as NewsItem['lang'],
        title: String(r.title),
        url: String(r.url),
        published: Number(r.published),
        dateOnly: r.date_only ? true : undefined,
        corpName: r.corp_name ? String(r.corp_name) : undefined,
        stockCode: r.stock_code ? String(r.stock_code) : undefined,
      }));
    }
    return [...this.mem.values()]
      .filter((x) => (!opts.kinds || opts.kinds.includes(x.kind)) && (!opts.stockCode || x.stockCode === opts.stockCode))
      .sort((a, b) => b.published - a.published)
      .slice(0, opts.scan ?? opts.limit);
  }

  count(): number {
    if (this.db) return Number((this.db.prepare('SELECT COUNT(*) AS n FROM news').get() as { n: number }).n);
    return this.mem.size;
  }

  close() {
    this.db?.close();
  }
}

// ── 종목에 맞는 헤드라인 ──

const EN_SUFFIX = /\b(inc|corp|corporation|co|company|ltd|limited|plc|holdings?|group|class [abc]|common stock|shares|the|sa|nv|ag|adr)\b\.?/gi;

/** 제목에서 찾을 이름: 한글 이름, 영문 이름의 앞부분(접미사 뺌), 3글자 이상 티커(단어로) */
export function matchTerms(inst: Instrument): { words: string[]; tickers: string[] } {
  const words: string[] = [];
  if (inst.nameKo && inst.nameKo.length >= 2) words.push(inst.nameKo);
  if (inst.nameEn) {
    const en = inst.nameEn.replace(EN_SUFFIX, '').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (en.length >= 3 && en.toUpperCase() !== inst.code) words.push(en);
  }
  const tickers = inst.code.length >= 3 && /^[A-Z]+$/.test(inst.code) ? [inst.code] : [];
  return { words, tickers };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 한글 이름은 조사가 붙으니 부분 일치(애플이·애플의), 영문 이름은 단어로(Pineapple에 Apple이 걸리지 않게) */
export function titleMatches(title: string, terms: { words: string[]; tickers: string[] }): boolean {
  const low = title.toLowerCase();
  for (const w of terms.words) {
    if (/[A-Za-z]/.test(w)) {
      if (new RegExp(`(^|[^A-Za-z])${escapeRe(w.toLowerCase())}([^A-Za-z]|$)`).test(low)) return true;
    } else if (low.includes(w.toLowerCase())) return true;
  }
  return terms.tickers.some((t) => new RegExp(`(^|[^A-Za-z])\\$?${t}([^A-Za-z]|$)`).test(title));
}

// ── 서비스 ──

export class NewsService {
  readonly archive: NewsArchive;
  private dartKey?: string;
  private status = new Map<string, NewsSourceStatus>();
  private timers: NodeJS.Timeout[] = [];
  private corpCodes?: Promise<Map<string, string>>;
  private corpFetched = new Map<string, number>();
  private lastRss = 0;
  private lastDart = 0;

  constructor(
    private dataDir: string,
    private log: Logger,
    archiveFile: string | undefined,
    private feeds: RssFeed[] = RSS_FEEDS,
  ) {
    this.archive = new NewsArchive(archiveFile, log);
    for (const f of feeds) this.status.set(f.id, { id: f.id, name: f.name, kind: 'news' });
  }

  start() {
    // 켜자마자 한 번, 그 뒤로는 5분(RSS)·2분(DART)마다. 앱이 켜져 있는 동안 아카이브가 쌓여요
    void this.pollRss();
    this.timers.push(setInterval(() => void this.pollRss(), RSS_INTERVAL_MS));
    this.timers.push(setInterval(() => void this.pollDart(), DART_INTERVAL_MS));
    for (const t of this.timers) t.unref?.();
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.archive.close();
  }

  setDartKey(key: string | undefined) {
    this.dartKey = key;
    this.corpFetched.clear();
    if (key) {
      this.status.set('dart', { id: 'dart', name: 'DART', kind: 'disclosure' });
      void this.pollDart();
    } else this.status.delete('dart');
  }

  get dartConfigured(): boolean {
    return !!this.dartKey;
  }

  /** 인증키 확인: 오늘 공시 1건을 받아 봐요 */
  async testDart(key: string): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await dartList(key, { page_count: '1', bgn_de: ymd(Date.now() - 7 * 86400_000), end_de: ymd(Date.now()) });
      return { ok: true, message: r.status === '013' ? '인증키는 맞아요(최근 공시가 없어요)' : '인증키가 맞아요' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async pollRss(): Promise<void> {
    await Promise.all(
      this.feeds.map(async (f) => {
        const st = this.status.get(f.id)!;
        try {
          const items = parseRss(await fetchFeed(f.url), f);
          const added = this.archive.add(items);
          this.status.set(f.id, { ...st, ok: true, at: Date.now(), error: undefined, count: items.length });
          if (added > 0) this.log.debug(`RSS ${f.name}: 새 헤드라인 ${added}개`);
        } catch (e) {
          this.status.set(f.id, { ...st, ok: false, error: (e as Error).message });
        }
      }),
    );
    this.lastRss = Date.now();
  }

  async pollDart(): Promise<void> {
    const key = this.dartKey;
    if (!key) return;
    const st = this.status.get('dart') ?? { id: 'dart', name: 'DART', kind: 'disclosure' as const };
    try {
      const now = Date.now();
      // 오늘 접수된 최근 공시 100건(최신순)
      const r = await dartList(key, { bgn_de: ymd(now), end_de: ymd(now) });
      this.archive.add(dartItems(r, now));
      this.status.set('dart', { ...st, ok: true, at: now, error: undefined, count: r.list?.length ?? 0 });
      this.lastDart = now;
    } catch (e) {
      this.status.set('dart', { ...st, ok: false, error: (e as Error).message });
    }
  }

  /** 한 회사의 지난 1년 공시를 DART에서 받아 아카이브에 더해요(10분에 한 번) */
  private async fetchCorp(stockCode: string): Promise<void> {
    const key = this.dartKey;
    if (!key) return;
    const last = this.corpFetched.get(stockCode) ?? 0;
    if (Date.now() - last < CORP_CACHE_MS) return;
    this.corpFetched.set(stockCode, Date.now());
    try {
      this.corpCodes ??= this.loadCorpCodes(key);
      const corp = (await this.corpCodes).get(stockCode);
      if (!corp) return;
      const now = Date.now();
      const r = await dartList(key, { corp_code: corp, bgn_de: ymd(now - 365 * 86400_000), end_de: ymd(now) });
      this.archive.add(dartItems(r, now));
    } catch (e) {
      this.corpCodes = undefined;
      this.log.warn(`DART ${stockCode} 공시를 받지 못했어요: ${(e as Error).message}`);
    }
  }

  private async loadCorpCodes(key: string): Promise<Map<string, string>> {
    const dir = join(this.dataDir, 'masters');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'dart-corpcode.zip');
    let bytes: Uint8Array | undefined;
    try {
      const st = await stat(path);
      if (Date.now() - st.mtimeMs < 24 * 3600_000) bytes = new Uint8Array(await readFile(path));
    } catch {
      // 아직 없음
    }
    if (!bytes) {
      bytes = await fetchBytes(`${DART_BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`, 60_000);
      // 오류면 zip이 아니라 JSON·XML 메시지가 와요
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(`DART 고유번호 파일을 받지 못했어요: ${new TextDecoder().decode(bytes.subarray(0, 200))}`);
      await writeFile(path, bytes);
    }
    const files = unzipSync(bytes);
    const xml = new TextDecoder('utf-8').decode(files[Object.keys(files)[0]]);
    return parseCorpCodes(xml);
  }

  sources(): NewsSourceStatus[] {
    return [...this.status.values()];
  }

  /**
   * N 패널의 목록. 종목이 있으면: 국내 주식은 그 회사 공시 + 이름이 들어간 헤드라인, 그 밖의 주식·코인은 이름이 들어간 헤드라인.
   * 지수·환율은 거르지 않아요
   */
  async list(inst: Instrument | undefined, kind: 'all' | 'news' | 'disclosure', limit = 150): Promise<NewsResponse> {
    const kinds: Array<NewsItem['kind']> | undefined = kind === 'all' ? undefined : [kind];
    let items: NewsItem[];
    let filtered = false;
    const krStock = inst?.assetClass === 'EQUITY' && (inst.market === 'KS' || inst.market === 'KQ');
    if (inst && (inst.assetClass === 'EQUITY' || inst.assetClass === 'CRYPTO')) {
      filtered = true;
      if (krStock && kind !== 'news') await this.fetchCorp(inst.code);
      const disc = krStock && kind !== 'news' ? this.archive.recent({ limit, kinds: ['disclosure'], stockCode: inst.code }) : [];
      const terms = matchTerms(inst);
      // 헤드라인은 최근 3,000개에서 이름이 들어간 것만
      const news = kind !== 'disclosure' ? this.archive.recent({ limit, kinds: ['news'], scan: 3000 }).filter((x) => titleMatches(x.title, terms)) : [];
      items = [...disc, ...news].sort((a, b) => b.published - a.published).slice(0, limit);
    } else {
      items = this.archive.recent({ limit, kinds });
    }
    const at = Math.max(kind === 'disclosure' ? 0 : this.lastRss, kind === 'news' ? 0 : this.lastDart) || Date.now();
    const intervalMs = kind === 'news' || !this.dartKey ? RSS_INTERVAL_MS : DART_INTERVAL_MS;
    const fresh: Freshness = { source: kind === 'disclosure' ? 'DART' : 'RSS', mode: 'poll', asOf: at, receivedAt: at, intervalMs, asOfFromReceipt: true };
    return { items, fresh, filtered, dart: this.dartKey ? 'on' : 'off', sources: this.sources(), archived: this.archive.count() };
  }
}
