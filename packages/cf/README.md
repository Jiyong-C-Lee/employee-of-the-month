# @narre/cf

Cloudflare Workers 위에서 게임 룸을 굴리는 부품 모음: 방 상태·알람·전송·쿼터·라우팅·로거·이그레스.

**상속 골격이 아니라 조합형 부품이다.** 게임은 자기 `DurableObject`를 직접 갖고 필요한 것만 집는다. 안 쓰는 부품은 만들지 않으면 그만이고, 더미를 채울 일이 없다. 각 계약마다 CF 구현과 테스트용 fake를 짝으로 낸다 — 게임 로직 테스트가 DO 없이 돌게 하려는 것이다.

## 계약 5종

```ts
interface RoomStore<T> { load(): Promise<T | null>; save(room: T): Promise<void>; clear(): Promise<void> }
interface Alarms      { at(tag, time): Promise<void>; ttl(): Promise<void>; fire(): Promise<string | null> }
interface Transport   { attach(req: Request): Response | Promise<Response>; broadcast(msg: unknown): void }
interface Quota       { incr(key, limit, ttlMs); take(provider, now?); rateLimit(ip, limit?, windowMs?) }
type     Llm = (args: ChainRequest, opts?: Partial<ChainContext>) => Promise<ChainResult>
```

## 구현 · fake

| 계약 | CF 구현 | fake |
|---|---|---|
| `RoomStore` | `doRoomStore(ctx, key?)` | `memRoomStore()` |
| `Alarms` | `doAlarms(ctx, { ttlMs })` | `fakeAlarms()` |
| `Transport` | `sseTransport(hooks?)` · `wsTransport(ctx, hooks?)` | `fakeTransport(hooks?)` |
| `Quota` | `QuotaDO` (DO RPC) | `memQuota(limits?)` |
| `Llm` | `@narre/llm`의 `callJsonChain`을 게임이 감아 주입 | 체인의 `mock` 어댑터 |

라우팅은 Hono 미들웨어로 낸다: `rateLimit({ binding, limit?, windowMs? })` · `roomDelegate({ binding, roomIdFrom, path })`.

그 밖에 `createLogger(base?)`(`@narre/llm` `Logger` 구현체)와 `EgressDO`·`egressFetch`가 있다.

**`EgressDO`가 왜 있나.** CF는 배포 리전을 직접 고를 수 없고, 워커가 APAC 엣지(홍콩 등)에 앉으면 Google AI Studio API 호출이 차단된다. location hint로 지원 리전에 앉힌 DO가 대신 fetch해서 우회한다. `@narre/llm`의 `fetchImpl`로 꽂는다. Gemini를 쓰는 모든 게임의 공통 리스크라 개별 게임이 아니라 여기가 갖는다.

## 부품과 검증 게임 수

| 부품 | 검증 게임 | 수 |
|---|---|---|
| `doRoomStore` / `memRoomStore` | sultan · eotm · speedquiz | 3 |
| `QuotaDO` / `memQuota` | sultan · eotm · speedquiz | 3 |
| `doAlarms` / `fakeAlarms` | eotm · speedquiz | 2 |
| `createLogger` | sultan · speedquiz | 2 |
| `sseTransport` | eotm | 1 (잠정) |
| `wsTransport` | speedquiz | 1 (잠정) |
| `Alarms.pending()` | eotm | 1 (잠정) |
| `EgressDO` / `egressFetch` | sultan | 1 (잠정) |
| `rateLimit` | sultan · speedquiz | 2 |
| `roomDelegate` | speedquiz | 1 (잠정) |

**`roomDelegate`가 두 판 만에 첫 소비자를 얻었다.** 소비자 0이던 원인은 부품이 아니라 입력이었다. 게임이 방 id와 세션 id를 한 값에 겹쳐 놔서, 겸직하는 값이 더 엄한 쪽(세션) 제약을 물려받아 본문으로 내려갔다. 그러면 `roomIdFrom`이 본문을 읽어야 하고, 읽는 순간 넘길 요청이 사라진다. speedquiz가 역할을 나누자 방 id가 URL로 올라왔고 `/api/:roomId/:action`이 그대로 얹혔다. 프로덕션 스모크로 확인했다(2026-07-30). 자세한 건 `src/interfaces.ts` 머리말.

