import { describe, it, expect } from 'vitest';
import { estimateCostKrw, pricingFromEnv, DEFAULT_PRICING } from '../src/cost.js';

describe('estimateCostKrw', () => {
  it('입력 100만 토큰 = 0.10 USD * 1400 = 140원', () => {
    expect(estimateCostKrw({ in: 1_000_000, out: 0, cached: 0 })).toBeCloseTo(140, 6);
  });
  it('출력 100만 토큰 = 0.40 USD * 1400 = 560원', () => {
    expect(estimateCostKrw({ in: 0, out: 1_000_000, cached: 0 })).toBeCloseTo(560, 6);
  });
  it('캐시 히트분은 cachedPerM 단가를 쓰고 in에서 제외한다', () => {
    // in 100만 중 100만이 cached면 in 단가는 0이 되고 cached 단가만 적용된다.
    expect(estimateCostKrw({ in: 1_000_000, out: 0, cached: 1_000_000 })).toBeCloseTo(0.025 * 1400, 6);
  });
  it('usage 0이면 0원', () => {
    expect(estimateCostKrw({ in: 0, out: 0, cached: 0 })).toBe(0);
  });
  it('pricing 오버라이드(환율 포함)를 적용한다', () => {
    const custom = { ...DEFAULT_PRICING, usdKrw: 1500 };
    expect(estimateCostKrw({ in: 1_000_000, out: 0, cached: 0 }, custom)).toBeCloseTo(150, 6);
  });
});

describe('pricingFromEnv', () => {
  it('env USD_KRW를 환율에 반영한다', () => {
    const pricing = pricingFromEnv({ USD_KRW: '1000' });
    expect(estimateCostKrw({ in: 1_000_000, out: 0, cached: 0 }, pricing)).toBeCloseTo(100, 6);
  });
  it('USD_KRW가 없으면 기본 1400을 쓴다', () => {
    const pricing = pricingFromEnv({});
    expect(pricing.usdKrw).toBe(1400);
  });
  it('USD_KRW가 숫자로 파싱 불가면 기본 1400을 쓴다', () => {
    const pricing = pricingFromEnv({ USD_KRW: 'nope' });
    expect(pricing.usdKrw).toBe(1400);
  });
  it('요율(inPerM 등)은 기본값을 그대로 유지한다', () => {
    const pricing = pricingFromEnv({ USD_KRW: '1000' });
    expect(pricing.inPerM).toBe(DEFAULT_PRICING.inPerM);
    expect(pricing.outPerM).toBe(DEFAULT_PRICING.outPerM);
    expect(pricing.cachedPerM).toBe(DEFAULT_PRICING.cachedPerM);
  });
});
