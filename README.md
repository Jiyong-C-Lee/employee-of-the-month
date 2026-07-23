# 이달의 사원

AI 권력자에게 아부해 승진하는 파티 게임. 회장(페르소나)이 던지는 곤란한 상황에 참모(AI)와 플레이어가 번갈아 발언하고, 회장이 가장 마음에 드는 발언을 매 라운드 채택한다. 채택될수록 총애가 쌓여 사원 → 대리 → 과장 → … → 사장까지 승진하며, 최고 직급에 오르면 그 라운드에서 게임이 끝난다. 혼자서 참모들과 경쟁하는 싱글 모드와 여럿이 같은 방에서 겨루는 멀티 모드를 지원한다.

## 모노레포 구조

npm workspaces 기반 경량 모노레포. 서버·클라이언트가 이벤트·API 계약 타입을 `packages/shared`로 공유하고, 게임데이터는 `packages/content`에서 팩 단위로 관리한다.

| 경로 | 패키지 | 역할 |
|---|---|---|
| `apps/worker` | `@eotm/worker` | Cloudflare Worker(Hono). REST 라우팅, RoomDO(방 상태머신·SSE·storage·alarm), QuotaDO(레이트리밋·일일 LLM 쿼터), AI 공급자 체인 |
| `apps/web` | `@eotm/web` | React + Vite SPA. SSE 구독·화면 렌더. Workers Assets로 `apps/worker`가 함께 서빙 |
| `packages/shared` | `@eotm/shared` | 서버·클라 공유 타입(`ServerEvent`, `PublicRoom`, API 요청/응답 등) |
| `packages/content` | `@eotm/content` | 페르소나 콘텐츠 팩(`packs/*`) + 전역 프롬프트·대사(`global/*`), zod 검증 로더 |
| `scripts` | — | `smoke.mjs` 등 저장소 루트 스크립트 |
| `docs` | — | 스펙·구현 계획 문서 |

## 로컬 개발

```bash
npm install

# .dev.vars 준비 (Gemini·NVIDIA API 키)
cp .dev.vars.example apps/worker/.dev.vars
# apps/worker/.dev.vars를 열어 실제 키 값을 채운다 (GOOGLE_AI_STUDIO_API_KEY, NVIDIA_API_KEY)
# 키를 비워두면 mock 폴백으로 동작한다 (게임 진행은 되지만 대사·판정이 결정적 목업)

npm run dev       # apps/worker — wrangler dev, http://localhost:8787
npm run dev:web   # apps/web — vite dev server (API는 worker로 프록시)
```

## 테스트

```bash
npm test          # 전 워크스페이스 vitest
npm run typecheck # 전 워크스페이스 tsc --noEmit
npm run smoke      # 헤드리스 스모크 E2E (아래 참고)
```

`npm run smoke`는 `BASE_URL`(기본 `http://localhost:8787`) 대상으로 싱글 모드 방을 만들고 SSE로 접속해, 내 차례에 발언한 뒤 판정 수신까지 1라운드를 완주시킨다. `wrangler dev`가 떠 있는 상태에서 실행하며, 실키가 채워져 있으면 실제 Gemini/NVIDIA 호출이 발생한다(라운드당 2~3건). 성공 시 `SMOKE PASS`를 출력한다.

## 배포

```bash
npx wrangler secret put GOOGLE_AI_STUDIO_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put NVIDIA_API_KEY --config apps/worker/wrangler.jsonc
npm run deploy
```

`npm run deploy`는 `apps/web`을 빌드한 뒤 `apps/worker`를 배포한다(Workers Assets가 `apps/web/dist`를 함께 서빙). 배포 후 `https://employee-of-the-month.<account>.workers.dev` 형태의 URL이 출력된다.

배포 검증:

```bash
BASE_URL=https://employee-of-the-month.<account>.workers.dev npm run smoke
curl https://employee-of-the-month.<account>.workers.dev/api/health   # providers: {gemini:true, nvidia:true} 확인
npx wrangler tail --config apps/worker/wrangler.jsonc                 # llm_call 로그에 provider·latencyMs 확인
```

배포에는 Cloudflare 계정 인증(`wrangler login`)이 필요하다.

## 베타 기능 운영 노트

- **커스텀 페르소나**: 홈의 "🛠 나만의 보스 만들기"가 `POST /api/personas/generate`(IP당 일 5회, QuotaDO)로 팩 전체를 1콜 생성한다. 결과는 브라우저 localStorage(`eotm.customPersonas`, 최대 8개)에 보관되고, 방 생성 시 팩 JSON이 서버로 전달돼 zod 재검증(20KB 상한) 후 방에 영속된다.
- **라운드 공유**: 판정 후 "📤 이 라운드 공유" 버튼이 캡처 전용 카드(`ShareCard`)를 html-to-image로 PNG화한다. 모바일은 Web Share 시트, 데스크톱은 다운로드 폴백.
- **익명 분석**: Cloudflare Web Analytics. 대시보드에서 사이트 등록 후 빌드 시 `VITE_CF_BEACON_TOKEN=<토큰> npm run deploy`로 주입하면 비콘이 로드된다(미설정 시 완전 비활성).
- **OG·파비콘**: `node scripts/og.mjs`로 `apps/web/public/`의 og.png·아이콘을 재생성한다. `apps/web/index.html`의 `og:image` 절대 URL은 커스텀 도메인 연결 시 갱신할 것.

## 콘텐츠 팩 추가 방법

새 페르소나는 `packages/content/packs/<id>/` 폴더에 `persona.json`(회장 설정·참모·축·계급)과 `situations.json`(상황 5개 이상)을 추가하면 된다. zod 스키마(`packages/content/src/schema.ts`)가 형식을 검증한다.

```bash
npm run gen -w @eotm/content   # packs/ 디렉토리를 스캔해 src/packs.gen.ts 재생성
```

`npm test`/`npm run typecheck`는 `pretest`/`pretypecheck` 훅으로 `gen`을 자동 실행하므로, 팩을 추가한 뒤 바로 테스트를 돌려도 된다.

## 문서

- 설계 스펙: [`docs/superpowers/specs/2026-07-22-employee-of-the-month-standalone-design.md`](docs/superpowers/specs/2026-07-22-employee-of-the-month-standalone-design.md)
- 구현 계획: [`docs/superpowers/plans/2026-07-22-eotm-implementation.md`](docs/superpowers/plans/2026-07-22-eotm-implementation.md)
