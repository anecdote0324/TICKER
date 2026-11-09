// 공용 영업일 달력(v0.6): 서버가 한국투자증권에서 받은 한국 휴장일(규칙 계산과 다른 날)을 받아 화면의 계산에도 써요.
// 시계의 '휴장', 장 상태, 영업일 계산이 서버와 같아져요. 6시간마다 다시 받아요.

import { setHolidayOverrides, type CalendarMarket } from '@bt/shared';
import { api } from '../api';
import { createStore } from './store';

export interface CalendarInfo {
  overrides: Partial<Record<CalendarMarket, Record<string, string | null>>>;
  krFetchedOn?: string;
  upcoming: Array<{ market: CalendarMarket; date: string; name: string }>;
}

export const calendarInfo = createStore<CalendarInfo | null>(null);

export async function loadCalendar() {
  try {
    const c = await api.get<CalendarInfo>('/api/calendar');
    setHolidayOverrides(c.overrides);
    calendarInfo.set(c);
  } catch {
    // 서버가 아직이면 규칙 계산만 써요
  }
}

export function startCalendarRefresh() {
  void loadCalendar();
  window.setInterval(() => void loadCalendar(), 6 * 3600_000);
}
