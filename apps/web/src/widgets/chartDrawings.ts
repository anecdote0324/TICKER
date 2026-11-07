// GP·G 그리기 도구(v0.5): 추세선·수평선·피보나치 되돌림을 차트 위에 그려요.
// 주 시리즈(캔들·바·선)에 붙여서 그 가격 축으로 좌표를 구하고, 그리는 중인 첫 점(미리 보기)도 보여 줘요.

import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from 'lightweight-charts';
import { fibPrices, type ChartPoint, type Drawing } from './chartPrefs';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** 두 점을 지나는 직선을 화면 오른쪽 끝까지 늘린 끝점(추세선은 두 번째 점 너머로 이어 그려요) */
export function extendRay(x1: number, y1: number, x2: number, y2: number, width: number): [number, number] {
  if (x2 === x1) return [x2, y2];
  const slope = (y2 - y1) / (x2 - x1);
  const xe = x2 >= x1 ? width : 0;
  return [xe, y2 + slope * (xe - x2)];
}

export class ChartDrawings implements ISeriesPrimitive<Time> {
  private items: Drawing[] = [];
  /** 그리는 중인 첫 점 */
  private pending: ChartPoint | null = null;
  private param: SeriesAttachedParameter<Time> | null = null;
  constructor(private color: string) {}

  attached(param: SeriesAttachedParameter<Time>) {
    this.param = param;
  }

  detached() {
    this.param = null;
  }

  setItems(items: Drawing[]) {
    this.items = items;
    this.param?.requestUpdate();
  }

  setPending(p: ChartPoint | null) {
    this.pending = p;
    this.param?.requestUpdate();
  }

  setColor(color: string) {
    this.color = color;
    this.param?.requestUpdate();
  }

  paneViews(): IPrimitivePaneView[] {
    return [{ zOrder: () => 'top', renderer: () => ({ draw: (target: Target) => this.draw(target) }) }];
  }

  private draw(target: Target) {
    const p = this.param;
    if (!p) return;
    const ts = p.chart.timeScale();
    const xy = (pt: ChartPoint): [number, number] | null => {
      const x = ts.timeToCoordinate(pt.t as UTCTimestamp);
      const y = p.series.priceToCoordinate(pt.p);
      return x === null || y === null ? null : [x, y];
    };
    const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toPrecision(5));
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.lineWidth = 1;
      ctx.font = '10px IBM Plex Mono, monospace';
      for (const d of this.items) {
        ctx.strokeStyle = this.color;
        ctx.fillStyle = this.color;
        ctx.setLineDash([]);
        if (d.kind === 'hline') {
          const y = p.series.priceToCoordinate(d.p1.p);
          if (y === null) continue;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(mediaSize.width, y);
          ctx.stroke();
          ctx.fillText(fmt(d.p1.p), 4, y - 3);
          continue;
        }
        if (!d.p2) continue;
        const a = xy(d.p1);
        const b = xy(d.p2);
        if (d.kind === 'trend') {
          if (!a || !b) continue;
          const [xe, ye] = extendRay(a[0], a[1], b[0], b[1], mediaSize.width);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(b[0], b[1]);
          ctx.lineTo(xe, ye);
          ctx.stroke();
          ctx.setLineDash([]);
          for (const [x, y] of [a, b]) ctx.fillRect(x - 2, y - 2, 4, 4);
        } else {
          // 피보나치: 첫 점(0%)과 둘째 점(100%) 사이 비율마다 가로줄
          const x0 = Math.min(a?.[0] ?? 0, b?.[0] ?? 0);
          for (const f of fibPrices(d.p1.p, d.p2.p)) {
            const y = p.series.priceToCoordinate(f.price);
            if (y === null) continue;
            ctx.globalAlpha = f.level === 0 || f.level === 1 ? 1 : 0.7;
            ctx.setLineDash(f.level === 0.5 ? [4, 3] : []);
            ctx.beginPath();
            ctx.moveTo(Math.max(0, x0), y);
            ctx.lineTo(mediaSize.width, y);
            ctx.stroke();
            ctx.fillText(`${(f.level * 100).toFixed(1)}% ${fmt(f.price)}`, Math.max(2, x0) + 2, y - 3);
          }
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        }
      }
      if (this.pending) {
        const a = xy(this.pending);
        if (a) {
          ctx.fillStyle = this.color;
          ctx.beginPath();
          ctx.arc(a[0], a[1], 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }
}
