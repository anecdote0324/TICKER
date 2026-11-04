// MAP 세계지도(03 v0.3): 나라마다 대표 지수의 오늘 등락을 지도 위치에 놓은 칸으로 보여 줘요(지형 대신 칸 지도).
// 칸 색은 등락 색(진할수록 크게 움직임), 칸 안에 지수·등락률·장 상태, 원화 대비 통화 등락. 칸을 누르면 연동 그룹이 그 지수로 바뀌어요.

import { SESSION_LABEL } from '@bt/shared';
import { fmtPct, fmtPrice } from '../format';
import { useNow } from '../hooks/useNow';
import { instSession } from '../session';
import { useQuotes } from '../stores/feed';
import { getInstrument } from '../stores/instruments';
import { setPanelSecurity, type PanelState } from '../stores/panels';
import { TitleBar } from './common';
import { heat } from './sector';

/** 칸 자리(12×6 격자, 대략의 지리 위치)와 통화 */
export const MAP_TILES: Array<{ country: string; index: string; fx?: string; col: number; row: number; w?: number; h?: number; region: '미주' | '유럽' | '아시아' }> = [
  { country: '미국', index: 'SPX', fx: 'USDKRW', col: 1, row: 2, w: 2, h: 2, region: '미주' },
  { country: '미국 나스닥', index: 'CCMP', fx: 'USDKRW', col: 3, row: 2, region: '미주' },
  { country: '미국 다우', index: 'INDU', fx: 'USDKRW', col: 3, row: 3, region: '미주' },
  { country: '영국', index: 'UKX', fx: 'GBPKRW', col: 5, row: 1, region: '유럽' },
  { country: '독일', index: 'DAX', fx: 'EURKRW', col: 6, row: 1, region: '유럽' },
  { country: '프랑스', index: 'CAC', fx: 'EURKRW', col: 5, row: 2, region: '유럽' },
  { country: '유로존', index: 'SX5E', fx: 'EURKRW', col: 6, row: 2, region: '유럽' },
  { country: '중국', index: 'SHCOMP', fx: 'CNYKRW', col: 9, row: 2, region: '아시아' },
  { country: '한국', index: 'KOSPI', col: 10, row: 1, region: '아시아' },
  { country: '한국 코스닥', index: 'KOSDAQ', col: 10, row: 2, region: '아시아' },
  { country: '일본', index: 'NKY', fx: 'JPYKRW', col: 11, row: 1, h: 2, region: '아시아' },
  { country: '홍콩', index: 'HSI', col: 9, row: 3, region: '아시아' },
  { country: '대만', index: 'TWSE', col: 10, row: 3, region: '아시아' },
];

export function WorldMap({ panel }: { panel: PanelState }) {
  const ids = [...new Set(MAP_TILES.flatMap((t) => [`IDX:${t.index}`, ...(t.fx ? [`CUR:${t.fx}`] : [])]))];
  const quotes = useQuotes(ids);
  const now = useNow(30_000);
  return (
    <>
      <TitleBar fn="MAP" name="세계지도" sub="나라별 대표 지수 오늘 등락" />
      <div className="pbody wmap-body">
        <div className="wmap">
          {(['미주', '유럽', '아시아'] as const).map((r, i) => (
            <div key={r} className="wmap-region label" style={{ gridColumn: `${[1, 5, 9][i]} / span 3`, gridRow: 1 }}>
              {r}
            </div>
          ))}
          {MAP_TILES.map((t) => {
            const inst = getInstrument(`IDX:${t.index}`);
            const q = inst ? quotes.get(inst.id) : undefined;
            const fx = t.fx ? quotes.get(`CUR:${t.fx}`) : undefined;
            const ses = inst ? instSession(inst, now) : undefined;
            return (
              <button
                key={t.index}
                className="wmap-tile"
                style={{ gridColumn: `${t.col} / span ${t.w ?? 1}`, gridRow: `${t.row + 1} / span ${t.h ?? 1}`, background: heat(q?.changePct, 2) }}
                title={inst ? `${inst.nameKo} — 누르면 연동 그룹이 이 지수로 바뀌어요` : t.index}
                onClick={() => inst && setPanelSecurity(panel.id, inst.id)}
              >
                <span className="wmap-country">{t.country}</span>
                <span className="wmap-index">{inst?.nameKo ?? t.index}</span>
                <span className="wmap-pct num">{q?.changePct !== undefined ? fmtPct(q.changePct) : '—'}</span>
                <span className="wmap-last num">{inst ? fmtPrice(inst, q?.last) : ''}</span>
                <span className="wmap-meta">
                  {ses ? SESSION_LABEL[ses] : ''}
                  {t.fx && fx?.changePct !== undefined ? ` · ${t.fx.slice(0, 3)}/원 ${fmtPct(fx.changePct)}` : ''}
                </span>
              </button>
            );
          })}
        </div>
        <div className="attr">칸 색: 지수 오늘 등락률(±2%에서 가장 진해요). 통화는 원화 대비 오늘 등락이에요. 지수 시세의 지연 여부는 WEI의 배지와 같아요.</div>
      </div>
    </>
  );
}
