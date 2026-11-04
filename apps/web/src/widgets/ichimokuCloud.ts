// 일목균형표의 구름(선행스팬 1과 2 사이)을 칠하는 차트 그리기 도구(02 차트, v0.2).
// 선행스팬 1 시리즈에 붙여서 그 시리즈의 가격 축으로 좌표를 구해요. 스팬 1이 위면 상승 색(초록), 아래면 하락 색(분홍)이고,
// 두 선이 엇갈리는 곳은 만나는 점에서 나눠 칠해요. 캔들 뒤(맨 아래 층)에 그려요.

import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from 'lightweight-charts';

export interface CloudPoint {
  t: number;
  a: number;
  b: number;
}

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** 두 선 사이 구간들(엇갈리는 점에서 나눠요). 화면 좌표 계산과 떼어 테스트해요 */
export function cloudSegments(pts: Array<{ x: number; ya: number; yb: number }>): Array<{ up: boolean; poly: Array<[number, number]> }> {
  const out: Array<{ up: boolean; poly: Array<[number, number]> }> = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    // 화면 좌표는 위가 작아요: ya < yb 이면 스팬 1이 위(상승 구름)
    const d0 = p.yb - p.ya;
    const d1 = q.yb - q.ya;
    if ((d0 >= 0 && d1 >= 0) || (d0 <= 0 && d1 <= 0)) {
      out.push({ up: d0 + d1 >= 0, poly: [[p.x, p.ya], [q.x, q.ya], [q.x, q.yb], [p.x, p.yb]] });
      continue;
    }
    // 엇갈림: 만나는 점에서 둘로 나눠요
    const r = d0 / (d0 - d1);
    const x = p.x + (q.x - p.x) * r;
    const y = p.ya + (q.ya - p.ya) * r;
    out.push({ up: d0 > 0, poly: [[p.x, p.ya], [x, y], [p.x, p.yb]] });
    out.push({ up: d1 > 0, poly: [[x, y], [q.x, q.ya], [q.x, q.yb]] });
  }
  return out;
}

export class IchimokuCloud implements ISeriesPrimitive<Time> {
  private data: CloudPoint[] = [];
  private param: SeriesAttachedParameter<Time> | null = null;
  constructor(private colors: { up: string; down: string }) {}

  attached(param: SeriesAttachedParameter<Time>) {
    this.param = param;
  }

  detached() {
    this.param = null;
  }

  setData(data: CloudPoint[]) {
    this.data = data;
    this.param?.requestUpdate();
  }

  setColors(colors: { up: string; down: string }) {
    this.colors = colors;
    this.param?.requestUpdate();
  }

  paneViews(): IPrimitivePaneView[] {
    return [{ zOrder: () => 'bottom', renderer: () => ({ draw: (target: Target) => this.draw(target) }) }];
  }

  private draw(target: Target) {
    const p = this.param;
    if (!p || this.data.length < 2) return;
    const ts = p.chart.timeScale();
    const pts: Array<{ x: number; ya: number; yb: number }> = [];
    for (const d of this.data) {
      const x = ts.timeToCoordinate(d.t as UTCTimestamp);
      const ya = p.series.priceToCoordinate(d.a);
      const yb = p.series.priceToCoordinate(d.b);
      if (x === null || ya === null || yb === null) continue;
      pts.push({ x, ya, yb });
    }
    if (pts.length < 2) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const s of cloudSegments(pts)) {
        // 화면 밖 구간은 건너뛰어요
        if (s.poly.every(([x]) => x < 0) || s.poly.every(([x]) => x > mediaSize.width)) continue;
        ctx.fillStyle = s.up ? this.colors.up : this.colors.down;
        ctx.beginPath();
        s.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
      }
    });
  }
}
