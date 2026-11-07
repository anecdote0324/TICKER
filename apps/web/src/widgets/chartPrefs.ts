// v0.5 차트 설정: TDEF 기본값(새 GP·G 패널의 지표·표시 모드·기간), G 템플릿, 종목별 그림(추세선·수평선·피보나치).
// 앱 상태 'chart'(데이터 폴더의 state-chart.json)에 둬요.

export type ChartStyle = 'candle' | 'bar' | 'line';

export const CHART_STYLES: Array<{ code: ChartStyle; label: string; desc: string }> = [
  { code: 'candle', label: '캔들', desc: '캔들(몸통과 꼬리). GPC와 같아요' },
  { code: 'bar', label: '바', desc: '바(시가 왼쪽, 종가 오른쪽 눈금). GPO와 같아요' },
  { code: 'line', label: '선', desc: '종가 선' },
];

export type DrawingKind = 'trend' | 'hline' | 'fib';

export interface ChartPoint {
  /** 봉 시각(초) */
  t: number;
  /** 가격 */
  p: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  p1: ChartPoint;
  /** 추세선·피보나치의 두 번째 점(수평선은 없어요) */
  p2?: ChartPoint;
}

export interface ChartTemplate {
  name: string;
  indicators: string[];
  style: ChartStyle;
}

export interface ChartPrefs {
  defaults: { indicators: string[]; style: ChartStyle; range: string };
  templates: ChartTemplate[];
  /** 종목 id → 그림 */
  drawings: Record<string, Drawing[]>;
}

export const DEFAULT_CHART_PREFS: ChartPrefs = {
  defaults: { indicators: ['ma20', 'ma60'], style: 'candle', range: '3M' },
  templates: [],
  drawings: {},
};

/** 피보나치 되돌림 비율 */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** 두 점 사이 피보나치 가격(첫 점이 0%, 둘째 점이 100%) */
export function fibPrices(a: number, b: number): Array<{ level: number; price: number }> {
  return FIB_LEVELS.map((level) => ({ level, price: a + (b - a) * level }));
}

/** GPO·GPC로 열면 표시 모드를 바꿔요 */
export function styleForAlias(via: string | undefined): ChartStyle | undefined {
  return via === 'GPO' ? 'bar' : via === 'GPC' ? 'candle' : undefined;
}
