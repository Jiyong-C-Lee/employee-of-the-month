// LLM 공급자 체인: gemini → nvidia. 429·타임아웃·스키마 위반 시 다음 공급자로 (스펙 §7).
import { logger } from '../log';
import type { Env } from '../env';
import { gemini } from './providers/gemini';
import { nvidia } from './providers/nvidia';

export interface LlmArgs { system: string; user: string; schema: object; temperature?: number; timeoutMs?: number }
export interface Provider {
  name: 'gemini' | 'nvidia';
  hasKey(env: Env): boolean;
  callJson(env: Env, args: LlmArgs): Promise<unknown>;
}
export class ChainExhaustedError extends Error {
  constructor() { super('모든 LLM 공급자 실패'); }
}

const CHAIN: Provider[] = [gemini, nvidia];

export interface ChainOpts {
  kind?: string;                                      // 로그용 호출 종류 (advisors|judge|epilogue)
  quotaTake?: (provider: string) => Promise<boolean>; // false면 해당 공급자 스킵 (일일 쿼터)
  validate?: (raw: unknown) => void;                  // zod 출력 검증 — throw 시 페일오버
}

export async function callJsonChain(env: Env, args: LlmArgs, opts: ChainOpts = {}): Promise<{ raw: unknown; provider: 'gemini' | 'nvidia' }> {
  let failedOver = false;
  const kind = opts.kind ?? 'unknown';
  for (const p of CHAIN) {
    if (!p.hasKey(env)) continue;
    if (opts.quotaTake && !(await opts.quotaTake(p.name))) {
      logger.quotaExceeded({ provider: p.name });
      continue;
    }
    const t0 = Date.now();
    try {
      const raw = await p.callJson(env, args);
      opts.validate?.(raw);
      logger.llmCall({ kind, provider: p.name, ok: true, latencyMs: Date.now() - t0, failedOver });
      return { raw, provider: p.name };
    } catch (e) {
      logger.llmCall({ kind, provider: p.name, ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
      failedOver = true;
    }
  }
  throw new ChainExhaustedError();
}
