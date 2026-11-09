import { describe, expect, it } from 'vitest';
import {
  bokKind,
  dotMedian,
  fedKind,
  isInvestmentGrade,
  parseBisCsv,
  parseBojSchedule,
  parseBokSchedule,
  parseEcbSchedule,
  parseFedStatement,
  parseFomcCalendar,
  parseSep,
  ratingNotch,
  summarizePolicy,
} from './centralbank';

describe('BIS 정책금리', () => {
  const csv = [
    'FREQ,REF_AREA,UNIT_MEASURE,TITLE,TIME_PERIOD,OBS_VALUE',
    'D,KR,368,"Korea, base rate",2025-01-01,3.25',
    'D,KR,368,"Korea, base rate",2025-02-25,3',
    'D,KR,368,"Korea, base rate",2026-02-01,3',
    'D,US,368,US,2026-02-01,3.875',
    'D,US,368,US,2026-02-02,',
  ].join('\n');
  it('나라별로 나누고 빈 값은 빼요', () => {
    const m = parseBisCsv(csv);
    expect(m.get('KR')?.length).toBe(3);
    expect(m.get('US')).toEqual([{ date: '2026-02-01', value: 3.875 }]);
  });
  it('마지막 변경과 1년 전 값', () => {
    const s = summarizePolicy('KR', parseBisCsv(csv).get('KR')!)!;
    expect(s.rate).toBe(3);
    expect(s.changed).toEqual({ date: '2025-02-25', from: 3.25 });
    expect(s.yearAgo).toBe(3.25);
  });
});

describe('회의 일정', () => {
  it('FOMC 일정: 결정일·SEP·링크, 달을 넘기는 회의와 서면 결의는 빼요', () => {
    const block = (month: string, date: string, extra = '') =>
      `<div class="row fomc-meeting" "><div class="fomc-meeting__month col-xs-5"><strong>${month}</strong></div><div class="fomc-meeting__date col-xs-4">${date}</div>${extra}</div>`;
    const html =
      '<h4><a>2026 FOMC Meetings</a></h4>' +
      block('January', '27-28', '<a href="/newsevents/pressreleases/monetary20260128a.htm">HTML</a> <a href="/monetarypolicy/fomcminutes20260128.htm">HTML</a>') +
      `<div class="fomc-meeting--shaded row fomc-meeting" "><div class="fomc-meeting--shaded fomc-meeting__month col-xs-5"><strong>March</strong></div><div class="fomc-meeting__date col-xs-4">17-18*</div><a href="/monetarypolicy/fomcprojtabl20260318.htm">HTML</a></div>` +
      '<h4><a>2019 FOMC Meetings</a></h4>' +
      block('Apr/May', '30-1') +
      block('August', '22 (notation vote)');
    const m = parseFomcCalendar(html);
    expect(m.map((x) => x.date)).toEqual(['2019-05-01', '2026-01-28', '2026-03-18']);
    expect(m[1].statementUrl).toBe('https://www.federalreserve.gov/newsevents/pressreleases/monetary20260128a.htm');
    expect(m[1].minutesUrl).toContain('fomcminutes20260128');
    expect(m[2].sep).toBe(true);
    expect(m[2].projectionsUrl).toContain('fomcprojtabl20260318');
  });
  it('한국은행 통화정책방향 회의일', () => {
    const html = '<th>회의일자</th><td>01월 15일(목)</td><td>…</td><td>02월 26일(목)</td><td>02월 26일(목)</td>';
    expect(parseBokSchedule(html, 2026).map((x) => x.date)).toEqual(['2026-01-15', '2026-02-26']);
  });
  it('ECB: 통화정책 회의의 둘째 날(기자회견)만', () => {
    const html =
      '<dl><dt> 25/11/2026 </dt><dd> Governing Council of the ECB: non-monetary policy meeting<br></dd>' +
      '<dt> 16/12/2026 </dt><dd> Governing Council of the ECB: monetary policy meeting in Frankfurt (Day 1)<br></dd>' +
      '<dt> 17/12/2026 </dt><dd> Governing Council of the ECB: monetary policy meeting in Frankfurt (Day 2), followed by press conference<br></dd></dl>';
    expect(parseEcbSchedule(html).map((x) => x.date)).toEqual(['2026-12-17']);
  });
  it('일본은행: 표 첫 칸의 둘째 날, 줄바꿈과 달 넘김', () => {
    const html =
      '<h2 id="p2026">2026</h2><table><tbody>' +
      '<tr><td><a href="x.pdf">Jan. 22 (Thurs.), 23 (Fri.) [PDF 171KB]</a></td><td>Jan. 23 (Fri.)</td></tr>' +
      '<tr><td>Mar. 17\n  (Wed.), 18 (Thurs.)</td><td>-</td></tr>' +
      '<tr><td>Apr. 30 (Thurs.), May 1 (Fri.)</td><td>-</td></tr>' +
      '</tbody></table><h2 id="p2027">2027</h2><table><tbody><tr><td>Jan. 21 (Thurs.), 22 (Fri.)</td></tr></tbody></table>';
    expect(parseBojSchedule(html).map((x) => x.date)).toEqual(['2026-01-23', '2026-03-18', '2026-05-01', '2027-01-22']);
  });
});

