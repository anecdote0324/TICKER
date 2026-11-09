// GP·G 그리기 도구(v0.5, v0.6에서 트레이딩뷰처럼): 추세선·수평선·피보나치 되돌림·박스를 차트 위에 그려요.
// 주 시리즈(캔들·바·선)에 붙여서 그 가격 축으로 좌표를 구해요. 시각 → 가로 좌표는 차트의 봉 간격으로 늘려서,
// 마지막 봉 오른쪽(빈 곳)에도 점을 찍을 수 있어요(TimeMapper).
// 고른 그림은 손잡이를 보여 주고, 그리는 중인 그림(첫 점을 찍고 마우스를 따라 늘었다 줄었다)도 같은 모양으로 그려요.

import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { extendsRight, fibPrices, type ChartPoint, type Drawing, type DrawingColor } from './chartPrefs';

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** 시각(초) ↔ 가로 좌표. 봉이 없는 곳(오른쪽 빈 곳)은 봉 간격으로 늘려요 */
export interface TimeMapper {
  toX(t: number): number | null;
  fromX(x: number): number | null;
}

/** 손잡이: p1·p2는 두 점, p12는 (p1의 시각, p2의 가격), p21은 (p2의 시각, p1의 가격) 모서리(박스) */
export type HandlePart = 'p1' | 'p2' | 'p12' | 'p21';
export type HitPart = HandlePart | 'body';

/** 두 점을 지나는 직선을 화면 오른쪽 끝까지 늘린 끝점 */
export function extendRay(x1: number, y1: number, x2: number, y2: number, width: number): [number, number] {
  if (x2 === x1) return [x2, y2];
  const slope = (y2 - y1) / (x2 - x1);
  const xe = x2 >= x1 ? width : 0;
  return [xe, y2 + slope * (xe - x2)];
}

/** 점에서 선분까지 거리(픽셀) */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const u = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
  return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
}

/** 손잡이를 끌었을 때 바뀐 그림. 손잡이의 가로는 그 점의 시각, 세로는 그 점의 가격을 바꿔요 */
export function moveHandle(d: Drawing, part: HitPart, pt: ChartPoint, start: ChartPoint): Drawing {
  if (part === 'body') {
    const dt = pt.t - start.t;
    const dp = pt.p - start.p;
    const sh = (q: ChartPoint): ChartPoint => ({ t: q.t + dt, p: q.p + dp });
    return { ...d, p1: sh(d.p1), p2: d.p2 ? sh(d.p2) : undefined };
  }
  if (!d.p2) return { ...d, p1: { ...d.p1, p: pt.p } };
  const xOwner = part === 'p1' || part === 'p12' ? 'p1' : 'p2';
  const yOwner = part === 'p1' || part === 'p21' ? 'p1' : 'p2';
  const next = { ...d, p1: { ...d.p1 }, p2: { ...d.p2 } };
  next[xOwner].t = pt.t;
  next[yOwner].p = pt.p;
  return next;
}

export interface DrawColors {
  accent: string;
  up: string;
  down: string;
}

const HANDLE_R = 6;
const LINE_TOL = 5;

export class ChartDrawings implements ISeriesPrimitive<Time> {
  private items: Drawing[] = [];
  /** 그리는 중인 그림(마우스를 따라 움직여요) */
  private draft: Drawing | null = null;
  private selected: string | null = null;
  private hovered: string | null = null;
  private param: SeriesAttachedParameter<Time> | null = null;
  private mapper: TimeMapper | null = null;
  private colors: DrawColors;
  constructor(accent: string) {
    this.colors = { accent, up: '#1FBF3F', down: '#E8203C' };
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.param = param;
  }

  detached() {
    this.param = null;
  }

  private update() {
    this.param?.requestUpdate();
  }

  setItems(items: Drawing[]) {
    this.items = items;
    this.update();
  }

  setDraft(d: Drawing | null) {
    this.draft = d;
    this.update();
  }

  setSelected(id: string | null) {
    this.selected = id;
    this.update();
  }

  setHovered(id: string | null) {
    if (this.hovered === id) return;
    this.hovered = id;
    this.update();
  }

  setMapper(m: TimeMapper) {
    this.mapper = m;
    this.update();
  }

  setColors(c: Partial<DrawColors>) {
    this.colors = { ...this.colors, ...c };
    this.update();
  }

  /** 예전 이름(강조 색만 바꾸기) */
  setColor(color: string) {
    this.setColors({ accent: color });
  }

  colorOf(c: DrawingColor | undefined): string {
    return this.colors[c ?? 'accent'];
  }

  private xy(pt: ChartPoint): [number, number] | null {
    const p = this.param;
    if (!p) return null;
    const x = this.mapper ? this.mapper.toX(pt.t) : p.chart.timeScale().timeToCoordinate(pt.t as Time);
    const y = p.series.priceToCoordinate(pt.p);
    return x === null || y === null ? null : [x, y];
  }

  /** 손잡이 자리(픽셀) */
  private handles(d: Drawing): Array<[HandlePart, number, number]> {
    const a = this.xy(d.p1);
    if (!a) return [];
    if (!d.p2) return [['p1', a[0], a[1]]];
    const b = this.xy(d.p2);
    if (!b) return [['p1', a[0], a[1]]];
    const out: Array<[HandlePart, number, number]> = [
      ['p1', a[0], a[1]],
      ['p2', b[0], b[1]],
    ];
    if (d.kind === 'box') out.push(['p12', a[0], b[1]], ['p21', b[0], a[1]]);
    return out;
  }

