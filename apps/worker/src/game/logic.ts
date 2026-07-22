// 순수 로직 (순번·채택·승진). 원본 server/sycophant/logic.js 이식 — 로직 동일.
import type { QueueEntry } from '@eotm/shared';
export { MAX_SPEECH_CHARS } from '@eotm/shared';

interface QueueArgs {
  advisors: { name: string }[];
  advisorFavor?: Record<string, number>;
  players: { id: string; nick: string; joinOrder: number; favor: number }[];
  roundNo: number;
}

// 발언 큐: 사람은 항상 AI 다음(마지막 블록) — 앞 의견을 보고 반박할 수 있는 유리한 자리.
// AI끼리·사람끼리는 각각 총애 높은 순(1라운드는 정의 순/입장순). 총애가 낮을수록 블록 안에서 뒤 순번.
export function buildSpeakQueue({ advisors, advisorFavor = {}, players, roundNo }: QueueArgs): QueueEntry[] {
  const ai = advisors.map((a, i) => ({ kind: 'ai' as const, key: `ai:${a.name}`, name: a.name, favor: advisorFavor[a.name] || 0, idx: i }));
  const us = players.map((p) => ({ kind: 'user' as const, key: p.id, name: p.nick, favor: p.favor, idx: p.joinOrder }));
  const byFavor = <T extends { favor: number; idx: number }>(arr: T[]) => [...arr].sort((a, b) => {
    if (roundNo > 1 && b.favor !== a.favor) return b.favor - a.favor;
    return a.idx - b.idx;
  });
  return [...byFavor(ai), ...byFavor(us)].map(({ kind, key, name }) => ({ kind, key, name }));
}

// perSpeaker: [{key, axisScores}], candidates: [{key, order}]
// 합산 최고점 채택. 동점이면 order 큰(늦게 말한) 쪽 우선.
export function computeAdoption(
  perSpeaker: { key: string; axisScores?: Record<string, number> }[],
  candidates: { key: string; order: number }[],
): { adoptedKey: string | null; totals: Record<string, number> } {
  const orderOf = Object.fromEntries(candidates.map((c) => [c.key, c.order]));
  const totals: Record<string, number> = {};
  let adoptedKey: string | null = null;
  let best = -Infinity;
  for (const s of perSpeaker) {
    const total = Object.values(s.axisScores || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
    totals[s.key] = total;
    const order = orderOf[s.key] ?? -1;
    if (total > best || (total === best && adoptedKey != null && order > (orderOf[adoptedKey] ?? -1))) {
      best = total;
      adoptedKey = s.key;
    }
  }
  return { adoptedKey, totals };
}

export function rankIdxFor(favor: number, ranks: string[]): number {
  return Math.min(favor, ranks.length - 1);
}

export function isChampion(favor: number, ranks: string[]): boolean {
  return rankIdxFor(favor, ranks) === ranks.length - 1;
}
