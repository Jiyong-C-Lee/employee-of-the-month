# @narre/llm

LLM 호출 체인·JSON 파서·원가 계량. 게임이 어떤 프로바이더를 쓰든 같은 인터페이스로 부르게 한다.

## 계약 요약

```ts
callJsonChain(req: ChainRequest, ctx: ChainContext):
  Promise<{ raw?: unknown; toolCalls?: ToolCall[]; provider: string; usage: { in: number; out: number; cached: number } }>;

registerProvider(adapter: ProviderAdapter, hasKey?: (env) => boolean, quota?: string): void;

parseLenientJson(text: string): unknown;
mockFromSchema(schema: JsonSchema): unknown;

estimateCostKrw(usage: Usage, pricing?: PricingRates): number;
pricingFromEnv(env: Record<string, string | undefined>): PricingRates;
DEFAULT_PRICING: PricingRates;
```

- 체인 기본값은 `gemini-free → gemini → nvidia → mock`. 새 프로바이더는 `providers/<name>.ts` 파일 하나와 `registerProvider()` 호출 한 줄로 추가한다 — `chain.ts`는 무수정.
- 어댑터는 `caps: { json: true, tools: boolean, cache: 'implicit'|'explicit'|'none' }`를 선언한다. `selectProviders`가 요청이 요구하는 능력(예: tools)으로 어댑터를 미리 걸러 체인에 넣는다.
- 프로바이더 고유 사정(스키마 변환 방식 등)은 어댑터 내부에 숨긴다. `toGeminiSchema` 같은 변환 유틸은 공개 API가 아니다.

## 설정

- **`LLM_CHAIN`** — 쉼표 구분 어댑터 이름. 기본 체인 순서·구성을 교체한다. 예: `LLM_CHAIN=gemini,mock`.
- **`MODEL_<KIND>`** — `ctx.kind`(대문자화)별 모델 오버라이드. 예: `ctx.kind='judge'`면 `MODEL_JUDGE=gemini-2.5-flash`. 장애 대응용 폴백 체인과 용도별 티어 라우팅을 분리하는 지점이다.
- **`pricingFromEnv(env)`** — `env.USD_KRW`를 읽어 `DEFAULT_PRICING`의 `usdKrw`만 덮어쓴 `PricingRates`를 만든다. `USD_KRW`가 없거나 숫자로 안 읽히면 기본 1400을 쓴다. 나머지 요율(`inPerM`·`outPerM`·`cachedPerM`)은 이 함수로 바꿀 수 없다 — 필요해지면 그때 오버라이드 지점을 추가한다. 이 패키지는 런타임 중립이라 env를 직접 읽지 않으므로, 호출측이 자신의 `env`를 넘겨 배선해야 한다.
- 키 env 이름은 게임 쪽 기존 규약 그대로다: `GOOGLE_AI_STUDIO_FREE_API_KEY` · `GOOGLE_AI_STUDIO_API_KEY` · `NVIDIA_API_KEY` · `GEMINI_MODEL`(기본 `gemini-flash-lite-latest`) · `NVIDIA_MODEL`(기본 `meta/llama-3.3-70b-instruct`).
- **쿼터 버킷은 프로바이더별로 분리된다.** `gemini-free`(무료)와 `gemini`(유료)는 어댑터 등록 시 쿼터명이 각각 `'gemini-free'`·`'gemini'`로 나뉜다(`chain.ts`의 registry). `ctx.quotaTake`를 `@narre/cf`의 `QuotaDO.take(provider)`로 배선하면 env `LLM_DAILY_LIMIT_GEMINI_FREE`(무료)와 `LLM_DAILY_LIMIT_GEMINI`(유료)를 각각 읽는다 — 무료 한도 소진이 유료 폴백까지 막지 않는다.

## validate — throw식과 boolean식을 함께 받는다

`ChainContext.validate?: (raw: unknown) => boolean | void`. 실패 판정 기준은 **throw하거나 정확히 `false`를 반환**한 경우뿐이다. `undefined`(zod `.parse()`처럼 성공 시 값을 안 돌려주는 throw식 검증자) · `void` · `true`는 모두 통과로 취급한다. 실패로 판정되면 체인은 다음 프로바이더로 페일오버한다. sultan·eotm·speedquiz 원본 검증자는 전부 throw식이라 이 계약이 아니면(예: `!validate(raw)`처럼 falsy 반환을 실패로 오판하면) 성공 호출도 실패로 잘못 처리돼 매번 체인이 전소된다.

## tools — 계약만 있고 루프는 미구현

`ToolDef`·`ToolCall` 타입과 `selectProviders`의 capability 필터까지만 구현했다. 모델이 tool 호출을 반환했을 때 그 결과를 다시 넣어 재호출하는 실제 루프는 없다. `gemini`·`mock` 어댑터는 `tools`가 실린 요청을 받으면 그 자리에서 `throw new Error('tools: 미구현 — 첫 소비자에서 구현')`한다. tools 요청이 미지원 프로바이더까지 흘러 조용히 성공한 척하면 소비자가 tools가 무시된 걸 못 알아채고 깨진 상태로 진행하게 되므로, 그 경로를 여기서 표면화해 막았다(스펙 §2). tools 루프는 첫 소비자가 실제로 필요해질 때 구현한다.

## 원본 매핑

| 함수/타입 | 패키지 위치 | 원본 |
|---|---|---|
| `callJsonChain`, `registerProvider` | `src/chain.ts` | marriage_problem·ai-speed-game `server/llm.mjs`의 `callJsonChain` · eotm `apps/worker/src/ai/chain.ts`(TS 등가) |
| `selectProviders` (capability 필터) | `src/select.ts` | 스펙 §2 신설 계약 — 직접 대응하는 원본 없음. tools 요청이 미지원 폴백으로 새는 걸 막기 위해 최소핵에서 추가 |
| `parseLenientJson` | `src/parse.ts` | marriage_problem·ai-speed-game `server/llm.mjs` (4개 프로젝트 100% 동일 코드) |
| `mockFromSchema`, `mockAdapter` | `src/mock.ts`, `src/providers/mock.ts` | 위와 동일 원본. 어댑터 래핑(`mockAdapter`)은 레지스트리 구조에 맞춘 신규 |
| `createGeminiAdapter`(gemini-free/gemini) | `src/providers/gemini.ts` | marriage_problem `server/llm.mjs`의 `geminiCall` + `toGeminiSchema` |
| `nvidiaAdapter` | `src/providers/nvidia.ts` | marriage_problem `server/llm.mjs`의 `nvidiaCall` |
| `estimateCostKrw`, `DEFAULT_PRICING`, `pricingFromEnv` | `src/cost.ts` | project-alibis `scripts/gemini-clients.ts`의 `usageLines()`/단가표(in 0.10 / out 0.40 / cached 0.025 USD per M) |

이 패키지는 추출본이다. 새 기능은 두 게임 이상에서 필요해질 때 추가한다.
