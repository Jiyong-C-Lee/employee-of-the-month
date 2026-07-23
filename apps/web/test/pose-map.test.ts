import { test, expect } from 'vitest';
import { buildPoseMap as build } from '../src/components/ComicCuts.jsx';

// buildPoseMap은 JSX 모듈의 순수 함수(렌더 없음) — 테스트용으로 결과 타입만 좁혀 쓴다.
const buildPoseMap = build as (arg: {
  persona: { advisors: { name: string }[] };
  players: { id: string; joinOrder: number }[];
}) => Record<string, number>;

const persona = { advisors: [{ name: '원칙파' }, { name: '실리파' }] };
const players = [
  { id: 'pA', joinOrder: 0 },
  { id: 'pB', joinOrder: 1 },
  { id: 'pC', joinOrder: 2 },
];

test('포즈 배정은 뷰어와 무관 — 같은 유저는 모든 클라이언트에서 같은 포즈', () => {
  // 서로 다른 클라이언트(뷰어)를 흉내내려 해도 인자가 동일하면 결과가 동일해야 한다.
  const mapA = buildPoseMap({ persona, players });
  const mapB = buildPoseMap({ persona, players });
  for (const p of players) expect(mapA[p.id]).toBe(mapB[p.id]);
});

test('플레이어 배열 순서가 뒤섞여도 joinOrder 기준으로 같은 포즈', () => {
  const shuffled = [...players].reverse();
  const map1 = buildPoseMap({ persona, players });
  const map2 = buildPoseMap({ persona, players: shuffled });
  for (const p of players) expect(map1[p.id]).toBe(map2[p.id]);
});

test('AI 참모도 이름 키로 결정적 배정', () => {
  const map = buildPoseMap({ persona, players });
  expect(map['ai:원칙파']).toBeTypeOf('number');
  expect(map['ai:실리파']).toBeTypeOf('number');
  expect(map['ai:원칙파']).not.toBe(map['ai:실리파']);
});

test('큰 풀 + 라운드 큐: 출전 참모끼리 포즈가 겹치지 않는다', () => {
  // 풀 8명은 포즈 5종보다 많아 선호 포즈가 겹칠 수 있다(0↔5, 1↔6, 2↔7).
  const bigPersona = { advisors: Array.from({ length: 8 }, (_, i) => ({ name: `참모${i}` })) };
  const queue = [
    { kind: 'ai', key: 'ai:참모0', name: '참모0' },
    { kind: 'ai', key: 'ai:참모5', name: '참모5' }, // 참모0과 선호 포즈 동일
    { kind: 'ai', key: 'ai:참모2', name: '참모2' },
  ];
  const map = (buildPoseMap as (arg: object) => Record<string, number>)({ persona: bigPersona, players: [], queue });
  const poses = [map['ai:참모0'], map['ai:참모5'], map['ai:참모2']];
  expect(new Set(poses).size).toBe(3);
});
