// 앱 상태: 명령 기록, 사용 점수, 기억된 선택, 겹침 기본값, 관심종목, 화면 배치.
// 서버(메인 프로세스)만 파일에 써요. 여러 창이 동시에 써서 기록이 사라지는 일을 막아요(05 §14.2).

import { DEFAULT_CHART_PREFS, type ChartPrefs } from '../widgets/chartPrefs';
import type { AlertsState, AssetClass, Holding, SovereignRating } from '@bt/shared';
import { api } from '../api';
import { createStore } from './store';

export interface WatchGroup {
  id: string;
  name: string;
  ids: string[];
}

/** 이름을 붙여 저장한 워크스페이스(data는 App의 SavedWorkspace) */
export interface NamedWorkspace {
  name: string;
  savedAt: number;
  data: unknown;
}

export interface AppState {
  /** 명령 기록(표준형, 최신순) */
  history: Array<{ cmd: string; panel: string; at: number }>;
  /** 종목별 사용 시각(최근 20번) */
  usage: Record<string, number[]>;
  /** 자산군별 기능 사용 횟수 */
  fnUsage: Partial<Record<AssetClass, Record<string, number>>>;
  /** 검색어 → 고른 줄 id(↺) */
  remembered: Record<string, string>;
  /** 겹침 코드 → 종목 id, 그리고 같은 줄을 고른 횟수 */
  defaults: { chosen: Record<string, string>; picks: Record<string, Record<string, number>> };
  watchlists: WatchGroup[];
  workspace: unknown;
  workspaces: NamedWorkspace[];
  tips: { counts: Record<string, number>; directRuns: number; standardAsked: boolean; hidden: string[] };
  /** 사용자 별칭(ALIAS, v0.2): 별칭(aliasKey) → 종목 */
  aliases: Array<{ name: string; id: string; at: number }>;
  /** PORT 보유 종목(v0.3) */
  portfolio: Holding[];
  /** ALRT 알림 규칙과 최근 알림(v0.3) */
  alerts: AlertsState;
  /** 차트 기본값·템플릿·그림(v0.5, TDEF·G·드로잉) */
  chart: ChartPrefs;
  /** FAVE 즐겨찾기(v0.5): 명령 줄 */
  favorites: Favorite[];
  /** CSDR 국가 신용등급(v0.6): 사용자가 고친 등급(나라 코드 → 등급) */
  ratings: Record<string, SovereignRating>;
  /** ECO 예상 칸(v0.6): 발표 id → 사용자가 넣은 예상 */
  ecoExpect: Record<string, string>;
  /** ECST 내 통계(v0.6): ECOF에서 더한 FRED 시계열과 KOSIS 주소 */
  macroCustom: MacroCustom[];
  /** CIX 수식 티커(v0.6) */
  cix: Array<{ id: string; name: string; formula: string }>;
}

/** ECST 내 통계 한 줄 */
export interface MacroCustom {
  id: string;
  name: string;
  /** KOSIS OpenAPI 주소(인증키 없이). 없으면 id가 FRED:… */
  kosisUrl?: string;
}

/** FAVE 즐겨찾기 한 줄: 커맨드 라인에 그대로 칠 수 있는 명령 */
export interface Favorite {
  id: string;
  command: string;
  /** 화면에 보이는 이름(종목 이름·기능 이름) */
  label: string;
  at: number;
}

export const DEFAULT_WATCHLISTS: WatchGroup[] = [
  { id: 'kr', name: '국내', ids: ['EQ:KS:005930', 'EQ:KS:000660', 'EQ:KS:373220', 'EQ:KS:207940', 'EQ:KS:005380', 'EQ:KS:035420', 'EQ:KS:035720', 'EQ:KS:069500'] },
  { id: 'us', name: '미국', ids: ['EQ:US:AAPL', 'EQ:US:NVDA', 'EQ:US:MSFT', 'EQ:US:TSLA', 'EQ:US:AMZN', 'EQ:US:GOOGL', 'EQ:US:META', 'EQ:US:QQQ'] },
  { id: 'crypto', name: '코인', ids: ['CRY:BTC', 'CRY:ETH', 'CRY:XRP', 'CRY:SOL', 'CRY:BNB', 'CRY:DOGE'] },
  { id: 'fx', name: '환율·지수', ids: ['CUR:USDKRW', 'CUR:JPYKRW', 'CUR:EURKRW', 'IDX:KOSPI', 'IDX:KOSDAQ', 'IDX:SPX', 'IDX:CCMP'] },
];

