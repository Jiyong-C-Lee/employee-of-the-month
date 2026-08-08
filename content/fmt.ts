// {token} 치환. 배열 템플릿은 줄바꿈으로 합친다. 모르는 토큰은 그대로 둔다.
//
// loader.ts가 아니라 독립 파일에 둔다 — 웹(ui.ts)이 fmt를 쓰려고 loader를 물면 packs.gen이 딸려와
// 모든 상황·프롬프트가 브라우저 번들에 실린다. 격벽을 임포트 그래프 수준에서 끊는다.
export function fmt(template: string | string[] | undefined, vars: Record<string, unknown> = {}): string {
  const s = Array.isArray(template) ? template.join('\n') : String(template ?? '');
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
