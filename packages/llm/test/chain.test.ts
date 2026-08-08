import { describe, it, expect } from 'vitest';
import { callJsonChain, registerProvider } from '../src/chain.js';
import type { ChainContext, ChainRequest, ProviderAdapter } from '../src/types.js';

const SCHEMA = { type: 'object', properties: { crack: { type: 'string', enum: ['none', 'graze', 'hit'] } } };
const REQ: ChainRequest = { system: 's', user: 'u', schema: SCHEMA };

function geminiOkResponse(json: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 });
}

function nvidiaOkResponse(json: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) } }] }), { status: 200 });
}

describe('callJsonChain', () => {
  it('gemini 실패 시 nvidia로 폴백한다', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('generativelanguage')) return new Response('server error', { status: 500 });
      if (u.includes('integrate.api.nvidia.com')) return nvidiaOkResponse({ crack: 'hit' });
      throw new Error(`unexpected url: ${u}`);
    }) as typeof fetch;

    const ctx: ChainContext = {
      env: { GOOGLE_AI_STUDIO_FREE_API_KEY: 'fake-key', NVIDIA_API_KEY: 'fake-key' },
      kind: 'test',
      fetchImpl,
    };
    const result = await callJsonChain(REQ, ctx);
    expect(result.provider).toBe('nvidia');
    expect(result.raw).toEqual({ crack: 'hit' });
    expect(calls.some((u) => u.includes('generativelanguage'))).toBe(true);
  });

  it('키가 없으면 mock까지 떨어져도 결과를 낸다', async () => {
    const ctx: ChainContext = { env: {}, kind: 'test' };
    const result = await callJsonChain(REQ, ctx);
    expect(result.provider).toBe('mock');
    expect(result.raw).toEqual({ crack: 'none' });
  });

  it('MODEL_JUDGE env가 judge kind의 모델을 바꾼다', async () => {
    const capturedUrls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      capturedUrls.push(String(url));
      return geminiOkResponse({ crack: 'none' });
    }) as typeof fetch;

    const ctx: ChainContext = {
      env: { GOOGLE_AI_STUDIO_FREE_API_KEY: 'fake-key', MODEL_JUDGE: 'custom-judge-model' },
      kind: 'judge',
      fetchImpl,
    };
    const result = await callJsonChain(REQ, ctx);
    expect(result.provider).toBe('gemini-free');
    expect(capturedUrls[0]).toContain(encodeURIComponent('custom-judge-model'));
  });

  it('quotaTake가 false면 해당 프로바이더를 건너뛴다', async () => {
    const calledUrls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      calledUrls.push(u);
      if (u.includes('integrate.api.nvidia.com')) return nvidiaOkResponse({ crack: 'graze' });
      throw new Error(`unexpected url: ${u}`);
    }) as typeof fetch;

    const ctx: ChainContext = {
      env: { GOOGLE_AI_STUDIO_FREE_API_KEY: 'fake-key', NVIDIA_API_KEY: 'fake-key' },
      kind: 'test',
      fetchImpl,
      // gemini-free/gemini는 쿼터명이 분리돼 있으므로(defect 2 수정) 둘 다 막아야 gemini 계열
      // 전체를 건너뛰는 이 테스트의 원래 의도(quota 소진 시 스킵)가 보존된다.
      quotaTake: async (provider) => !provider.startsWith('gemini'),
    };
    const result = await callJsonChain(REQ, ctx);
    expect(result.provider).toBe('nvidia');
    expect(calledUrls.some((u) => u.includes('generativelanguage'))).toBe(false);
  });

  it('tools 요청은 mock까지 떨어져도 조용히 성공하지 않고 에러가 표면화된다', async () => {
    const toolsReq: ChainRequest = {
      messages: [{ role: 'user', content: 'u' }],
      tools: [{ name: 't', description: '', parameters: {} }],
    };
    // 키가 전무 → gemini-free/gemini/nvidia는 hasKey에서 걸러지고 mock만 남는다.
    const ctx: ChainContext = { env: {}, kind: 'test' };
    await expect(callJsonChain(toolsReq, ctx)).rejects.toThrow(/tools: 미구현/);
  });

  it('레지스트리에 어댑터를 추가하고 LLM_CHAIN으로 지정하면 chain.ts 무수정으로 동작한다 (확장성 증명)', async () => {
    const fakeAdapter: ProviderAdapter = {
      name: 'fake-test-adapter',
      caps: { json: true, tools: false, cache: 'none' },
      async call() {
        return { raw: { crack: 'fake' }, provider: 'fake-test-adapter', usage: { in: 0, out: 0, cached: 0 } };
      },
    };
    registerProvider(fakeAdapter);

    const ctx: ChainContext = { env: { LLM_CHAIN: 'fake-test-adapter' }, kind: 'test' };
    const result = await callJsonChain(REQ, ctx);
    expect(result.provider).toBe('fake-test-adapter');
    expect(result.raw).toEqual({ crack: 'fake' });
  });
});

describe('callJsonChain validate 계약 (throw식·boolean식 둘 다 지원)', () => {
  // sultan·eotm·speedword 원본 검증자는 전부 zod 스타일 throw식(성공 시 undefined 반환)이다.
  // gemini-free가 항상 먼저 성공하고, validate가 실패로 판정하면 nvidia로 페일오버된다.
  function ctxWithValidate(validate: ChainContext['validate']): ChainContext {
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes('generativelanguage')) return geminiOkResponse({ crack: 'hit' });
      if (u.includes('integrate.api.nvidia.com')) return nvidiaOkResponse({ crack: 'graze' });
      throw new Error(`unexpected url: ${u}`);
    }) as typeof fetch;
    return {
      env: { GOOGLE_AI_STUDIO_FREE_API_KEY: 'fake-key', NVIDIA_API_KEY: 'fake-key' },
      kind: 'test',
      fetchImpl,
      validate,
    };
  }

  it('① throw식 검증자가 성공(undefined 반환)하면 그대로 통과한다', async () => {
    const result = await callJsonChain(REQ, ctxWithValidate(() => {
      // zod의 .parse()처럼 실패 시 throw, 성공 시 반환값 없음(undefined) — 정상 케이스.
    }));
    expect(result.provider).toBe('gemini-free');
  });

  it('② throw식 검증자가 throw하면 다음 프로바이더로 페일오버한다', async () => {
    // validate는 ctx 하나를 체인의 모든 프로바이더 호출에 공용으로 쓴다 — 첫 호출(gemini-free)만
    // 실패시키고 이후(nvidia)는 통과시켜야 "페일오버"를 검증할 수 있다(항상 throw면 전소된다).
    let calls = 0;
    const result = await callJsonChain(REQ, ctxWithValidate(() => {
      calls += 1;
      if (calls === 1) throw new Error('zod: invalid shape');
    }));
    expect(result.provider).toBe('nvidia');
  });

  it('③ boolean식 검증자가 false를 반환하면 페일오버한다', async () => {
    let calls = 0;
    const result = await callJsonChain(REQ, ctxWithValidate(() => {
      calls += 1;
      return calls !== 1;
    }));
    expect(result.provider).toBe('nvidia');
  });

  it('④ boolean식 검증자가 true를 반환하면 통과한다', async () => {
    const result = await callJsonChain(REQ, ctxWithValidate(() => true));
    expect(result.provider).toBe('gemini-free');
  });
});
