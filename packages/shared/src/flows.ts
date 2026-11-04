// v0.4 수급(08 §2.3): KINV 투자자별 매매동향, KPGM 프로그램 매매, KCRD 신용·대차 잔고, SI 공매도, KWRN 시장경보·VI.
// 한국투자증권 국내 조회의 일별 표를 같은 모양(날짜·종가·칸들)으로 주고, 화면은 칸 정의대로 그려요.

import type { Freshness } from './freshness';

export type FlowKind = 'investor' | 'program' | 'credit' | 'loan' | 'short';

/** 칸 단위: 주(수량), 원(금액, 서버가 원 단위로 맞춰 줘요), %(비율) */
export type FlowUnit = 'shares' | 'krw' | 'pct';

export interface FlowColumn {
  key: string;
  label: string;
  unit: FlowUnit;
  /** 순매수처럼 +·−가 뜻이 있는 칸(등락 색) */
  signed?: boolean;
  /** 막대로 함께 보여 줄 칸 */
  bar?: boolean;
}

export interface FlowRow {
  /** YYYY-MM-DD */
  date: string;
  close?: number;
  changePct?: number;
  values: Record<string, number | undefined>;
}

export interface FlowResponse {
  id: string;
  kind: FlowKind;
  /** 최근 날짜가 먼저 */
  rows: FlowRow[];
  fresh: Freshness;
  note?: string;
}

/** 표 칸 정의(화면과 서버가 함께 써요) */
export const FLOW_COLUMNS: Record<FlowKind, FlowColumn[]> = {
  investor: [
    { key: 'frgnAmt', label: '외국인', unit: 'krw', signed: true, bar: true },
    { key: 'orgnAmt', label: '기관', unit: 'krw', signed: true, bar: true },
    { key: 'prsnAmt', label: '개인', unit: 'krw', signed: true, bar: true },
    { key: 'frgnQty', label: '외국인(주)', unit: 'shares', signed: true },
    { key: 'orgnQty', label: '기관(주)', unit: 'shares', signed: true },
    { key: 'prsnQty', label: '개인(주)', unit: 'shares', signed: true },
  ],
  program: [
    { key: 'netAmt', label: '순매수', unit: 'krw', signed: true, bar: true },
    { key: 'buyAmt', label: '매수', unit: 'krw' },
    { key: 'sellAmt', label: '매도', unit: 'krw' },
    { key: 'netQty', label: '순매수(주)', unit: 'shares', signed: true },
    { key: 'turnoverShare', label: '거래대금 대비', unit: 'pct', signed: true },
  ],
  credit: [
    { key: 'loanBal', label: '융자 잔고(주)', unit: 'shares', bar: true },
    { key: 'loanAmt', label: '융자 잔고', unit: 'krw' },
    { key: 'loanRate', label: '잔고율', unit: 'pct' },
    { key: 'loanNew', label: '신규(주)', unit: 'shares' },
    { key: 'loanRepay', label: '상환(주)', unit: 'shares' },
    { key: 'stlnBal', label: '대주 잔고(주)', unit: 'shares' },
  ],
  loan: [
    { key: 'balance', label: '대차 잔고(주)', unit: 'shares', bar: true },
    { key: 'balanceAmt', label: '잔고 금액', unit: 'krw' },
    { key: 'change', label: '증감(주)', unit: 'shares', signed: true },
    { key: 'newQty', label: '체결(주)', unit: 'shares' },
    { key: 'repayQty', label: '상환(주)', unit: 'shares' },
  ],
  short: [
    { key: 'qty', label: '공매도(주)', unit: 'shares', bar: true },
    { key: 'qtyShare', label: '거래량 비중', unit: 'pct' },
    { key: 'amt', label: '공매도 금액', unit: 'krw' },
    { key: 'amtShare', label: '금액 비중', unit: 'pct' },
    { key: 'avgPrice', label: '평균가', unit: 'krw' },
  ],
};

/**
 * 원천 금액 칸의 단위를 원으로 맞출 배수. 한국투자증권 일별 표의 거래대금 단위(원·천 원·백만 원)가 조회마다 달라서,
 * 수량 × 종가(원)와 견줘 가장 가까운 10의 거듭제곱(1, 1e3, 1e6)을 골라요. 견줄 줄이 없으면 1
 */
export function amountScale(samples: Array<{ amt: number | undefined; qty: number | undefined; price: number | undefined }>): number {
  const ratios: number[] = [];
  for (const s of samples) {
    if (!s.amt || !s.qty || !s.price) continue;
    const won = Math.abs(s.qty) * s.price;
    const r = won / Math.abs(s.amt);
    if (Number.isFinite(r) && r > 0) ratios.push(r);
  }
  if (!ratios.length) return 1;
  ratios.sort((a, b) => a - b);
  const mid = ratios[Math.floor(ratios.length / 2)];
  const best = [1, 1e3, 1e6].reduce((b, c) => (Math.abs(Math.log10(mid / c)) < Math.abs(Math.log10(mid / b)) ? c : b), 1);
  return best;
}

/** KWRN: 종목 경보와 시장의 VI 발동 목록 */
export interface ViRow {
  code: string;
  name: string;
  /** 'HH:MM:SS' */
  time: string;
  releaseTime?: string;
  kind: string;
  price?: number;
  /** 발동 기준가 대비 괴리율(%) */
  gap?: number;
  count?: number;
}

export interface WarningsResponse {
  id?: string;
  /** 종목 경보: 투자주의·투자경고·투자위험·관리종목·거래정지·단기과열·정리매매·투자유의 */
  warnings?: string[];
  /** 종목 VI 상태(발동 중이면 종류) */
  vi?: string;
  /** 오늘 VI 발동 목록(시장 전체, 최근 먼저) */
  viList: ViRow[];
  fresh: Freshness;
  error?: string;
}
