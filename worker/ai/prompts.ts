// 3종 AI 호출의 프롬프트 조립 + responseSchema. 원본 server/sycophant/prompts.js 이식 — 로직 동일.
// 프롬프트 본문은 @content(global/prompts.json) — 이 파일은 토큰 치환과 스키마만 담당.
import { PROMPTS, fmt, type FullPersona } from '@content';
import type { Situation, Difficulty } from '@shared';

export const DIFFICULTY = PROMPTS.difficulty; // { easy|normal|hard: 결점 스펙 문장 }
export const APPROACHES = PROMPTS.approaches; // 조언자 해법 축 (중복 금지 강제용)

export interface Candidate { key: string; name: string; kind: 'ai' | 'user'; order: number; text: string }

// 시나리오 모드 라운드 기록 — 판정의 "이전 라운드 기억"과 브릿지 생성이 공유한다.
export interface HistoryEntry { situationText: string; adoptedText: string | null; outcome?: string }

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

export function judgeSystem(persona: FullPersona, difficulty: Difficulty = 'normal', hasHistory = false): string {
  return fmt(PROMPTS.judgeSystem, {
    personaName: persona.name,
    personaPrompt: persona.personaPrompt,
    axes: persona.axes.join(', '),
    // 호칭·말투는 인물 데이터가 정한다 (사극체 "그대" 하드코딩 금지)
    addr: persona.judgeAddress || PROMPTS.judgeDefaultAddress,
    // 사람 우대는 순한맛(easy) 한정. 시나리오 히스토리 규칙은 기록이 있을 때만 얹는다.
    humanBias: (difficulty === 'easy' ? `\n${PROMPTS.judgeHumanBiasLine}` : '')
      + (hasHistory ? `\n${PROMPTS.judgeHistoryRules}` : ''),
  });
}

export function judgeUser(persona: FullPersona, situation: Situation, candidates: Candidate[], history: HistoryEntry[] = []): string {
  const lines: string[] = [];
  if (history.length > 0) {
    lines.push('# 지난 라운드 기록 (오래된 것부터)');
    for (const h of history) {
      lines.push(`- 상황: ${h.situationText}`);
      lines.push(`  채택: ${h.adoptedText ?? '채택 없음'}`);
      if (h.outcome) lines.push(`  결과: ${h.outcome}`);
    }
    lines.push('');
  }
  lines.push(`# 상황`, situation.text, `# ${persona.name}의 물음: ${situation.question}`, '', '# 의견 (발언 순서대로)');
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
  // personaIntro: 보스가 어느 회사의 누구인지 — 상황 속 타사(도원컴퍼니 등)로 시점이 새는 것을 막는다.
  return fmt(PROMPTS.epilogueSystem, { personaName: persona.name, personaIntro: persona.intro });
}

export function epilogueUser(persona: FullPersona, situation: Situation, adopted: { name: string; text: string }): string {
  return [`# 상황`, situation.text, `# 물음: ${situation.question}`, '', `# 채택된 간언 (${adopted.name})`, adopted.text].join('\n');
}

export function epilogueSchema() {
  return { type: 'object', properties: { story: { type: 'string' } }, required: ['story'] };
}

// ---- 시나리오 브릿지 (라운드 사이 보스의 회고 한마디) ----

export function bridgeSystem(persona: FullPersona): string {
  return fmt(PROMPTS.bridgeSystem, { personaName: persona.name, personaPrompt: persona.personaPrompt });
}

export function bridgeUser(
  persona: FullPersona,
  prevSituation: Situation,
  adopted: { name: string; text: string } | null,
  nextSituation: Situation,
  lead?: string,
): string {
  return [
    `# 지난 상황`,
    prevSituation.text,
    '',
    adopted ? `# 채택한 간언 (${adopted.name})` : '# 채택한 간언',
    adopted ? adopted.text : '없음 — 쓸 만한 안이 하나도 없어 채택하지 않았다.',
    '',
    `# 다음 상황 (곧이어 따로 공개된다 — 세부 내용을 재서술하지 마라)`,
    nextSituation.text,
    ...(lead ? ['', `# 다음 상황으로 넘어가는 도입 방향 (이 인과를 따르되, 문장을 그대로 베끼지 마라)`, lead] : []),
  ].join('\n');
}

export function bridgeSchema() {
  return { type: 'object', properties: { bridge: { type: 'string' } }, required: ['bridge'] };
}
