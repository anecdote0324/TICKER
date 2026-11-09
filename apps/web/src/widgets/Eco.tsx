// ECO 경제 캘린더(03 v0.3, v0.6 한국·예상 칸): 지난 2주와 앞으로 30일의 미국·한국 지표 발표(한국 시간), 최근 값·이전 값,
// 사용자가 넣는 예상 값, 한국 주요 지표의 최근 값.
// 시각: BEA·국가데이터처는 원천이 준 시각, FRED·한국은행은 날짜만 줘서 관례 시각(*), 그 밖에는 '시각 미상'.

import { useState } from 'react';
import type { EcoEvent, EcoResponse } from '@bt/shared';
import { formatHm, formatYmd } from '@bt/shared';
import { useNow } from '../hooks/useNow';
import { patchPanel, type PanelState } from '../stores/panels';
import { appState, updateState } from '../stores/state';
import { useStore } from '../stores/store';
import { TitleBar, usePoll } from './common';
import { openEcod } from './MacroViews';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const SOURCE_LABEL: Record<EcoEvent['source'], string> = { BEA: 'BEA', FRED: 'FRED', MODS: '데이터처', BOK: '한은' };

function when(e: EcoEvent) {
  const ymd = formatYmd(e.at);
  const d = new Date(`${ymd}T00:00:00Z`);
  const date = `${ymd.slice(5).replace('-', '/')}(${DOW[d.getUTCDay()]})`;
  const time = e.time === 'none' ? '시각 미상' : `${formatHm(e.at)}${e.time === 'usual' ? '*' : ''}`;
  return { ymd, date, time };
}

function ExpectCell({ id }: { id: string }) {
  const value = useStore(appState).ecoExpect?.[id] ?? '';
  const [edit, setEdit] = useState(false);
  const save = (v: string) => {
    updateState('ecoExpect', (m) => {
      const next = { ...(m ?? {}) };
      if (v.trim()) next[id] = v.trim().slice(0, 24);
      else delete next[id];
      return next;
    });
    setEdit(false);
  };
  if (edit)
    return (
      <input
        className="eco-expect"
        autoFocus
        defaultValue={value}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEdit(false);
        }}
      />
    );
  return (
    <button className="linkish eco-expect-btn" title="눌러서 예상 값 넣기" onClick={() => setEdit(true)}>
      {value || '＋'}
    </button>
  );
}

export function Eco({ panel }: { panel: PanelState }) {
  const country = panel.ecoCountry ?? 'ALL';
  const res = usePoll<EcoResponse>('/api/eco', 60 * 60_000);
  const now = useNow(60_000);
  const data = res?.data;
  const events = (data?.events ?? []).filter((e) => country === 'ALL' || e.country === country);
  const nextIdx = events.findIndex((e) => e.at >= now);
  const today = formatYmd(now);
  const tools = (
    <>
      {(['ALL', 'US', 'KR'] as const).map((c) => (
        <button key={c} className={c === country ? 'on' : ''} onClick={() => patchPanel(panel.id, { ecoCountry: c })}>
          {c === 'ALL' ? '전체' : c === 'US' ? '미국' : '한국'}
        </button>
      ))}
    </>
  );
  return (
    <>
      <TitleBar fn="ECO" name="경제 캘린더" sub="지표 발표(한국 시간) · 한국 주요 지표" fresh={data?.fresh} attribution={data?.fresh.source === 'FRED' ? 'FRED · 세인트루이스 연준' : undefined} tools={tools} />
      <div className="pbody eco">
        {!res && <div className="empty-body label">불러오는 중…</div>}
        {res?.error && !data && <div className="empty-body err">{res.error}</div>}
        {(data?.missing ?? []).map((m) => (
          <div key={m.what} className="gc-note label">
            {m.what}: {m.reason}
          </div>
        ))}
        {data && (
          <div className="eco-cols">
            <table className="eco-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>시각</th>
                  <th />
                  <th>지표</th>
                  <th>최근 값</th>
                  <th>이전</th>
                  <th>예상</th>
                  <th>출처</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => {
                  const w = when(e);
                  const prevDay = i > 0 ? when(events[i - 1]).ymd : '';
                  return [
                    i === nextIdx && (
                      <tr key="now" className="eco-now">
                        <td colSpan={8}>지금 {formatHm(now)}</td>
                      </tr>
                    ),
                    <tr key={e.id} className={`${e.at < now ? 'past' : ''} ${w.ymd === today ? 'today' : ''}`}>
                      <td className="num">{w.ymd !== prevDay ? w.date : ''}</td>
                      <td className="num">{w.time}</td>
                      <td>{e.country === 'US' ? '미국' : '한국'}</td>
                      <td title={e.seriesId ? `${e.sourceName} · 눌러서 지표 상세(ECOD)` : e.sourceName} className={e.seriesId ? 'eco-link' : undefined} onClick={e.seriesId ? () => openEcod(panel.id, e.seriesId!) : undefined}>
                        {e.name}
                      </td>
                      <td className="num">{e.latest ? `${e.latest}${e.period ? ` (${e.period})` : ''}` : ''}</td>
                      <td className="num">{e.previous ?? ''}</td>
                      <td className="num">
                        <ExpectCell id={e.id} />
                      </td>
                      <td className="label">{SOURCE_LABEL[e.source]}</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
            {data.korea.length > 0 && country !== 'US' && (
              <table className="eco-table eco-kr">
                <thead>
                  <tr>
                    <th>한국 주요 지표</th>
                    <th>최근 값</th>
                    <th>기간</th>
                  </tr>
                </thead>
                <tbody>
                  {data.korea.map((k) => (
                    <tr key={k.name}>
                      <td title={k.group}>{k.name}</td>
                      <td className="num">
                        {Number(k.value).toLocaleString('en-US', { maximumFractionDigits: 2 })} <span className="label">{k.unit}</span>
                      </td>
                      <td className="num label">{k.cycle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        <div className="attr">
          * 관례 시각(FRED·한국은행은 날짜만 줘요). 최근 값은 그 지표 시계열의 가장 최근 값이라, 발표 전 줄의 최근 값은 지난 발표 값이에요. 예상 칸은 눌러서 직접 넣어요(이 컴퓨터에 저장). 이름을 누르면 지표 상세(ECOD). 한국 일정은 국가데이터처 보도계획·한국은행
          통계공표일정. BLS 공표일정은 자동 요청을 막아서 쓰지 않아요.
        </div>
      </div>
    </>
  );
}
