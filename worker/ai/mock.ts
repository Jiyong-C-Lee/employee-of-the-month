// 3종 AI 호출 mock: 키 없음/실패 시 폴백. 대사 템플릿은 @content(global/strings.json)에서 읽는다.
// 원본 server/sycophant/mock.js 이식 — 로직 동일.
import { STRINGS, fmt, type FullPersona } from '@content';
import type { Situation } from '@shared';
import { APPROACHES, type Candidate } from './prompts';

function seeded(str: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Advisor = FullPersona['advisors'][number];

interface AdvisorSpeech { name: string; text: string; approach: string }
interface JudgeSpeaker { key: string; axisScores: Record<string, number>; comment: string }

// 조언자 발언 배치 mock: 순서대로 앞사람을 받아치고, 축은 겹치지 않게 배정.
export function mockAdvisorTurnsBatch(
  { advisors, situation }: { persona: FullPersona; advisors: Advisor[]; situation: Situation },
): { speeches: AdvisorSpeech[] } {
  const templates = STRINGS.mock.advisorTemplates as Record<string, string | string[]>;
  const speeches: AdvisorSpeech[] = [];
  const used: string[] = [];
  for (const advisor of advisors) {
    const base = fmt(templates[advisor.style] || templates['실리파'], { question: situation.question });
    const last = speeches[speeches.length - 1];
    const prefix = last ? fmt(STRINGS.mock.advisorRebutPrefix as string | string[], { lastName: last.name }) : '';
    const approach = APPROACHES.find((a) => !used.includes(a)) ?? APPROACHES[0]!;
    used.push(approach);
    speeches.push({ name: advisor.name, text: (prefix + base).slice(0, 160), approach });
  }
  return { speeches };
}

export function mockJudgeSpeeches(
  { persona, situation, candidates }: { persona: FullPersona; situation: Situation; candidates: Candidate[] },
): { perSpeaker: JudgeSpeaker[]; adoptedKey: string | null; adoptReason: string } {
  const perSpeaker = candidates.map((c) => {
    const rng = seeded(c.key + situation.question);
    const base = Math.max(2, Math.min(8, Math.round(c.text.length / 15)));
    const axisScores: Record<string, number> = {};
    for (const ax of persona.axes) axisScores[ax] = Math.max(0, Math.min(10, base + Math.floor(rng() * 4) - 1));
    return { key: c.key, axisScores, comment: String(STRINGS.mock.judgeComment) };
  });
  // mock의 지목은 서버 재계산과 무관 — finalizeVerdict가 교정
  return { perSpeaker, adoptedKey: perSpeaker[0]?.key ?? null, adoptReason: String(STRINGS.mock.judgeReason) };
}

export function mockEpilogue(
  { persona, adopted }: { persona: FullPersona; situation: Situation; adopted: { name: string; text: string } },
): { story: string } {
  return { story: fmt(STRINGS.mock.epilogue as string | string[], { personaName: persona.name, adoptedName: adopted.name }) };
}
