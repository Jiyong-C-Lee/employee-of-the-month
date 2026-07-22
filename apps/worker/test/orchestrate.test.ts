import { test, expect } from 'vitest';
import { getPersona } from '@eotm/content';
import { advisorTurnsBatch, judgeSpeeches, makeEpilogue } from '../src/ai/orchestrate';
import type { Env } from '../src/env';

const persona = getPersona('caocao')!;
const situation = persona.situations[0]!;
const deps = { env: {} as Env }; // 키 없음 → mock 경로

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
