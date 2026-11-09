// v0.6 WEIF 세계 지수선물: KOSPI200(최근 두 월물)·미니·코스닥150·KRX300·VKOSPI 선물의 시세, 베이시스, 이론가, 미결제약정,
// 고른 계약의 5호가. 주간·야간(KRX 야간 파생시장)을 장 구분과 함께 보여 줘요. 미국 지수선물은 CME 유료 시세라 넣지 않아요.

import { FUTURES_SESSION_LABEL, type FuturesBook, type FuturesResponse } from '@bt/shared';
import { dirClass } from '../format';
import { patchPanel, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';

const f2 = (v: number | undefined, d = 2) => (v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const int = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('en-US'));
const sg = (v: number | undefined, d = 2) => (v === undefined ? '—' : `${v > 0 ? '+' : ''}${f2(v, d)}`);

function Book({ code, label }: { code: string; label: string }) {
  const res = usePoll<FuturesBook>(`/api/futures/book?code=${encodeURIComponent(code)}`, 3_000);
  const b = res?.data;
  const maxQty = Math.max(1, ...(b?.asks ?? []).map((x) => x.qty), ...(b?.bids ?? []).map((x) => x.qty));
  return (
    <div className="weif-book">
      <div className="cb-sub">
        <b>{label}</b>
        <span className="label">{`5호가${b?.time ? ` · ${b.time.replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2:$3')}` : ''} · 3초마다`}</span>
      </div>
      {b?.error && <div className="label fx-warn">{b.error}</div>}
      {b && !b.error && (
        <table className="flow-table weif-book-t">
          <tbody>
            {[...b.asks].reverse().map((a, i) => (
              <tr key={`a${i}`}>
                <td className="weif-bar">
                  <span className="weif-ask" style={{ width: `${(a.qty / maxQty) * 100}%` }} />
                  {int(a.qty)}
                </td>
                <td className="down">{f2(a.price)}</td>
                <td />
              </tr>
            ))}
            {b.bids.map((x, i) => (
              <tr key={`b${i}`}>
                <td />
                <td className="up">{f2(x.price)}</td>
                <td className="weif-bar">
                  <span className="weif-bid" style={{ width: `${(x.qty / maxQty) * 100}%` }} />
                  {int(x.qty)}
                </td>
              </tr>
            ))}
            <tr className="label">
              <td>{`매도 ${int(b.totalAsk)}`}</td>
              <td>잔량</td>
              <td>{`매수 ${int(b.totalBid)}`}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Weif({ panel }: { panel: PanelState }) {
  const res = usePoll<FuturesResponse>('/api/futures', 5_000);
  const data = res?.data;
  const rows = data?.rows ?? [];
  const sel = rows.find((r) => r.contract.code === panel.weifCode) ?? rows.find((r) => r.last !== undefined) ?? rows[0];
  return (
    <>
      <TitleBar fn="WEIF" name="세계 지수선물" sub={data ? `국내 지수선물 · ${FUTURES_SESSION_LABEL[data.session]}` : undefined} fresh={data?.fresh} />
      <div className="pbody flow">
        {res?.error && !data && <div className="des-note err">{res.error}</div>}
        {data?.error && <div className="label fx-warn">{data.error}</div>}
        {!res && <div className="des-note label">받는 중…</div>}
        {rows.length > 0 && (
          <table className="flow-table weif">
            <thead>
              <tr>
                <th>계약</th>
                <th>현재가</th>
                <th>대비</th>
                <th>%</th>
                <th>기초 지수</th>
                <th>베이시스</th>
                <th>KIS 이론가</th>
                <th>괴리율</th>
                <th>단순 이론가</th>
                <th>거래량</th>
                <th>미결제</th>
                <th>증감</th>
                <th>잔존</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.contract.code} className={`click ${sel?.contract.code === r.contract.code ? 'sel' : ''}`} onClick={() => patchPanel(panel.id, { weifCode: r.contract.code })} title={`${r.contract.code} · 눌러서 호가 보기${r.error ? `\n${r.error}` : ''}`}>
                  <td>{r.label}</td>
                  <td>{f2(r.last)}</td>
                  <td className={dirClass(r.change)}>{sg(r.change)}</td>
                  <td className={dirClass(r.changePct)}>{r.changePct === undefined ? '—' : `${sg(r.changePct)}%`}</td>
                  <td>
                    {f2(r.spot)}
                    {r.spotChangePct !== undefined && <span className={`label ${dirClass(r.spotChangePct)}`}>{` ${sg(r.spotChangePct)}%`}</span>}
                  </td>
                  <td className={dirClass(r.basis)}>{sg(r.basis)}</td>
                  <td>{f2(r.theo)}</td>
                  <td>{r.disparity === undefined ? '—' : `${f2(r.disparity)}%`}</td>
                  <td>{f2(r.carry)}</td>
                  <td>{int(r.volume)}</td>
                  <td>{int(r.openInterest)}</td>
                  <td className={dirClass(r.oiChange)}>{r.oiChange === undefined ? '—' : `${r.oiChange > 0 ? '+' : ''}${int(r.oiChange)}`}</td>
                  <td className="label">{r.daysLeft === undefined ? '' : `${r.daysLeft}일`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {sel && !data?.error && <Book code={sel.contract.code} label={sel.label} />}
      </div>
      <div className="attr">
        {`한국투자증권 선물옵션 시세를 5초마다 받아요(조회). 주간 08:45~15:45, 야간 18:00~다음 날 06:00(KRX 야간 파생시장). 베이시스 = 선물 − 지수. 단순 이론가 = 지수 × (1 + CD91 × 잔존일/365)${data?.cd91 !== undefined ? `, CD91 ${data.cd91.toFixed(2)}%` : '(CD91은 ECOS 인증키)'}, 배당은 빼지 않아요. 미국 지수선물은 CME 유료 시세라 넣지 않아요`}
      </div>
    </>
  );
}
