// 원가 계량 — project-alibis scripts/gemini-clients.ts의 costKrw() 단가·집계 이식.
import type { Usage } from './types.js';

// 단일 요율 행(provider/model 구분 없이 하나의 기본 요율만 표현) — 이름을 PricingTable이 아니라
// PricingRates로 둔 이유는 실구조(중첩 테이블 아님)를 그대로 드러내기 위해서다.
export type PricingRates = { inPerM: number; outPerM: number; cachedPerM: number; usdKrw: number };

// alibis 실측표(0.10/0.40/0.025 USD per 1M 토큰). 환율 기본값 1400.
export const DEFAULT_PRICING: PricingRates = { inPerM: 0.10, outPerM: 0.40, cachedPerM: 0.025, usdKrw: 1400 };

export function estimateCostKrw(usage: Usage, pricing: PricingRates = DEFAULT_PRICING): number {
  const usd =
    ((usage.in - usage.cached) / 1e6) * pricing.inPerM +
    (usage.cached / 1e6) * pricing.cachedPerM +
    (usage.out / 1e6) * pricing.outPerM;
  return usd * pricing.usdKrw;
}

// env USD_KRW를 기본 요율표에 반영한 PricingRates를 만든다. 이 패키지는 런타임 중립이라 env를
// 직접 읽지 않는다 — 호출측이 자신의 env를 넘겨 배선한다. USD_KRW 미설정·파싱 불가 시 기본 1400.
export function pricingFromEnv(env: Record<string, string | undefined>): PricingRates {
  const parsed = env.USD_KRW ? parseFloat(env.USD_KRW) : NaN;
  const usdKrw = Number.isFinite(parsed) ? parsed : DEFAULT_PRICING.usdKrw;
  return { ...DEFAULT_PRICING, usdKrw };
}
