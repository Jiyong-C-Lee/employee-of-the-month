// mock 어댑터 — 전 공급자 실패·키 전무 시에도 게임 흐름을 유지하기 위한 결정론적 목업 응답.
// 원본: marriage_problem/server/llm.mjs CHAIN의 mock 엔트리.
import { mockFromSchema } from '../mock.js';
import type { ChainRequest, ProviderAdapter } from '../types.js';

function schemaOf(req: ChainRequest) {
  return 'schema' in req ? req.schema : undefined;
}

export const mockAdapter: ProviderAdapter = {
  name: 'mock',
  // caps.tools=true는 미래 능력 선언 — 실제 tools 루프는 미구현이라 call()이 명시적으로 던진다.
  // tools 요청이 미지원 폴백(mock)까지 흘러 "조용히 성공"하면 소비자가 tools가 무시된 걸 못 알아채고
  // 깨진 상태로 진행하게 된다 — 그 경로를 여기서 표면화한다(스펙 §2).
  caps: { json: true, tools: true, cache: 'none' },
  async call(req) {
    if ('tools' in req && req.tools?.length) {
      throw new Error('tools: 미구현 — 첫 소비자에서 구현');
    }
    const schema = schemaOf(req);
    const raw = schema ? mockFromSchema(schema) : null;
    return { raw, provider: 'mock', usage: { in: 0, out: 0, cached: 0 } };
  },
};
