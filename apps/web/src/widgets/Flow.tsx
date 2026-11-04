// v0.4 수급(08 §2.3): KINV 투자자별 매매동향, KPGM 프로그램 매매, KCRD 신용·대차 잔고, SI 공매도.
// 위는 작은 그림(투자자는 기간 누적 순매수 선, 나머지는 날마다 막대와 종가 선), 아래는 일별 표(최근 날짜가 위).

import { FLOW_COLUMNS, type FlowKind, type FlowResponse, type FlowRow } from '@bt/shared';
import { cumulative, flowCell } from './flowCalc';
import { dirClass, fmtPct } from '../format';
import { useInstrument } from '../stores/instruments';
import { patchPanel, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';

const REFRESH_MS = 5 * 60_000;

export const FLOW_FN: Record<string, { name: string; kinds: Array<{ kind: FlowKind; label: string }>; sub: string }> = {
  KINV: { name: '투자자별 매매동향', kinds: [{ kind: 'investor', label: '투자자' }], sub: '외국인·기관·개인 순매수' },
  KPGM: { name: '프로그램 매매', kinds: [{ kind: 'program', label: '프로그램' }], sub: '프로그램 순매수' },
  KCRD: {
    name: '신용·대차 잔고',
    kinds: [
      { kind: 'credit', label: '신용' },
      { kind: 'loan', label: '대차' },
    ],
    sub: '신용 융자·대주, 대차거래',
  },
  SI: { name: '공매도', kinds: [{ kind: 'short', label: '공매도' }], sub: '공매도 거래' },
};

const COLORS = ['var(--amber)', '#4fc3f7', '#c792ea'];

function FlowChart({ kind, rows }: { kind: FlowKind; rows: FlowRow[] }) {
  const W = 600;
  const H = 110;
  const cols = FLOW_COLUMNS[kind].filter((c) => c.bar);
  if (rows.length < 2 || cols.length === 0) return null;
  const n = rows.length;
  const x = (i: number) => (i / (n - 1)) * (W - 8) + 4;
  if (kind === 'investor') {
    const series = cols.map((c) => cumulative(rows, c.key));
    const all = series.flat().concat(0);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
    return (
      <div className="flow-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="3 3" />
          {series.map((s, k) => (
            <polyline key={k} fill="none" stroke={COLORS[k]} strokeWidth={1.6} vectorEffect="non-scaling-stroke" points={s.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          ))}
        </svg>
        <div className="flow-legend label">
          {`${n}일 누적 순매수 `}
          {cols.map((c, k) => (
            <span key={c.key} style={{ color: COLORS[k] }}>{`■ ${c.label} ${flowCell({ ...c, signed: true }, series[k][n - 1])}억 `}</span>
          ))}
        </div>
      </div>
    );
  }
  const c = cols[0];
  const asc = [...rows].reverse();
  const vals = asc.map((r) => r.values[c.key] ?? 0);
  const vmax = Math.max(...vals.map(Math.abs), 1);
  const signed = vals.some((v) => v < 0);
  const base = signed ? H / 2 : H - 4;
  const bw = Math.max(1, (W - 8) / n - 1);
  const closes = asc.map((r) => r.close).filter((v): v is number => v !== undefined);
  const clo = Math.min(...closes);
  const chi = Math.max(...closes);
  const cy = (v: number) => H - 6 - ((v - clo) / (chi - clo || 1)) * (H - 12);
  return (
    <div className="flow-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {vals.map((v, i) => {
          const h = (Math.abs(v) / vmax) * (signed ? H / 2 - 4 : H - 8);
          return <rect key={i} x={x(i) - bw / 2} y={v >= 0 ? base - h : base} width={bw} height={Math.max(0.5, h)} fill={signed ? (v >= 0 ? 'var(--up)' : 'var(--down)') : '#5a6b7d'} />;
        })}
        {closes.length > 1 && <polyline fill="none" stroke="var(--amber)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" points={asc.map((r, i) => (r.close !== undefined ? `${x(i)},${cy(r.close)}` : '')).join(' ')} />}
      </svg>
      <div className="flow-legend label">
        <span>{`막대: ${c.label}`}</span> <span style={{ color: 'var(--amber)' }}>— 종가</span>
      </div>
    </div>
  );
}

export function Flow({ panel }: { panel: PanelState }) {
  const fn = FLOW_FN[panel.fn ?? 'KINV'] ?? FLOW_FN.KINV;
  const inst = useInstrument(panel.securityId);
  const kind = fn.kinds.find((k) => k.kind === panel.flowKind)?.kind ?? fn.kinds[0].kind;
  const ok = inst?.assetClass === 'EQUITY' && (inst.market === 'KS' || inst.market === 'KQ');
  const res = usePoll<FlowResponse>(ok ? `/api/flows?id=${encodeURIComponent(inst!.id)}&kind=${kind}` : '', REFRESH_MS);
  const data = res?.data;
  const cols = FLOW_COLUMNS[kind];
  const tools =
    fn.kinds.length > 1 ? (
      <>
        {fn.kinds.map((k) => (
          <button key={k.kind} className={k.kind === kind ? 'on' : ''} onClick={() => patchPanel(panel.id, { flowKind: k.kind })}>
            {k.label}
          </button>
        ))}
      </>
    ) : undefined;
  if (!inst || !ok) {
    return (
      <>
        <TitleBar fn={panel.fn ?? 'KINV'} name={fn.name} tools={tools} />
        <div className="empty-body">
          <div>{inst ? '수급 표는 국내 주식만 볼 수 있어요' : '종목이 필요해요'}</div>
          <div className="label">{`예: 005930 ${panel.fn ?? 'KINV'} ⏎`}</div>
        </div>
      </>
    );
  }
  const name = inst.nameKo || inst.code;
  return (
    <>
      <TitleBar fn={panel.fn ?? 'KINV'} name={fn.name} sub={`${name} ${inst.code}`} fresh={data?.fresh} inst={inst} tools={tools} />
      <div className="pbody flow">
        {!res && <div className="empty-body label">불러오는 중…</div>}
        {res?.error && !data && <div className="empty-body err">{res.error}</div>}
        {data && data.rows.length === 0 && <div className="empty-body label">받은 줄이 없어요</div>}
        {data && data.rows.length > 0 && (
          <>
            <FlowChart kind={kind} rows={data.rows} />
            <table className="flow-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>종가</th>
                  <th>등락</th>
                  {cols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date.slice(5).replace('-', '/')}</td>
                    <td className="num">{r.close?.toLocaleString('en-US') ?? '—'}</td>
                    <td className={`num ${dirClass(r.changePct)}`}>{fmtPct(r.changePct)}</td>
                    {cols.map((c) => {
                      const v = r.values[c.key];
                      return (
                        <td key={c.key} className={`num ${c.signed ? dirClass(v) : ''}`}>
                          {flowCell(c, v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="attr">한국투자증권 · 금액은 억 원(평균가는 원) · {kind === 'investor' ? '기관은 기관계 합' : kind === 'short' ? '공매도 잔고는 따로 공표돼서 여기엔 거래만 있어요' : '일별'}</div>
          </>
        )}
      </div>
    </>
  );
}