  /** 픽셀 자리에 있는 그림과 부분. 고른 그림의 손잡이가 먼저, 그다음 위에 그린 것부터 */
  hitAt(x: number, y: number): { id: string; part: HitPart } | null {
    const p = this.param;
    if (!p) return null;
    const width = p.chart.timeScale().width();
    const sel = this.items.find((d) => d.id === this.selected);
    if (sel) for (const [part, hx, hy] of this.handles(sel)) if (Math.hypot(x - hx, y - hy) <= HANDLE_R + 2) return { id: sel.id, part };
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      if (this.bodyHit(d, x, y, width)) return { id: d.id, part: 'body' };
    }
    return null;
  }

  private bodyHit(d: Drawing, x: number, y: number, width: number): boolean {
    const p = this.param!;
    if (d.kind === 'hline') {
      const yy = p.series.priceToCoordinate(d.p1.p);
      return yy !== null && Math.abs(y - yy) <= LINE_TOL;
    }
    if (!d.p2) return false;
    const a = this.xy(d.p1);
    const b = this.xy(d.p2);
    if (!a || !b) return false;
    if (d.kind === 'trend') {
      const end = extendsRight(d) ? extendRay(a[0], a[1], b[0], b[1], width) : b;
      return distToSegment(x, y, a[0], a[1], end[0], end[1]) <= LINE_TOL;
    }
    if (d.kind === 'box') {
      const x1 = Math.min(a[0], b[0]);
      const x2 = extendsRight(d) ? width : Math.max(a[0], b[0]);
      const y1 = Math.min(a[1], b[1]);
      const y2 = Math.max(a[1], b[1]);
      return x >= x1 - LINE_TOL && x <= x2 + LINE_TOL && y >= y1 - LINE_TOL && y <= y2 + LINE_TOL;
    }
    // 피보나치: 줄 하나 위나 두 점을 잇는 대각선 위
    const x0 = Math.min(a[0], b[0]);
    if (x < x0 - LINE_TOL) return false;
    for (const f of fibPrices(d.p1.p, d.p2.p)) {
      const yy = p.series.priceToCoordinate(f.price);
      if (yy !== null && Math.abs(y - yy) <= LINE_TOL) return true;
    }
    return distToSegment(x, y, a[0], a[1], b[0], b[1]) <= LINE_TOL;
  }

  paneViews(): IPrimitivePaneView[] {
    return [{ zOrder: () => 'top', renderer: () => ({ draw: (target: Target) => this.draw(target) }) }];
  }

  private draw(target: Target) {
    const p = this.param;
    if (!p) return;
    const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toPrecision(5));
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.font = '10px IBM Plex Mono, monospace';
      const list = this.draft ? [...this.items, this.draft] : this.items;
      for (const d of list) {
        const isSel = d === this.draft || d.id === this.selected;
        const color = this.colorOf(d.color);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = isSel || d.id === this.hovered ? 2 : 1;
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        if (d.kind === 'hline') {
          const y = p.series.priceToCoordinate(d.p1.p);
          if (y === null) continue;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(mediaSize.width, y);
          ctx.stroke();
          ctx.fillText(fmt(d.p1.p), 4, y - 3);
        } else if (d.p2) {
          const a = this.xy(d.p1);
          const b = this.xy(d.p2);
          if (!a || !b) continue;
          if (d.kind === 'trend') {
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
            if (extendsRight(d)) {
              const [xe, ye] = extendRay(a[0], a[1], b[0], b[1], mediaSize.width);
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(b[0], b[1]);
              ctx.lineTo(xe, ye);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          } else if (d.kind === 'box') {
            const x1 = Math.min(a[0], b[0]);
            const x2 = extendsRight(d) ? mediaSize.width : Math.max(a[0], b[0]);
            const y1 = Math.min(a[1], b[1]);
            const y2 = Math.max(a[1], b[1]);
            ctx.globalAlpha = 0.18;
            ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
            ctx.globalAlpha = 1;
            ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1);
            const hi = Math.max(d.p1.p, d.p2.p);
            const lo = Math.min(d.p1.p, d.p2.p);
            if (y2 - y1 >= 14) {
              ctx.textAlign = 'right';
              ctx.fillText(fmt(hi), x2 - 3, y1 + 10);
              ctx.fillText(fmt(lo), x2 - 3, y2 - 3);
              ctx.textAlign = 'left';
            }
          } else {
            // 피보나치: 첫 점(0%)과 둘째 점(100%) 사이 비율마다 가로줄, 두 점은 점선으로 이어요
            const x0 = Math.min(a[0], b[0]);
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
            ctx.globalAlpha = 0.6;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.setLineDash([]);
          }
        }
        // 고른 그림(그리는 중 포함)은 손잡이를 보여 줘요
        if (isSel) {
          ctx.lineWidth = 1.5;
          for (const [, hx, hy] of this.handles(d)) {
            ctx.beginPath();
            ctx.arc(hx, hy, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#000000';
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.stroke();
          }
        }
      }
    });
  }
}
