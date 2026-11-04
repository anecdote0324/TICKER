// FA 재무제표(03 v0.3): 손익·재무상태·현금흐름과 비율을 기간별 표로. 연간(6년)·분기(8분기), 최근 기간이 오른쪽이에요.
// 국내는 DART(원, 표는 억 원), 미국은 SEC EDGAR(달러, 표는 백만 달러).

import { FIN_LINES, FIN_RATIOS, finRatios, type FinancialsResponse } from '@bt/shared';
import { dirClass } from '../format';
import { useInstrument } from '../stores/instruments';
import { patchPanel, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';

const SECTIONS = [
  { key: 'is', title: '손익' },
  { key: 'bs', title: '재무상태' },
  { key: 'cf', title: '현금흐름' },
] as const;

export function Fa({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const kind = panel.faPeriod ?? 'annual';
  const ok = inst?.assetClass === 'EQUITY';
  const res = usePoll<FinancialsResponse>(ok ? `/api/financials?id=${encodeURIComponent(inst!.id)}&period=${kind}` : '', 6 * 3600_000);
  const data = res?.data;
  const name = inst ? inst.nameKo || inst.nameEn || inst.code : '';
  const tools = (
    <>
      {(['annual', 'quarter'] as const).map((k) => (
        <button key={k} className={kind === k ? 'on' : ''} onClick={() => patchPanel(panel.id, { faPeriod: k })}>
          {k === 'annual' ? '연간' : '분기'}
        </button>
      ))}
    </>
  );
  if (!inst || !ok) {
    return (
      <>
        <TitleBar fn="FA" name="재무제표" />
        <div className="empty-body">
          <div>{inst ? '재무제표는 주식만 볼 수 있어요' : '종목이 필요해요'}</div>
          <div className="label">예: 005930 FA ⏎ · AAPL US FA ⏎</div>
        </div>
      </>
    );
  }
  const usd = data?.currency === 'USD';
  const unit = usd ? 1e6 : 1e8;
  const amount = (v: number | null | undefined) => (v == null ? '—' : Math.round(v / unit).toLocaleString('en-US'));
  const ratios = data ? finRatios(data) : null;
  return (
    <>
      <TitleBar fn="FA" name="재무제표" sub={`${name} ${inst.code}`} fresh={data?.fresh} inst={inst} tools={tools} />
      <div className="pbody fa">
        {!res && <div className="empty-body label">불러오는 중…</div>}
        {res?.error && !data && <div className="empty-body err">{res.error}</div>}
        {data && ratios && (
          <>
            <div className="fa-note label">
              {data.source === 'DART' ? 'DART' : 'SEC EDGAR'} · {data.basis} · 단위 {usd ? '백만 달러' : '억 원'}
              {data.note ? ` · ${data.note}` : ''}
            </div>
            <table className="fa-table">
              <thead>
                <tr>
                  <th />
                  {data.periods.map((p) => (
                    <th key={p.key}>{p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((s) => {
                  const lines = FIN_LINES.filter((l) => l.section === s.key && data.values[l.id]?.some((v) => v != null));
                  if (!lines.length) return null;
                  return [
                    <tr key={s.key} className="fa-grp">
                      <td colSpan={data.periods.length + 1}>{s.title}</td>
                    </tr>,
                    ...lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.label}</td>
                        {data.values[l.id]!.map((v, i) => (
                          <td key={i} className={`num ${v != null && v < 0 ? 'down' : ''}`}>
                            {amount(v)}
                          </td>
                        ))}
                      </tr>
                    )),
                  ];
                })}
                <tr className="fa-grp">
                  <td colSpan={data.periods.length + 1}>비율</td>
                </tr>
                {FIN_RATIOS.filter((r) => ratios[r.id].some((v) => v != null)).map((r) => (
                  <tr key={r.id}>
                    <td title={r.label}>{r.label.replace(/\(.*\)/, '')}</td>
                    {ratios[r.id].map((v, i) => (
                      <td key={i} className={`num ${r.id === 'revenueGrowth' || r.id === 'fcf' ? dirClass(v ?? undefined) : v != null && v < 0 ? 'down' : ''}`}>
                        {v == null ? '—' : r.unit === '%' ? `${v.toFixed(1)}%` : amount(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {kind === 'quarter' && <div className="fa-note label">분기 ROE·ROA는 그 분기 이익 그대로예요(연환산하지 않아요). 성장률은 전년 같은 분기와 비교해요.</div>}
          </>
        )}
      </div>
    </>
  );
}
