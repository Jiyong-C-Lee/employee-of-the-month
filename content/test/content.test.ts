import { test, expect } from 'vitest';
import { getPersona, listPersonas, PROMPTS, STRINGS, fmt, personaSchema } from '../index';

test('페르소나 전 팩이 로드된다', () => {
  const list = listPersonas();
  expect(list.length).toBe(6);
  expect(list.map((p) => p.id).sort()).toEqual(['caocao', 'liubei', 'maou', 'olympus', 'seonjo', 'sonkwon']);
  // 노출 순서 — 삼국지 3인방(조조→유비→손권)이 목록 앞에 온다.
  expect(list.map((p) => p.id).slice(0, 3)).toEqual(['caocao', 'liubei', 'sonkwon']);
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

test('조조 팩 시나리오 아크가 로드되고 beats 참조가 온전하다', () => {
  const p = getPersona('caocao')!;
  expect(p.scenarios.length).toBe(4);
  expect(p.scenarios.map((s) => s.id)).toEqual(['boncho-war', 'liubei-vessel', 'recruits', 'succession']);
  const ids = new Set(p.situations.map((s) => s.id).filter(Boolean));
  for (const sc of p.scenarios) {
    expect(sc.beats.length).toBeGreaterThanOrEqual(4);
    for (const beat of sc.beats) expect(ids.has(beat)).toBe(true);
    expect(sc.finaleText).toBeTruthy();
  }
  // arcOnly 상황은 자유 모드 덱 제외 대상 — 최소한 아크에는 소속돼 있어야 한다.
  const inBeats = new Set(p.scenarios.flatMap((sc) => sc.beats));
  for (const s of p.situations.filter((x) => x.arcOnly)) expect(inBeats.has(s.id!)).toBe(true);
  // 자유 모드 덱(arcOnly 제외)이 증량됐다: 20 → 27
  expect(p.situations.filter((s) => !s.arcOnly).length).toBeGreaterThanOrEqual(27);
  // listPersonas 요약에 아크가 실리되 본문(beats)은 새지 않는다
  const summary = listPersonas().find((x) => x.id === 'caocao')!;
  expect(summary.scenarios.map((s) => s.id)).toEqual(p.scenarios.map((s) => s.id));
  expect(JSON.stringify(summary)).not.toContain('hanshil-chairman');
});
