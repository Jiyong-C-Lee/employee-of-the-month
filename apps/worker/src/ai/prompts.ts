// 3종 AI 호출의 프롬프트 조립 + responseSchema. 원본 server/sycophant/prompts.js 이식 — 로직 동일.
// 프롬프트 본문은 @eotm/content(global/prompts.json) — 이 파일은 토큰 치환과 스키마만 담당.
import { PROMPTS, fmt, type FullPersona } from '@eotm/content';
import type { Situation, Difficulty } from '@eotm/shared';

export const DIFFICULTY = PROMPTS.difficulty; // { easy|normal|hard: 결점 스펙 문장 }
export const APPROACHES = PROMPTS.approaches; // 조언자 해법 축 (중복 금지 강제용)

export interface Candidate { key: string; name: string; kind: 'ai' | 'user'; order: number; text: string }

type Advisor = FullPersona['advisors'][number];

// ---- 조언자 발언 배치 생성 (라운드당 1콜 — 레이트리밋 대응, 뒤 참모가 앞 참모를 반박하는 릴레이는 프롬프트가 유지) ----

// quirks: 참모 이름 → 이번 라운드에 쓸 버릇 (null이면 버릇 없이 안건에만 집중).
// approaches: 참모 이름 → 이번 라운드 해법 축. 모두 라운드마다 코드가 샘플링해 넘긴다 —
// 무상태 LLM 호출이라도 라운드 간 다양성을 코드가 보장한다(모델 자율에 맡기면 같은 축·같은 개그로 쏠린다).
export function advisorBatchSystem(
  persona: FullPersona,
  advisors: Advisor[],
  difficulty: Difficulty = 'normal',
  quirks: Record<string, string | null> = {},
  approaches: Record<string, string> = {},
): string {
  const advisorRoster = advisors
    .map((a, i) => {
      const quirk = quirks[a.name];
      const voice = a.voice ? ` / 말투: ${a.voice}` : '';
      const axis = approaches[a.name] ? ` / 이번 해법 축: ${approaches[a.name]}` : '';
      return `${i + 1}. ${a.name} (${a.style}) — 성향: ${a.core}${voice}${axis} / 이번 버릇: ${quirk ?? '없음 — 안건에만 집중한다'}`;
    })
    .join('\n');
  return fmt(PROMPTS.advisorBatchSystem, {
    personaName: persona.name,
    listenerBrief: persona.listenerBrief || persona.intro,
    advisorRoster,
    flaw: DIFFICULTY[difficulty] ?? DIFFICULTY.normal,
  });
}

export function advisorBatchUser(persona: FullPersona, situation: Situation): string {
  return [
    `# 상황`,
    situation.text,
    `# ${persona.name}의 물음: ${situation.question}`,
  ].join('\n');
}

export function advisorBatchSchema() {
  return {
    type: 'object',
    properties: {
      speeches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            text: { type: 'string' },
            approach: { type: 'string', enum: APPROACHES },
          },
          required: ['name', 'text', 'approach'],
        },
      },
    },
    required: ['speeches'],
  };
}

// ---- 판정 ----

export function judgeSystem(persona: FullPersona, difficulty: Difficulty = 'normal'): string {
  return fmt(PROMPTS.judgeSystem, {
    personaName: persona.name,
    personaPrompt: persona.personaPrompt,
    axes: persona.axes.join(', '),
    // 호칭·말투는 인물 데이터가 정한다 (사극체 "그대" 하드코딩 금지)
    addr: persona.judgeAddress || PROMPTS.judgeDefaultAddress,
    // 사람 우대는 순한맛(easy) 한정
    humanBias: difficulty === 'easy' ? `\n${PROMPTS.judgeHumanBiasLine}` : '',
  });
}

export function judgeUser(persona: FullPersona, situation: Situation, candidates: Candidate[]): string {
  const lines = [`# 상황`, situation.text, `# ${persona.name}의 물음: ${situation.question}`, '', '# 의견 (발언 순서대로)'];
  for (const c of candidates) lines.push(`[${c.key}] ${c.name}${c.kind === 'ai' ? ' (참모)' : ''}: ${c.text}`);
  return lines.join('\n');
}

export function judgeSchema(axes: string[]) {
  const axisProps = Object.fromEntries(axes.map((ax) => [ax, { type: 'integer' }]));
  return {
    type: 'object',
    properties: {
      perSpeaker: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            axisScores: { type: 'object', properties: axisProps, required: axes },
            comment: { type: 'string' },
          },
          required: ['key', 'axisScores', 'comment'],
        },
      },
      adoptedKey: { type: 'string' },
      adoptReason: { type: 'string' },
    },
    required: ['perSpeaker', 'adoptedKey', 'adoptReason'],
  };
}

// ---- 에필로그 ----

export function epilogueSystem(persona: FullPersona): string {
  return fmt(PROMPTS.epilogueSystem, { personaName: persona.name });
}

export function epilogueUser(persona: FullPersona, situation: Situation, adopted: { name: string; text: string }): string {
  return [`# 상황`, situation.text, `# 물음: ${situation.question}`, '', `# 채택된 간언 (${adopted.name})`, adopted.text].join('\n');
}

export function epilogueSchema() {
  return { type: 'object', properties: { story: { type: 'string' } }, required: ['story'] };
}
