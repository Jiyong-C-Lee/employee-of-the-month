// LLM 출력 zod 스키마 — JSON Schema(prompts.ts의 responseSchema)와 쌍을 이루는 수신측 검증.
// 위반 = 페일오버 (다음 공급자로 넘긴다).
import { z } from 'zod';

export const advisorBatchOut = z.object({
  speeches: z.array(z.object({ name: z.string(), text: z.string(), approach: z.string() })).min(1),
});

export const judgeOut = z.object({
  perSpeaker: z.array(z.object({ key: z.string(), axisScores: z.record(z.number()), comment: z.string() })).min(1),
  adoptedKey: z.string(),
  adoptReason: z.string(),
});

export const epilogueOut = z.object({ story: z.string().min(1) });
