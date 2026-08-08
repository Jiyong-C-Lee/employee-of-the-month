// NVIDIA NIM (OpenAI 호환 chat completions) 어댑터. tools 미지원(caps.tools=false) — selectProviders가 걸러낸다.
// 원본: marriage_problem/server/llm.mjs의 nvidiaCall.
import { parseLenientJson } from '../parse.js';
import type { ChainContext, ChainRequest, JsonSchema, ProviderAdapter } from '../types.js';

const BASE = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';

function toSystemUser(req: ChainRequest): { system: string; user: string; schema?: JsonSchema } {
  if ('system' in req) return { system: req.system, user: req.user, schema: req.schema };
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const user = req.messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n');
  return { system, user, schema: req.schema };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, doFetch: typeof fetch): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

type NvidiaResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export const nvidiaAdapter: ProviderAdapter = {
  name: 'nvidia',
  caps: { json: true, tools: false, cache: 'none' },
  async call(req, ctx, model) {
    const key = ctx.env.NVIDIA_API_KEY;
    if (!key) throw new Error('NVIDIA_API_KEY missing');
    const { system, user, schema } = toSystemUser(req);
    const resolvedModel = model || ctx.env.NVIDIA_MODEL || DEFAULT_MODEL;
    const temperature = req.temperature ?? 0.9;
    const timeoutMs = req.timeoutMs ?? 30000;
    const body = {
      model: resolvedModel,
      messages: [
        { role: 'system', content: `${system}\n\n다음 JSON 스키마를 정확히 따르는 JSON만 출력한다. 다른 텍스트 금지.\n${JSON.stringify(schema)}` },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: 2048,
      nvext: { guided_json: schema },
    };
    const doFetch = ctx.fetchImpl ?? fetch;
    const res = await fetchWithTimeout(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    }, timeoutMs, doFetch);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`NVIDIA HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as NvidiaResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('NVIDIA empty response');
    const raw = parseLenientJson(content);
    return {
      raw,
      provider: 'nvidia',
      usage: { in: data.usage?.prompt_tokens ?? 0, out: data.usage?.completion_tokens ?? 0, cached: 0 },
    };
  },
};
