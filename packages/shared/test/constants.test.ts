import { test, expect } from 'vitest';
import { MAX_SPEECH_CHARS, SPEAK_TIME_OPTIONS, DIFFICULTIES } from '../src/index';

test('게임 규칙 상수는 원본 값을 유지한다', () => {
  expect(MAX_SPEECH_CHARS).toBe(160);
  expect(SPEAK_TIME_OPTIONS).toEqual([60, 120, 180]);
  expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
});
