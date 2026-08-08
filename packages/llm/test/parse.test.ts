import { describe, it, expect } from 'vitest';
import { parseLenientJson } from '../src/parse.js';
import { mockFromSchema } from '../src/mock.js';

describe('parseLenientJson', () => {
  it('맨 JSON을 파싱한다', () => {
    expect(parseLenientJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('코드펜스를 관용한다', () => {
    expect(parseLenientJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('코드펜스를 벗긴다 (언어 태그 없이)', () => {
    expect(parseLenientJson('```\n{"crack":"hit"}\n```')).toEqual({ crack: 'hit' });
  });
  it('전후 잡음을 잘라낸다', () => {
    expect(parseLenientJson('결과: {"a":1} 입니다')).toEqual({ a: 1 });
  });
});

describe('mockFromSchema', () => {
  it('같은 스키마에 같은 목업을 낸다 (결정론)', () => {
    const s = { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] };
    expect(mockFromSchema(s)).toEqual(mockFromSchema(s));
  });
  it('enum은 첫 값을 고른다', () => {
    expect(mockFromSchema({ type: 'string', enum: ['none', 'graze', 'hit'] })).toBe('none');
  });
  it('enum 첫 값이 빈 문자열이면 그대로 고른다', () => {
    expect(mockFromSchema({ type: 'string', enum: ['', 'answer', 'chosung'] })).toBe('');
  });
  it('object의 각 필드를 채운다', () => {
    const out = mockFromSchema({
      type: 'object',
      properties: { dialogue: { type: 'string' }, n: { type: 'number' } },
    }) as { dialogue: string; n: number };
    expect(typeof out.dialogue).toBe('string');
    expect(out.dialogue).toContain('[mock');
    expect(out.n).toBe(0);
  });
  it('array는 아이템 목업 1개짜리 배열을 낸다', () => {
    expect(mockFromSchema({ type: 'array', items: { type: 'number' } })).toEqual([0]);
  });
  it('boolean은 false를 낸다', () => {
    expect(mockFromSchema({ type: 'boolean' })).toBe(false);
  });
});
