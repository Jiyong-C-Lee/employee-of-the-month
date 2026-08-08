import { describe, it, expect } from 'vitest';
import { selectProviders } from '../src/select.js';
import type { ProviderAdapter } from '../src/types.js';

const mk = (name: string, tools: boolean): ProviderAdapter =>
  ({ name, caps: { json: true, tools, cache: 'none' }, call: async () => ({ provider: name, usage: { in: 0, out: 0, cached: 0 } }) });

describe('selectProviders', () => {
  const chain = [mk('gemini-free', true), mk('nvidia', false), mk('mock', true)];
  it('단순형 요청은 전체 체인을 통과시킨다', () => {
    const r = selectProviders({ system: 's', user: 'u', schema: {} }, chain);
    expect(r.map(a => a.name)).toEqual(['gemini-free', 'nvidia', 'mock']);
  });
  it('tools 요청은 tools 미지원 프로바이더를 제외한다', () => {
    const r = selectProviders({ messages: [], tools: [{ name: 't', description: '', parameters: {} }] }, chain);
    expect(r.map(a => a.name)).toEqual(['gemini-free', 'mock']);
  });
});
