// Gemini generateContent 어댑터 — 무료/유료는 키 env 변수만 다른 동일 로직(createGeminiAdapter로 팩토리화).
// 원본: marriage_problem/server/llm.mjs의 geminiCall + toGeminiSchema.
import { parseLenientJson } from '../parse.js';
import type { ChainContext, ChainRequest, ChainResult, JsonSchema, ProviderAdapter } from '../types.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-flash-lite-latest';

// 우리 JSON 스키마의 type(소문자)을 Gemini Schema enum(대문자)로 변환.
// providers/gemini.ts 내부 전용 — index.ts에서 export하지 않는다(스펙 §Interfaces).
function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'type' && typeof v === 'string') out[k] = v.toUpperCase();
      else out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return node;
}

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

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
};

async function call(req: ChainRequest, ctx: ChainContext, model: string, key: string | undefined): Promise<ChainResult> {
  if ('tools' in req && req.tools?.length) {
    throw new Error('tools: 미구현 — 첫 소비자에서 구현');
  }
  if (!key) throw new Error('Gemini key missing');
  const { system, user, schema } = toSystemUser(req);
  const resolvedModel = model || ctx.env.GEMINI_MODEL || DEFAULT_MODEL;
  const temperature = req.temperature ?? 0.9;
  const timeoutMs = req.timeoutMs ?? 30000;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema),
      temperature,
    },
  };
  const url = `${BASE}/${encodeURIComponent(resolvedModel)}:generateContent?key=${encodeURIComponent(key)}`;
  const doFetch = ctx.fetchImpl ?? fetch;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs, doFetch);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as GeminiResponse;
  const parts = data.candidates?.[0]?.content?.parts || [];
  const jsonText = parts.map((p) => p.text || '').join('').trim();
  if (!jsonText) throw new Error('Gemini empty response');
  const raw = parseLenientJson(jsonText);
  const u = data.usageMetadata;
  return {
    raw,
    provider: '',
    usage: { in: u?.promptTokenCount ?? 0, out: u?.candidatesTokenCount ?? 0, cached: u?.cachedContentTokenCount ?? 0 },
  };
}

// 무료/유료 gemini는 키를 읽는 env 변수만 다른 동일 어댑터 — 이름을 지정해 registry.ts가 두 번 등록한다.
export function createGeminiAdapter(name: string, keyEnvVar: string): ProviderAdapter {
  return {
    name,
    caps: { json: true, tools: true, cache: 'implicit' },
    async call(req, ctx, model) {
      const result = await call(req, ctx, model, ctx.env[keyEnvVar]);
      return { ...result, provider: name };
    },
  };
}
