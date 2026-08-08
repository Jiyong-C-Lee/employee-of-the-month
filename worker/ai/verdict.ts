// 판정 후처리 순수 함수. 원본 server/sycophant/ai.js에서 분리 이식 — 로직 동일.
import { MAX_SPEECH_CHARS, type Verdict } from '@shared';
import { STRINGS, fmt } from '@content';
import { computeAdoption } from '../game/logic';
import type { Candidate } from './prompts';

// 글자 초과 시 문장 중간이 아니라 문장 끝에서 끊는다 (잘린 대사 방지).
export function trimSpeech(text: unknown, max: number = MAX_SPEECH_CHARS): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 10);
  let end = -1;
  for (const ch of ['.', '!', '?', '…']) end = Math.max(end, cut.lastIndexOf(ch));
  if (end >= max * 0.4) return cut.slice(0, end + 1);
  return t.slice(0, max);
}

interface RawVerdict {
  perSpeaker?: { key?: string; axisScores?: Record<string, number>; comment?: string }[];
  adoptedKey?: string | null;
  adoptReason?: string;
}

// raw 판정 → 클램프·합산·서버 채택 재계산. key/이름 관용 매칭 포함 (원본 주석 참조).
export function finalizeVerdict(raw: RawVerdict, candidates: Candidate[], axes: string[]): Verdict {
  const rawList = raw.perSpeaker || [];
  const byKey = new Map(rawList.map((s) => [String(s.key), s]));
  const resolve = (c: Candidate) => byKey.get(c.key) ?? byKey.get(c.name) ?? byKey.get(`ai:${c.name}`);
  const perSpeaker = candidates.map((c) => {
    const s = resolve(c) || {};
    const axisScores: Record<string, number> = {};
    for (const ax of axes) {
      const v = Math.round(Number(s.axisScores?.[ax]) || 0);
      axisScores[ax] = Math.max(0, Math.min(10, v));
    }
    return {
      key: c.key, name: c.name, kind: c.kind, axisScores,
      total: Object.values(axisScores).reduce((a, b) => a + b, 0),
      comment: s.comment || STRINGS.fallback.judgeComment!,
    };
  });
  const { adoptedKey, totals } = computeAdoption(perSpeaker, candidates);
  const rawAdopted = candidates.find(
    (c) => c.key === raw.adoptedKey || c.name === raw.adoptedKey || `ai:${c.name}` === raw.adoptedKey,
  )?.key ?? null;
  let adoptReason = raw.adoptReason || '';
  if (adoptedKey && rawAdopted !== adoptedKey) {
    const adopted = perSpeaker.find((s) => s.key === adoptedKey);
    adoptReason = adopted?.comment && adopted.comment !== STRINGS.fallback.judgeComment
      ? adopted.comment
      : fmt(STRINGS.fallback.adoptReason, { adoptedName: adopted?.name ?? '' });
  }
  return { perSpeaker, adoptedKey, adoptReason, totals };
}
