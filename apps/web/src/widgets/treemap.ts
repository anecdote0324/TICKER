// IMAP 타일 배치: 넓이가 값(시가총액)에 비례하고 정사각형에 가깝게(squarified treemap, Bruls 외 2000).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 값이 큰 것부터 넣으면 정사각형에 가까워요. 돌려주는 사각형은 들어온 순서와 같아요 */
export function squarify(values: number[], box: Rect): Rect[] {
  const out: Rect[] = new Array(values.length);
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const scale = (box.w * box.h) / total;
  const order = values.map((v, i) => ({ i, a: Math.max(0, v) * scale })).sort((p, q) => q.a - p.a);
  let rect = { ...box };
  let row: typeof order = [];
  // 한 줄(짧은 변을 따라)의 가장 나쁜 가로세로 비
  const worst = (r: typeof order, side: number) => {
    const s = r.reduce((t, x) => t + x.a, 0);
    if (s === 0) return Infinity;
    let max = 0;
    let min = Infinity;
    for (const x of r) {
      max = Math.max(max, x.a);
      min = Math.min(min, x.a);
    }
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * Math.max(min, 1e-9)));
  };
  const layRow = (r: typeof order) => {
    const s = r.reduce((t, x) => t + x.a, 0);
    const horizontal = rect.w >= rect.h; // 넓으면 왼쪽에 세로 띠, 높으면 위에 가로 띠
    if (horizontal) {
      const w = rect.h > 0 ? s / rect.h : 0;
      let y = rect.y;
      for (const x of r) {
        const h = w > 0 ? x.a / w : 0;
        out[x.i] = { x: rect.x, y, w, h };
        y += h;
      }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      const h = rect.w > 0 ? s / rect.w : 0;
      let x0 = rect.x;
      for (const x of r) {
        const w = h > 0 ? x.a / h : 0;
        out[x.i] = { x: x0, y: rect.y, w, h };
        x0 += w;
      }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }
  };
  for (const item of order) {
    const side = Math.min(rect.w, rect.h);
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) row.push(item);
    else {
      layRow(row);
      row = [item];
    }
  }
  if (row.length) layRow(row);
  return out;
}
