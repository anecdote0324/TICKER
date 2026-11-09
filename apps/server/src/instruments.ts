// 종목 목록(05 §6.1): KIS 종목 마스터(국내·미국), Binance USDT 현물, 정해 둔 지수·환율 목록.
// 마스터 파일은 키 없이 내려받을 수 있어요. 하루에 한 번 받아서 데이터 폴더에 캐시해요.
// 받지 못했고 캐시도 없으면(첫 실행인데 인터넷이 없을 때) 설치 파일에 넣은 사본으로 대신해요.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import {
  CRYPTO_EXCLUDED_BASES,
  CRYPTO_KO,
  US_POPULAR,
  staticInstruments,
  type Instrument,
  type InstrumentFlag,
  type InstrumentsResponse,
} from '@bt/shared';
import type { BinanceAdapter, Ticker24h } from './adapters/binance';
import { krMaster, parseKrInfoLine, parseSectorNames, type KrStockInfo } from './kr-master';
import { applyUsBoost } from './us-activity';
import { fetchBytes, type Logger } from './util';

const MASTER_BASE = 'https://new.real.download.dws.co.kr/common/master';
const MASTERS = {
  kospi: 'kospi_code.mst',
  kosdaq: 'kosdaq_code.mst',
  nas: 'nasmst.cod',
  nys: 'nysmst.cod',
  ams: 'amsmst.cod',
  /** 업종 이름(공용 업종 분류, 08 §4.2) */
  sectors: 'idxcode.mst',
} as const;

const cp949 = new TextDecoder('euc-kr');

/** 국내 마스터에 넣을 그룹: 주식, ETF, ETN, 리츠, 예탁증서, 외국주권, 인프라·뮤추얼 펀드. ELW·신주인수권·수익증권은 빼요 */
const KR_GROUPS = new Set(['ST', 'EF', 'EN', 'RT', 'DR', 'FS', 'IF', 'MF']);

type MasterSource = InstrumentsResponse['sources'][number];

/** 설치 파일에 넣는 종목 목록 사본(05 §6.1). 저장소에는 올리지 않고 설치 파일을 만들 때 내려받아 만들어요 */
export interface InstrumentSnapshot {
  builtAt: number;
  instruments: Instrument[];
}

export async function readSnapshot(file: string | undefined): Promise<InstrumentSnapshot | undefined> {
  if (!file) return undefined;
  try {
    const raw = await readFile(file);
    return JSON.parse(gunzipSync(raw).toString('utf8')) as InstrumentSnapshot;
  } catch {
    return undefined;
  }
}

export function encodeSnapshot(r: InstrumentsResponse): Buffer {
  const fixed = new Set(staticInstruments().map((i) => i.id));
  const snap: InstrumentSnapshot = { builtAt: r.builtAt, instruments: r.instruments.filter((i) => !fixed.has(i.id)) };
  return gzipSync(JSON.stringify(snap), { level: 9 });
}

/** 받지 못한 소스를 사본에서 골라내는 조건 */
const SNAPSHOT_PART: Record<string, (i: Instrument) => boolean> = {
  kospi: (i) => i.market === 'KS',
  kosdaq: (i) => i.market === 'KQ',
  nas: (i) => i.market === 'US' && i.exchange === 'NAS',
  nys: (i) => i.market === 'US' && i.exchange === 'NYS',
  ams: (i) => i.market === 'US' && i.exchange === 'AMS',
  binance: (i) => i.assetClass === 'CRYPTO',
};

function fromSnapshot(snap: InstrumentSnapshot | undefined, part: string): Instrument[] {
  const f = SNAPSHOT_PART[part];
  return snap && f ? snap.instruments.filter(f) : [];
}

const snapDate = (snap: InstrumentSnapshot) => new Date(snap.builtAt).toISOString().slice(0, 10);

