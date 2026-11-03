// 국내 종목 마스터의 뒷부분 칸(업종·상장일·상장주수·매출액·영업이익·ROE·시가총액)과 업종 이름 파일(idxcode.mst).
// DES 종목 개요와 공용 업종 분류(08 §4.2, HMAP·IMAP)가 써요.
// 칸 너비는 공식 저장소 stocks_info/kis_kospi_code_mst.py·kis_kosdaq_code_mst.py의 field_specs와 같아요.
// 공식 코드는 줄 끝의 줄바꿈까지 넣어 228·222칸을 자르므로, 줄바꿈을 뺀 실제 칸은 227·221칸이에요.

import type { Instrument, ProfileMaster } from '@bt/shared';

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

/** 업종 이름 파일(idxcode.mst): 한 줄 = 시장 구분 1자리(0 코스피, 1 코스닥, 2 코스피200 …) + 업종코드 4자리 + 이름 40자 */
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
      const key = String.fromCharCode(...line.subarray(0, 5));
      const name = cp949.decode(line.subarray(5)).trim();
      if (/^\d{5}$/.test(key) && name) out.set(key, name);
    }
  }
  return out;
}

const WARN_LABEL: Record<string, string> = { '01': '투자주의', '02': '투자경고', '03': '투자위험' };

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

  get(id: string): KrStockInfo | undefined {
    return this.info.get(id);
  }

  /** 업종 코드의 이름. 코스피는 0, 코스닥은 1을 앞에 붙여 찾아요 */
  sectorName(market: 'KS' | 'KQ', code: string): string | undefined {
    if (!code || code === '0000') return undefined;
    return this.names.get(`${market === 'KS' ? '0' : '1'}${code}`);
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
