// KWRN 시장경보·VI(08 §2.3, v0.4, 블룸버그 코드 아님): 위는 종목의 경보(투자주의·경고·위험, 관리종목, 거래정지, 단기과열 등),
// 아래는 오늘 VI 발동 목록(시장 전체, 최근 먼저). 종목 없이 열면 목록만. 줄을 누르면 연동 그룹이 그 종목으로 바뀌어요.

import type { WarningsResponse } from '@bt/shared';
import { getInstrument, useInstrument } from '../stores/instruments';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';

const REFRESH_MS = 30_000;

export function Kwrn({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  const kr = inst && (inst.market === 'KS' || inst.market === 'KQ') && inst.assetClass === 'EQUITY' ? inst : undefined;
  const res = usePoll<WarningsResponse>(`/api/warnings${kr ? `?id=${encodeURIComponent(kr.id)}` : ''}`, REFRESH_MS);
  const data = res?.data;
  const active = data?.viList.filter((v) => !v.releaseTime).length ?? 0;
  return (
    <>
      <TitleBar fn="KWRN" name="시장경보·VI" sub={kr ? `${kr.nameKo || kr.code} ${kr.code}` : '오늘 VI 발동'} fresh={data?.fresh} inst={kr} />
      <div className="pbody kwrn">
        {kr && data && (
          <div className="kwrn-mine">
            <span className="label">종목 경보</span>
            {data.warnings && data.warnings.length > 0 ? data.warnings.map((w) => <span key={w} className="kwrn-tag">{w}</span>) : <span className="label">{data.warnings ? '없음' : '—'}</span>}
            {data.vi && <span className="kwrn-tag vi">{data.vi}</span>}
          </div>
        )}
        {!res && <div className="empty-body label">불러오는 중…</div>}
        {res?.error && !data && <div className="empty-body err">{res.error}</div>}
        {data?.error && <div className="kwrn-err err">{data.error}</div>}
        {data && (
          <>
            <div className="label kwrn-sum">{`오늘 VI 발동 ${data.viList.length}건 · 발동 중 ${active}건`}</div>
            <table className="flow-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th style={{ textAlign: 'left' }}>종목</th>
                  <th>종류</th>
                  <th>발동가</th>
                  <th>괴리율</th>
                  <th>해제</th>
                  <th>횟수</th>
                </tr>
              </thead>
              <tbody>
                {data.viList.map((v, i) => {
                  const id = getInstrument(`EQ:KS:${v.code}`)?.id ?? getInstrument(`EQ:KQ:${v.code}`)?.id;
                  return (
                    <tr key={`${v.code}-${v.time}-${i}`} className={id ? 'click' : ''} onClick={() => id && setPanelSecurity(panel.id, id)}>
                      <td>{v.time}</td>
                      <td style={{ textAlign: 'left', color: 'var(--value)' }}>{`${v.name} `}<span className="label">{v.code}</span></td>
                      <td>{v.kind}</td>
                      <td className="num">{v.price?.toLocaleString('en-US') ?? '—'}</td>
                      <td className={`num ${v.gap && v.gap > 0 ? 'up' : v.gap && v.gap < 0 ? 'down' : ''}`}>{v.gap !== undefined ? `${v.gap > 0 ? '+' : ''}${v.gap.toFixed(2)}%` : '—'}</td>
                      <td>{v.releaseTime ?? <span className="kwrn-tag vi">발동 중</span>}</td>
                      <td className="num">{v.count ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="attr">한국투자증권 변동성완화장치(VI) 현황·주식현재가 시세 · 30초마다 · 정적 VI는 기준가 대비 ±10%(코스피200 ±3%), 동적 VI는 직전 체결가 대비 급변</div>
          </>
        )}
      </div>
    </>
  );
}
