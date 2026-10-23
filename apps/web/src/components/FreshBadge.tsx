// 신선도 배지(02): 실시간이 아닌 값에는 빠짐없이 붙여요. 배지가 없으면 실시간이에요.
// 도움 수준과 상관없이 늘 보이고, 설정으로 끌 수 없어요.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { computeBadge, freshnessDetail, type Freshness, type Instrument } from '@bt/shared';
import { useNow } from '../hooks/useNow';
import { feedStatus } from '../stores/feed';
import { useStore } from '../stores/store';
import { sessionOpen, sourceConnected } from '../session';

interface Props {
  fresh: Freshness | undefined;
  inst?: Instrument;
  variant?: 'long' | 'short';
  /** 출처 표시가 의무인 데이터의 문구 */
  attribution?: string;
}

export function FreshBadge({ fresh, inst, variant = 'long', attribution }: Props) {
  const now = useNow(1000);
  const sources = useStore(feedStatus, (s) => s.sources);
  const [tip, setTip] = useState<{ x: number; y: number; doc: Document } | null>(null);
  if (!fresh) return null;
  const badge = computeBadge(fresh, {
    now,
    sourceConnected: sourceConnected(sources, fresh.source),
    sessionOpen: sessionOpen(inst, now),
  });
  if (!badge) return null;
  const text = variant === 'long' ? badge.long : badge.short;
  if (!text) return null;
  const rows = freshnessDetail(fresh, now);
  if (attribution) rows.push(['출처 표시', attribution]);
  return (
    <>
      <span
        className={`fb ${variant === 'short' ? 'short' : ''} ${badge.inverted ? 'inv' : ''}`}
        onMouseEnter={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setTip({ x: r.left, y: r.bottom + 4, doc: e.currentTarget.ownerDocument });
        }}
        onMouseLeave={() => setTip(null)}
        aria-label={`${text} · ${rows.map((r) => r.join(' ')).join(', ')}`}
      >
        {text}
      </span>
      {tip &&
        createPortal(
          <dl className="tip" style={{ left: Math.min(tip.x, (tip.doc.defaultView?.innerWidth ?? 1200) - 260), top: tip.y }}>
            {rows.map(([k, v]) => (
              <FragmentRow key={k} k={k} v={v} />
            ))}
          </dl>,
          tip.doc.body,
        )}
    </>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
