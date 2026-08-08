// QuotaDO — 범용 카운터 DO: IP 분당 rate limit(RL_PER_MIN) + LLM 프로바이더별 일일 쿼터
// (LLM_DAILY_LIMIT_<PROVIDER>)를 한 DO에서 관리한다. key별 {count, expiresAt} 슬라이딩
// 윈도를 storage에 유지하는 핵심 로직은 원본 그대로 — 동작 보존.
//
// 원본: C:\Users\user\marriage_problem\worker\quota-do.mjs (ai-speed-game 것과 바이트 동일 —
// 검증된 코드). TS 표현은 employee-of-the-month/apps/worker/src/quota-do.ts 참고.
// 원본은 fetch(POST /incr {key,limit,ttlMs}) 하나로 IP rate limit·프로바이더 쿼터를 호출부가
// 직접 key를 조립해 공유했다. 여기서는 core.ts의 Quota 인터페이스(take)를 RPC 메서드로
// 직접 구현하고, IP rate limit용 별도 RPC 메서드(rateLimit)를 둬 같은 내부 카운터 로직을
// 공유한다 — fetch 기반 프로토콜은 걷어내고 DO RPC(compatibility_date 2024-04-03+)로 전환.
import { DurableObject } from 'cloudflare:workers';
import type { Quota } from './interfaces.js';

// 이 DO가 필요로 하는 env 값만 — provider별 LLM_DAILY_LIMIT_* 키는 동적으로 조회한다.
export type QuotaEnv = {
  RL_PER_MIN?: string;
  [key: string]: string | undefined;
};

type Counter = { count: number; expiresAt: number };

const RL_WINDOW_MS = 60_000;
const DAILY_WINDOW_MS = 86_400_000;
const DEFAULT_RL_PER_MIN = 30;

export class QuotaDO extends DurableObject<QuotaEnv> implements Quota {
  // Quota 인터페이스 — 프로바이더별 일일 한도. env.LLM_DAILY_LIMIT_<PROVIDER 대문자>가 없으면
  // 한도 0(전부 거부)으로 안전 측 폴백. 키에 UTC 날짜를 넣어 하루 지나면 버킷이 자연히
  // 리셋되게 한다(eotm apps/worker/src/room-do.ts의 makeQuotaTake 방식). gemini-free(무료)와
  // gemini(유료)는 프로바이더명이 다르므로 카운터도 분리된다 — 무료 소진이 유료 폴백까지
  // 막지 않는다(유료 키는 별도 비용 상한 역할). `now`는 테스트에서 날짜 경계를 넘기기 위한
  // 선택 인자 — 실호출에서는 항상 기본값(Date.now())을 쓴다.
  async take(provider: string, now: number = Date.now()): Promise<boolean> {
    const envKey = `LLM_DAILY_LIMIT_${provider.toUpperCase().replace(/-/g, '_')}`;
    const limit = Number(this.env[envKey]) || 0;
    const day = new Date(now).toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const { ok } = await this.incr(`llm:${provider}:${day}`, limit, DAILY_WINDOW_MS, now);
    return ok;
  }

  // IP rate limit. 한도는 인자 > env.RL_PER_MIN > 기본 30 순으로 정해진다. 윈도도 인자로
  // 바꿀 수 있다 — eotm의 페르소나 생성·공유·피드백은 분당이 아니라 일 단위 한도를 쓴다.
  async rateLimit(ip: string, limit?: number, windowMs: number = RL_WINDOW_MS): Promise<boolean> {
    const effective = limit ?? (Number(this.env.RL_PER_MIN) || DEFAULT_RL_PER_MIN);
    const { ok } = await this.incr(`rl:${ip}`, effective, windowMs);
    return ok;
  }

  // 범용 카운터 진입점. 원본(marriage_problem·ai-speed-game·eotm의 quota-do)이 노출하던
  // 형태 그대로다. take·rateLimit은 이걸 접두사만 다르게 부르는 두 호출자이고, 그 둘로
  // 담기지 않는 한도(eotm의 용도별 IP 한도 4종 — 방 생성 분당 5·페르소나 생성 일 5·공유 일
  // 30·피드백 일 5)는 호출측이 이걸 직접 쓴다. 이 진입점을 지웠던 것이 계약 불일치의 원인이다.
  async incr(key: string, limit: number, ttlMs: number, now: number = Date.now()): Promise<{ ok: boolean; count: number }> {
    const cur = (await this.ctx.storage.get<Counter>(key)) ?? { count: 0, expiresAt: now + ttlMs };
    const fresh = cur.expiresAt <= now ? { count: 0, expiresAt: now + ttlMs } : cur;
    if (fresh.count >= limit) return { ok: false, count: fresh.count };
    fresh.count += 1;
    await this.ctx.storage.put(key, fresh);
    return { ok: true, count: fresh.count };
  }
}
