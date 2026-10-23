// 위젯 공통 부품: 제목 줄(패널 2줄), 시세 행, 틱 플래시

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Freshness, Instrument, Quote } from '@bt/shared';
import { FreshBadge } from '../components/FreshBadge';
import { Sparkline } from '../components/Sparkline';
import { arrow, dirClass, fmtPct, fmtPrice } from '../format';

export function TitleBar(props: { fn: string; name: ReactNode; sub?: ReactNode; fresh?: Freshness; inst?: Instrument; attribution?: string; tools?: ReactNode }) {
  return (
    <div className="ptitle">
      <span className="fn">{props.fn}</span>
      <span className="name">{props.name}</span>
      {props.sub && <span className="sub">{props.sub}</span>}
      <span className="grow" />
      <FreshBadge fresh={props.fresh} inst={props.inst} attribution={props.attribution} />
      {props.tools && <div className="ptools">{props.tools}</div>}
    </div>
  );
}

/** 값이 바뀌면 셀 배경이 0.3초 동안 등락 색으로 반짝여요(02 틱 플래시). 실시간·주기 조회 값만 */
export function useFlash(value: number | undefined, mode: string | undefined): string {
  const prev = useRef<number | undefined>(value);
  const [cls, setCls] = useState('');
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p === undefined || value === undefined || p === value) return;
    if (mode !== 'realtime' && mode !== 'poll' && mode !== 'demo') return;
    setCls(value > p ? 'flash-up' : 'flash-down');
    const t = window.setTimeout(() => setCls(''), 320);
    return () => window.clearTimeout(t);
  }, [value, mode]);
  return cls;
}

export function QuoteRow(props: {
  inst: Instrument;
  quote: Quote | undefined;
  selected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  spark?: boolean;
  extra?: ReactNode;
  badgeCol?: boolean;
}) {
  const { inst, quote: q } = props;
  const flash = useFlash(q?.last, q?.fresh.mode);
  const name = inst.nameKo ?? inst.nameEn ?? inst.code;
  return (
    <div className={`row ${props.selected ? 'sel' : ''}`} onClick={props.onClick} onDoubleClick={props.onDoubleClick} role="row">
      <span className="nm">
        <span>{name}</span>
        <span className="cd">{inst.code}</span>
      </span>
      <span className={`num ${flash}`} style={{ width: 84, color: 'var(--value-hi)', fontWeight: 500 }}>
        {fmtPrice(inst, q?.last)}
      </span>
      <span className={`num ${dirClass(q?.changePct)}`} style={{ width: 70 }}>
        {arrow(q?.changePct)}
        {q?.changePct !== undefined ? fmtPct(Math.abs(q.changePct)).replace('+', '') : '—'}
      </span>
      {props.extra}
      {props.badgeCol !== false && (
        <span style={{ width: 34, textAlign: 'right' }}>
          <FreshBadge fresh={q?.fresh} inst={inst} variant="short" />
        </span>
      )}
      {props.spark !== false && <Sparkline id={inst.id} />}
    </div>
  );
}
