// 국내 종목 마스터의 뒷부분 칸(업종·상장일·상장주수·매출액·영업이익·ROE·시가총액)과 업종 이름 파일(idxcode.mst).
// DES 종목 개요와 공용 업종 분류(08 §4.2, HMAP·IMAP)가 써요.
// 칸 너비는 공식 저장소 stocks_info/kis_kospi_code_mst.py·kis_kosdaq_code_mst.py의 field_specs와 같아요.
// 공식 코드는 줄 끝의 줄바꿈까지 넣어 228·222칸을 자르므로, 줄바꿈을 뺀 실제 칸은 227·221칸이에요.

import type { Instrument, ProfileMaster, SectorIndex } from '@bt/shared';

const cp949 = new TextDecoder('euc-kr');

type Field = [name: string, width: number];

const one = (names: string[]): Field[] => names.map((n) => [n, 1]);

const KOSPI_FIELDS: Field[] = [
  ['group', 2],
  ['mcapSize', 1],
  ['big', 4],
  ['mid', 4],
  ['small', 4],
  ...one(['manufacturing', 'lowLiquidity', 'governance', 'k200Sector', 'k100', 'k50', 'krx', 'etp', 'elw', 'krx100']),
  ...one(['krxAuto', 'krxSemi', 'krxBio', 'krxBank', 'spac', 'krxEnergy', 'krxSteel', 'shortTermOverheat', 'krxMedia', 'krxConstruction']),
  ...one(['non1', 'krxSecurities', 'krxShip', 'krxInsurance', 'krxTransport', 'sri']),
  ['base', 9],
  ['lot', 5],
  ['afterLot', 5],
  ['halt', 1],
  ['liquidation', 1],
  ['managed', 1],
  ['warn', 2],
  ['warnNotice', 1],
  ['unfaithful', 1],
  ['backdoor', 1],
  ['lock', 2],
  ['faceChange', 2],
  ['capitalIncrease', 2],
  ['margin', 3],
  ['credit', 1],
  ['creditDays', 3],
  ['prevVolume', 12],
  ['face', 12],
  ['listedDate', 8],
  ['sharesK', 15],
  ['capital', 21],
  ['settleMonth', 2],
  ['ipoPrice', 7],
  ['pref', 1],
  ['shortOverheat', 1],
  ['surge', 1],
  ['krx300', 1],
  ['kospi', 1],
  ['sales', 9],
  ['operatingProfit', 9],
  ['ordinaryProfit', 9],
  // 당기순이익은 5칸이라 큰 회사는 넘쳐서 앞자리만 남아요(삼성전자 11884). 쓰지 않아요
  ['netIncome', 5],
  ['roe', 9],
  ['basisYm', 8],
  ['mcap', 9],
  ['groupCompany', 3],
  ['creditLimit', 1],
  ['collateral', 1],
  ['lendable', 1],
];

const KOSDAQ_FIELDS: Field[] = [
  ['group', 2],
  ['mcapSize', 1],
  ['big', 4],
  ['mid', 4],
  ['small', 4],
  ...one(['venture', 'lowLiquidity', 'krx', 'etp', 'krx100', 'krxAuto', 'krxSemi', 'krxBio', 'krxBank', 'spac']),
  ...one(['krxEnergy', 'krxSteel', 'shortTermOverheat', 'krxMedia', 'krxConstruction', 'caution', 'krxSecurities', 'krxShip', 'krxInsurance', 'krxTransport']),
  ...one(['kosdaq150']),
  ['base', 9],
  ['lot', 5],
  ['afterLot', 5],
  ['halt', 1],
  ['liquidation', 1],
  ['managed', 1],
  ['warn', 2],
  ['warnNotice', 1],
  ['unfaithful', 1],
  ['backdoor', 1],
  ['lock', 2],
  ['faceChange', 2],
  ['capitalIncrease', 2],
  ['margin', 3],
  ['credit', 1],
  ['creditDays', 3],
  ['prevVolume', 12],
  ['face', 12],
  ['listedDate', 8],
  ['sharesK', 15],
  ['capital', 21],
  ['settleMonth', 2],
  ['ipoPrice', 7],
  ['pref', 1],
  ['shortOverheat', 1],
  ['surge', 1],
  ['krx300', 1],
  ['sales', 9],
  ['operatingProfit', 9],
  ['ordinaryProfit', 9],
  ['netIncome', 5],
  ['roe', 9],
  ['basisYm', 8],
  ['mcap', 9],
  ['groupCompany', 3],
  ['creditLimit', 1],
  ['collateral', 1],
  ['lendable', 1],
];

export const KR_FIELDS = { KS: KOSPI_FIELDS, KQ: KOSDAQ_FIELDS } as const;

const widthOf = (f: Field[]) => f.reduce((s, [, w]) => s + w, 0);
export const KR_TAIL_WIDTH = { KS: widthOf(KOSPI_FIELDS), KQ: widthOf(KOSDAQ_FIELDS) } as const;

