// ECO 경제 캘린더(03 v0.3): 지난 2주와 앞으로 30일의 미국 지표 발표(한국 시간), 최근 값·이전 값, 한국 주요 지표의 최근 값.
// 시각: BEA는 원천이 준 시각, FRED는 날짜만 줘서 관례 시각(*), 그 밖에는 '시각 미상'.

import type { EcoEvent, EcoResponse } from '@bt/shared';
import { formatHm, formatYmd } from '@bt/shared';
import { useNow } from '../hooks/useNow';
import type { PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function when(e: EcoEvent) {
  const ymd = formatYmd(e.at);
  const d = new Date(`${ymd}T00:00:00Z`);
  const date = `${ymd.slice(5).replace('-', '/')}(${DOW[d.getUTCDay()]})`;
  const time = e.time === 'none' ? '시각 미상' : `${formatHm(e.at)}${e.time === 'usual' ? '*' : ''}`;
  return { ymd, date, time };
}

export function Eco({ panel }: { panel: PanelState }) {
  void panel;
  const res = usePoll<EcoResponse>('/api/eco', 60 * 60_000);
  const now = useNow(60_000);
  const data = res?.data;
  const events = data?.events ?? [];
  const nextIdx = events.findIndex((e) => e.at >= now);
  const today = formatYmd(now);
  return (
    <>
      <TitleBar fn="ECO" name="경제 캘린더" sub="미국 지표 발표(한국 시간) · 한국 주요 지표" fresh={data?.fresh} attribution={data?.fresh.source === 'FRED' ? 'FRED · 세인트루이스 연준' : undefined} />
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
                        <td colSpan={7}>지금 {formatHm(now)}</td>
                      </tr>
                    ),
                    <tr key={e.id} className={`${e.at < now ? 'past' : ''} ${w.ymd === today ? 'today' : ''}`}>
                      <td className="num">{w.ymd !== prevDay ? w.date : ''}</td>
                      <td className="num">{w.time}</td>
                      <td>{e.country === 'US' ? '미국' : '한국'}</td>
                      <td title={e.sourceName}>{e.name}</td>
                      <td className="num">{e.latest ? `${e.latest}${e.period ? ` (${e.period})` : ''}` : ''}</td>
                      <td className="num">{e.previous ?? ''}</td>
                      <td className="label">{e.source}</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
            {data.korea.length > 0 && (
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
        <div className="attr">* 관례 시각(FRED는 날짜만 줘요). 최근 값은 그 지표 시계열의 가장 최근 값이라, 발표 전 줄의 최근 값은 지난 발표 값이에요. 예상 칸은 아직 없어요. BLS 공표일정은 자동 요청을 막아서 쓰지 않아요.</div>
      </div>
    </>
  );
}
