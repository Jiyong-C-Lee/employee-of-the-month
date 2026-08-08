# @narre/eotm (이달의 우수사원)

페르소나 상사 앞에서 참모들과 아부 경쟁을 벌이는 게임. 싱글·멀티 모두 지원한다.

## 실행 방법

```bash
npm run dev:web -w @narre/eotm   # Vite 개발 서버 (5173, /api는 8787로 프록시)
npm run dev -w @narre/eotm       # wrangler dev (8787)
npm run build -w @narre/eotm     # web/dist 생성 — 배포와 워커 테스트가 이걸 요구한다
npm test -w @narre/eotm          # vitest (node·worker 두 프로젝트)
```

`npm test`는 `pretest`가 `content/scripts/gen-index.mjs`를 먼저 돌려 `content/packs.gen.ts`를 만든다. 페르소나 추가는 `content/packs/` 아래 폴더 추가 + `npm run gen`이다.

## 구조

원본은 워크스페이스 4개(`apps/{web,worker}` + `packages/{shared,content}`)였다. narre 규약이 게임 하나 = 워크스페이스 하나라 폴더로 평탄화했다. `@eotm/*` 별칭은 `@shared`·`@content`로 바뀌었고, tsconfig `paths`와 Vite `resolve.alias` 양쪽에 배선돼 있다.

런타임이 다른 테스트가 한 워크스페이스에 모여 vitest를 프로젝트로 나눴다(`vitest.workspace.ts`). `worker`는 Workers 런타임, `node`는 콘텐츠·웹이다.

## 패키지 소비 지점

| 패키지 | 쓰는 것 | 파일 |
|---|---|---|
| `@narre/llm` | `callJsonChain` | `worker/ai/llm.ts`의 `makeLlm()` |
| `@narre/cf` | `doRoomStore`·`doAlarms`·`sseTransport`·`Llm` 타입 | `worker/room-do.ts` |
| `@narre/cf` | `QuotaDO`(re-export)·`incr` RPC | `worker/index.ts` |
| `@narre/ui` | `Shell`·`tokens.css` | `web/src/App.tsx`·`main.tsx` |

## 패키지를 안 쓴 자리

1. **`rateLimit` 미들웨어 미사용** (`worker/index.ts`). eotm은 IP 한도가 용도별 4종이고 키·윈도·값이 각각 다르다(방 생성 분당 5·페르소나 생성 일 5·공유 일 30·피드백 일 5). 미들웨어는 `rl:${ip}` 키 하나만 다룬다. 복원한 `QuotaDO.incr`을 직접 쓴다 — 그 진입점이 이 자리를 위한 것이다.
2. **`createLogger` 미사용** (`worker/log.ts`). eotm 자체 로거가 타입드 이벤트 17종을 갖고 있고 `createLogger`는 `llmCall`·`quotaExceeded` 2종뿐이라 좁다. 체인 로그 통로(`logger.chain`)만 열어 `ChainContext.logger`에 꽂았다.

## 이관에서 드러난 계약 확장 1건

**`Alarms.pending()`**. 재접속 스냅샷이 남은 발언 마감 시각을 실어 보내야 하는데, 원본은 storage의 `alarmTag` 키와 `getAlarm()`을 직접 읽었다. 그 키가 `doAlarms` 내부 구현이 되면서 밖에서 못 읽게 됐다. 게임이 부품 내부를 뒤지게 두는 대신 소거 없는 조회 메서드를 열었다. 소비자 1개라 `잠정`이다(`packages/cf/README.md`).

## LLM 체인 — 기본 mock을 빼는 이유

`wrangler.jsonc`의 `LLM_CHAIN`이 `gemini-free,gemini,nvidia`다. `@narre/llm` 기본 체인은 마지막이 `mock` 어댑터인데, 그건 스키마 모양만 맞춘 더미다.

eotm은 페르소나에 맞는 실제 대사를 만드는 **게임 고유 mock**(`worker/ai/mock.ts`)이 있고, `orchestrate.ts`의 `withFallback`이 체인 실패를 잡아 그걸 쓴다. 기본 체인을 그대로 두면 체인이 절대 throw하지 않아 그 catch가 안 돌고 대사 품질이 떨어진다. 키가 없을 때도 `hasKey: false`로 체인을 아예 건너뛴다.

## 배포

- 워커 이름: `employee-of-the-month`
- 도메인: `eotm.narre.io`
- 마이그레이션 태그는 `v1` 고정. 바꾸면 기존 방이 끊긴다.

```bash
npm run deploy -w @narre/eotm    # web 빌드 후 wrangler deploy
```

## 시크릿·vars

키는 `wrangler secret`으로만 관리한다. 항목은 `.env.example` 참고.

```bash
cd games/eotm && npx wrangler secret put GOOGLE_AI_STUDIO_FREE_API_KEY
```

**`LLM_DAILY_LIMIT_GEMINI_FREE`는 신설 vars다.** 원본은 무료·유료 gemini가 `LLM_DAILY_LIMIT_GEMINI` 하나를 나눠 썼는데 `@narre/cf` `QuotaDO.take`는 프로바이더명별로 env를 따로 읽는다. 미설정이면 한도 0이라 무료 경로가 항상 거부된다. `wrangler.jsonc`에 값이 들어 있다.
