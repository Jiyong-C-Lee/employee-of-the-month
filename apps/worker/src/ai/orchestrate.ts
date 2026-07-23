// 3종 AI 호출 오케스트레이션: 체인(gemini→nvidia) 시도 → mock 폴백 + 판정 검증.
// 원본 server/sycophant/ai.js 이식 — withFallback·advisorTurnsBatch(재시도·approach 재배정)·
// judgeSpeeches(익명 마스킹·복원)·makeEpilogue 로직 동일. LLM 호출부만 callJsonChain으로 교체.
import type { Env } from '../env';
import { ADVISOR_SPEECH_MAX_CHARS, type Difficulty, type Situation, type Verdict } from '@eotm/shared';
import type { FullPersona } from '@eotm/content';
import { callJsonChain } from './chain';
import { gemini, geminiFree } from './providers/gemini';
import { nvidia } from './providers/nvidia';
import * as P from './prompts';
import type { Candidate } from './prompts';
import { mockAdvisorTurnsBatch, mockJudgeSpeeches, mockEpilogue } from './mock';
import { trimSpeech, finalizeVerdict } from './verdict';
import { advisorBatchOut, judgeOut, epilogueOut } from './schemas';

type Advisor = FullPersona['advisors'][number];

export interface Deps {
  env: Env;
  quotaTake?: (provider: string) => Promise<boolean>;
  roomCode?: string; // 로그용 — llm_call을 세션에 귀속
}

type Source = string; // 공급자 이름(gemini-free|gemini|nvidia) 또는 mock|mock(fallback)

function hasAnyKey(env: Env): boolean {
  return geminiFree.hasKey(env) || gemini.hasKey(env) || nvidia.hasKey(env);
}

// 체인(가능한 공급자 전부) 시도 → 실패 시 mock. 키 자체가 없으면 체인을 건너뛰고 바로 mock.
async function withFallback<T>(
  deps: Deps,
  chainFn: () => Promise<{ value: T; provider: string }>,
  mockFn: () => T,
): Promise<T & { source: Source }> {
  if (hasAnyKey(deps.env)) {
    try {
      const { value, provider } = await chainFn();
      return { ...value, source: provider };
    } catch {
      return { ...mockFn(), source: 'mock(fallback)' };
    }
  }
  return { ...mockFn(), source: 'mock' };
}

// ---- 조언자 발언 배치 ----

interface AdvisorSpeech { name: string; text: string; approach: string }

// 라운드의 모든 조언자 발언을 한 번의 콜로 생성 (레이트리밋 대응).
// advisors는 발언 순서대로 — 프롬프트가 "뒤 참모는 앞 참모를 반박" 릴레이를 유지한다.
export async function advisorTurnsBatch(
  deps: Deps,
  { persona, advisors, situation, difficulty, quirks, approaches }: { persona: FullPersona; advisors: Advisor[]; situation: Situation; difficulty: Difficulty; quirks?: Record<string, string | null>; approaches?: Record<string, string> },
): Promise<{ speeches: AdvisorSpeech[]; source: Source }> {
  return withFallback(
    deps,
    async () => {
      let lastErr: Error | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { raw, provider } = await callJsonChain(
          deps.env,
          {
            system: P.advisorBatchSystem(persona, advisors, difficulty, quirks, approaches),
            user: P.advisorBatchUser(persona, situation),
            schema: P.advisorBatchSchema(),
            temperature: 1.0,
          },
          { kind: 'advisors', roomCode: deps.roomCode, quotaTake: deps.quotaTake, validate: (r) => { advisorBatchOut.parse(r); } },
        );
        const list = advisorBatchOut.parse(raw).speeches;
        // 이름 관용 매칭 → 실패 시 순서 기준 복구
        const speeches = advisors.map((a, i) => {
          const s = list.find((x) => x.name === a.name) ?? list[i];
          return s?.text ? { name: a.name, text: trimSpeech(s.text, ADVISOR_SPEECH_MAX_CHARS), approach: s.approach } : null;
        });
        if (speeches.every((s): s is AdvisorSpeech => Boolean(s))) {
          if (approaches) {
            // 코드가 배정한 축이 정답 — 모델이 딴 축을 적어 와도 배정값으로 덮어쓴다.
            for (const s of speeches) s.approach = approaches[s.name] ?? s.approach;
          } else {
            // (배정 미지정 폴백) approach 중복·무효는 남은 축으로 재배정
            const used = new Set<string>();
            for (const s of speeches) {
              if (!P.APPROACHES.includes(s.approach) || used.has(s.approach)) {
                s.approach = P.APPROACHES.find((x) => !used.has(x)) ?? P.APPROACHES[0]!;
              }
              used.add(s.approach);
            }
          }
          return { value: { speeches }, provider };
        }
        lastErr = new Error('speeches 참모 누락');
      }
      throw lastErr;
    },
    () => mockAdvisorTurnsBatch({ persona, advisors, situation }),
  );
}

