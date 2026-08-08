import { test, expect } from 'vitest';
import { AVATAR_EMOJI_PREFIX, avatarEmoji, isEmojiAvatar, isImageAvatar } from '../src/comic-assets.js';

test('isImageAvatar는 data:image/ 접두 문자열만 true', () => {
  expect(isImageAvatar('data:image/png;base64,AAAA')).toBe(true);
  expect(isImageAvatar('emoji:😎')).toBe(false);
  expect(isImageAvatar(null)).toBe(false);
  expect(isImageAvatar(undefined)).toBe(false);
});

test('isEmojiAvatar는 emoji: 접두 문자열만 true', () => {
  expect(isEmojiAvatar('emoji:😎')).toBe(true);
  expect(isEmojiAvatar('data:image/png;base64,AAAA')).toBe(false);
  expect(isEmojiAvatar('')).toBe(false);
});

test('avatarEmoji는 emoji: 접두를 떼고 이모지만 돌려준다', () => {
  expect(avatarEmoji(`${AVATAR_EMOJI_PREFIX}🥸`)).toBe('🥸');
});
