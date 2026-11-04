// 위젯 공통 부품: 제목 줄(패널 2줄), 시세 행, 틱 플래시

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Freshness, Instrument, Quote } from '@bt/shared';
import { FreshBadge } from '../components/FreshBadge';
import { Sparkline } from '../components/Sparkline';
import { api } from '../api';
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
  /** 줄 오른쪽 끝에 겹쳐 보이는 단추(마우스를 올리거나 고른 줄에서만, MON의 ✕ 빼기) */
  actions?: ReactNode;
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
      {props.actions && <span className="row-act">{props.actions}</span>}
    </div>
  );
}

/** 경로를 주기마다 다시 받아요(HMAP·GC 등). 다시 받다 실패하면 앞 값을 그대로 둬요 */
export function usePoll<T>(path: string, ms: number): { key: string; data?: T; error?: string } | undefined {
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    // 빈 경로면 받지 않아요(종목이 없을 때 등)
    if (!path) return;
    let alive = true;
    const load = () =>
      api
        .get<T>(path)
        .then((data) => alive && setState({ key: path, data }))
        .catch((e: Error) => alive && setState((s) => (s?.key === path && s.data ? s : { key: path, error: e.message })));
    void load();
    const t = window.setInterval(load, ms);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [path, ms]);
  return state?.key === path ? state : undefined;
}
