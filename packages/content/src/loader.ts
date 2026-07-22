// loader.ts — 모듈 로드 시점에 전 팩·전역 데이터를 검증한다. 위반 시 팩 id·필드를 지목하며 throw.
import { RAW_PACKS } from './packs.gen';
import rawPrompts from '../global/prompts.json';
import rawStrings from '../global/strings.json';
import { personaSchema, promptsSchema, stringsSchema, type FullPersona } from './schema';

function fail(where: string, e: unknown): never {
  throw new Error(`[content] ${where} 검증 실패: ${e instanceof Error ? e.message : String(e)}`);
}

const PACKS: FullPersona[] = RAW_PACKS.map(({ persona, situations }) => {
  try {
    return personaSchema.parse({ ...persona, situations });
  } catch (e) {
    fail(`pack "${(persona as { id?: string }).id ?? '?'}"`, e);
  }
});

export const PROMPTS = (() => { try { return promptsSchema.parse(rawPrompts); } catch (e) { fail('global/prompts.json', e); } })();
export const STRINGS = (() => { try { return stringsSchema.parse(rawStrings); } catch (e) { fail('global/strings.json', e); } })();

export function getPersona(id: string): FullPersona | null {
  return PACKS.find((p) => p.id === id) ?? null;
}

// 클라이언트 공개용 요약 (프롬프트·상황 본문 제외 — 스포일러 방지)
export function listPersonas() {
  return PACKS.map((p) => ({
    id: p.id, name: p.name, emoji: p.emoji, intro: p.intro,
    axes: p.axes, ranks: p.ranks,
    advisors: p.advisors.map((a) => ({ name: a.name, emoji: a.emoji, style: a.style })),
    situationCount: p.situations.length,
  }));
}

// {token} 치환. 배열 템플릿은 줄바꿈으로 합친다. 모르는 토큰은 그대로 둔다. (원본 content.js의 fmt)
export function fmt(template: string | string[] | undefined, vars: Record<string, unknown> = {}): string {
  const s = Array.isArray(template) ? template.join('\n') : String(template ?? '');
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