describe('성명·자료', () => {
  it('연준 성명 본문만 꺼내요', () => {
    const html =
      '<div id="article"><div class="heading col-xs-12 col-sm-8 col-md-8"><h3>Federal Reserve issues FOMC statement</h3></div>' +
      '<div class="col-xs-12 col-sm-8 col-md-8"><p>The Committee decided to maintain the target range.</p><p>Inflation remains elevated &amp; sticky.</p>' +
      '<p>For media inquiries, please email</p></div></div>';
    expect(parseFedStatement(html)).toBe('The Committee decided to maintain the target range.\nInflation remains elevated & sticky.');
  });
  it('제목으로 종류를 나눠요', () => {
    expect(fedKind('Federal Reserve issues FOMC statement')).toBe('statement');
    expect(fedKind('Minutes of the Federal Open Market Committee, September 15-16, 2026')).toBe('minutes');
    expect(fedKind("Minutes of the Board's discount rate meetings")).toBe('other');
    expect(bokKind('통화정책방향(2026.10.22)')).toBe('statement');
    expect(bokKind('금융통화위원회 의사록(2026년 제18차)(2026.9.22)')).toBe('minutes');
  });
});

describe('점도표', () => {
  const html = `
<h4>Table 1. Economic projections of Federal Reserve Board members</h4>
<table><thead><tr><th>Variable</th><th>Median</th></tr><tr><th>2026</th><th>2027</th><th>Longer run</th></tr></thead><tbody>
<tr><th>Change in real GDP</th><td>2.4</td><td>2.3</td><td>2.0</td><td>2.2–2.5</td><td>2.0–2.4</td><td>1.8–2.0</td></tr>
<tr><th>December projection</th><td>2.3</td><td>2.0</td><td>1.8</td><td>2.1–2.5</td><td>1.9–2.3</td><td>1.8–2.0</td></tr>
<tr><th>Core PCE inflation <a>4</a></th><td>2.7</td><td>2.2</td><td>2.5–2.8</td><td>2.0–2.4</td></tr>
<tr><th>Federal funds rate</th><td>3.4</td><td>3.1</td><td>3.1</td><td>3.1–3.6</td><td>2.9–3.6</td><td>2.9–3.5</td></tr>
</tbody></table>
<h4>Figure 2. FOMC participants' assessments of appropriate monetary policy</h4>
<table><thead><tr><th>Midpoint</th><th>2026</th><th>2027</th><th>Longer run</th></tr></thead><tbody>
<tr><th>3.625</th><td>2</td><td></td><td>1</td></tr>
<tr><th>3.375</th><td>10</td><td>5</td><td>4</td></tr>
<tr><th>3.125</th><td>7</td><td>14</td><td>14</td></tr>
</tbody></table>`;
  it('그림 2와 표 1 중간값', () => {
    const d = parseSep(html, 'u', '2026-03-18')!;
    expect(d.years).toEqual(['2026', '2027', 'Longer run']);
    expect(d.dots[0]).toEqual({ rate: 3.625, counts: [2, 0, 1] });
    const gdp = d.medians.find((m) => m.key === 'gdp')!;
    expect(gdp.values).toEqual([2.4, 2.3, 2.0]);
    expect(gdp.prev).toEqual([2.3, 2.0, 1.8]);
    expect(d.medians.find((m) => m.key === 'core')!.values).toEqual([2.7, 2.2, null]);
    expect(d.medians.find((m) => m.key === 'ffr')!.values).toEqual([3.4, 3.1, 3.1]);
  });
  it('점도표 열의 중간값', () => {
    const d = parseSep(html, 'u', '2026-03-18')!;
    expect(dotMedian(d.dots, 0)).toBe(3.375);
    expect(dotMedian(d.dots, 1)).toBe(3.125);
  });
});

describe('신용등급', () => {
  it('S&P·피치와 무디스를 같은 자로', () => {
    expect(ratingNotch('AA-')).toBe(3);
    expect(ratingNotch('Aa3')).toBe(3);
    expect(ratingNotch('baa3')).toBe(9);
    expect(ratingNotch('?')).toBeUndefined();
    expect(isInvestmentGrade('BBB-')).toBe(true);
    expect(isInvestmentGrade('Ba1')).toBe(false);
  });
});
