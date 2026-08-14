// LLM 공급자 체인: 기본 gemini-free(무료) → gemini(유료) → nvidia → mock.
// 원본: marriage_problem/server/llm.mjs의 callJsonChain.
//
// 확장성: 프로바이더는 이름→어댑터 레지스트리(Record)로 관리한다. 새 프로바이더 추가는
// providers/<name>.ts 파일 하나 + registerProvider() 등록 한 줄로 끝난다 — 이 파일(chain.ts)은
// 무수정. env LLM_CHAIN(쉼표 구분 어댑터 이름)으로 체인 순서·구성을 교체할 수 있다.
import type { ChainContext, ChainRequest, ChainResult, ProviderAdapter } from './types.js';
import { selectProviders } from './select.js';
import { createGeminiAdapter } from './providers/gemini.js';
import { openaiAdapter } from './providers/openai.js';
import { nvidiaAdapter } from './providers/nvidia.js';
import { mockAdapter } from './providers/mock.js';

type Env = Record<string, string | undefined>;

type RegistryEntry = {
  adapter: ProviderAdapter;
  hasKey: (env: Env) => boolean;
  quota?: string;
};

const registry: Record<string, RegistryEntry> = {
  'gemini-free': {
    adapter: createGeminiAdapter('gemini-free', 'GOOGLE_AI_STUDIO_FREE_API_KEY'),
    hasKey: (e) => Boolean(e.GOOGLE_AI_STUDIO_FREE_API_KEY),
    // 유료 gemini와 별개 버킷 — 무료 키 소진이 유료 폴백까지 막지 않게 한다.
    // env는 LLM_DAILY_LIMIT_GEMINI_FREE(신설), 유료는 기존 LLM_DAILY_LIMIT_GEMINI 그대로.
    quota: 'gemini-free',
  },
  gemini: {
    adapter: createGeminiAdapter('gemini', 'GOOGLE_AI_STUDIO_API_KEY'),
    hasKey: (e) => Boolean(e.GOOGLE_AI_STUDIO_API_KEY),
    quota: 'gemini',
  },
  nvidia: {
    adapter: nvidiaAdapter,
    hasKey: (e) => Boolean(e.NVIDIA_API_KEY),
    quota: 'nvidia',
  },
  openai: {
    adapter: openaiAdapter,
    hasKey: (e) => Boolean(e.OPEN_AI_API_KEY),
    quota: 'openai',
  },
  mock: {
    adapter: mockAdapter,
    hasKey: () => true,
  },
};

const DEFAULT_CHAIN = ['gemini-free', 'gemini', 'openai', 'nvidia', 'mock'];

/** 새 프로바이더 어댑터를 레지스트리에 등록한다. hasKey 생략 시 항상 사용 가능으로 취급. */
export function registerProvider(adapter: ProviderAdapter, hasKey: (env: Env) => boolean = () => true, quota?: string): void {
  registry[adapter.name] = { adapter, hasKey, quota };
}

export async function callJsonChain(req: ChainRequest, ctx: ChainContext): Promise<ChainResult> {
  const env = ctx.env;
  const chainNames = env.LLM_CHAIN
    ? env.LLM_CHAIN.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_CHAIN;

  const available = chainNames
    .map((name) => registry[name])
    .filter((e): e is RegistryEntry => Boolean(e))
    .filter((e) => e.hasKey(env));

  const permitted = new Set(selectProviders(req, available.map((e) => e.adapter)));
  const selected = available.filter((e) => permitted.has(e.adapter));

  const modelOverride = env[`MODEL_${ctx.kind.toUpperCase()}`] ?? '';

  let lastError: Error | null = null;
  for (const entry of selected) {
    if (entry.quota && ctx.quotaTake) {
      // 쿼터 DO 장애는 fail-open — 카운터가 아파도(QuotaDO "internal error; reference = ...")
      // 체인을 죽이지 않는다. 여기서 throw가 새면 공급자를 하나도 시도 못 하고 mock으로 떨어진다.
      let quotaOk = true;
      try {
        quotaOk = await ctx.quotaTake(entry.quota);
      } catch (e) {
        ctx.logger?.event('quota_error', { provider: entry.adapter.name, kind: ctx.kind, error: e instanceof Error ? e.message : String(e) });
      }
      if (!quotaOk) {
        ctx.logger?.event('quota_exceeded', { provider: entry.adapter.name, kind: ctx.kind });
        continue;
      }
    }
    const t0 = Date.now();
    try {
      const result = await entry.adapter.call(req, ctx, modelOverride);
      // validate는 throw식(zod 등 — 성공 시 undefined)과 boolean식(정확히 false만 실패) 둘 다 받는다.
      // 이 try 블록 안이라 throw든 false 반환이든 아래 catch에서 다음 프로바이더로 페일오버된다.
      if (ctx.validate?.(result.raw) === false) {
        throw new Error('validate failed');
      }
      ctx.logger?.event('llm_call', { kind: ctx.kind, provider: entry.adapter.name, ok: true, latencyMs: Date.now() - t0, gameId: ctx.gameId });
      return result;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      ctx.logger?.event('llm_call', { kind: ctx.kind, provider: entry.adapter.name, ok: false, latencyMs: Date.now() - t0, gameId: ctx.gameId, error: lastError.message });
    }
  }
  throw new Error(`모든 LLM 공급자 실패: ${lastError?.message ?? '?'}`);
}
