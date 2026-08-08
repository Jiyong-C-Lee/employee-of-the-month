// 커스텀 페르소나 생성 — 입력·출력 스키마와 user 프롬프트 조립의 순수 검증.
import { describe, it, expect } from 'vitest';
import { personaGenInputSchema, generatedPersonaSchema, personaGenUser } from '../ai/persona-gen';
import { CUSTOM_GEN as VALID_GEN } from './fixtures';

describe('persona-gen', () => {
  it('입력: 이름·컨셉 필수, 상한 검증', () => {
    expect(personaGenInputSchema.safeParse({ name: '건물주 할머니', concept: '월세가 인생' }).success).toBe(true);
    expect(personaGenInputSchema.safeParse({ name: '', concept: 'x' }).success).toBe(false);
    expect(personaGenInputSchema.safeParse({ name: 'a'.repeat(30), concept: 'x' }).success).toBe(false);
  });
  it('생성 결과 스키마: 유효 팩 통과, 참모 부족은 거부', () => {
    expect(generatedPersonaSchema.safeParse(VALID_GEN).success).toBe(true);
    expect(generatedPersonaSchema.safeParse({ ...VALID_GEN, advisors: VALID_GEN.advisors.slice(0, 1) }).success).toBe(false);
  });
  it('user 프롬프트에 입력 필드가 들어간다 (빈 선택 필드는 "AI가 정한다")', () => {
    const u = personaGenUser({ name: '건물주 할머니', concept: '월세가 인생' });
    expect(u).toContain('건물주 할머니');
    expect(u).toContain('월세가 인생');
    expect(u).toContain('AI가 정한다');
  });
});
