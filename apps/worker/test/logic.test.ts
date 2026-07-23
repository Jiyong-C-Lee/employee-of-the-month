// 원본 tests/sycoLogic.test.js를 vitest로 이식 (전 케이스).
import { test, expect } from 'vitest';
import { buildSpeakQueue, computeAdoption, pickApproaches, pickQuirks, pickRoundAdvisors, rankIdxFor, isChampion } from '../src/game/logic';

const P = (id: string, joinOrder: number, favor: number) =>
  ({ id, nick: id, joinOrder, favor }) as { id: string; nick: string; joinOrder: number; favor: number };
const A = (name: string) => ({ name, emoji: '🎓', style: 's', core: 'p', quirks: ['q1', 'q2'] });

test('발언 큐: AI 블록 먼저, 사람 블록 나중. 1라운드는 정의순/입장순', () => {
  const q = buildSpeakQueue({ advisors: [A('갑'), A('을')], advisorFavor: {}, players: [P('u2', 1, 0), P('u1', 0, 0)], roundNo: 1 });
  expect(q.map((e) => e.key)).toEqual(['ai:갑', 'ai:을', 'u1', 'u2']);
});

test('2라운드부터 블록 내 총애 높은 순', () => {
  const q = buildSpeakQueue({ advisors: [A('갑'), A('을')], advisorFavor: { 을: 2 }, players: [P('u1', 0, 0), P('u2', 1, 1)], roundNo: 2 });
  expect(q.map((e) => e.key)).toEqual(['ai:을', 'ai:갑', 'u2', 'u1']);
});

test('사람이 총애 1등이어도 AI 다음에 말한다', () => {
  const q = buildSpeakQueue({
    advisors: [A('갑'), A('을')],
    advisorFavor: { 을: 2, 갑: 1 },
    players: [P('u1', 0, 3)],
    roundNo: 3,
  });
  expect(q.map((e) => e.key)).toEqual(['ai:을', 'ai:갑', 'u1']);
});

test('채택 = 합산 최고점, 동점은 늦게 말한 쪽', () => {
  const candidates = [
    { key: 'ai:을', order: 0 },
    { key: 'u1', order: 1 },
    { key: 'u2', order: 2 },
  ];
  const perSpeaker = [
    { key: 'ai:을', axisScores: { x: 8, y: 7, z: 6 } }, // 21
    { key: 'u1', axisScores: { x: 9, y: 6, z: 6 } },    // 21 동점 → 늦은 u1
    { key: 'u2', axisScores: { x: 5, y: 5, z: 5 } },    // 15
  ];
  const r = computeAdoption(perSpeaker, candidates);
  expect(r.adoptedKey).toBe('u1');
  expect(r.totals['ai:을']).toBe(21);
});

test('채택 = 합산 최고점 (동점 없는 단순 케이스)', () => {
  const candidates = [{ key: 'a', order: 0 }, { key: 'b', order: 1 }];
  const r = computeAdoption(
    [{ key: 'a', axisScores: { x: 9, y: 6 } }, { key: 'b', axisScores: { x: 8, y: 7 } }],
    candidates,
  );
  expect(r.adoptedKey).toBe('b');
  expect(r.totals.a).toBe(15);
});

test('발언자 없으면 채택 없음', () => {
  expect(computeAdoption([], []).adoptedKey).toBeNull();
});

test('라운드 출전 발탁: 풀에서 n명, 중복 없이 정의 순서 유지', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const picked = pickRoundAdvisors(pool, 3);
  expect(picked.length).toBe(3);
  expect(new Set(picked).size).toBe(3);
  // 정의 순서 유지 확인
  const idx = picked.map((x) => pool.indexOf(x));
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
});

test('라운드 출전 발탁: 풀이 n 이하면 전원 출전', () => {
  expect(pickRoundAdvisors(['a', 'b'], 3)).toEqual(['a', 'b']);
  expect(pickRoundAdvisors(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c']);
});

test('해법 축 배정: 참모 전원에게 유효한 축을 겹치지 않게 배정', () => {
  const names = ['갑', '을', '병'];
  const axes = ['a', 'b', 'c', 'd', 'e'];
  const m = pickApproaches(names, axes, () => 0.42);
  expect(Object.keys(m)).toEqual(names);
  const vals = Object.values(m);
  expect(new Set(vals).size).toBe(names.length);
  for (const v of vals) expect(axes).toContain(v);
});

test('해법 축 배정: 참모가 축보다 많으면 순환 배정', () => {
  const m = pickApproaches(['갑', '을', '병'], ['a', 'b'], () => 0.99);
  expect(Object.values(m).every((v) => ['a', 'b'].includes(v))).toBe(true);
});

test('버릇 샘플링: 30% 미만 난수면 없음, 아니면 풀에서 추첨', () => {
  const advisors = [{ name: '갑', quirks: ['a', 'b', 'c'] }];
  // rng 1콜: 0.1 < 0.3 → 없음
  expect(pickQuirks(advisors, {}, () => 0.1)).toEqual({ 갑: null });
  // rng 2콜: 0.9(발동), 0.0(첫 항목)
  const seq = [0.9, 0];
  expect(pickQuirks(advisors, {}, () => seq.shift()!)).toEqual({ 갑: 'a' });
});

test('버릇 샘플링: 직전 라운드 버릇은 풀에서 제외된다', () => {
  const advisors = [{ name: '갑', quirks: ['a', 'b'] }];
  const seq = [0.9, 0]; // 발동 + 첫 항목 → 'a'가 제외됐으니 'b'
  expect(pickQuirks(advisors, { 갑: 'a' }, () => seq.shift()!)).toEqual({ 갑: 'b' });
});

test('버릇 샘플링: 풀이 비면(전부 직전 제외) 없음', () => {
  const advisors = [{ name: '갑', quirks: ['a'] }];
  expect(pickQuirks(advisors, { 갑: 'a' }, () => 0.99)).toEqual({ 갑: null });
});

test('승진: 채택 수 = 계급 인덱스, 최고 계급이 우승', () => {
  const ranks = ['인턴', '사원', '팀장', '이사', '부사장'];
  expect(rankIdxFor(0, ranks)).toBe(0);
  expect(rankIdxFor(3, ranks)).toBe(3);
  expect(rankIdxFor(9, ranks)).toBe(4); // 상한
  expect(isChampion(3, ranks)).toBe(false);
  expect(isChampion(4, ranks)).toBe(true);
});
