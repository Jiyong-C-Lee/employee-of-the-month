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

export const situationSchema = z.object({ text: z.string().min(1), question: z.string().min(1) });
export const situationsSchema = z.array(situationSchema).min(5);
export const personaSchema = personaMetaSchema.extend({ situations: situationsSchema });
export type FullPersona = z.infer<typeof personaSchema>;

const tmpl = z.union([z.string(), z.array(z.string())]);
export const promptsSchema = z.object({
  difficulty: z.object({ easy: tmpl, normal: tmpl, hard: tmpl }),
  approaches: z.array(z.string()).min(2),
  advisorBatchSystem: tmpl,
  judgeSystem: tmpl,
  judgeHumanBiasLine: z.string(),
  judgeDefaultAddress: z.string(),
  epilogueSystem: tmpl,
  personaGenSystem: tmpl,
}).passthrough(); // _readme 등 허용

export const stringsSchema = z.object({
  session: z.record(tmpl),
  round: z.record(tmpl),
  fallback: z.record(z.string()),
  mock: z.record(z.union([tmpl, z.record(tmpl)])), // advisorTemplates는 style→template 중첩 맵
  errors: z.record(z.string()), // UI 에러 문구 — 코드 하드코딩 금지, 여기서만
}).passthrough();
