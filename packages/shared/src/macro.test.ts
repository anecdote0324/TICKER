import { describe, expect, it } from 'vitest';
import { applyTransform, ecosTime, kosisUrlOk, parseBokStatCalendar, parseKosis, parseModsPlan, periodLabel } from './macro';

const months = (vals: number[]) => vals.map((value, i) => ({ date: `2025-${String(i + 1).padStart(2, '0')}-01`, value }));

describe('값 바꾸기', () => {
  it('전년 대비·전기 대비·증감·전년 대비 증감', () => {
    const raw = [...months([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]), { date: '2026-01-01', value: 103 }];
    expect(applyTransform(raw, 'yoy', 'M')).toEqual([{ date: '2026-01-01', value: expect.closeTo(3, 6) }]);
    expect(applyTransform(raw.slice(0, 3), 'mom', 'M')[1].value).toBeCloseTo(0.990099, 5);
    expect(applyTransform(raw.slice(0, 3), 'diff', 'M').map((o) => o.value)).toEqual([1, 1]);
    expect(applyTransform(raw, 'yoyDiff', 'M')[0].value).toBe(3);
    expect(applyTransform(raw.slice(0, 2), 'level', 'M', 0.01).map((o) => o.value)).toEqual([1, 1.01]);
  });
  it('분기 전년 대비는 4칸 앞', () => {
    const q = [100, 101, 102, 103, 110].map((value, i) => ({ date: `q${i}`, value }));
    expect(applyTransform(q, 'yoy', 'Q')[0].value).toBeCloseTo(10, 6);
  });
});

describe('기간', () => {
  it('ECOS 시점 → 날짜, 화면 기간', () => {
    expect(ecosTime('202609')).toBe('2026-09-01');
    expect(ecosTime('2026Q3')).toBe('2026-07-01');
    expect(ecosTime('20261104')).toBe('2026-11-04');
    expect(periodLabel('2026-07-01', 'Q')).toBe('2026 3분기');
    expect(periodLabel('2026-09-01', 'M')).toBe('2026-09');
  });
});

describe('KOSIS', () => {
  it('항목별로 나누고 오류 모양(따옴표 없는 키)도 읽어요', () => {
    const ok = JSON.stringify([
      { TBL_NM: '경제활동인구', C1_NM: '서울', ITM_NM: '실업률', UNIT_NM: '%', PRD_SE: 'M', PRD_DE: '202609', DT: '3.1' },
      { TBL_NM: '경제활동인구', C1_NM: '서울', ITM_NM: '실업률', UNIT_NM: '%', PRD_SE: 'M', PRD_DE: '202608', DT: '3.0' },
      { TBL_NM: '경제활동인구', C1_NM: '부산', ITM_NM: '실업률', UNIT_NM: '%', PRD_SE: 'M', PRD_DE: '202609', DT: '2.8' },
    ]);
    const r = parseKosis(ok);
    expect(r.groups.map((g) => g.name)).toEqual(['서울 · 실업률', '부산 · 실업률']);
    expect(r.groups[0].obs).toEqual([
      { date: '2026-08-01', value: 3 },
      { date: '2026-09-01', value: 3.1 },
    ]);
    expect(parseKosis('{err:"10",errMsg:"인증 KEY값이 누락되었습니다."}').error).toBe('인증 KEY값이 누락되었습니다. (10)');
    expect(parseKosis(JSON.stringify([{ PRD_SE: 'Q', PRD_DE: '20263', DT: '1,234', ITM_NM: 'x' }])).groups[0].obs[0]).toEqual({ date: '2026-07-01', value: 1234 });
  });
  it('kosis.kr의 OpenAPI 주소만', () => {
    expect(kosisUrlOk('https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList')).toBe(true);
    expect(kosisUrlOk('https://evil.example/openapi/')).toBe(false);
    expect(kosisUrlOk('http://kosis.kr/openapi/x')).toBe(false);
  });
});

describe('한국 발표 일정', () => {
  it('국가데이터처 보도계획: 통계 발표만, 시각까지', () => {
    const html =
      '<th>보도일자</th><table><tbody>' +
      '<tr><td class="center">11.03.( 화 )</td><td>08:00</td><td>2026년 10월 소비자물가동향</td><td>물가동향과</td><td></td></tr>' +
      '<tr><td>11.02.( 월 )</td><td>12:00</td><td>국가데이터처, 특별한 성과</td><td>혁신행정담당관</td><td></td></tr>' +
      '<tr><td>11.02.( 월 )</td><td>16:30</td><td>2026년도 대규모 통계조사 업무 유공 포상 전수식 개최</td><td>인구총조사과</td><td></td></tr>' +
      '</tbody></table>';
    expect(parseModsPlan(html, 2026)).toEqual([{ date: '2026-11-03', time: '08:00', title: '2026년 10월 소비자물가동향', source: 'MODS' }]);
  });
  it('한국은행 통계공표일정 달력', () => {
    const html =
      "<caption>월간통계공표일정 달력 2026년 11월</caption><table><tbody><tr><td> 4 </td><td> 5 <ul><li><a title='2026년 9월 국제수지(잠정)'>x</a></li></ul></td>" +
      "<td> 13 <ul><li><p title='2026년 9월 통화 및 유동성'>y</p></li><li><p title='2026년 10월 수출입물가지수'>z</p></li></ul></td><td></td></tr></tbody></table>";
    expect(parseBokStatCalendar(html, 2026, 11)).toEqual([
      { date: '2026-11-05', title: '2026년 9월 국제수지(잠정)', source: 'BOK' },
      { date: '2026-11-13', title: '2026년 9월 통화 및 유동성', source: 'BOK' },
      { date: '2026-11-13', title: '2026년 10월 수출입물가지수', source: 'BOK' },
    ]);
  });
});
