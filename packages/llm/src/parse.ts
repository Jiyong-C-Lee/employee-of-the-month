// 관용적 JSON 파서 — 모델이 코드펜스 등으로 감싸도 견디게 파싱.
// 원본: marriage_problem/server/llm.mjs, ai-speed-game/server/llm.mjs (4개 프로젝트 100% 동일 코드).
export function parseLenientJson(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first > 0 || last < s.length - 1) {
    if (first !== -1 && last !== -1) s = s.slice(first, last + 1);
  }
  return JSON.parse(s);
}
