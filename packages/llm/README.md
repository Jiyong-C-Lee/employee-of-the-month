# @narre/llm

LLM 호출 체인. JSON 스키마를 주면 그 모양으로 응답을 받아 내는 것까지가 이 패키지의 일입니다.

프로바이더를 순서대로 시도하고, 하나가 실패하면 다음으로 넘어갑니다. 순서는
`wrangler.jsonc`의 `LLM_CHAIN`이 정합니다 — 이 게임은 `gemini-free,gemini,nvidia`입니다.

- `chain.ts` — 순서대로 시도하고 실패를 넘기는 부분
- `providers/` — Gemini · NVIDIA 어댑터
- `parse.ts` — 모델이 뱉은 텍스트에서 JSON을 건져 내는 부분
- `cost.ts` — 토큰 사용량 환산

키가 하나도 없으면 체인 전체를 건너뜁니다. 그때는 게임 쪽 mock(`worker/ai/mock.ts`)이
페르소나에 맞는 대사를 대신 만듭니다.
