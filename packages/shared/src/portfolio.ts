// PORT 포트폴리오(03 v0.3): 직접 입력하거나 CSV(신한 잔고 등)로 가져온 보유 종목의 평가·손익. 원화로 합쳐요.
// 미국 종목은 지금 원/달러로 평가하고, 매입금액은 '매입 환율'을 넣었으면 그 환율, 없으면 지금 환율로 환산해요(환율 손익 0).

export interface Holding {
  /** 종목 id(EQ:KS:005930, EQ:US:AAPL, CRY:BTC) */
  id: string;
  qty: number;
  /** 평균 매입 단가(그 종목의 통화: 원·달러) */
  avgCost: number;
  /** 미국 종목의 매입 환율(원/달러). 없으면 지금 환율 */
  fxAtCost?: number;
  /** 계좌·메모(예: 신한, ISA) */
  account?: string;
}

export interface HoldingQuote {
  last?: number;
  /** 전일 종가(오늘 손익) */
  prevClose?: number;
  /** 'KRW', 'USD', 'USDT' */
  currency: string;
}

export interface PortRow {
  id: string;
  qty: number;
  avgCost: number;
  last?: number;
  /** 원화 */
  value?: number;
  cost: number;
  pnl?: number;
  pnlPct?: number;
  /** 오늘 손익(원화) */
  dayPnl?: number;
  /** 평가금액 비중(%) */
  weight?: number;
  /** 원화가 아닌 종목에 쓴 지금 환율 */
  fx?: number;
}

export interface PortTotals {
  value: number;
  cost: number;
  pnl: number;
  pnlPct?: number;
  dayPnl: number;
  /** 시세가 없어 평가에서 뺀 종목 수 */
  missing: number;
}

/** 통화 → 원화 환율. USDT 코인은 달러로 봐요 */
export function fxOf(currency: string, usdkrw: number | undefined): number | undefined {
  if (currency === 'KRW') return 1;
  if (currency === 'USD' || currency === 'USDT') return usdkrw;
  return undefined;
}

export function computePortfolio(holdings: Holding[], quotes: (id: string) => HoldingQuote | undefined, usdkrw: number | undefined): { rows: PortRow[]; totals: PortTotals } {
  const rows: PortRow[] = holdings.map((h) => {
    const q = quotes(h.id);
    const fx = fxOf(q?.currency ?? 'KRW', usdkrw);
    const costFx = q && q.currency !== 'KRW' ? (h.fxAtCost ?? fx) : 1;
    const cost = h.qty * h.avgCost * (costFx ?? 0);
    if (!q || q.last === undefined || fx === undefined) return { id: h.id, qty: h.qty, avgCost: h.avgCost, last: q?.last, cost };
    const value = h.qty * q.last * fx;
    const dayPnl = q.prevClose !== undefined ? h.qty * (q.last - q.prevClose) * fx : undefined;
    return {
      id: h.id,
      qty: h.qty,
      avgCost: h.avgCost,
      last: q.last,
      value,
      cost,
      pnl: value - cost,
      pnlPct: cost ? (value / cost - 1) * 100 : undefined,
      dayPnl,
      fx: q.currency !== 'KRW' ? fx : undefined,
    };
  });
  const valued = rows.filter((r) => r.value !== undefined);
  const value = valued.reduce((a, r) => a + r.value!, 0);
  const cost = valued.reduce((a, r) => a + r.cost, 0);
  for (const r of valued) r.weight = value ? (r.value! / value) * 100 : undefined;
  return {
    rows,
    totals: { value, cost, pnl: value - cost, pnlPct: cost ? (value / cost - 1) * 100 : undefined, dayPnl: valued.reduce((a, r) => a + (r.dayPnl ?? 0), 0), missing: rows.length - valued.length },
  };
}

// ── CSV 가져오기 ──

/** CSV 한 줄 나누기(따옴표 안의 쉼표 지키기) */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const COLS = {
  code: ['종목코드', '종목번호', '코드', '티커', 'symbol', 'ticker', 'code'],
  name: ['종목명', '종목', 'name'],
  qty: ['보유수량', '잔고수량', '수량', '보유량', 'quantity', 'qty', 'shares'],
  avg: ['평균단가', '매입단가', '평균매입가', '매입평균가', '평균가', 'avgcost', 'avg cost', 'average cost', 'cost'],
  fx: ['매입환율', '평균환율', 'fx'],
  account: ['계좌', '계좌명', 'account'],
};

/** 머리줄에서 열 찾기(공백·괄호 무시, 앞에서부터) */
function findCol(header: string[], names: string[]): number {
  const norm = header.map((h) => h.toLowerCase().replace(/[\s()（）]/g, ''));
  for (const n of names) {
    const i = norm.findIndex((h) => h === n.replace(/\s/g, '') || h.startsWith(n.replace(/\s/g, '')));
    if (i >= 0) return i;
  }
  return -1;
}

const toNum = (s: string | undefined) => {
  if (!s) return NaN;
  return Number(s.replace(/[,원$\s]/g, ''));
};

export interface CsvHoldingRow {
  code: string;
  name?: string;
  qty: number;
  avgCost: number;
  fxAtCost?: number;
  account?: string;
}

/**
 * 잔고 CSV 읽기: 머리줄(종목코드·수량·평균단가 등)을 찾아 줄마다 읽어요. 신한 등 증권사 파일의 열 이름이 조금씩 달라서
 * 여러 이름을 받아요. 국내 코드의 'A005930' 같은 앞 글자는 떼요
 */
export function parseHoldingsCsv(text: string): { rows: CsvHoldingRow[]; skipped: number; error?: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  let hi = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const h = splitCsvLine(lines[i]);
    if ((findCol(h, COLS.code) >= 0 || findCol(h, COLS.name) >= 0) && findCol(h, COLS.qty) >= 0) {
      hi = i;
      header = h;
      break;
    }
  }
  if (hi < 0) return { rows: [], skipped: 0, error: '머리줄(종목코드·수량 등)을 찾지 못했어요' };
  const c = { code: findCol(header, COLS.code), name: findCol(header, COLS.name), qty: findCol(header, COLS.qty), avg: findCol(header, COLS.avg), fx: findCol(header, COLS.fx), account: findCol(header, COLS.account) };
  const rows: CsvHoldingRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(hi + 1)) {
    const f = splitCsvLine(line);
    let code = c.code >= 0 ? (f[c.code] ?? '').trim() : '';
    if (/^[AQ]\d{6}$/.test(code)) code = code.slice(1);
    const qty = toNum(f[c.qty]);
    const avg = c.avg >= 0 ? toNum(f[c.avg]) : NaN;
    if ((!code && !(c.name >= 0 && f[c.name])) || !(qty > 0)) {
      skipped++;
      continue;
    }
    const fx = c.fx >= 0 ? toNum(f[c.fx]) : NaN;
    rows.push({ code, name: c.name >= 0 ? f[c.name] : undefined, qty, avgCost: Number.isFinite(avg) ? avg : 0, fxAtCost: fx > 0 ? fx : undefined, account: c.account >= 0 ? f[c.account] || undefined : undefined });
  }
  return { rows, skipped };
}
