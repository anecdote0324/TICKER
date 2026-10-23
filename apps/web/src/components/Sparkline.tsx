// 스파크라인: 숫자와 추세를 한 줄에서(02). v0.1은 SVG로 그려요.

import { useEffect, useState } from 'react';
import { getSpark } from '../stores/bars';

export function Sparkline({ id, width = 52, height = 16 }: { id: string; width?: number; height?: number }) {
  const [closes, setCloses] = useState<number[] | null>(null);
  useEffect(() => {
    let alive = true;
    getSpark(id).then((c) => alive && setCloses(c), () => alive && setCloses([]));
    return () => {
      alive = false;
    };
  }, [id]);
  if (!closes || closes.length < 2) return <svg width={width} height={height} className="spark" aria-hidden="true" />;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const d = closes
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${((i / (closes.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 1 - ((c - min) / span) * (height - 2)).toFixed(1)}`)
    .join('');
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
