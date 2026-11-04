// v0.4 뉴스 보기: TOP 주요 뉴스, NI 주제별 뉴스, NSE 뉴스 검색(저장 검색), FIRS 속보. 모두 뉴스 아카이브에서 골라요.
// 줄을 누르면 원문을 브라우저로 열어요. CN 종목 뉴스는 N 화면을 그 종목으로 고정해서 써요(News.tsx).

import { NEWS_TOPICS, type NewsItem, type NewsViewResponse, type TopNewsResponse } from '@bt/shared';
import { useNow } from '../hooks/useNow';
import { patchPanel, type PanelState } from '../stores/panels';
import { TitleBar, usePoll } from './common';
import { openLink, when } from './News';

const FRESH_MS = 10 * 60_000;

function Rows({ items, now, extra }: { items: NewsItem[]; now: number; extra?: (x: NewsItem) => string | undefined }) {
  return (
    <>
      {items.map((x) => (
        <div key={x.id} className={`news-row ${now - x.published < FRESH_MS && !x.dateOnly ? 'new' : ''}`} onClick={() => openLink(x.url)} title={`${x.title}\n${x.url}`}>
          <span className="news-t num">{when(x, now)}</span>
          <span className={`news-src ${x.kind === 'disclosure' ? 'disc' : ''}`}>{x.source}</span>
          <span className="news-title">
            {x.corpName && <span className="news-corp">{x.corpName}</span>}
            {x.title}
            {extra?.(x) && <span className="label news-extra">{` ${extra(x)}`}</span>}
          </span>
        </div>
      ))}
    </>
  );
}

export function Top({ panel }: { panel: PanelState }) {
  const hours = panel.topHours ?? 24;
  const res = usePoll<TopNewsResponse>(`/api/news/top?hours=${hours}`, 5 * 60_000);
  const now = useNow(30_000);
  const items = res?.data?.items ?? [];
  return (
    <>
      <TitleBar
        fn="TOP"
        name="주요 뉴스"
        sub={`최근 ${hours}시간`}
        fresh={res?.data?.fresh}
        tools={
          <>
            {[6, 24, 72].map((h) => (
              <button key={h} className={hours === h ? 'on' : ''} onClick={() => patchPanel(panel.id, { topHours: h })}>
                {`${h}시간`}
              </button>
            ))}
          </>
        }
      />
      <div className="pbody news">
        {!res && <div className="des-note label">불러오는 중…</div>}
        {res?.error && !res.data && <div className="des-note err">{res.error}</div>}
        <Rows items={items} now={now} extra={(x) => {
          const t = x as (typeof items)[number];
          return t.dupes > 0 ? `+${t.dupes} (${t.otherSources.join(', ')})` : undefined;
        }} />
        {res?.data && items.length === 0 && <div className="des-note label">아직 받은 뉴스가 없어요</div>}
        {res?.data && <div className="des-note label news-foot">{`출처 가중치와 여러 곳이 같이 다룬 정도로 고른 헤드라인 · 비슷한 제목은 한 줄로(+N은 같은 이야기를 다룬 다른 줄) · 아카이브 ${res.data.archived.toLocaleString('en-US')}건`}</div>}
      </div>
    </>
  );
}

