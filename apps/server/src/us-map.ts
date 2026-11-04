// IMAP 미국 지수(03 v0.3): 구성 종목과 비중은 그 지수를 따르는 ETF의 보유 종목 파일로 정해요.
// S&P 500은 State Street SPDR SPY(날마다 올리는 엑셀 파일), 나스닥100은 Invesco QQQ(보유 종목 JSON).
// 파일은 12시간에 한 번 받아 데이터 폴더(etf-holdings-SPY.json 등)에 두고, 받지 못하면 마지막으로 받은 것을 써요.
// 업종은 한국투자증권 해외주식 업종 분류(거래소별 업종코드 → 업종별 종목)로 묶고, 7일 동안 데이터 폴더(us-industries.json)에 둬요.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { UsMapIndex } from '@bt/shared';
import { fetchBytes, fetchJson, type Logger } from './util';

const SPY_URL = 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx';
const QQQ_URL = 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/holdings/fund?idType=ticker&interval=monthly&productType=ETF';
const HOLDINGS_TTL_MS = 12 * 3600_000;
/** 받지 못했을 때 다시 해 보기까지 */
const RETRY_MS = 30 * 60_000;
const INDUSTRY_TTL_MS = 7 * 86400_000;

export interface EtfHolding {
  /** 앱 표기(BRK/B) */
  ticker: string;
  name: string;
  /** ETF 안의 비중(%) */
  weight: number;
}

export interface EtfHoldings {
  etf: string;
  /** 파일의 기준일(YYYY-MM-DD) */
  asOf?: string;
  holdings: EtfHolding[];
  /** 받은 때(ms) */
  savedAt: number;
}

/** BRK.B·BRK B → BRK/B(한국투자증권·종목 마스터 표기). 주식이 아닌 줄(현금 '-', 임시 코드 2602335D)은 undefined */
export function appTicker(raw: string): string | undefined {
  const t = raw.trim().toUpperCase().replace(/[. ]/g, '/');
  return /^[A-Z]{1,5}(\/[A-Z])?$/.test(t) ? t : undefined;
}

const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

/** 'As of 03-Nov-2026' → '2026-11-03' */
export function asOfDate(text: string): string | undefined {
  const m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(text);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? iso[0] : undefined;
}

// ── 엑셀(xlsx) 읽기: zip 안의 sharedStrings.xml과 sheet1.xml만 ──

