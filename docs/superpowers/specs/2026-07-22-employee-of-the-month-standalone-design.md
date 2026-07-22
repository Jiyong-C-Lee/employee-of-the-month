# 이달의 사원 — 독립 서비스 설계

- 날짜: 2026-07-22
- 상태: 사용자 검토 대기
- 원본: `C:\Users\user\ai-debate-game`의 간신배(sycophant) 게임을 분리·이식

## 1. 목표

`ai-debate-game` 저장소에 토론 게임과 동거 중인 간신배 게임("이달의 사원")을 독립 저장소·독립 서비스로 분리하고, 실제 웹에 공개하는 프로토타입 수준의 프로덕트로 리팩토링한다. 게임 규칙·콘텐츠·연출은 기존 그대로 유지하고, 구조(소스/데이터 분리, 타입, 전송 계층, 배포)만 프로덕트 체계로 바꾼다.

## 2. 결정 요약

| 항목 | 결정 | 근거 |
|---|---|---|
| 게임 범위 | 싱글 + 멀티 모두 유지 | 기존 기능 보존 |
| 언어 | TypeScript (ESM) | 이식하면서 전환하는 게 비용 최소 |
| 실시간 전송 | **SSE + POST** (Socket.IO 제거) | 턴제·저빈도 게임. 표준 HTTP로 환원되어 운영·디버깅·이동성 우세 |
| 배포 | **Cloudflare Workers + Durable Objects** | 방=DO 1:1, Alarms로 서버 권위 타이머, 무료 티어에 콜드스타트 없음, 한국 엣지 지연 최소 |
| 서버 프레임워크 | Hono | Workers 표준. Express와 유사 API |
| DB | **없음** | 게임 상태는 세션 수명. DO 내장 SQLite storage로 방 수명만큼의 영속성 확보 |
| 게임데이터 | 콘텐츠 팩 디렉토리 + zod 스키마 검증 | 목적: 콘텐츠 확장 용이성. 페르소나 추가 = 폴더 추가 |
| 저장소 구조 | npm workspaces 경량 모노레포 | 서버·클라가 이벤트 계약 타입을 공유 |
| LLM | Gemini flash-lite + **NVIDIA NIM**(OpenAI 호환, RPM 40) 이중 공급자 → 결정적 mock 최종 폴백 | 무료 쿼터 두 개 합산으로 처리량 확보. 체인 덕에 비용·장애 하방 방어 |
| 테스트 | vitest (+ @cloudflare/vitest-pool-workers) | 기존 node:test 자산 이식 |

## 3. 전체 아키텍처

```
[브라우저 SPA (React + Vite)]
   │  POST /api/rooms, /join, /speak, /next        (액션)
   │  GET  /api/rooms/:code/events   ← SSE 스트림  (서버 푸시)
   ▼
[Cloudflare Worker (Hono)]
   ├─ 정적 SPA 서빙 (Workers Assets)
   ├─ GET /api/personas, /api/health
   ├─ 방 생성 rate limit (IP당)
   └─ /api/rooms/:code/* → RoomDO(idFromName(code)) 로 위임
        │
        ▼
[RoomDO — 방 1개당 Durable Object 1개]
   ├─ 게임 엔진 상태머신 (서버 권위)
   │    SITUATION → ADVISORS → PLAYER_TURNS → JUDGING → RESULT → (다음 라운드 | END)
   ├─ 인메모리 상태 + ctx.storage(SQLite)에 저장 → hibernation·재배포에도 방 생존
   ├─ Alarms: 발언 마감 시각 집행 (마감 지나면 자동 진행)
   ├─ SSE 스트림 관리 (접속 시 스냅샷 → 이후 이벤트 푸시, heartbeat)
   └─ AI 호출: 공급자 체인 Gemini → NVIDIA NIM → mock (실패·429·쿼터 초과 시 다음으로)
```

### 3.1 타이머 — 마감 시각 방식

매초 틱 브로드캐스트를 폐지한다. phase 이벤트에 `deadline`(epoch ms)을 실어 보내고 카운트다운은 클라이언트가 로컬 렌더. 마감 집행은 DO Alarm이 담당한다 (`ctx.storage.setAlarm(deadline)` → alarm 핸들러에서 페이즈 진행).

### 3.2 재접속 복구 — 스냅샷 방식

