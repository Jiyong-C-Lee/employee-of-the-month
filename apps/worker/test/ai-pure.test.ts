// 원본 tests/sycoAi.test.js에서 순수 부분(mock·trimSpeech·finalizeVerdict) 이식.
import { test, expect } from 'vitest';
import { getPersona } from '@eotm/content';
import { mockAdvisorTurnsBatch, mockJudgeSpeeches, mockEpilogue } from '../src/ai/mock';
import { trimSpeech, finalizeVerdict } from '../src/ai/verdict';
import type { Candidate } from '../src/ai/prompts';

const persona = getPersona('caocao')!;
const situation = persona.situations[0]!;

test('mock 조언자 배치: 조언자 수만큼, 160자 이내, approach 부여', () => {
  const r = mockAdvisorTurnsBatch({ persona, advisors: persona.advisors, situation });
  expect(r.speeches.length).toBe(persona.advisors.length);
  for (const s of r.speeches) {
    expect(s.name && s.text).toBeTruthy();
    expect(s.text.length).toBeLessThanOrEqual(160);
  }
});

test('mock 조언자 배치: 둘째부터 앞사람을 받아치고, approach가 겹치지 않는다', () => {
  const r = mockAdvisorTurnsBatch({ persona, advisors: persona.advisors, situation });
  expect(r.speeches[1]!.text).toContain(r.speeches[0]!.name);
  const approaches = r.speeches.map((s) => s.approach);
  expect(new Set(approaches).size).toBe(approaches.length);
});

test('mock 판정: 모든 후보에 전 축 점수', () => {
  const candidates: Candidate[] = [
    { key: 's1', name: '발언자1', kind: 'ai', order: 0, text: '살려서 쓰소서.' },
    { key: 's2', name: '발언자2', kind: 'user', order: 1, text: '베어야 합니다.' },
  ];
  const raw = mockJudgeSpeeches({ persona, situation, candidates });
  expect(raw.perSpeaker.length).toBe(2);
  for (const s of raw.perSpeaker) {
    for (const ax of persona.axes) expect(Number.isInteger(s.axisScores[ax])).toBe(true);
    expect(s.comment).toBeTruthy();
  }
});

test('trimSpeech: 초과 시 문장 끝에서 끊는다', () => {
  const short = '짧은 발언입니다.';
  expect(trimSpeech(short)).toBe(short);
  const t = '가나다. '.repeat(50);
  const cut = trimSpeech(t, 160);
  expect(cut.length).toBeLessThanOrEqual(170);
  expect(cut.endsWith('.')).toBe(true);
});

test('finalizeVerdict: 클램프 + 서버 채택 재계산 + 불일치 시 사유 대체', () => {
  const candidates: Candidate[] = [
    { key: 'a', name: 'A', kind: 'user', order: 0, text: 'ㄱ' },
    { key: 'b', name: 'B', kind: 'user', order: 1, text: 'ㄴ' },
  ];
  const raw: { perSpeaker: { key: string; axisScores: Record<string, number>; comment: string }[]; adoptedKey: string; adoptReason: string } = {
    perSpeaker: [
      { key: 'a', axisScores: { 실리: 99, 기지: -3 }, comment: 'a평' },
      { key: 'b', axisScores: { 실리: 9, 기지: 9, 체면: 9 }, comment: 'b평' },
    ],
    adoptedKey: 'a',
    adoptReason: 'A 최고',
  };
  const v = finalizeVerdict(raw, candidates, ['실리', '기지', '체면']);
  expect(v.adoptedKey).toBe('b');
  expect(v.adoptReason).not.toBe('A 최고');
  const a = v.perSpeaker.find((s) => s.key === 'a')!;
  expect(a.axisScores['실리']).toBe(10);
  expect(a.axisScores['기지']).toBe(0);
  expect(a.total).toBe(10);
});

test('finalizeVerdict: 모델이 key 대신 이름을 돌려줘도 매칭된다', () => {
  const advisor = persona.advisors[0]!;
  const axes = persona.axes;
  const candidates: Candidate[] = [
    { key: `ai:${advisor.name}`, name: advisor.name, kind: 'ai', order: 0, text: 'ㄱ' },
    { key: 'p1a2b3c4', name: '유저', kind: 'user', order: 1, text: 'ㄴ' },
  ];
  const scoresAdvisor = Object.fromEntries(axes.map((ax, i) => [ax, (i * 2) % 11]));
  const scoresUser = Object.fromEntries(axes.map((ax, i) => [ax, (i * 3 + 1) % 11]));
  const raw = {
    perSpeaker: [
      { key: advisor.name, axisScores: scoresAdvisor, comment: '조언자평' },
      { key: '유저', axisScores: scoresUser, comment: '유저평' },
    ],
    adoptedKey: '유저',
    adoptReason: '유저 채택 사유',
  };
  const v = finalizeVerdict(raw, candidates, axes);
  expect(v.adoptedKey).toBe('p1a2b3c4');
  expect(v.adoptReason).toBe('유저 채택 사유'); // 지목 일치로 인정 → 사유 유지
  const advisorSpeaker = v.perSpeaker.find((s) => s.key === `ai:${advisor.name}`)!;
  const expectedTotal = Object.values(scoresAdvisor).reduce((sum: number, n: number) => sum + Math.max(0, Math.min(10, n)), 0);
  expect(advisorSpeaker.total).toBe(expectedTotal);
});

test('mock 에필로그: 이야기 생성', () => {
  const r = mockEpilogue({ persona, situation, adopted: { name: '유저', text: '베소서' } });
  expect(r.story.length).toBeGreaterThan(10);
});