/** zip에서 이름이 맞는 파일 하나를 꺼내요(중앙 디렉터리 기준, 저장·deflate만) */
export function unzipEntry(bytes: Uint8Array, name: string): Uint8Array | undefined {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('엑셀 파일(zip) 형식이 아니에요');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < count && p + 46 <= bytes.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const entry = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (entry !== name) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) return data;
    if (method === 8) return new Uint8Array(inflateRawSync(data));
    throw new Error(`엑셀 파일의 압축 방식(${method})을 읽지 못해요`);
  }
  return undefined;
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** 첫 시트를 줄마다 칸 값(문자열) 배열로 */
export function xlsxRows(bytes: Uint8Array): string[][] {
  const dec = new TextDecoder();
  const sstRaw = unzipEntry(bytes, 'xl/sharedStrings.xml');
  const shared = sstRaw ? [...dec.decode(sstRaw).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))) : [];
  const sheet = unzipEntry(bytes, 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('엑셀 파일에 시트가 없어요');
  const rows: string[][] = [];
  for (const r of dec.decode(sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const body = c[2] ?? '';
      const t = /\bt="(\w+)"/.exec(attrs)?.[1];
      let v: string;
      if (t === 'inlineStr') v = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        v = t === 's' ? (shared[Number(raw)] ?? '') : unxml(raw);
      }
      row[ref ? colIndex(ref) : row.length] = v;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

/** SPDR 보유 종목 엑셀: 머리줄(Name·Ticker·Weight)을 찾아 그 아래 줄들. 기준일은 'As of 03-Nov-2026' 칸 */
export function parseSpdrHoldings(bytes: Uint8Array): Omit<EtfHoldings, 'savedAt'> {
  const rows = xlsxRows(bytes);
  const hi = rows.findIndex((r) => r.some((c) => c.trim() === 'Ticker') && r.some((c) => c.trim() === 'Weight'));
  if (hi < 0) throw new Error('SPY 보유 종목 파일에서 Ticker·Weight 머리줄을 찾지 못했어요');
  const head = rows[hi].map((c) => c.trim());
  const [iT, iN, iW] = [head.indexOf('Ticker'), head.indexOf('Name'), head.indexOf('Weight')];
  let asOf: string | undefined;
  for (const r of rows.slice(0, hi)) for (const c of r) if (/as of/i.test(c)) asOf ??= asOfDate(c);
  const holdings: EtfHolding[] = [];
  for (const r of rows.slice(hi + 1)) {
    const ticker = appTicker(r[iT] ?? '');
    const weight = Number(r[iW]);
    if (!ticker || !(weight > 0)) continue;
    holdings.push({ ticker, name: (r[iN] ?? ticker).trim(), weight });
  }
  if (holdings.length === 0) throw new Error('SPY 보유 종목 파일에 종목이 없어요');
  return { etf: 'SPY', asOf, holdings };
}

interface InvescoHoldings {
  effectiveDate?: string;
  holdings?: Array<{ ticker?: string | null; issuerName?: string; percentageOfTotalNetAssets?: number | null; securityTypeCode?: string }>;
}

/** Invesco 보유 종목 JSON: 주식(COM)·예탁증서(ADR 등)만, 현금·선물(CURR·IFUT·SYN)은 빼요 */
export function parseInvescoHoldings(etf: string, r: InvescoHoldings): Omit<EtfHoldings, 'savedAt'> {
  const holdings: EtfHolding[] = [];
  for (const h of r.holdings ?? []) {
    const type = (h.securityTypeCode ?? '').toUpperCase();
    if (type.startsWith('CURR') || type === 'IFUT' || type === 'SYN') continue;
    const ticker = appTicker(h.ticker ?? '');
    const weight = Number(h.percentageOfTotalNetAssets);
    if (!ticker || !(weight > 0)) continue;
    holdings.push({ ticker, name: (h.issuerName ?? ticker).trim(), weight });
  }
  if (holdings.length === 0) throw new Error(`${etf} 보유 종목에 종목이 없어요`);
  return { etf, asOf: r.effectiveDate ? asOfDate(r.effectiveDate) : undefined, holdings };
}

/** 한국투자증권 업종 분류: 종목 → 업종 이름 */
export type IndustryMap = Map<string, string>;

export class UsMapService {
  private mem = new Map<UsMapIndex, EtfHoldings>();
  private loading = new Map<UsMapIndex, Promise<EtfHoldings>>();
  private failedAt = new Map<UsMapIndex, { at: number; message: string }>();
  private industries?: { savedAt: number; map: IndustryMap };
  private industryLoad?: Promise<void>;
  /** 업종 분류를 받지 못한 이유(다음 요청에 보여 줘요) */
  industryError?: string;

  constructor(
    private dataDir: string,
    private log: Logger,
  ) {}

  private file(etf: string) {
    return join(this.dataDir, `etf-holdings-${etf}.json`);
  }

  /** 구성 종목: 새 파일이 있으면 그것, 받는 중이거나 받지 못하면 마지막으로 받은 것 */
  async holdings(index: UsMapIndex): Promise<{ data?: EtfHoldings; error?: string }> {
    const etf = index === 'SPX' ? 'SPY' : 'QQQ';
    let cur = this.mem.get(index);
    if (!cur) {
      try {
        cur = JSON.parse(await readFile(this.file(etf), 'utf8')) as EtfHoldings;
        if (cur?.holdings?.length) this.mem.set(index, cur);
        else cur = undefined;
      } catch {
        cur = undefined;
      }
    }
    const fail = this.failedAt.get(index);
    const stale = !cur || Date.now() - cur.savedAt > HOLDINGS_TTL_MS;
    if (stale && !(fail && Date.now() - fail.at < RETRY_MS)) {
      let p = this.loading.get(index);
      if (!p) {
        p = this.download(index, etf);
        this.loading.set(index, p);
        void p.finally(() => this.loading.delete(index)).catch(() => undefined);
      }
      // 처음이면 받을 때까지 기다리고, 갖고 있으면 그것을 먼저 보여 줘요
      if (!cur) {
        try {
          return { data: await p };
        } catch (e) {
          return { error: (e as Error).message };
        }
      }
      void p.catch(() => undefined);
    }
    return { data: cur, error: fail && stale ? fail.message : undefined };
  }

  private async download(index: UsMapIndex, etf: string): Promise<EtfHoldings> {
    try {
      const parsed = etf === 'SPY' ? parseSpdrHoldings(await fetchBytes(SPY_URL, 60_000)) : parseInvescoHoldings(etf, await fetchJson<InvescoHoldings>(QQQ_URL, { timeoutMs: 60_000 }));
      const data: EtfHoldings = { ...parsed, savedAt: Date.now() };
      this.mem.set(index, data);
      this.failedAt.delete(index);
      void writeFile(this.file(etf), JSON.stringify(data)).catch(() => undefined);
      this.log.info(`${etf} 보유 종목 ${data.holdings.length}개(${data.asOf ?? '기준일 모름'})를 받았어요`);
      return data;
    } catch (e) {
      const message = `${etf} 보유 종목 파일을 받지 못했어요: ${(e as Error).message}`;
      this.failedAt.set(index, { at: Date.now(), message });
      this.log.warn(message);
      throw new Error(message);
    }
  }

  /** 업종 분류(있는 것). 없거나 7일이 지났으면 load로 뒤에서 다시 받아요 */
  async industryMap(load: () => Promise<IndustryMap>): Promise<IndustryMap | undefined> {
    if (!this.industries) {
      try {
        const raw = JSON.parse(await readFile(join(this.dataDir, 'us-industries.json'), 'utf8')) as { savedAt: number; map: Record<string, string> };
        if (raw?.map) this.industries = { savedAt: raw.savedAt, map: new Map(Object.entries(raw.map)) };
      } catch {
        // 아직 없음
      }
    }
    if ((!this.industries || Date.now() - this.industries.savedAt > INDUSTRY_TTL_MS) && !this.industryLoad) {
      this.industryLoad = load()
        .then((map) => {
          if (map.size === 0) throw new Error('업종별 종목이 비어 있어요');
          this.industries = { savedAt: Date.now(), map };
          this.industryError = undefined;
          void writeFile(join(this.dataDir, 'us-industries.json'), JSON.stringify({ savedAt: Date.now(), map: Object.fromEntries(map) })).catch(() => undefined);
          this.log.info(`미국 업종 분류 ${map.size}종목을 받았어요`);
        })
        .catch((e: Error) => {
          this.industryError = `한국투자증권 해외 업종 분류를 받지 못했어요: ${e.message}`;
          this.log.warn(this.industryError);
          // 30분 뒤에 다시 해 봐요
          setTimeout(() => (this.industryLoad = undefined), RETRY_MS).unref?.();
          throw e;
        })
        .then(() => {
          this.industryLoad = undefined;
        });
      void this.industryLoad.catch(() => undefined);
    }
    return this.industries?.map;
  }

  /** 업종 분류를 받는 중인지 */
  get industryLoading(): boolean {
    return !!this.industryLoad && !this.industryError;
  }
}