SSE 접속(및 재접속) 시 첫 이벤트로 방 전체 스냅샷(방 상태 + 현재 게임의 feed 전체)을 내려보낸다. feed는 게임당 최대 ~100건 수준이라 스냅샷에 포함 가능. `Last-Event-ID` 리플레이는 사용하지 않는다 — 클라이언트는 스냅샷으로 feed를 리셋하고 이후 이벤트를 이어 붙인다. 복구 로직이 한 가지 경로로 단순해진다.

### 3.3 플레이어 식별

방 생성/입장 시 DO가 `playerId + token`을 발급한다. 이후 모든 액션 POST와 SSE 구독에 토큰을 첨부(쿼리 또는 헤더). 계정·쿠키 없음(익명). 토큰은 방 수명과 함께 소멸.

## 4. 디렉토리 구조

```
employee-of-the-month/
├─ apps/
│  ├─ worker/                  # @eotm/worker — 서버
│  │  ├─ src/
│  │  │  ├─ index.ts           # Worker 엔트리: Hono 라우팅 + assets + DO 위임
│  │  │  ├─ room-do.ts         # RoomDO 클래스 (엔진 호스팅·storage·alarm·SSE)
│  │  │  ├─ http/              # routes.ts, sse.ts, guard.ts(rate limit·토큰 검증)
│  │  │  ├─ game/              # engine.ts(상태머신), logic.ts(순번·채택·승진 순수함수), state.ts(방 상태 타입·직렬화)
│  │  │  └─ ai/                # chain.ts(공급자 체인), providers/{gemini,nvidia}.ts, prompts.ts, mock.ts, verdict.ts(검증·교정)
│  │  ├─ test/
│  │  └─ wrangler.jsonc        # DO 바인딩·assets·환경변수 선언
│  └─ web/                     # @eotm/web — React + Vite SPA
│     ├─ src/
│     │  ├─ screens/           # Home, Lobby, Game
│     │  ├─ components/        # Feed, VerdictCard, ComicCuts, EmployeeFrame, ...
│     │  ├─ api/               # sse.ts(EventSource 구독), actions.ts(POST 래퍼)
│     │  ├─ store/             # ServerEvent → 화면 상태 리듀서
│     │  └─ theme/             # comic.css 등
│     └─ public/               # 만화 에셋
├─ packages/
│  ├─ shared/                  # @eotm/shared — 서버·클라 공용 계약 (단일 진실)
│  │  └─ src/
│  │     ├─ events.ts          # ServerEvent 유니언 (snapshot|room|phase|turn|feed|ended)
│  │     ├─ api.ts             # REST 요청/응답 타입
│  │     └─ constants.ts       # MAX_SPEECH_CHARS(140), 발언 시간 옵션(30/45/60) 등
│  └─ content/                 # @eotm/content — 게임데이터
│     ├─ src/
│     │  ├─ schema.ts          # persona·situation·prompts·strings zod 스키마
│     │  └─ loader.ts          # 전 팩 + 전역 데이터 로드·검증 (위반 시 팩·필드 지목하며 실패)
│     ├─ global/               # prompts.json(프롬프트 템플릿·난이도·해법 축), strings.json(시스템 대사·mock)
│     └─ packs/                # 6종: caocao, liubei, sunquan, yuanshao, dongzhuo, kimceo
│        └─ <id>/              # persona.json + situations.json
├─ docs/superpowers/specs/     # 이 문서
├─ package.json                # npm workspaces 루트
└─ README.md
```

### 4.1 소스/데이터 경계 규칙

- **팩에 들어가는 것**: 페르소나 메타(이름·이모지·소개·listenerBrief·judgeAddress), 채점 축, 계급 사다리, 조언자(이름·성향·성향 프롬프트), 인물 프롬프트, 상황 목록. — 새 페르소나 추가 시 코드 수정 없이 `packs/` 폴더 하나 추가가 전부.
- **전역 게임데이터**(`packages/content/global/`): 프롬프트 템플릿(조언자 배치/판정/에필로그 시스템 프롬프트, 난이도 문구, 해법 축)과 시스템 대사(라운드 안내·폴백 문구·mock 대사) — 원본의 `sycophant-prompts.json`·`sycophant-strings.json`을 승계. 문구 수정은 데이터 수정.
- **코드에 남는 것**: 프롬프트 조립 로직(`fmt` 토큰 치환)·responseSchema, 게임 규칙(순번·채택·승진), mock 생성 로직.
- 콘텐츠는 빌드 시 번들에 포함(Workers는 파일시스템이 없으므로 import로 정적 포함). loader가 모듈 로드 시점에 zod 검증 — 스키마 위반 팩이 있으면 배포 전에 실패한다.

