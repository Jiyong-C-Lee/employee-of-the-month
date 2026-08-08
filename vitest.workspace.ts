// 원본은 워크스페이스 3개(worker·web·content)에 vitest 설정도 3개였다. 평탄화로 워크스페이스가
// 하나가 되면서 런타임이 다른 테스트가 한 곳에 모였다 — 워커 테스트는 Workers 런타임이,
// 콘텐츠·웹 테스트는 Node가 필요하다. 프로젝트로 나눠 각자 제 런타임에서 돌린다.
//
// 워커 프로젝트는 wrangler.jsonc의 main(worker/index.ts)이 있어야 뜬다. 이관 중에는
// `vitest run --project node`로 순수 로직만 먼저 돌린다.
export default ['./vitest.node.config.ts', './worker/vitest.config.ts'];
