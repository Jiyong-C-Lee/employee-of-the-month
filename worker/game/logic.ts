// 순수 로직 (순번·채택·승진). 원본 server/sycophant/logic.js 이식 — 로직 동일.
import type { QueueEntry } from '@shared';
export { MAX_SPEECH_CHARS } from '@shared';

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

// 라운드 출전 참모: 풀(최대 8명)에서 라운드마다 무작위 n명 발탁 — 한 판 안에서도 여러 참모가 번갈아 등장.
// 정의 순서를 유지해 로스터·발언 순서가 안정적이다. 풀이 n 이하면 전원 출전.
export const ADVISORS_PER_ROUND = 3;

export function pickRoundAdvisors<T>(advisors: T[], n = ADVISORS_PER_ROUND, rng: () => number = Math.random): T[] {
  if (advisors.length <= n) return [...advisors];
  const chosen = new Set<number>();
  while (chosen.size < n) chosen.add(Math.floor(rng() * advisors.length) % advisors.length);
  return advisors.filter((_, i) => chosen.has(i));
}

// 라운드별 버릇 샘플링: 참모마다 30%는 "없음"(안건 집중), 나머지는 풀에서 균등 추첨.
// 직전 라운드에 쓴 버릇은 제외해 같은 개그의 연속 반복을 막는다. 순수 함수 — rng 주입으로 테스트한다.
export const QUIRK_NONE_P = 0.3;

export function pickQuirks(
  advisors: { name: string; quirks: string[] }[],
  lastQuirk: Record<string, string> = {},
  rng: () => number = Math.random,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const a of advisors) {
    const pool = a.quirks.filter((q) => q !== lastQuirk[a.name]);
    out[a.name] = pool.length === 0 || rng() < QUIRK_NONE_P
      ? null
      : pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
  }
  return out;
}

// 세션 라운드 상한 — 이 라운드까지 아무도 최고 직급을 못 달면 '올해의 사원'(최고 총애) 발표로 끝낸다.
export const MAX_ROUNDS = 10;

// 0..n-1 무작위 순열 — 세션 시작 시 상황 덱을 섞는 데 쓴다(세션 안 중복 없음, 순서만 무작위).
export function shuffledIndices(n: number, rng: () => number = Math.random): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)) % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// 라운드별 해법 축 배정: 축 풀을 섞어 참모마다 서로 다른 축을 코드가 강제한다.
// 모델에게 맡기면 같은 상황에서 늘 같은 축으로 쏠려 대사가 반복된다 — 프롬프트 엔트로피의 핵심 장치.
export function pickApproaches(
  names: string[],
  approaches: string[],
  rng: () => number = Math.random,
): Record<string, string> {
  const pool = [...approaches];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)) % (i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return Object.fromEntries(names.map((name, i) => [name, pool[i % pool.length]!]));
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
