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

// 진행 모델은 "랜덤픽 + sparse 링크 그래프"다. 게임은 늘 섞인 덱에서 상황을 뽑지만,
// 상황이 링크를 가지면 그 판의 결말이 다음 상황을 확정 연결한다:
// - then: 무조건 링크 — 이 상황을 치르면 다음은 후보 중 하나로 확정.
// - branch: 판정이 채택안을 노선(options 키)으로 분류하고, then[노선]의 후보가 다음이 된다.
//   mock·분류 실패 시 첫 키가 기본 노선이다.
// 후보(Link[])가 여럿이면 아직 안 나온 상황 중 랜덤 — 같은 전개의 반복을 막는다.
// lead: 앞 판의 결말이 그 상황을 불러오는 보스 말투 도입 문장(브릿지의 인과 힌트이자
// AI 실패 시 그대로 나가는 폴백 — 연결이 저작으로 보장된다).
// linkedOnly: 링크로만 등장 — 랜덤 덱에서 제외 (앞 문맥 없이는 어색한 상황).
const linkSchema = z.object({ to: z.string().min(1), lead: z.string().min(1) });
export const situationSchema = z.object({
  text: z.string().min(1),
  question: z.string().min(1),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(), // 링크가 참조하는 슬러그
  linkedOnly: z.boolean().optional(),
  then: z.array(linkSchema).min(1).optional(),
  branch: z.object({
    options: z.record(z.string().min(1)),      // 노선 키 → 판정에게 주는 분류 기준
    then: z.record(z.array(linkSchema).min(1)), // 노선 키 → 다음 상황 후보들
  }).optional(),
});
export const situationsSchema = z.array(situationSchema).min(5);
export type SituationLink = z.infer<typeof linkSchema>;
export type AuthoredSituation = z.infer<typeof situationSchema>;

export const personaSchema = personaMetaSchema.extend({
  situations: situationsSchema,
});
export type FullPersona = z.infer<typeof personaSchema>;

const tmpl = z.union([z.string(), z.array(z.string())]);
export const promptsSchema = z.object({
  difficulty: z.object({ easy: tmpl, normal: tmpl, hard: tmpl }),
  approaches: z.array(z.string()).min(2),
  advisorBatchSystem: tmpl,
  judgeSystem: tmpl,
  judgeHumanBiasLine: z.string(),
  judgeHistoryRules: z.string(),
  judgeDefaultAddress: z.string(),
  epilogueSystem: tmpl, // 라운드 마무리 통합 프롬프트 — story(에필로그)와 bridge(다음 상황 첫마디)를 한 콜로
  personaGenSystem: tmpl,
}).passthrough(); // _readme 등 허용

export const stringsSchema = z.object({
  session: z.record(tmpl),
  round: z.record(tmpl),
  fallback: z.record(z.string()),
  mock: z.record(z.union([tmpl, z.record(tmpl)])), // advisorTemplates는 style→template 중첩 맵
  errors: z.record(z.string()), // UI 에러 문구 — 코드 하드코딩 금지, 여기서만
}).passthrough();
