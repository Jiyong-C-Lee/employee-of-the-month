import { test, expect } from 'vitest';
import { getPersona } from '@content';
import { advisorTurnsBatch, judgeSpeeches, makeEpilogue, makeBridge, type Deps } from '../ai/orchestrate';

const persona = getPersona('caocao')!;
const situation = persona.situations[0]!;

// 키 없음 → 체인을 건너뛰고 게임 고유 mock(ai/mock.ts). llm이 호출되면 안 된다.
const deps: Deps = {
  hasKey: false,
  llm: () => {
    throw new Error('키가 없는데 체인을 불렀다');
  },
};

// 키 있음 + 체인 전소 → mock(fallback). 게임 고유 mock이 살아 있는지 보는 케이스다.
const failing: Deps = {
  hasKey: true,
  llm: async () => {
    throw new Error('체인 전소');
  },
};

test('키 없으면 mock으로 조언자 배치 생성', async () => {
  const r = await advisorTurnsBatch(deps, { persona, advisors: persona.advisors, situation, difficulty: 'normal' });
  expect(r.source).toBe('mock');
  expect(r.speeches.length).toBe(persona.advisors.length);
});

test('키 없으면 mock 판정 — 익명 마스킹 복원 확인', async () => {
  const candidates = [
    { key: 'ai:박이사', name: '박이사', kind: 'ai' as const, order: 0, text: '숫자부터 봅시다.' },
    { key: 'u1', name: '유저닉', kind: 'user' as const, order: 1, text: '지릅시다.' },
  ];
  const r = await judgeSpeeches(deps, { persona, situation, candidates, difficulty: 'normal' });
  expect(r.source).toBe('mock');
  expect(r.verdict.perSpeaker.map((s) => s.key).sort()).toEqual(['ai:박이사', 'u1']);
  expect(r.verdict.perSpeaker.every((s) => s.name !== '발언자1')).toBe(true);
});

test('키 없으면 mock 에필로그', async () => {
  const r = await makeEpilogue(deps, { persona, situation, adopted: { name: '유저닉', text: '지릅시다.' } });
  expect(r.source).toBe('mock');
  expect(r.story.length).toBeGreaterThan(10);
});

// 이 케이스가 LLM_CHAIN 설정의 존재 이유다. @narre/llm 기본 체인은 마지막이 mock 어댑터라
// 절대 throw하지 않는다. 그러면 여기 catch가 안 돌고 게임 고유 mock이 죽는다.
// wrangler.jsonc의 LLM_CHAIN이 그 어댑터를 빼서 체인이 실패할 수 있게 만든다.
test('키는 있는데 체인이 전소하면 게임 고유 mock으로 떨어진다', async () => {
  const r = await advisorTurnsBatch(failing, { persona, advisors: persona.advisors, situation, difficulty: 'normal' });
  expect(r.source).toBe('mock(fallback)');
  expect(r.speeches.length).toBe(persona.advisors.length);
  // 스키마 더미가 아니라 페르소나에 맞는 실제 문장이어야 한다.
  expect(r.speeches[0]!.text.length).toBeGreaterThan(5);
});

test('키 없으면 브릿지는 빈 문자열 (생략 — 진행 무영향)', async () => {
  const r = await makeBridge(deps, {
    persona,
    prevSituation: situation,
    adopted: { name: '유저닉', text: '지릅시다.' },
    nextSituation: persona.situations[1]!,
  });
  expect(r.source).toBe('mock');
  expect(r.bridge).toBe('');
});