## 5. 통신 계약

### 5.1 REST (액션)

| 메서드·경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/rooms` | `{ nick, config: { mode, personaId, speakTime, aiCompete, maxPlayers } }` | `{ code, playerId, token, room }` — 싱글은 즉시 게임 시작 |
| `POST /api/rooms/:code/join` | `{ nick }` | `{ playerId, token, room }` |
| `POST /api/rooms/:code/start` | (방장 토큰) | `{ ok }` |
| `POST /api/rooms/:code/speak` | `{ text }` (자기 순번에만 유효, 140자 서버 검증) | `{ ok }` |
| `POST /api/rooms/:code/next` | (방장 토큰) | `{ ok }` |
| `POST /api/rooms/:code/leave` | | `{ ok }` |
| `GET /api/personas` | | 공개 요약 배열 (상황 본문 제외 — 스포일러 방지 유지) |
| `GET /api/health` | | `{ ok, providers: { gemini: boolean, nvidia: boolean }, models }` |

### 5.2 SSE (푸시) — `GET /api/rooms/:code/events?playerId&token`

| 이벤트 | 페이로드 요지 |
|---|---|
| `snapshot` | 방 전체 상태 + 현재 게임 feed 전체 (접속·재접속 시 최초 1회) |
| `room` | 방 상태 변경 (플레이어 입장·퇴장·계급·총애) |
| `phase` | `{ phase, roundNo, deadline?, situation? }` |
| `turn` | `{ playerId, nick, deadline }` — 발언 순번 |
| `feed` | `{ type: 'speech'\|'advisor'\|'verdict'\|'epilogue'\|'system', ... }` |
| `ended` | 최종 결과 (우승자·순위) |

- 모든 이벤트에 단조 증가 `seq` 부여 (클라이언트 중복 방지용).
- heartbeat: 20초 간격 주석 라인.

## 6. 게임 도메인 (기존 규칙 그대로 이식)

- 상태머신: `SITUATION → PLAYER_TURNS(통합 발언 큐) → JUDGING → RESULT → (다음|END)`.
- 발언 큐: AI 조언자 블록 먼저, 사람 블록 나중(앞 의견을 보고 반박할 수 있는 유리한 자리). 블록 내에서는 총애 높은 순(1라운드는 정의순/입장순). 채택: 축 합산 최고점, 동점은 늦게 말한 쪽. 승진: 채택 수 = 계급 인덱스, 최고 계급(채택 4회) 도달 시 우승. 상황 소진 시 종료(멀티=총애 최다 우승, 싱글=실패 엔딩).
- AI 3종 호출(조언자 배치 1콜·판정·에필로그)과 `finalizeVerdict` 검증 규칙(0~10 클램프, 서버 채택 재계산, key/이름 관용 매칭, 불일치 시 사유 대체), 판정 시 익명 라벨 마스킹(이름값 편향 방지)은 기존 그대로.
- 발언 160자 제한(문장 끝에서 자르는 `trimSpeech`), 발언 시간 싱글 무제한 / 멀티 60·120·180초(기본 60), 난이도(조언자 완성도) easy/normal/hard 유지.
- 페르소나 6종(caocao·liubei·sunquan·yuanshao·dongzhuo·kimceo) 이식.

## 7. 운영·안전장치

- **LLM 공급자 체인**: 1차 Gemini flash-lite → 2차 NVIDIA NIM(OpenAI 호환 chat completions, RPM 40) → 최종 mock. 429·타임아웃·응답 스키마 위반 시 다음 공급자로 페일오버한다 — 사전 RPM 관리 없이 429 응답 기반으로 단순하게. 두 공급자는 `callJson({ system, user, schema, temperature, timeoutMs })` 공통 인터페이스(chain.ts)로 묶고, NIM은 모델별 structured output 지원이 달라 관용 JSON 파싱 + zod 검증 실패 시 다음 공급자로 취급한다. 모델명은 vars로 설정(`GEMINI_MODEL`, `NVIDIA_MODEL`).
- **LLM 비용 상한**: QuotaDO(싱글턴)에 공급자별 일일 호출 카운터 — 상한 초과한 공급자는 체인에서 스킵. 전부 소진돼도 mock으로 게임은 계속 동작. 방당 호출 수도 구조적으로 유한(라운드당 3회 × 최대 5라운드).
- **남용 방지**: 방 생성 IP당 rate limit(Worker 레벨), 발언 길이·순번 서버 검증, join 정원 검증.
- **방 수명**: 마지막 활동 후 30분 경과 시 alarm으로 storage 삭제(자체 청소). DO는 참조가 없으면 자연 소멸.
- **SSE 배포 체크리스트**: heartbeat 20초, 클라이언트 EventSource 자동 재접속 + 스냅샷 복구.
- 로깅: §11 로깅 플랜 참조.

## 8. 테스트 전략

| 계층 | 도구 | 내용 |
|---|---|---|
| 순수 로직 | vitest | 순번·채택·승진, `finalizeVerdict`, mock 출력 형태 — 기존 테스트 이식 |
| 콘텐츠 | vitest | 전 팩 zod 스키마 통과, 상황 수·조언자 수 등 무결성 |
| 엔진 | vitest + fake timers | 상태머신 전이, 마감 처리, 라운드 진행 |
| DO 통합 | @cloudflare/vitest-pool-workers | 방 생성→발언→판정 1라운드, 스냅샷 복구, alarm |
| E2E 스모크 | 스크립트 (`wrangler dev` 대상) | 싱글 1판 + 멀티 1라운드 헤드리스 — 기존 `syco-smoke` 이식 |

## 9. 이식 맵핑

| 원본 (`ai-debate-game`) | 이식처 | 비고 |
|---|---|---|
| `server/sycophant/logic.js` | `apps/worker/src/game/logic.ts` | 거의 그대로 TS화 |
| `server/sycophant/{prompts,mock,ai}.js` | `apps/worker/src/ai/` | 그대로 TS화, `ai.js`→`verdict.ts`+오케스트레이션 |
| `server/llm.js` | `apps/worker/src/ai/providers/gemini.ts` | fetch 기반이라 Workers에서 그대로 동작. NVIDIA 공급자(providers/nvidia.ts)를 신설하고 chain.ts 공통 인터페이스로 묶음 |
| `server/sycophant/engine.js` | `apps/worker/src/game/engine.ts` | 소켓 브로드캐스트→SSE 발행, setTimeout→Alarm. **가장 손 많이 가는 부분** |
| `server/rooms.js` (간신배 경로) | `apps/worker/src/game/state.ts` | debate 분기 제거, DO storage 직렬화 추가 |
| `server/data/personas.json` | `packages/content/packs/*/` | 페르소나 6종을 팩 구조로 분해 |
| `server/data/sycophant-{prompts,strings}.json` | `packages/content/global/` | 전역 게임데이터로 승계, `content.js`의 fmt/로더는 loader.ts로 |
| `client/src/{SycoGame,Syco*,Comic*,Feed}` 등 | `apps/web/src/` | store를 소켓 구독→SSE 리듀서로 교체 |
| `server/game.js`, `judge/`, debate 화면 | **미이식** | 토론 게임은 원본 저장소에 남김 |

네이밍: 대외 서비스명 "이달의 사원", 패키지 스코프 `@eotm`. 내부 코드의 `syco` 접두어는 이식하면서 제거(단일 게임이므로 불필요).

## 10. 배포

- `wrangler deploy` 한 번으로 Worker + DO + 정적 SPA 동시 배포. 무료 `*.workers.dev` 서브도메인으로 시작, 커스텀 도메인은 필요 시 추가.
- **시크릿**: `GOOGLE_AI_STUDIO_API_KEY`·`NVIDIA_API_KEY`는 프로덕션은 `wrangler secret put`, 로컬은 `.dev.vars` 파일(.gitignore 필수). 키가 코드·저장소·wrangler.jsonc에 절대 들어가지 않는다. 모델명(`GEMINI_MODEL`, `NVIDIA_MODEL`) 등 비밀 아닌 설정은 wrangler.jsonc `vars`.
- **wrangler.jsonc 체크리스트**: DO 마이그레이션 선언(`migrations` + `new_sqlite_classes: ["RoomDO", "QuotaDO"]` — 누락 시 배포 실패), Workers Assets `not_found_handling: "single-page-application"`(SPA 라우팅 폴백), `observability.enabled = true`(§11).
- **재배포 안전성**: 배포 시 활성 DO는 새 코드로 재기동되지만 storage가 유지되므로 진행 중인 방이 살아남는다(§3의 직렬화가 전제). 상태 직렬화 형식을 바꾸는 배포는 마이그레이션 로직을 동반해야 한다.
- **롤백**: `wrangler rollback`으로 직전 배포 버전 즉시 복귀 가능. 단 storage 형식을 바꾼 뒤의 롤백은 위 호환성 규칙에 걸리므로 주의.
- 로컬 개발: `wrangler dev` (DO·alarm 로컬 에뮬레이션) + Vite dev 서버 프록시.
- CI/CD는 v1 범위 외 (로컬 배포). 반응이 생기면 GitHub Actions 추가.

## 11. 로깅 플랜

프로토타입 규모에 맞게 **Workers 내장 기능만 사용**하고, 외부 로깅 서비스·라이브러리는 두지 않는다.

- **수집**: wrangler.jsonc에 `observability.enabled = true` — `console.log` 출력이 Workers Logs로 자동 수집되어 대시보드에서 검색·필터 가능(무료 플랜 일 20만 이벤트, 3일 보관). 실시간 확인은 `wrangler tail`.
- **형식**: JSON 한 줄 로그. 공통 필드 `{ event, roomCode, level }` + 이벤트별 필드. `console.log(JSON.stringify(...))` 래퍼 함수 하나(`log.ts`)로 통일한다.
- **로그 이벤트 목록** (info):
  - `room_created` `{ mode, personaId }` / `game_started` `{ nicks }` / `game_ended` `{ rounds, winnerNick? }`
  - `round_started` `{ roundNo, situation }` / `speech_submitted` `{ roundNo, nick, text }`
  - `verdict_issued` `{ roundNo, provider, adoptedNick, totals, comments }`
  - `llm_call` `{ kind: advisors|judge|epilogue, provider: gemini|nvidia|mock, ok, latencyMs, failedOver? }` — 공급자별 폴백률·지연 추적의 핵심
  - `sse_connect` / `sse_disconnect` `{ playerId }`
  - `quota_exceeded` `{ provider }` (warn) — 해당 공급자 일일 쿼터 도달
- **에러**: 예외는 error 레벨로 스택 포함 기록. LLM 실패는 warn + 다음 공급자 페일오버 태그. Workers의 미처리 예외는 플랫폼이 자동 수집.
- **게임플레이 로그 방침**: 게임 튜닝(어떤 발언이 어떻게 채점되는지 관찰)이 로깅의 주 목적이므로 닉네임·발언 본문·판정 코멘트를 로그에 **포함**한다. 단 Workers Logs 보관이 3일이므로, 장기 분석용 게임 기록 보존이 필요해지는 시점에 D1 적재로 승격(v2).
- **지표**: 별도 지표 시스템 없음. 판수·폴백률·판정 지연은 Workers Logs 검색으로, 요청 수·에러율·지역 분포는 Cloudflare 기본 Analytics로 충분.

## 12. 범위 제외 (v2 후보)

계정·전적·통계(D1), 판정 카드 공유 링크, 토론 게임 이식, 비개발자용 콘텐츠 편집 파이프라인, CI/CD, 커스텀 도메인.

## 13. 리스크와 완화

- **SSE가 DO를 깨워둠**: 열린 스트림 동안 DO가 활성 상태로 duration 쿼터(무료 13,000 GB-s/일 ≈ 128MB 기준 약 28 인스턴스-시간/일)를 소모한다. 프로토타입 동접 규모에선 여유. 초과 조짐이 보이면 유휴 스트림 자동 종료(클라 자동 재접속) 또는 WebSocket hibernation 전환이 출구.
- **Workers 런타임 학습 곡선**: Hono·DO·wrangler가 팀에 새로움. 게임 로직·콘텐츠·shared는 순수 TS라 플랫폼 무관 — 리스크는 배선 계층에 국한.
- **Cloudflare 종속**: 배선 계층만 종속. 순수 로직 분리를 유지하면 Node 서버로 되돌리는 비용은 배선 재작성 수준.
- **Gemini 품질·비용**: 기존과 동일. mock 폴백 + 일일 쿼터로 하방 방어.
