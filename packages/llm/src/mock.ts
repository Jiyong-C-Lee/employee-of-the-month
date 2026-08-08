import type { JsonSchema } from './types.js';

// 스키마에서 결정적 목업 생성 — 키 전무·전 공급자 실패 시에도 게임 흐름 유지.
// 원본: marriage_problem/server/llm.mjs, ai-speed-game/server/llm.mjs (4개 프로젝트 100% 동일 코드).
export function mockFromSchema(schema: JsonSchema, key = ''): unknown {
  if (!schema || typeof schema !== 'object') return null;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  switch (schema.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
      for (const [k, v] of Object.entries(properties)) out[k] = mockFromSchema(v, k);
      return out;
    }
    case 'array': return [mockFromSchema(schema.items as JsonSchema, key)];
    case 'string': return `[mock ${key}] 공급자 없이 동작 중입니다.`;
    case 'number':
    case 'integer': return 0;
    case 'boolean': return false;
    default: return null;
  }
}
