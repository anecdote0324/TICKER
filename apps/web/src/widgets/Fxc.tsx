// FXC 환율 매트릭스: 각 칸은 왼쪽(행) 통화 1단위가 위쪽(열) 통화로 얼마인지 보여 줘요. 셀 배경은 등락 색(02).
// 교차 환율은 두 원화 환율로 계산해서, 신선도는 두 입력 중 늦은 쪽을 따라가요.
// 한국투자증권 키가 있으면 10초마다 받은 환율, 없으면 ECB 기준환율(하루 한 번)이에요(04 환율).
// 칸을 누르면 같은 연동 그룹(색)의 패널이 그 환율로 바뀌어요(v0.2, MON 행과 같아요). 그 방향의 환율 종목이 없으면
// 뒤집은 쌍으로 열어요(KRW 행·USD 열 → 원/달러 USDKRW).

import { useState } from 'react';
import { FX_CURRENCIES, fxPairFor, slowestFreshness, type Quote } from '@bt/shared';
import { useQuotes } from '../stores/feed';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { TitleBar } from './common';

const KRW_PAIR = (c: string) => (c === 'KRW' ? undefined : `CUR:${c}KRW`);

export function Fxc({ panel }: { panel: PanelState }) {
  /** 마지막으로 누른 칸('USD|JPY') */
  const [sel, setSel] = useState<string | null>(null);
  const pick = (row: string, col: string) => {
    const hit = fxPairFor(row, col);
    if (!hit) return;
    setSel(`${row}|${col}`);
    setPanelSecurity(panel.id, `CUR:${hit.pair.code}`);
  };
  const ids = FX_CURRENCIES.map(KRW_PAIR).filter((x): x is string => !!x);
  const quotes = useQuotes(ids);
  const rate = (c: string): { v?: number; pct?: number; q?: Quote } => {
    if (c === 'KRW') return { v: 1, pct: 0 };
    const q = quotes.get(`CUR:${c}KRW`);
    return { v: q?.last, pct: q?.changePct, q };
  };
  const fresh = slowestFreshness([...quotes.values()].map((q) => q.fresh));
  // ECB 값이 하나라도 섞여 있으면 출처 표시를 붙여요
  const ecb = [...quotes.values()].some((q) => q.fresh.source === 'ECB');
  const kis = [...quotes.values()].some((q) => q.fresh.source === 'KIS');
  const source = kis && ecb ? '한국투자증권(10초 간격 조회), 일부 ECB 기준환율(Frankfurter)' : kis ? '한국투자증권(10초 간격 조회)' : 'ECB 기준환율(Frankfurter, 하루 한 번). 한국투자증권 키를 넣으면 10초마다 받아요';
  return (
    <>
      <TitleBar fn="FXC" name="환율 매트릭스" fresh={fresh} attribution={ecb ? 'ECB 기준환율 · Frankfurter' : undefined} />
      <div className="pbody">
        <table className="fxc">
          <thead>
            <tr>
              <th />
              {FX_CURRENCIES.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FX_CURRENCIES.map((row) => (
              <tr key={row}>
                <th className="rowh">{row}</th>
                {FX_CURRENCIES.map((col) => {
                  if (row === col) return <td key={col} className="diag">—</td>;
                  const a = rate(row);
                  const b = rate(col);
                  if (a.v === undefined || b.v === undefined) return <td key={col}>—</td>;
                  const v = a.v / b.v;
                  const pct = (1 + (a.pct ?? 0) / 100) / (1 + (b.pct ?? 0) / 100) * 100 - 100;
                  const alpha = Math.min(0.55, Math.abs(pct) / 1.2 + 0.08);
                  const bg = pct > 0.0005 ? `color-mix(in srgb, var(--up) ${Math.round(alpha * 100)}%, #0a0a0a)` : pct < -0.0005 ? `color-mix(in srgb, var(--down) ${Math.round(alpha * 100)}%, #0a0a0a)` : '#141414';
                  const hit = fxPairFor(row, col);
                  const tip = `${row}/${col} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%${hit ? ` · 누르면 연동 그룹 차트가 ${hit.pair.nameKo}(${hit.pair.code})로 바뀌어요` : ''}`;
                  return (
                    <td key={col} className={`pick ${sel === `${row}|${col}` ? 'sel' : ''}`} style={{ background: bg }} title={tip} onClick={() => pick(row, col)}>
                      {v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(5)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="attr">원화 외환시장은 다음 날 02:00까지 열려요. 기준 시각은 배지에 마우스를 올려 확인해요. 환율 출처: {source}</div>
      </div>
    </>
  );
}