function offsets(fields: Field[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  let o = 0;
  for (const [n, w] of fields) {
    out[n] = [o, o + w];
    o += w;
  }
  return out;
}

const OFF = { KS: offsets(KOSPI_FIELDS), KQ: offsets(KOSDAQ_FIELDS) };

/** 종목 마스터 한 줄의 뒷부분에서 고른 칸 */
export interface KrStockInfo {
  market: 'KS' | 'KQ';
  /** 증권 그룹: ST 주식, EF ETF, RT 리츠 … */
  group: string;
  /** 코스피200 섹터(1 건설 … B 커뮤니케이션서비스, 0·빈칸은 코스피200 밖). 코스닥은 빈칸 */
  k200: string;
  /** 지수업종 대·중·소분류 코드(4자리, 없으면 '0000') */
  big: string;
  mid: string;
  small: string;
  listedDate?: string;
  shares?: number;
  /** 원 */
  marketCap?: number;
  sales?: number;
  operatingProfit?: number;
  roe?: number;
  basisYm?: string;
  faceValue?: number;
  settleMonth?: string;
  managed: boolean;
  /** 시장경고: 00 없음, 01 투자주의, 02 투자경고, 03 투자위험 */
  warn: string;
  halted: boolean;
  liquidation: boolean;
  shortOverheat: boolean;
}

const EOK = 1e8;

function num(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function ymd(s: string): string | undefined {
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : undefined;
}

/** 줄 끝에서 뒷부분(227·221칸)을 잘라 칸을 읽어요. 앞부분(코드·이름)은 parseKrMaster가 읽어요 */
export function parseKrInfoLine(line: Uint8Array, market: 'KS' | 'KQ'): { code: string; info: KrStockInfo } | undefined {
  const width = KR_TAIL_WIDTH[market];
  if (line.length < width + 21) return undefined;
  const code = String.fromCharCode(...line.subarray(0, 9)).trim();
  const tail = String.fromCharCode(...line.subarray(line.length - width));
  const off = OFF[market];
  const get = (n: string) => tail.slice(off[n][0], off[n][1]);
  const sharesK = num(get('sharesK'));
  const mcapEok = num(get('mcap'));
  const sales = num(get('sales'));
  const op = num(get('operatingProfit'));
  const roe = num(get('roe'));
  const basis = get('basisYm');
  const face = num(get('face'));
  const settle = get('settleMonth').trim();
  return {
    code,
    info: {
      market,
      group: get('group'),
      k200: market === 'KS' ? get('k200Sector').trim() : '',
      big: get('big'),
      mid: get('mid'),
      small: get('small'),
      listedDate: ymd(get('listedDate')),
      shares: sharesK ? sharesK * 1000 : undefined,
      marketCap: mcapEok ? mcapEok * EOK : undefined,
      sales: sales !== undefined && basis.trim() ? sales * EOK : undefined,
      operatingProfit: op !== undefined && basis.trim() ? op * EOK : undefined,
      roe: roe !== undefined && basis.trim() ? roe : undefined,
      basisYm: /^\d{6}/.test(basis) && !basis.startsWith('0000') ? `${basis.slice(0, 4)}-${basis.slice(4, 6)}` : undefined,
      faceValue: face || undefined,
      settleMonth: /^\d{2}$/.test(settle) && settle !== '00' ? settle : undefined,
      managed: get('managed') === 'Y',
      warn: get('warn'),
      halted: get('halt') === 'Y',
      liquidation: get('liquidation') === 'Y',
      shortOverheat: get('shortOverheat') === 'Y',
    },
  };
}

/**
 * 업종 이름 파일(idxcode.mst): 한 줄 = 구분 1자리 + 업종코드 4자리 + 이름 40자.
 * 공식 예제(stocks_info/sector_code.py)처럼 2~5번째 글자를 업종코드로 읽어요. 코드 첫 자리가 시장이에요(0xxx 코스피, 1xxx 코스닥, 2xxx 코스피200)
 */
export function parseSectorNames(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  let s = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 0x0a) {
      let e = i;
      if (e > s && bytes[e - 1] === 0x0d) e--;
      const line = bytes.subarray(s, e);
      s = i + 1;
      if (line.length < 6) continue;
      const key = String.fromCharCode(...line.subarray(1, 5));
      const name = cp949.decode(line.subarray(5)).trim();
      if (/^\d{4}$/.test(key) && name) out.set(key, name);
    }
  }
  return out;
}

const WARN_LABEL: Record<string, string> = { '01': '투자주의', '02': '투자경고', '03': '투자위험' };

/**
 * 종목 마스터의 코스피200 섹터 글자 → 코스피200 섹터 지수(idxcode.mst의 2xxx). 2026-11-03 마스터에서
 * 글자마다 대표 종목으로 맞춰 봤어요(5 삼성전자·SK하이닉스, 6 KB금융, 8 현대차, B NAVER, 합계 201종목)
 */
