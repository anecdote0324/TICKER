// 성능 측정(05 §14.1): 키 하나당 해석 시간, 16ms(한 프레임)를 넘긴 입력 이벤트(Event Timing API).
// 설정 → 정보의 '성능'에서 봐요. 실제 기기에서 목표를 넘는지 확인하는 데 써요.

const MAX = 500;
const analyzeMs: number[] = [];

/** 커맨드 라인 해석 한 번에 걸린 시간을 남겨요 */
export function recordAnalyze(ms: number) {
  analyzeMs.push(ms);
  if (analyzeMs.length > MAX) analyzeMs.shift();
}

function pct(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function analyzeStats() {
  const s = [...analyzeMs].sort((a, b) => a - b);
  return { count: s.length, p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s[s.length - 1] ?? 0 };
}

/** 한 프레임(16ms)을 넘긴 키·입력 이벤트. 차트가 움직이는 동안 타자가 밀리는지 봐요 */
export const slowInputs = { count: 0, worst: 0, observed: false };

export function startInputObserver() {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('event')) return;
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'compositionupdate', 'pointerdown', 'click'].includes(e.name)) continue;
        if (e.duration > 16) {
          slowInputs.count++;
          slowInputs.worst = Math.max(slowInputs.worst, e.duration);
        }
      }
    });
    po.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    slowInputs.observed = true;
  } catch {
    // Event Timing을 못 쓰는 환경
  }
}
