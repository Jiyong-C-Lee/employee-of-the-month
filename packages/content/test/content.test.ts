import { test, expect } from 'vitest';
import { getPersona, listPersonas, PROMPTS, STRINGS, fmt, personaSchema } from '../src/index';

test('페르소나 전 팩이 로드된다', () => {
  const list = listPersonas();
  expect(list.length).toBe(5);
  expect(list.map((p) => p.id).sort()).toEqual(['caocao', 'liubei', 'maou', 'olympus', 'seonjo']);
  for (const p of list) {
    expect(p.id && p.name && p.intro).toBeTruthy();
    expect(p.axes.length).toBeGreaterThanOrEqual(3);
    expect(p.ranks.length).toBeGreaterThanOrEqual(5);
    expect(p.situationCount).toBeGreaterThanOrEqual(5);
    expect(p.advisors.length).toBeGreaterThanOrEqual(2);
  }
});

test('getPersona는 전체 데이터(상황·프롬프트 포함)를 준다', () => {
  const p = getPersona('caocao')!;
  expect(p.name).toContain('조조');
  expect(p.personaPrompt.length).toBeGreaterThan(20);
  expect(p.situations.every((s) => s.text && s.question)).toBe(true);
  expect(p.advisors.every((a) => a.name && a.style && a.core && a.quirks.length >= 2)).toBe(true);
  expect(getPersona('nope')).toBeNull();
});

test('전역 게임데이터가 로드된다', () => {
  expect(PROMPTS.approaches.length).toBeGreaterThan(0);
  expect(PROMPTS.difficulty.normal).toBeTruthy();
  expect(STRINGS.fallback.judgeComment).toBeTruthy();
  expect(fmt('{a}-{b}', { a: 1, b: 'x' })).toBe('1-x');
  expect(fmt(['줄1', '{a}'], { a: 2 })).toBe('줄1\n2');
});

test('스키마 위반 팩은 거부된다', () => {
  expect(() => personaSchema.parse({ id: 'bad' })).toThrow();
});
