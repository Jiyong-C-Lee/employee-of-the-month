// NVIDIA NIM (OpenAI 호환 chat completions). 요청은 nvext.guided_json으로 JSON Schema를
// 강제하고(NIM 구조화 출력), 프롬프트에도 스키마를 명시해 이중 방어. 응답은 관용 파싱 후
// 호출측 zod 검증 — 위반은 체인이 다음 공급자로 넘긴다.
import { parseLenientJson } from '../parse';
import type { Env } from '../../env';
import type { LlmArgs, Provider } from '../chain';

const BASE = 'https://integrate.api.nvidia.com/v1/chat/completions';

async function callJson(env: Env, { system, user, schema, temperature = 0.9, timeoutMs = 30000 }: LlmArgs): Promise<unknown> {
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error('NVIDIA_API_KEY missing');
  const body = {
    model: env.NVIDIA_MODEL,
    messages: [
      { role: 'system', content: `${system}\n\n다음 JSON 스키마를 정확히 따르는 JSON만 출력한다. 다른 텍스트 금지.\n${JSON.stringify(schema)}` },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: 2048,
    nvext: { guided_json: schema }, // NIM 구조화 출력 — 요청측 JSON Schema 강제
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NVIDIA HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('NVIDIA empty response');
  return parseLenientJson(content);
}

export const nvidia: Provider = {
  name: 'nvidia',
  hasKey: (env) => Boolean(env.NVIDIA_API_KEY),
  callJson,
};
