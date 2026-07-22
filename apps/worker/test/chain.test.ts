import { test, expect, vi, afterEach } from 'vitest';
import { callJsonChain, ChainExhaustedError } from '../src/ai/chain';
import type { Env } from '../src/env';

const env = {
  GOOGLE_AI_STUDIO_API_KEY: 'g-key', NVIDIA_API_KEY: 'n-key',
  GEMINI_MODEL: 'gemini-x', NVIDIA_MODEL: 'nv-x',
} as Env;
const args = { system: 's', user: 'u', schema: { type: 'object' } };

afterEach(() => vi.unstubAllGlobals());

function geminiOk(json: object) {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] });
}
function nvidiaOk(json: object) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(json) } }] });
}

test('gemini 성공 시 gemini 결과', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => geminiOk({ a: 1 })));
  const r = await callJsonChain(env, args);
  expect(r.provider).toBe('gemini');
  expect(r.raw).toEqual({ a: 1 });
});

test('gemini 429 → nvidia 페일오버', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).includes('generativelanguage') ? new Response('rate', { status: 429 }) : nvidiaOk({ b: 2 })));
  const r = await callJsonChain(env, args);
  expect(r.provider).toBe('nvidia');
  expect(r.raw).toEqual({ b: 2 });
});

test('validate 실패도 페일오버 사유', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).includes('generativelanguage') ? geminiOk({ bad: true }) : nvidiaOk({ good: true })));
  const r = await callJsonChain(env, args, {
    validate: (raw) => { if ((raw as { bad?: boolean }).bad) throw new Error('bad shape'); },
  });
  expect(r.provider).toBe('nvidia');
});

test('키 없는 공급자는 건너뛰고, 전부 실패면 ChainExhaustedError', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));
  await expect(callJsonChain({ ...env, NVIDIA_API_KEY: undefined } as Env, args)).rejects.toThrow(ChainExhaustedError);
});

test('quotaTake가 false면 그 공급자 스킵', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => nvidiaOk({ c: 3 })));
  const r = await callJsonChain(env, args, { quotaTake: async (p) => p !== 'gemini' });
  expect(r.provider).toBe('nvidia');
});