// ---- 판정 ----

interface JudgeRaw {
  perSpeaker: { key: string; axisScores: Record<string, number>; comment: string }[];
  adoptedKey: string | null;
  adoptReason: string;
}

export async function judgeSpeeches(
  deps: Deps,
  { persona, situation, candidates, difficulty }: { persona: FullPersona; situation: Situation; candidates: Candidate[]; difficulty: Difficulty },
): Promise<{ verdict: Verdict; source: Source }> {
  if (candidates.length === 0) {
    return { verdict: { perSpeaker: [], adoptedKey: null, adoptReason: '', totals: {} }, source: 'mock' };
  }
  // 편향 방지: 실명(참모, 유저 닉네임)을 감추고 익명 라벨로 채점 → 결과를 실명으로 복원.
  // (이름값에 점수를 주는 것을 막고, 내용만으로 채점하게 한다)
  const masked = candidates.map((c, i) => ({
    key: `s${i + 1}`,
    name: `발언자${i + 1}`,
    kind: c.kind,
    order: c.order,
    text: c.text,
  }));
  const r = await withFallback<{ raw: JudgeRaw }>(
    deps,
    async () => {
      // 모델이 간헐적으로 일부 발언자를 누락/키 불일치로 돌려주면 1회 재시도.
      let lastErr: Error | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { raw, provider } = await callJsonChain(
          deps.env,
          {
            system: P.judgeSystem(persona, difficulty),
            user: P.judgeUser(persona, situation, masked),
            schema: P.judgeSchema(persona.axes),
            temperature: 0.7,
          },
          { kind: 'judge', roomCode: deps.roomCode, quotaTake: deps.quotaTake, validate: (r2) => { judgeOut.parse(r2); } },
        );
        const parsed = judgeOut.parse(raw);
        const found = new Set(parsed.perSpeaker.map((s) => String(s.key)));
        if (masked.every((m) => found.has(m.key) || found.has(m.name))) return { value: { raw: parsed }, provider };
        lastErr = new Error('perSpeaker 발언자 누락(키 불일치)');
      }
      throw lastErr;
    },
    () => ({ raw: mockJudgeSpeeches({ persona, situation, candidates: masked }) }),
  );
  const v = finalizeVerdict(r.raw, masked, persona.axes);
  // 익명 라벨 → 원래 발언자 복원
  const byMasked = Object.fromEntries(masked.map((m, i) => [m.key, candidates[i]!]));
  const verdict: Verdict = {
    ...v,
    perSpeaker: v.perSpeaker.map((s) => ({ ...s, key: byMasked[s.key]!.key, name: byMasked[s.key]!.name })),
    adoptedKey: v.adoptedKey ? byMasked[v.adoptedKey]!.key : null,
    totals: Object.fromEntries(Object.entries(v.totals).map(([k, t]) => [byMasked[k]?.key ?? k, t])),
  };
  return { verdict, source: r.source };
}

// ---- 에필로그 ----

export async function makeEpilogue(
  deps: Deps,
  { persona, situation, adopted }: { persona: FullPersona; situation: Situation; adopted: { name: string; text: string } },
): Promise<{ story: string; source: Source }> {
  return withFallback(
    deps,
    async () => {
      const { raw, provider } = await callJsonChain(
        deps.env,
        {
          system: P.epilogueSystem(persona),
          user: P.epilogueUser(persona, situation, adopted),
          schema: P.epilogueSchema(),
          temperature: 1.0,
        },
        { kind: 'epilogue', roomCode: deps.roomCode, quotaTake: deps.quotaTake, validate: (r) => { epilogueOut.parse(r); } },
      );
      const parsed = epilogueOut.parse(raw);
      return { value: { story: parsed.story }, provider };
    },
    () => mockEpilogue({ persona, situation, adopted }),
  );
}
