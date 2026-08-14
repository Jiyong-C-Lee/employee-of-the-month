// LLM 출력 zod 스키마 — JSON Schema(prompts.ts의 responseSchema)와 쌍을 이루는 수신측 검증.
// 위반 = 페일오버 (다음 공급자로 넘긴다).
import { z } from 'zod';
import { ADVISOR_SPEECH_MIN_CHARS } from '@shared';

export const advisorBatchOut = z.object({
  speeches: z.array(z.object({
    name: z.string(),
    // 하한 미달(단답)은 스키마 위반 → 체인이 다음 공급자로 페일오버
    text: z.string().min(ADVISOR_SPEECH_MIN_CHARS),
    approach: z.string(),
  })).min(1),
});

export const judgeOut = z.object({
  perSpeaker: z.array(z.object({ key: z.string(), axisScores: z.record(z.number()), comment: z.string() })).min(1),
  adoptedKey: z.string(),
  adoptReason: z.string(),
  decision: z.string().optional(), // 분기 상황 한정: 채택안의 노선 분류
});

export const epilogueOut = z.object({ story: z.string().min(1) });

export const bridgeOut = z.object({ bridge: z.string().min(1) });