const DEFAULT: AppState = {
  history: [],
  usage: {},
  fnUsage: {},
  remembered: {},
  defaults: { chosen: {}, picks: {} },
  watchlists: DEFAULT_WATCHLISTS,
  workspace: null,
  workspaces: [],
  tips: { counts: {}, directRuns: 0, standardAsked: false, hidden: [] },
  aliases: [],
  portfolio: [],
  alerts: { rules: [], log: [] },
  chart: DEFAULT_CHART_PREFS,
  favorites: [],
  ratings: {},
  ecoExpect: {},
  macroCustom: [],
  cix: [],
};

export const appState = createStore<AppState>(DEFAULT);

const KEYS: Array<keyof AppState> = ['history', 'usage', 'fnUsage', 'remembered', 'defaults', 'watchlists', 'workspace', 'workspaces', 'tips', 'aliases', 'portfolio', 'alerts', 'chart', 'favorites', 'ratings', 'ecoExpect', 'macroCustom', 'cix'];

export async function loadAppState() {
  const next: AppState = { ...DEFAULT };
  await Promise.all(
    KEYS.map(async (k) => {
      try {
        const r = await api.get<{ value: unknown }>(`/api/state/${k}`);
        if (r.value !== null && r.value !== undefined) (next as unknown as Record<string, unknown>)[k] = r.value;
      } catch {
        // 기본값
      }
    }),
  );
  appState.set(next);
}

const timers = new Map<string, number>();

/** 상태를 바꾸고 잠시 뒤에 저장해요 */
export function updateState<K extends keyof AppState>(key: K, fn: (prev: AppState[K]) => AppState[K]) {
  appState.set((s) => ({ ...s, [key]: fn(s[key]) }));
  window.clearTimeout(timers.get(key));
  timers.set(
    key,
    window.setTimeout(() => {
      void api.put(`/api/state/${key}`, { value: appState.get()[key] }).catch(() => undefined);
    }, 400),
  );
}

/** 사용 점수 0~1: 최근 20번 각각에 0.5^(지난 날수 ÷ 7)을 더한 값(05 §6.6) */
export function usageScore(id: string): number {
  const list = appState.get().usage[id];
  if (!list) return 0;
  const now = Date.now();
  let s = 0;
  for (const t of list) s += Math.pow(0.5, (now - t) / (7 * 86400_000));
  return Math.min(1, s / 5);
}

export function recordUsage(id: string, fn: string | undefined, asset: AssetClass | undefined) {
  updateState('usage', (u) => ({ ...u, [id]: [Date.now(), ...(u[id] ?? [])].slice(0, 20) }));
  if (fn && asset) {
    updateState('fnUsage', (u) => {
      const m = { ...(u[asset] ?? {}) };
      m[fn] = (m[fn] ?? 0) + 1;
      return { ...u, [asset]: m };
    });
  }
}

/** 별칭 만들기(같은 이름이면 바꿔요) */
export function setAlias(name: string, id: string) {
  updateState('aliases', (a) => [{ name, id, at: Date.now() }, ...(a ?? []).filter((x) => x.name !== name)]);
}

export function removeAlias(name: string) {
  updateState('aliases', (a) => (a ?? []).filter((x) => x.name !== name));
}

export function recordHistory(cmd: string, panel: string) {
  updateState('history', (h) => [{ cmd, panel, at: Date.now() }, ...h.filter((x) => !(x.cmd === cmd && x.panel === panel))].slice(0, 500));
}
