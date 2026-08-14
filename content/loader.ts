// loader.ts — 모듈 로드 시점에 전 팩·전역 데이터를 검증한다. 위반 시 팩 id·필드를 지목하며 throw.
import { RAW_PACKS } from './packs.gen';
import rawPrompts from './global/prompts.json';
import rawStrings from './global/strings.json';
import { personaSchema, promptsSchema, stringsSchema, type FullPersona, type SituationLink } from './schema';

function fail(where: string, e: unknown): never {
  throw new Error(`[content] ${where} 검증 실패: ${e instanceof Error ? e.message : String(e)}`);
}

const PACKS: FullPersona[] = RAW_PACKS.map(({ persona, situations }) => {
  try {
    const p = personaSchema.parse({ ...persona, situations });
    // 링크 무결성: id 중복 금지, 링크 대상 존재, branch의 then 키는 options에 있어야 하고,
    // linkedOnly 상황은 어딘가의 링크가 가리켜야 한다(아니면 영원히 등장 불가 — 저작 실수).
    const ids = new Set<string>();
    for (const s of p.situations) {
      if (!s.id) continue;
      if (ids.has(s.id)) throw new Error(`상황 id 중복: "${s.id}"`);
      ids.add(s.id);
    }
    const targets = new Set<string>();
    const checkLinks = (from: string, links: SituationLink[]) => {
      for (const l of links) {
        if (!ids.has(l.to)) throw new Error(`"${from}"의 링크 대상 "${l.to}"가 없다`);
        targets.add(l.to);
      }
    };
    for (const s of p.situations) {
      const from = s.id ?? s.text.slice(0, 20);
      if (s.then) checkLinks(from, s.then);
      if (s.branch) {
        for (const [key, links] of Object.entries(s.branch.then)) {
          if (!(key in s.branch.options)) throw new Error(`"${from}" branch.then의 키 "${key}"가 options에 없다`);
          checkLinks(from, links);
        }
      }
      if ((s.then || s.branch) && !s.id) throw new Error(`링크를 가진 상황 "${from}"에 id가 없다`);
    }
    for (const s of p.situations) {
      if (s.linkedOnly && (!s.id || !targets.has(s.id))) {
        throw new Error(`linkedOnly 상황 "${s.id ?? s.text.slice(0, 20)}"를 가리키는 링크가 없다`);
      }
    }
    return p;
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
    // 랜덤 덱 크기 기준 — linkedOnly(링크로만 등장)는 제외
    situationCount: p.situations.filter((s) => !s.linkedOnly).length,
  }));
}

// fmt는 fmt.ts에 산다 — 웹이 packs를 물지 않고 쓸 수 있어야 한다. 여기서는 재수출만.
export { fmt } from './fmt';