export const K200_SECTORS: Record<string, { code: string; name: string }> = {
  '1': { code: '2009', name: '건설' },
  '2': { code: '2010', name: '중공업' },
  '3': { code: '2011', name: '철강소재' },
  '4': { code: '2012', name: '에너지화학' },
  '5': { code: '2013', name: '정보기술' },
  '6': { code: '2014', name: '금융' },
  '7': { code: '2015', name: '생활소비재' },
  '8': { code: '2016', name: '경기소비재' },
  '9': { code: '2017', name: '산업재' },
  A: { code: '2018', name: '헬스케어' },
  B: { code: '2039', name: '커뮤니케이션서비스' },
};

/** 국내 종목 마스터의 칸을 보관해요. 종목 목록을 다시 만들 때(하루 한 번) 바뀌어요 */
export class KrMasterStore {
  private info = new Map<string, KrStockInfo>();
  private names = new Map<string, string>();
  private asOf: Record<'KS' | 'KQ', string | undefined> = { KS: undefined, KQ: undefined };

  setMarket(market: 'KS' | 'KQ', list: Map<string, KrStockInfo>, asOf: string) {
    for (const [id, v] of [...this.info]) if (v.market === market) this.info.delete(id);
    for (const [code, v] of list) this.info.set(`EQ:${market}:${code}`, v);
    this.asOf[market] = asOf;
  }

  setSectorNames(names: Map<string, string>) {
    this.names = names;
  }

  /** 그 시장 마스터를 받은 날 */
  asOfDate(market: 'KS' | 'KQ'): string | undefined {
    return this.asOf[market];
  }

  get(id: string): KrStockInfo | undefined {
    return this.info.get(id);
  }

  /** 업종 코드의 이름(코스닥 코드는 1xxx라 시장을 따로 보지 않아요) */
  sectorName(_market: 'KS' | 'KQ', code: string): string | undefined {
    if (!code || code === '0000') return undefined;
    return this.names.get(code);
  }

  /**
   * 지수의 종목과 업종(HMAP·IMAP, 08 §4.2 공용 업종 분류). 코스피·코스닥은 KRX 업종 중분류(없으면 대분류),
   * 코스피200은 코스피200 섹터. 보통주·리츠만(ETF·ETN·우선주 빼요)
   */
  universe(index: SectorIndex, isPref: (id: string) => boolean): Array<{ id: string; code: string; info: KrStockInfo; sector: string; sectorName: string }> {
    const out: Array<{ id: string; code: string; info: KrStockInfo; sector: string; sectorName: string }> = [];
    for (const [id, info] of this.info) {
      if (info.group !== 'ST' && info.group !== 'RT') continue;
      if (isPref(id)) continue;
      const code = id.split(':')[2];
      if (index === 'KOSPI2') {
        const k = K200_SECTORS[info.k200];
        if (info.market !== 'KS' || !k) continue;
        out.push({ id, code, info, sector: k.code, sectorName: k.name });
        continue;
      }
      if (info.market !== (index === 'KOSPI' ? 'KS' : 'KQ')) continue;
      const sector = info.mid !== '0000' ? info.mid : info.big;
      const name = this.sectorName(info.market, sector);
      if (!name) continue;
      out.push({ id, code, info, sector, sectorName: name });
    }
    return out;
  }

  /** 대분류 > 중분류 이름. 중분류가 없으면 대분류만(금융 등) */
  sectorPath(info: KrStockInfo): string[] {
    return [this.sectorName(info.market, info.big), this.sectorName(info.market, info.mid)].filter((x): x is string => !!x);
  }

  profile(inst: Instrument): ProfileMaster | undefined {
    if (inst.assetClass !== 'EQUITY' || (inst.market !== 'KS' && inst.market !== 'KQ')) return undefined;
    const i = this.info.get(inst.id);
    const asOf = this.asOf[inst.market];
    if (!i || !asOf) return undefined;
    const warnings: string[] = [];
    if (i.halted) warnings.push('거래정지');
    if (i.managed) warnings.push('관리종목');
    if (WARN_LABEL[i.warn]) warnings.push(WARN_LABEL[i.warn]);
    if (i.liquidation) warnings.push('정리매매');
    if (i.shortOverheat) warnings.push('공매도 과열');
    const sector = this.sectorPath(i);
    return {
      sector: sector.length ? sector : undefined,
      listedDate: i.listedDate,
      shares: i.shares,
      marketCap: i.marketCap,
      sales: i.sales,
      operatingProfit: i.operatingProfit,
      roe: i.roe,
      basisMonth: i.basisYm,
      faceValue: i.faceValue,
      settleMonth: i.settleMonth,
      warnings: warnings.length ? warnings : undefined,
      asOf,
    };
  }

  size(): number {
    return this.info.size;
  }
}

export const krMaster = new KrMasterStore();