sultan은 아직 `gameId` 하나가 겸직 중이라 못 얹었다. React 전환에서 나눈다. 그때 검증 게임 수가 2가 된다.

eotm은 IP 한도가 용도별 4종이라 `rateLimit` 대신 `incr`을 직접 쓴다.

`잠정`은 소비자가 아직 하나라는 뜻이다. 두 번째 소비자가 붙을 때 계약이 어긋나면 넓힌다. **게임이 더미로 우회하게 두지 않는다** — 우회는 계약이 틀렸다는 신호이고, 그걸 방치한 것이 이전 판의 실패 원인이었다.

이 표가 있는 이유: 이전 판은 부품마다 원본 게임이 하나씩이었고(`GameRoomDO`는 ai-speed-game, `SSETransport`는 eotm, `createGameWorker`는 ai-speed-game 관례), 두 게임 이상에서 온 것(`QuotaDO`·`parseLenientJson`)만 실제로 맞았다. 소비자가 붙기 전에는 "한 게임에서 왔다"와 "공통이다"가 코드상 구분되지 않는다. 그래서 문서에 박아 둔다.

## 핵심 설계 결정

### `Alarms` — DO 알람은 인스턴스당 1개다

게임 타이머와 idle TTL이 그 하나를 나눠 쓴다. storage에 태그를 같이 넣어 구분하고, `fire()`가 `null`을 주면 TTL 만료(방 폐기)다. 알람 storage 조작은 내부에서 직렬화한다 — 안 하면 `clear`→`start`가 마이크로태스크 경합으로 뒤섞여 게임 알람이 유실된다. `ttl()`은 게임 알람이 무장 중이면 아무것도 하지 않는다.

세 게임이 이 문제를 세 가지로 풀었다. sultan·speedquiz `GameDO`는 타이머가 없어 `alarm() = deleteAll()`, speedquiz `RoomDO`는 `room.phase` 분기, eotm은 태그 + 직렬화. 태그 쪽이 게임 알람 종류가 둘 이상일 때(eotm의 `turnTimeout`·`inputWindow`)도 버틴다.

### `Transport` — 훅은 `attach`가 아니라 팩토리가 받는다

hibernation에서 깬 DO는 `attach` 없이 `webSocketMessage`부터 받는다. 훅이 `attach` 인자였다면 그 시점에 비어 메시지가 유실된다. DO 생성자가 transport를 다시 만들면서 훅을 배선하므로 깨어난 뒤에도 안전하다.

`ConnHooks`는 전부 선택적이다. SSE는 `onMessage`를 절대 호출하지 않는다 — 인바운드는 게임이 별도 HTTP POST로 받기 때문이다. `Conn.data`는 WS `serializeAttachment`와 SSE 메모리 좌석을 통일한다.

`wsTransport`는 `Transport` 위에 `message(ws, raw)`·`close(ws)`를 더 노출한다. DO의 `webSocketMessage`·`webSocketClose`에서 넘겨받는 WS 전용 통로다.

### `Quota.incr` — 범용 진입점을 지우지 않는다

`take`·`rateLimit`은 `incr`을 접두사만 다르게 부르는 두 호출자다. 그 둘로 담기지 않는 한도는 호출측이 `incr`을 직접 쓴다 — eotm은 용도별 IP 한도가 4종이고 윈도와 값이 각각 다르다(방 생성 분당 5·페르소나 생성 일 5·공유 일 30·피드백 일 5).

`take`의 storage 키는 `llm:${provider}:${day}`(UTC `YYYY-MM-DD`)다. 날짜가 바뀌면 새 키로 자연히 리셋되고, 프로바이더명이 다르면 카운터도 별개다. `gemini-free`(무료) 소진이 `gemini`(유료) 폴백을 막지 않는다(env는 각각 `LLM_DAILY_LIMIT_GEMINI_FREE`·`LLM_DAILY_LIMIT_GEMINI`).

