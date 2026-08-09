import { parseLenientJson } from '../parse.js';
import type { ChainContext, ChainRequest, JsonSchema, ProviderAdapter } from '../types.js';

const BASE = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-5-mini';

function toSystemUser(req: ChainRequest): { system: string; user: string; schema?: JsonSchema } {
  if ('system' in req) return { system: req.system, user: req.user, schema: req.schema };
  const system = req.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
  const user = req.messages.filter((message) => message.role !== 'system').map((message) => message.content).join('\n');
  return { system, user, schema: req.schema };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, doFetch: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type OpenAIResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export const openaiAdapter: ProviderAdapter = {
  name: 'openai',
  caps: { json: true, tools: false, cache: 'none' },
  async call(req, ctx, model) {
    const key = ctx.env.OPEN_AI_API_KEY;
    if (!key) throw new Error('OPEN_AI_API_KEY missing');

    const { system, user, schema } = toSystemUser(req);
    const responseFormat = schema
      ? { type: 'json_schema' as const, json_schema: { name: 'llm_response', strict: false, schema } }
      : { type: 'json_object' as const };
    const body = {
      model: model || ctx.env.OPENAI_MODEL || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: `${system}\n\nReturn only valid JSON.` },
        { role: 'user', content: user },
      ],
      response_format: responseFormat,
    };
    const response = await fetchWithTimeout(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    }, req.timeoutMs ?? 30_000, ctx.fetchImpl ?? fetch);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('OpenAI empty response');
    return {
      raw: parseLenientJson(content),
      provider: 'openai',
      usage: { in: data.usage?.prompt_tokens ?? 0, out: data.usage?.completion_tokens ?? 0, cached: 0 },
    };
  },
};