export async function loadMaster(dataDir: string, file: string, log: Logger): Promise<{ bytes: Uint8Array; asOf: string } | { error: string }> {
  const dir = join(dataDir, 'masters');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${file}.zip`);
  let cached: Uint8Array | undefined;
  let mtime = 0;
  try {
    const st = await stat(path);
    mtime = st.mtimeMs;
    cached = new Uint8Array(await readFile(path));
  } catch {
    // 아직 없음
  }
  // 하루가 지났으면 새로 받아요
  if (!cached || Date.now() - mtime > 20 * 3600_000) {
    try {
      const fresh = await fetchBytes(`${MASTER_BASE}/${file}.zip`);
      await writeFile(path, fresh);
      cached = fresh;
      mtime = Date.now();
    } catch (e) {
      log.warn(`종목 마스터 ${file}를 받지 못했어요: ${(e as Error).message}`);
      if (!cached) return { error: (e as Error).message };
    }
  }
  const files = unzipSync(cached);
  const entry = Object.keys(files)[0];
  return { bytes: files[entry], asOf: new Date(mtime).toISOString().slice(0, 10) };
}

function splitLines(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let s = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      let e = i;
      if (e > s && bytes[e - 1] === 0x0d) e--;
      if (e > s) out.push(bytes.subarray(s, e));
      s = i + 1;
    }
  }
  if (s < bytes.length) out.push(bytes.subarray(s));
  return out;
}

const ascii = (b: Uint8Array) => String.fromCharCode(...b);

/** 우선주 이름: 삼성전자우, 현대차2우B, 대신증권우(전환) */
const PREF_RE = /(\d?우[A-C]?|우\(전환\))$/;

/**
 * 국내 마스터(고정폭, cp949). 한 줄 = 단축코드 9 + 표준코드 12 + 한글명 40 + 나머지.
 * 나머지 칸: 0~1 그룹코드, 기준가(코스피 41~49, 코스닥 36~44), 거래정지(기준가 + 19), 끝에서 15~7 시가총액(억 원).
 */
export function parseKrMaster(bytes: Uint8Array, market: 'KS' | 'KQ'): Instrument[] {
  const out: Instrument[] = [];
  const baseOff = market === 'KS' ? 41 : 36;
  for (const line of splitLines(bytes)) {
    if (line.length < 100) continue;
    const code = ascii(line.subarray(0, 9)).trim();
    const name = cp949.decode(line.subarray(21, 61)).trim();
    const tail = ascii(line.subarray(61));
    const group = tail.slice(0, 2);
    if (!KR_GROUPS.has(group) || !/^[0-9A-Z]{6}$/.test(code)) continue;
    const refPrice = Number(tail.slice(baseOff, baseOff + 9));
    const halted = tail[baseOff + 19] === 'Y';
    const mcap = Number(tail.slice(-15, -6));
    const flags: InstrumentFlag[] = [];
    if (group === 'EF') flags.push('ETF');
    if (group === 'EN') flags.push('ETN');
    if (group === 'RT') flags.push('REIT');
    if (name.includes('스팩')) flags.push('SPAC');
    if (halted) flags.push('HALT');
    const isPref = group === 'ST' && code[5] !== '0' && PREF_RE.test(name);
    if (isPref) flags.push('PREF');
    out.push({
      id: `EQ:${market}:${code}`,
      assetClass: 'EQUITY',
      market,
      code,
      nameKo: name,
      flags: flags.length ? flags : undefined,
      exchange: 'KRX',
      currency: 'KRW',
      refPrice: refPrice > 0 ? refPrice : undefined,
      // 시가총액은 아래에서 백분위로 바꿔요
      popularity: Number.isFinite(mcap) ? mcap : 0,
      commonId: isPref ? `EQ:${market}:${code.slice(0, 5)}0` : undefined,
    });
  }
  return out;
}

/** 종목 마스터 뒷부분의 칸(업종·상장주수·실적). 목록에 넣은 종목만 보관해요 */
export function parseKrInfo(bytes: Uint8Array, market: 'KS' | 'KQ', keep: Set<string>): Map<string, KrStockInfo> {
  const out = new Map<string, KrStockInfo>();
  for (const line of splitLines(bytes)) {
    const r = parseKrInfoLine(line, market);
    if (r && keep.has(r.code)) out.set(r.code, r.info);
  }
  return out;
}

/**
 * 미국 마스터(탭 구분, cp949). 칸: 4 심볼, 5 실시간 심볼, 6 한글명, 7 영문명, 8 종류(1 지수, 2 주식, 3 ETP, 4 워런트),
 * 12 기준가, 17 DR 여부, 22 구분(001 ETF, 002 ETN, 003 ETC, 005 VIX ETF, 006 VIX ETN).
 */
export function parseUsMaster(bytes: Uint8Array, exchange: 'NAS' | 'NYS' | 'AMS'): Instrument[] {
  const out: Instrument[] = [];
  for (const line of splitLines(bytes)) {
    const c = cp949.decode(line).split('\t');
    if (c.length < 18) continue;
    const symbol = c[4]?.trim();
    const kind = c[8]?.trim();
    if (!symbol || kind === '1' || kind === '4') continue; // 지수·워런트는 빼요(기본값)
    const nameKo = c[6]?.trim();
    const nameEn = c[7]?.trim();
    const flags: InstrumentFlag[] = [];
    const sub = c[22]?.trim();
    if (kind === '3') flags.push(sub === '002' || sub === '006' ? 'ETN' : 'ETF');
    if (c[17]?.trim() === 'Y') flags.push('ADR');
    const refPrice = Number(c[12]);
    out.push({
      id: `EQ:US:${symbol}`,
      assetClass: 'EQUITY',
      market: 'US',
      code: symbol,
      // 한글명 칸에 영문이 그대로 들어 있는 종목이 많아요. 한글이 있을 때만 한글명으로 써요
      nameKo: nameKo && /[가-힣]/.test(nameKo) ? nameKo : undefined,
      nameEn: nameEn || undefined,
      flags: flags.length ? flags : undefined,
      exchange,
      currency: 'USD',
      feedSymbol: c[5]?.trim() || `${exchange}${symbol}`,
      refPrice: refPrice > 0 ? refPrice : undefined,
    });
  }
  return out;
}

/** 시가총액·거래대금 같은 값을 자산군 안의 백분위(0~1)로 바꿔요 */
function percentile(list: Instrument[], key: (i: Instrument) => number) {
  const sorted = [...list].sort((a, b) => key(a) - key(b));
  const n = sorted.length;
  sorted.forEach((inst, i) => {
    inst.popularity = n > 1 ? i / (n - 1) : 1;
  });
}

export function cryptoFromTickers(tickers: Ticker24h[]): Instrument[] {
  const ko = new Map(CRYPTO_KO);
  const out: Instrument[] = [];
  const vols = new Map<string, number>();
  for (const t of tickers) {
    if (!t.symbol.endsWith('USDT')) continue;
    const base = t.symbol.slice(0, -4);
    if (!/^[A-Z0-9]+$/.test(base) || CRYPTO_EXCLUDED_BASES.has(base)) continue;
    if (!(t.count > 0) || !(Number(t.quoteVolume) > 0)) continue;
    vols.set(base, Number(t.quoteVolume));
    out.push({
      id: `CRY:${base}`,
      assetClass: 'CRYPTO',
      code: base,
      nameKo: ko.get(base),
      nameEn: base,
      aliases: [`${base}USDT`, ...(base === 'BTC' ? ['XBT'] : [])],
      exchange: 'BINANCE',
      currency: 'USDT',
      feedSymbol: t.symbol,
      refPrice: Number(t.lastPrice),
    });
  }
  percentile(out, (i) => vols.get(i.code) ?? 0);
  // 한글 이름을 정해 둔 주요 코인은 인기도를 조금 올려요
  for (const i of out) if (ko.has(i.code)) i.popularity = Math.max(i.popularity ?? 0, 0.9);
  return out;
}

export async function buildInstruments(dataDir: string, binance: BinanceAdapter, log: Logger, snapshotFile?: string, usScores?: Map<string, number>): Promise<InstrumentsResponse> {
  const sources: MasterSource[] = [];
  const all: Instrument[] = [];
  // 사본은 필요할 때만 읽어요
  let snap: Promise<InstrumentSnapshot | undefined> | undefined;
  const fallback = async (part: string, name: string, error: string, into: Instrument[]) => {
    snap ??= readSnapshot(snapshotFile);
    const s = await snap;
    const list = fromSnapshot(s, part);
    into.push(...list);
    sources.push(list.length && s ? { name, count: list.length, asOf: snapDate(s), error, snapshot: true } : { name, count: 0, error });
  };

  const kr: Instrument[] = [];
  for (const [market, file, part] of [
    ['KS', MASTERS.kospi, 'kospi'],
    ['KQ', MASTERS.kosdaq, 'kosdaq'],
  ] as const) {
    const m = await loadMaster(dataDir, file, log);
    if ('error' in m) {
      await fallback(part, file, m.error, kr);
      continue;
    }
    const list = parseKrMaster(m.bytes, market);
    kr.push(...list);
    krMaster.setMarket(market, parseKrInfo(m.bytes, market, new Set(list.map((i) => i.code))), m.asOf);
    sources.push({ name: file, count: list.length, asOf: m.asOf });
  }
  percentile(kr, (i) => i.popularity ?? 0);
  all.push(...kr);
  // 업종 이름은 받지 못해도 목록은 만들어요(DES의 업종 칸과 HMAP·IMAP의 업종 이름만 비어요)
  const sec = await loadMaster(dataDir, MASTERS.sectors, log);
  if ('error' in sec) sources.push({ name: MASTERS.sectors, count: 0, error: sec.error });
  else {
    const names = parseSectorNames(sec.bytes);
    krMaster.setSectorNames(names);
    sources.push({ name: MASTERS.sectors, count: names.size, asOf: sec.asOf });
  }

  const us: Instrument[] = [];
  for (const [ex, file, part] of [
    ['NAS', MASTERS.nas, 'nas'],
    ['NYS', MASTERS.nys, 'nys'],
    ['AMS', MASTERS.ams, 'ams'],
  ] as const) {
    const m = await loadMaster(dataDir, file, log);
    if ('error' in m) {
      await fallback(part, file, m.error, us);
      continue;
    }
    const list = parseUsMaster(m.bytes, ex);
    us.push(...list);
    sources.push({ name: file, count: list.length, asOf: m.asOf });
  }
  const popRank = new Map(US_POPULAR.map((s, i) => [s, i]));
  for (const i of us) {
    const r = popRank.get(i.code);
    i.popularity = r !== undefined ? 1 - (r / US_POPULAR.length) * 0.4 : i.flags?.includes('ETF') ? 0.25 : 0.2;
  }
  // 앱에서 본 거래대금으로 인기도 보강(v0.2)
  if (usScores?.size) applyUsBoost(us, usScores);
  all.push(...us);

  try {
    const tickers = await binance.tickers24h();
    const cry = cryptoFromTickers(tickers);
    all.push(...cry);
    sources.push({ name: 'Binance USDT', count: cry.length, asOf: new Date().toISOString().slice(0, 10) });
  } catch (e) {
    log.warn(`Binance 종목 목록을 받지 못했어요: ${(e as Error).message}`);
    const cry: Instrument[] = [];
    await fallback('binance', 'Binance USDT', (e as Error).message, cry);
    all.push(...cry);
    // 사본도 없으면 주요 코인만이라도 넣어요
    if (cry.length === 0) {
      CRYPTO_KO.forEach(([code, nameKo], i) =>
        all.push({
          id: `CRY:${code}`,
          assetClass: 'CRYPTO',
          code,
          nameKo,
          nameEn: code,
          aliases: [`${code}USDT`],
          exchange: 'BINANCE',
          currency: 'USDT',
          feedSymbol: `${code}USDT`,
          popularity: 1 - i / CRYPTO_KO.length,
        }),
      );
    }
  }

  const stat = staticInstruments();
  all.push(...stat);
  sources.push({ name: '지수·환율 목록', count: stat.length });

  log.info(`종목 ${all.length}개 색인 준비: ${sources.map((s) => `${s.name} ${s.count}`).join(', ')}`);
  return { instruments: all, builtAt: Date.now(), sources };
}
