import { describe, expect, it } from 'vitest';
import { amountScale } from './flows';

describe('수급 금액 단위 맞추기', () => {
  it('수량 × 종가와 견줘 원·천 원·백만 원을 골라요', () => {
    // 1만 주 × 7만 원 = 7억 원
    expect(amountScale([{ amt: 700_000_000, qty: 10_000, price: 70_000 }])).toBe(1);
    expect(amountScale([{ amt: 700_000, qty: 10_000, price: 70_000 }])).toBe(1e3);
    expect(amountScale([{ amt: 700, qty: 10_000, price: 70_000 }])).toBe(1e6);
    // 순매수는 평균 단가가 종가와 달라도 가장 가까운 단위로
    expect(amountScale([{ amt: -650, qty: -10_000, price: 70_000 }, { amt: 0, qty: 0, price: 70_000 }])).toBe(1e6);
  });
  it('견줄 줄이 없으면 1', () => {
    expect(amountScale([])).toBe(1);
    expect(amountScale([{ amt: 100, qty: undefined, price: 1 }])).toBe(1);
  });
});
