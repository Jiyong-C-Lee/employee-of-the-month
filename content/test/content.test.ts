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

test('조조 팩 sparse 링크가 온전하다 (대상 존재·lead 저작·linkedOnly 도달 가능)', () => {
  const p = getPersona('caocao')!;
  const ids = new Set(p.situations.map((s) => s.id).filter(Boolean));
  const targets = new Set<string>();
  let linkCount = 0;
  for (const s of p.situations) {
    const links = [...(s.then ?? []), ...Object.values(s.branch?.then ?? {}).flat()];
    for (const l of links) {
      expect(ids.has(l.to)).toBe(true);
      expect(l.lead.length).toBeGreaterThan(10); // 연결이 AI 운에 좌우되지 않게 lead는 저작 필수
      targets.add(l.to);
      linkCount += 1;
    }
    if (s.branch) for (const key of Object.keys(s.branch.then)) expect(s.branch.options[key]).toBeTruthy();
  }
  expect(linkCount).toBeGreaterThanOrEqual(10); // 그래프가 실제로 sparse하게 깔려 있다
  // 여포 분기: 뽑으면 인질극, 내치면 복수
  const yeopo = p.situations.find((s) => s.id === 'yeopo-apply')!;
  expect(Object.keys(yeopo.branch!.then).sort()).toEqual(['hire', 'reject']);
  expect(yeopo.branch!.then.hire![0]!.to).toBe('yeopo-stock-demand');
  expect(yeopo.branch!.then.reject![0]!.to).toBe('yeopo-revenge');
  // linkedOnly는 링크로만 등장 — 반드시 어떤 링크가 가리켜야 한다.
  for (const s of p.situations.filter((x) => x.linkedOnly)) expect(targets.has(s.id!)).toBe(true);
  // 랜덤 덱 크기(linkedOnly 제외)가 증량됐다: 20 → 27
  const summary = listPersonas().find((x) => x.id === 'caocao')!;
  expect(summary.situationCount).toBeGreaterThanOrEqual(27);
  // 요약에 링크·본문이 새지 않는다 (스포일러 방지)
  expect(JSON.stringify(summary)).not.toContain('yeopo-stock-demand');
});
