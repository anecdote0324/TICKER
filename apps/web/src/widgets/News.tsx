// N 뉴스·공시(03 v0.2): DART 공시와 RSS 헤드라인. 종목이 있으면 그 회사 공시와 이름이 들어간 헤드라인만.
// 줄을 누르면 원문(기사·DART 공시 뷰어)을 브라우저로 열어요.

import { useEffect, useState } from 'react';
import { BOND_PATTERN, type NewsItem, type NewsResponse } from '@bt/shared';
import { api } from '../api';
import { useNow } from '../hooks/useNow';
import { useInstrument } from '../stores/instruments';
import { patchPanel, type PanelState } from '../stores/panels';
import { TitleBar } from './common';

const REFRESH_MS = 30_000;
/** 이보다 새 줄은 밝게 */
const FRESH_MS = 15 * 60_000;

const TABS = [
  { code: 'all', label: '전체' },
  { code: 'disclosure', label: '공시' },
  { code: 'ko', label: '국내 뉴스' },
  { code: 'en', label: '해외 뉴스' },
] as const;
type Tab = (typeof TABS)[number]['code'];

export function openLink(url: string) {
  if (window.btBridge?.openExternal) window.btBridge.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 오늘이면 시:분, 아니면 월/일(한국 시간) */
export function when(x: NewsItem, now: number): string {
  const k = new Date(x.published + 9 * 3600_000);
  const today = new Date(now + 9 * 3600_000);
  const sameDay = k.getUTCFullYear() === today.getUTCFullYear() && k.getUTCMonth() === today.getUTCMonth() && k.getUTCDate() === today.getUTCDate();
  if (sameDay && !x.dateOnly) return `${pad2(k.getUTCHours())}:${pad2(k.getUTCMinutes())}`;
  return `${pad2(k.getUTCMonth() + 1)}/${pad2(k.getUTCDate())}`;
}

export function News({ panel }: { panel: PanelState }) {
  const inst = useInstrument(panel.securityId);
  // CN 종목 뉴스(v0.4): N과 같은 화면이지만 늘 그 종목만
  const isCn = panel.fn === 'CN';
  const tab: Tab = (TABS.some((t) => t.code === panel.newsTab) ? panel.newsTab : 'all') as Tab;
  // 종목이 있어도 '전체 보기'를 누르면 거르지 않아요
  const byInst = !!inst && (isCn || !panel.newsAll);
  const kind = tab === 'disclosure' ? 'disclosure' : tab === 'all' ? 'all' : 'news';
  const key = `${byInst ? inst!.id : ''}|${kind}`;
  const [state, setState] = useState<{ key: string; data?: NewsResponse; error?: string } | null>(null);
  const now = useNow(30_000);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<NewsResponse>(`/api/news?kind=${kind}&limit=200${byInst ? `&id=${encodeURIComponent(inst!.id)}` : ''}`)
        .then((data) => alive && setState({ key, data }))
        .catch((e: Error) => alive && setState((s) => (s?.key === key && s.data ? s : { key, error: e.message })));
    void load();
    const t = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
    // key가 종목과 종류를 담아요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const cur = state?.key === key ? state : undefined;
  const data = cur?.data;
  // N BON(v0.6): 채권·금리 헤드라인만(공시는 빼요)
  const bond = panel.args?.[0] === 'BON' && !isCn;
  const bondRe = new RegExp(BOND_PATTERN, 'i');
  const items = (data?.items ?? []).filter((x) => (tab === 'all' || tab === 'disclosure' || x.lang === tab) && (!bond || (x.kind === 'news' && bondRe.test(x.title))));
  const rss = data?.sources.filter((s) => s.kind === 'news') ?? [];
  const rssOk = rss.filter((s) => s.ok).length;
  const name = inst ? inst.nameKo || inst.nameEn || inst.code : '';
  return (
    <>
      <TitleBar
        fn={isCn ? 'CN' : 'N'}
        name={isCn ? '종목 뉴스' : bond ? '뉴스 · 채권' : '뉴스·공시'}
        sub={byInst ? name : isCn ? '종목이 필요해요(예: 005930 CN)' : undefined}
        fresh={data?.fresh}
        tools={
          inst && !isCn ? (
            <>
              <button className={byInst ? 'on' : ''} onClick={() => patchPanel(panel.id, { newsAll: false })} title={`${name} 관련만`}>
                {name.length > 8 ? `${name.slice(0, 8)}…` : name}
              </button>
              <button className={!byInst ? 'on' : ''} onClick={() => patchPanel(panel.id, { newsAll: true })}>
                전체
              </button>
            </>
          ) : undefined
        }
      />
      <div className="most-tabs">
        {TABS.map((t) => (
          <button key={t.code} className={t.code === tab ? 'on' : ''} onClick={() => patchPanel(panel.id, { newsTab: t.code })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="pbody news">
        {!cur && <div className="des-note label">불러오는 중…</div>}
        {cur?.error && !data && <div className="des-note err">{cur.error}</div>}
        {tab === 'disclosure' && data?.dart === 'off' && <div className="des-note label">DART 인증키를 넣으면 공시가 보여요 · 설정 → 데이터 연결</div>}
        {items.map((x) => (
          <div key={x.id} className={`news-row ${now - x.published < FRESH_MS && !x.dateOnly ? 'new' : ''}`} onClick={() => openLink(x.url)} title={`${x.title}\n${x.url}`}>
            <span className="news-t num">{when(x, now)}</span>
            <span className={`news-src ${x.kind === 'disclosure' ? 'disc' : ''}`}>{x.source}</span>
            <span className="news-title">
              {x.corpName && <span className="news-corp">{x.corpName}</span>}
              {x.title}
            </span>
          </div>
        ))}
        {data && items.length === 0 && (
          <div className="des-note label">{byInst ? `${name} 관련 ${tab === 'disclosure' ? '공시' : '뉴스'}가 아직 없어요 · 헤드라인은 제목에 이름이 들어간 것만 보여요` : '아직 받은 뉴스가 없어요(켜진 뒤 처음 받는 중이에요)'}</div>
        )}
        {data && (
          <div className="des-note label news-foot">
            RSS {rss.length}곳 중 {rssOk}곳 · 5분마다 · DART {data.dart === 'on' ? '켜짐(2분마다)' : '꺼짐'} · 아카이브 {data.archived.toLocaleString('en-US')}건
          </div>
        )}
      </div>
    </>
  );
}
