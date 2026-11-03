// MOST 상위 종목(03 v0.2): 시장 하나(코스피·코스닥·미국·코인)의 거래량·거래대금·상승률·하락률 상위 30.
// 시장은 커맨드 라인 인자(MOST KQ)나 위의 시장 버튼으로, 종류는 탭으로 골라요. 줄을 누르면 연동 그룹이 그 종목으로 바뀌어요.

import { useEffect, useState } from 'react';
import { MOST_KINDS, MOST_MARKETS, type MostKind, type MostResponse } from '@bt/shared';
import { api } from '../api';
import { arrow, dirClass, fmtBig, fmtNum, fmtPct } from '../format';
import { patchPanel, setPanelSecurity, type PanelState } from '../stores/panels';
import { getInstrument } from '../stores/instruments';
import { TitleBar } from './common';

const REFRESH_MS = 30_000;

/** 배지가 장 상태(마감 등)를 알 수 있게 시장의 대표 지수를 넘겨요 */
const MARKET_INDEX: Record<string, string> = { KS: 'IDX:KOSPI', KQ: 'IDX:KOSDAQ', US: 'IDX:SPX' };

/** 패널의 시장: 인자가 있으면 인자, 없으면 띄운 종목의 시장, 그것도 없으면 코스피 */
function marketOf(panel: PanelState): string {
  const a = panel.args?.[0];
  if (a && MOST_MARKETS.some((m) => m.code === a)) return a;
  const inst = getInstrument(panel.securityId);
  if (inst?.assetClass === 'CRYPTO') return 'CRYPTO';
  if (inst?.market) return inst.market;
  return MOST_MARKETS[0].code;
}

export function Most({ panel }: { panel: PanelState }) {
  const market = marketOf(panel);
  const kind: MostKind = panel.mostKind ?? 'volume';
  const [state, setState] = useState<{ key: string; data?: MostResponse; error?: string } | null>(null);
  const key = `${market}:${kind}`;
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<MostResponse>(`/api/most?market=${market}&kind=${kind}`)
        .then((data) => alive && setState({ key, data }))
        .catch((e: Error) => alive && setState((s) => (s?.key === key && s.data ? s : { key, error: e.message })));
    void load();
    const t = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [market, kind, key]);
  // 시장·종류를 바꾸면 앞 표를 보여 주지 않아요
  const cur = state?.key === key ? state : undefined;
  const data = cur?.data;
  const label = MOST_MARKETS.find((m) => m.code === market)?.label ?? market;
  const pickMarket = (code: string) => patchPanel(panel.id, { args: [code] });
  const priceDigits = (v: number) => (data?.currency === 'KRW' ? 0 : v >= 100 ? 2 : v >= 1 ? 3 : 5);
  return (
    <>
      <TitleBar
        fn="MOST"
        name="상위 종목"
        sub={label}
        fresh={data?.fresh}
        inst={getInstrument(MARKET_INDEX[market])}
        tools={
          <>
            {MOST_MARKETS.map((m) => (
              <button key={m.code} className={m.code === market ? 'on' : ''} onClick={() => pickMarket(m.code)} title={`MOST ${m.code}`}>
                {m.label}
              </button>
            ))}
          </>
        }
      />
      <div className="most-tabs">
        {MOST_KINDS.map((k) => (
          <button key={k.code} className={k.code === kind ? 'on' : ''} onClick={() => patchPanel(panel.id, { mostKind: k.code })}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="pbody">
        <div className="thead">
          <span style={{ width: 22, textAlign: 'right' }}>#</span>
          <span style={{ flex: 1 }}>종목</span>
          <span style={{ width: 84, textAlign: 'right' }}>현재가</span>
          <span style={{ width: 64, textAlign: 'right' }}>등락률</span>
          <span className="col-vol" style={{ width: 84, textAlign: 'right' }}>
            거래량
          </span>
          <span style={{ width: 70, textAlign: 'right' }}>거래대금</span>
        </div>
        {!cur && <div className="des-note label">불러오는 중…</div>}
        {cur?.error && !data && <div className="des-note err">{cur.error}</div>}
        {data?.rows.map((r) => (
          <div key={r.code} className={`row ${r.id ? '' : 'nolink'}`} onClick={() => r.id && setPanelSecurity(panel.id, r.id)} title={r.id ? '누르면 연동 그룹이 이 종목으로 바뀌어요' : '종목 목록에 없는 종목이에요'}>
            <span className="num label" style={{ width: 22 }}>
              {r.rank}
            </span>
            <span className="nm">
              <span>{r.name}</span>
              <span className="cd">{r.code}</span>
            </span>
            <span className="num" style={{ width: 84, color: 'var(--value-hi)' }}>
              {r.last.toLocaleString('en-US', { minimumFractionDigits: priceDigits(r.last), maximumFractionDigits: priceDigits(r.last) })}
            </span>
            <span className={`num ${dirClass(r.changePct)}`} style={{ width: 64 }}>
              {arrow(r.changePct)}
              {fmtPct(Math.abs(r.changePct)).replace('+', '')}
            </span>
            <span className="num col-vol" style={{ width: 84 }}>
              {r.volume !== undefined ? (r.volume >= 1e6 ? `${fmtNum(r.volume / 1e6, 2)}M` : Math.round(r.volume).toLocaleString('en-US')) : '—'}
            </span>
            <span className="num" style={{ width: 70 }}>
              {fmtBig(r.turnover, data.currency === 'USDT' ? 'USD' : data.currency)}
            </span>
          </div>
        ))}
        {data && data.rows.length === 0 && <div className="des-note label">순위가 비어 있어요(장 시작 전이거나 휴장일일 수 있어요)</div>}
        {data?.note && <div className="des-note label">{data.note}</div>}
      </div>
    </>
  );
}