### 방 id와 세션 id는 다른 물건이다

부품이 두 번 실패한 자리다. `createGameWorker`는 room-id를 `?room=`으로 못 박아 아무도 못 썼고, `roomIdFrom` 훅으로 고친 `roomDelegate`도 소비자가 0이었다. 훅 모양의 문제가 아니었다.

| | 방 id | 세션 id |
|---|---|---|
| 하는 일 | 어느 DO 인스턴스인가 · 남에게 불러주는 이름 | 이 자리를 이어갈 자격 |
| 있어야 할 곳 | URL (경로·쿼리) | 본문 · WS 메시지 |
| 왜 | 라우터가 본문을 읽지 않고 위임할 수 있다 | URL에 두면 히스토리·리퍼러·로그로 샌다 |

멀티 두 게임은 이미 나눠 놨다. eotm은 경로 `:code` + 본문 `{ playerId, token }`, speedquiz 멀티는 쿼리 `?room=` + join 메시지의 `playerId`다. 싱글 두 게임(sultan·speedquiz 싱글)만 `gameId` 하나가 겸직해서 그 값이 본문으로 내려갔고, 거기서 라우터가 막혔다.

**세션 검증은 아직 부품으로 안 뽑는다.** eotm은 토큰을 따로 두고 speedquiz 멀티는 `playerId` UUID 하나로 끝낸다. 두 게임이 같은 필요를 다른 방식으로 풀고 있어서, 지금 뽑으면 한 게임 모양을 공통이라고 부르는 이전 판 실수를 반복한다. 계정(로드맵 #6·2단계)이 붙을 때 다시 본다.

### `Conn<TSeat>` — 좌석 타입을 게임이 정한다

세션 id가 사는 곳이다. eotm·speedquiz 둘 다 `{ playerId }`를 넣는데 이전 판은 `unknown`이라 꺼낼 때마다 게임이 캐스팅했다. 타입 인자로 받으면 hibernation(`serializeAttachment`)을 건너온 값도 선언한 모양으로 돌아온다. 런타임 코드는 그대로다.

## 폐기 완료

`GameRoomDO`(`src/room-do.ts`) · 옛 인터페이스 층(`src/core.ts`) · `WSHibernationTransport`를 지웠다(스펙 §4.8). 마지막 소비자였던 sultan이 부품 조합으로 넘어왔다. 테스트도 같이 정리해 44건에서 39건이 됐다 — 사라진 5건은 삭제된 클래스의 계약 테스트다.

## 원본 매핑

| 부품 | 위치 | 원본 |
|---|---|---|
| 계약 5종 | `src/interfaces.ts` | 3게임 대조에서 관찰한 공통분모 (스펙 §3) |
| `doRoomStore` | `src/room-store.ts` | 3게임 공통 — storage 키 하나에 방 전체 |
| `doAlarms` | `src/alarms.ts` | eotm `apps/worker/src/room-do.ts`의 `alarmTag`·`alarmChain`(I1·I2) |
| `sseTransport` | `src/transport-sse.ts` | eotm `apps/worker/src/room-do.ts`의 `sinks`/`heartbeats`·`frame()`/`broadcast()` |
| `wsTransport` | `src/transport-ws.ts` | ai-speed-game `worker/room-do.mjs`의 `fetch()`/`broadcast()`·`serializeAttachment` |
| `QuotaDO` | `src/quota-do.ts` | marriage_problem `worker/quota-do.mjs` ≡ ai-speed-game(바이트 동일) · eotm의 UTC 날짜 스코프 |
| `rateLimit`·`roomDelegate` | `src/middleware.ts` | marriage_problem ↔ ai-speed-game `worker/index.mjs`(구조 동일) |
| `createLogger` | `src/logger.ts` | eotm `apps/worker/src/log.ts`의 `{level, event, ...}` 포맷 |
| `EgressDO`·`egressFetch` | `src/egress-do.ts` | marriage_problem `worker/egress-do.mjs`(워킹트리 미커밋 유일본) |

이 패키지는 추출본이다. 새 부품은 두 게임 이상에서 필요해질 때 추가한다.
