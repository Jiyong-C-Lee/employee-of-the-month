// Gemini generateContent 공통 호출 (구조화 JSON). 원본 server/llm.js 이식 —
// process.env → env 인자, hasKey(env)로 변경 외 로직 동일.
import { parseLenientJson } from '../parse';
import type { Env } from '../../env';
import type { LlmArgs, Provider } from '../chain';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 우리 JSON 스키마의 type(소문자)을 Gemini Schema enum(대문자)로 변환.
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

async function callJson(env: Env, { system, user, schema, temperature = 0.9, timeoutMs = 30000 }: LlmArgs, key?: string): Promise<unknown> {
  if (!key) throw new Error('GOOGLE_AI_STUDIO_API_KEY missing');
  const model = env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema),
      temperature,
    },
  };
  const url = `${BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const parts = data.candidates?.[0]?.content?.parts || [];
  const jsonText = parts.map((p) => p.text || '').join('').trim();
  if (!jsonText) throw new Error('Gemini empty response');
  return parseLenientJson(jsonText);
}

function makeGemini(name: string, pickKey: (env: Env) => string | undefined): Provider {
  return {
    name,
    hasKey: (env) => Boolean(pickKey(env)),
    callJson: (env, args) => callJson(env, args, pickKey(env)),
  };
}

// 체인 순서는 chain.ts가 정한다: 무료 → 유료 → nvidia.
export const geminiFree = makeGemini('gemini-free', (env) => env.GOOGLE_AI_STUDIO_FREE_API_KEY);
export const gemini = makeGemini('gemini', (env) => env.GOOGLE_AI_STUDIO_API_KEY);
