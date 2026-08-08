# @narre/cf

Cloudflare Workers 배관 부품. 이 게임이 쓰려고 들어온 라이브러리이고, 게임 규칙은 여기 없습니다.

- `doRoomStore` · `doAlarms` — Durable Object 위의 방 상태와 타이머
- `sseTransport` — 참가자에게 진행 상황을 밀어 주는 통로
- `QuotaDO` — LLM 일일 호출 한도 계수기
- `EgressDO` — 지역 차단을 피해 나가는 LLM 요청 경유
- `makeLlm` — 위 조각들을 묶어 게임에 넘기는 LLM 진입점

소비 지점은 `worker/room-do.ts`와 `worker/index.ts`입니다.

테스트: `npx vitest run --project worker` (저장소 루트에서 `npm test`가 함께 돌립니다)
