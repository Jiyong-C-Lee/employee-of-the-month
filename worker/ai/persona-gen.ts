// 커스텀 페르소나 1콜 생성 — 기존 체인 재사용, mock 폴백 없음(키 없으면 에러).
import { z } from 'zod';
import { PROMPTS, fmt, personaMetaSchema, situationsSchema } from '@content';
import type { Llm } from '@narre/cf';
import type { JsonSchema } from '@narre/llm';

export const personaGenInputSchema = z.object({
  name: z.string().trim().min(1).max(20),
  concept: z.string().trim().min(2).max(300),
  voiceHint: z.string().trim().max(200).optional(),
  taboo: z.string().trim().max(200).optional(),
  axes: z.array(z.string().trim().min(1).max(12)).min(1).max(5).optional(),
});
export type PersonaGenInput = z.infer<typeof personaGenInputSchema>;

// 생성 결과는 id 없는 팩 — id는 라우트가 custom-* 로 부여한다.
export const generatedPersonaSchema = personaMetaSchema
  .omit({ id: true, lines: true })
  .extend({ situations: situationsSchema });
export type GeneratedPersona = z.infer<typeof generatedPersonaSchema>;

export function personaGenUser(input: PersonaGenInput): string {
  const opt = (v?: string) => (v && v.length > 0 ? v : '(AI가 정한다)');
  return [
    `# 보스 이름 (변경 금지): ${input.name}`,
    `# 컨셉: ${input.concept}`,
    `# 말투 힌트: ${opt(input.voiceHint)}`,
    `# 역린 (건드리면 안 되는 것): ${opt(input.taboo)}`,
    `# 채점축 희망: ${input.axes?.length ? input.axes.join(', ') : '(AI가 정한다)'}`,
  ].join('\n');
}

// 반환형이 object면 체인의 JsonSchema(Record<string, unknown>)에 안 맞는다 — 인덱스 시그니처가 없다.
function personaGenSchema(): JsonSchema {
  const str = { type: 'string' };
  const strArr = (n: number) => ({ type: 'array', items: str, minItems: n, maxItems: n });
  return {
    type: 'object',
    properties: {
      name: str, emoji: str, intro: str,
      axes: strArr(3), ranks: strArr(7),
      personaPrompt: str, judgeAddress: str, listenerBrief: str,
      advisors: {
        type: 'array', minItems: 4, maxItems: 4,
        items: {
          type: 'object',
          properties: { name: str, emoji: str, style: str, core: str, voice: str, quirks: { type: 'array', items: str, minItems: 5, maxItems: 6 } },
          required: ['name', 'emoji', 'style', 'core', 'voice', 'quirks'],
        },
      },
      situations: {
        type: 'array', minItems: 10, maxItems: 10,
        items: { type: 'object', properties: { text: str, question: str }, required: ['text', 'question'] },
      },
    },
    required: ['name', 'emoji', 'intro', 'axes', 'ranks', 'personaPrompt', 'judgeAddress', 'listenerBrief', 'advisors', 'situations'],
  };
}

// llm은 호출부가 주입한다 — env·쿼터 배선은 worker/ai/llm.ts의 makeLlm이 들고 있다.
export async function generatePersona(
  llm: Llm,
  input: PersonaGenInput,
): Promise<GeneratedPersona> {
  const { raw } = await llm(
    { system: fmt(PROMPTS.personaGenSystem), user: personaGenUser(input), schema: personaGenSchema(), temperature: 1.0, timeoutMs: 60000 },
    { kind: 'persona-gen', validate: (r) => { generatedPersonaSchema.parse(r); } },
  );
  const persona = generatedPersonaSchema.parse(raw);
  persona.name = input.name; // 이름은 입력이 정답
  return persona;
}
