import { z } from 'zod';

export const advisorSchema = z.object({
  name: z.string().min(1),
  emoji: z.string().min(1),
  style: z.string().min(1),
  core: z.string().min(1), // 항상 유지되는 성향·논리 축
  voice: z.string().optional(), // 말투·어조
  quirks: z.array(z.string().min(1)).min(2), // 말버릇·러닝개그 풀 — 라운드마다 하나 또는 없음이 샘플링된다
});

export const personaMetaSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  emoji: z.string().min(1),
  intro: z.string().min(1),
  axes: z.array(z.string()).min(3),
  ranks: z.array(z.string()).min(5),
  personaPrompt: z.string().min(20),
  judgeAddress: z.string().optional(),
  listenerBrief: z.string().optional(),
  lines: z.record(z.union([z.string(), z.array(z.string())])).optional(),
  advisors: z.array(advisorSchema).min(2).max(12), // 풀 — 라운드 출전은 ADVISORS_PER_ROUND명
});

export const situationSchema = z.object({
  text: z.string().min(1),
  question: z.string().min(1),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(), // 시나리오 아크가 참조하는 슬러그
  arcOnly: z.boolean().optional(), // true면 자유 모드 랜덤 덱에서 제외 (아크 문맥 없이는 어색한 상황)
});
export const situationsSchema = z.array(situationSchema).min(5);

// 시나리오 아크 — 사전 저작된 상황 비트를 연대기 순서로 진행하는 선형 시퀀스.
// beats는 같은 팩 situations의 id 참조 (무결성은 loader가 검증).
// lead: 이 비트가 "왜 지금 터지는지"를 앞 비트의 결과에 잇는 보스 말투 도입 문장(사전 저작).
// AI 브릿지의 인과 힌트이자, AI 실패 시 그대로 브릿지로 나가는 폴백 — 연결이 저작으로 보장된다.
export const scenarioSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  tagline: z.string().min(1),
  beats: z.array(z.object({
    id: z.string().min(1),
    lead: z.string().min(1).optional(), // 첫 비트는 도입이 필요 없다
  })).min(4),
  finaleText: z.string().min(1), // 마지막 비트 뒤 세션 종료 연출 문구
});
export const scenariosSchema = z.array(scenarioSchema);

export const personaSchema = personaMetaSchema.extend({
  situations: situationsSchema,
  scenarios: scenariosSchema.default([]),
});
export type FullPersona = z.infer<typeof personaSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;

const tmpl = z.union([z.string(), z.array(z.string())]);
export const promptsSchema = z.object({
  difficulty: z.object({ easy: tmpl, normal: tmpl, hard: tmpl }),
  approaches: z.array(z.string()).min(2),
  advisorBatchSystem: tmpl,
  judgeSystem: tmpl,
  judgeHumanBiasLine: z.string(),
  judgeHistoryRules: z.string(),
  judgeDefaultAddress: z.string(),
  epilogueSystem: tmpl,
  bridgeSystem: tmpl,
  personaGenSystem: tmpl,
}).passthrough(); // _readme 등 허용

export const stringsSchema = z.object({
  session: z.record(tmpl),
  round: z.record(tmpl),
  fallback: z.record(z.string()),
  mock: z.record(z.union([tmpl, z.record(tmpl)])), // advisorTemplates는 style→template 중첩 맵
  errors: z.record(z.string()), // UI 에러 문구 — 코드 하드코딩 금지, 여기서만
}).passthrough();