export function Ni({ panel }: { panel: PanelState }) {
  const topic = NEWS_TOPICS.find((t) => t.code === panel.niTopic)?.code ?? NEWS_TOPICS[0].code;
  const res = usePoll<NewsViewResponse>(`/api/news/topic?topic=${topic}`, 5 * 60_000);
  const now = useNow(30_000);
  return (
    <>
      <TitleBar fn="NI" name="주제별 뉴스" sub={NEWS_TOPICS.find((t) => t.code === topic)?.label} fresh={res?.data?.fresh} />
      <div className="most-tabs">
        {NEWS_TOPICS.map((t) => (
          <button key={t.code} className={t.code === topic ? 'on' : ''} onClick={() => patchPanel(panel.id, { niTopic: t.code })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="pbody news">
        {!res && <div className="des-note label">불러오는 중…</div>}
        {res?.error && !res.data && <div className="des-note err">{res.error}</div>}
        <Rows items={res?.data?.items ?? []} now={now} />
        {res?.data && res.data.items.length === 0 && <div className="des-note label">이 주제의 최근 헤드라인이 없어요</div>}
        {res?.data && <div className="des-note label news-foot">{`제목에 주제 낱말이 든 최근 헤드라인 ${res.data.total ?? res.data.items.length}건 · 뉴스 아카이브 최근 5,000건에서`}</div>}
      </div>
    </>
  );
}

export function Nse({ panel }: { panel: PanelState }) {
  const q = (panel.nseQuery ?? '').trim();
  const days = panel.nseDays ?? 30;
  const saved = panel.nseSaved ?? [];
  const res = usePoll<NewsViewResponse>(q ? `/api/news/search?q=${encodeURIComponent(q)}&days=${days}` : '', 5 * 60_000);
  const now = useNow(30_000);
  return (
    <>
      <TitleBar
        fn="NSE"
        name="뉴스 검색"
        sub={q ? `"${q}"` : undefined}
        fresh={res?.data?.fresh}
        tools={
          <>
            {[7, 30, 365].map((d) => (
              <button key={d} className={days === d ? 'on' : ''} onClick={() => patchPanel(panel.id, { nseDays: d })}>
                {d === 365 ? '1년' : `${d}일`}
              </button>
            ))}
          </>
        }
      />
      <div className="pbody news">
        <div className="nse-bar">
          <input className="cf-search" placeholder="낱말을 띄어 쓰면 모두 든 것, -낱말은 빼기 (예: 삼성 HBM -중국)" defaultValue={panel.nseQuery ?? ''} key={panel.nseQuery ?? ''} onKeyDown={(e) => e.key === 'Enter' && patchPanel(panel.id, { nseQuery: (e.target as HTMLInputElement).value })} onBlur={(e) => patchPanel(panel.id, { nseQuery: e.target.value })} />
          {q && !saved.includes(q) && (
            <button className="btn" onClick={() => patchPanel(panel.id, { nseSaved: [...saved, q].slice(-12) })}>
              저장
            </button>
          )}
        </div>
        {saved.length > 0 && (
          <div className="nse-saved">
            {saved.map((s) => (
              <span key={s} className={`nse-chip ${s === q ? 'on' : ''}`}>
                <button onClick={() => patchPanel(panel.id, { nseQuery: s })}>{s}</button>
                <button aria-label="지우기" onClick={() => patchPanel(panel.id, { nseSaved: saved.filter((x) => x !== s) })}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {!q && <div className="des-note label">찾을 낱말을 넣고 Enter. 앱이 켜져 있는 동안 쌓은 뉴스·공시 아카이브(수집을 시작한 뒤의 것만)에서 찾아요.</div>}
        {q && !res && <div className="des-note label">찾는 중…</div>}
        {res?.error && !res.data && <div className="des-note err">{res.error}</div>}
        {res?.data && <Rows items={res.data.items} now={now} />}
        {res?.data && <div className="des-note label news-foot">{`${res.data.total ?? res.data.items.length}건${(res.data.total ?? 0) > res.data.items.length ? `(최근 ${res.data.items.length}건만 보여요)` : ''} · 최근 ${days === 365 ? '1년' : `${days}일`} · 아카이브 ${res.data.archived.toLocaleString('en-US')}건`}</div>}
      </div>
    </>
  );
}

export function Firs({ panel }: { panel: PanelState }) {
  void panel;
  const res = usePoll<NewsViewResponse>('/api/news/breaking', 60_000);
  const now = useNow(15_000);
  return (
    <>
      <TitleBar fn="FIRS" name="속보" sub="근사: 속보 표시 헤드라인·주요 공시" fresh={res?.data?.fresh} />
      <div className="pbody news">
        {!res && <div className="des-note label">불러오는 중…</div>}
        {res?.error && !res.data && <div className="des-note err">{res.error}</div>}
        <Rows items={res?.data?.items ?? []} now={now} />
        {res?.data && res.data.items.length === 0 && <div className="des-note label">최근 12시간 속보가 없어요</div>}
        {res?.data && <div className="des-note label news-foot">블룸버그 First Word를 대신하는 근사 화면이에요: 최근 12시간 제목에 속보·1보·단독·Breaking이 든 헤드라인, MarketWatch Pulse 2시간, 주요 DART 공시(증자·자기주식·합병·공급계약 등) · 1분마다</div>}
      </div>
    </>
  );
}
