# 베타 기능 4종 설계 — 출력량 튜닝·OG/분석·공유하기·커스텀 페르소나

2026-07-23. `feat/v1` 이후 상용 베타 준비 묶음. 광고·약관·피드백 채널·서버 공유 URL은 이번 스코프에서 **제외**(광고는 지표 확인 후 재검토).

구현 순서: **1 → 2 → 3 → 4** (폰트 로컬화가 3의 선행조건, OG가 3의 공유 문구에 쓰임).

## 1. 참모 출력량 튜닝 + 프롬프트 캐싱 재배치

문제: 프롬프트가 "2~3문장, 100~160자"를 요구해도 실제 출력이 40~50자 단답으로 나옴. 동시에, 판정 LLM이 장문에 점수를 후하게 주는 편향이 있어 참모 대사가 길어지면 유저 입력 부담이 커짐.

목표 길이: **참모 대사 50~120자** (유저 입력 상한 `MAX_SPEECH_CHARS=160`은 유지).

- `packages/content/global/prompts.json`:
  - `advisorBatchSystem` 길이 규칙을 "2~3문장, 공백 포함 50~120자. 한 문장 단답은 실패, 120자 초과도 실패"로 교체하고, 규칙 나열에 묻히지 않게 길이 규칙을 강조(굵게/별도 행). 90~110자대 좋은 예시 대사 1개 삽입 — 모델은 지시보다 예시 길이를 따라간다.
  - `judgeSystem`에 길이 편향 방지 1줄 추가: "발언의 길이는 채점 근거가 아니다. 짧아도 정곡이면 후하게, 길어도 공허하면 깎아라."
  - **캐싱 재배치**: `advisorBatchSystem`·`judgeSystem` 템플릿을 "불변 규칙 전부 앞 → 가변 토큰(`{listenerBrief}`·`{advisorRoster}`·`{flaw}`, `{personaPrompt}`·`{axes}` 등)은 맨 뒤" 순서로 재배열. Gemini 암묵적 캐싱(동일 프리픽스 ≥ ~1,024토큰)이 같은 페르소나 연속 플레이에서 잡히도록.
- `apps/worker/src/ai`:
  - 참모 배치 응답 zod 검증에 `text` 최소 길이(40자) 추가 — 위반 시 기존 체인 규칙대로 다음 공급자로 폴백. mock은 검증 대상 아님.
  - 참모 대사는 `trimSpeech(text, 120)`으로 상한 클램프(문장 끝에서 자르는 기존 함수 재사용).
- 검증: `npm test`(ai-pure 등 기존 테스트의 160 가정 갱신), `npm run smoke`로 실호출 길이 육안 확인.

## 2. OG·파비콘·SEO + 익명 분석

`apps/web/index.html` + 정적 에셋만. 서버 변경 없음.

- OG/트위터 카드: `og:title`·`og:description`·`og:image`(1200×630 정적 PNG, `apps/web/public/og.png`)·`twitter:card=summary_large_image`.
- 파비콘 세트(ico/png/apple-touch), `<meta name="description">`.
- Cloudflare Web Analytics 비콘 1줄. 쿠키 없음 → 동의 배너 불필요. 토큰은 CF 대시보드에서 발급받아 치환(수동 단계).
- 수동 체크리스트(코드 밖): 커스텀 도메인 구입·wrangler 라우팅 연결, CF Web Analytics 사이트 등록.

## 3. 공유하기 — 라운드 전체 이미지 (클라이언트 캡처)

라운드 판정 공개 후 "이 라운드 공유" 버튼. 서버 저장·공유 URL 없음(2차 과제).

- 캡처: 화면 DOM을 직접 찍지 않고, **캡처 전용 숨김 레이아웃**(라운드 상황 + 전체 발언 만화 컷 + 판정·코멘트 + 하단 워터마크: 로고·서비스 URL)을 렌더해 `html-to-image`로 PNG 생성. 버튼·타이머 등 UI 잡음 배제.
- 공유 동작: Web Share API(files) 지원 시 네이티브 공유 시트(카톡 등) → 미지원이면 PNG 다운로드 폴백 + 클립보드 복사 옵션.
- **폰트 로컬화**: Nanum Gothic을 Google Fonts CDN → 로컬 번들(woff2, `@font-face`)로 이전. 캡처 시 폰트 미적용 방지 + 초기 로딩 개선. `index.html`의 preconnect/link 제거.

## 4. 커스텀 페르소나 (AI 보조 간편 생성)

- **입력**: 이름·컨셉 필수. 말투 힌트·역린·채점축 선택 — 빈칸은 AI가 채운다.
- **생성 API**: `POST /api/personas/generate` (Hono 라우트). 기존 AI 체인(chain.ts) 재사용, 1콜로 팩 전체를 responseSchema 강제 생성:
  intro·personaPrompt·listenerBrief·judgeAddress, axes 3, ranks 7, advisors 4명(각 quirks 4+), situations 8.
  결과는 기존 `personaSchema`(zod, situations 포함 `personaSchema.extend`)로 검증 — 실패 시 체인 폴백, 최종 실패 시 에러 응답(재시도 안내).
- **쿼터**: QuotaDO 재사용 — IP당 일 5회 생성 제한.
- **컨펌 UI**: 홈 화면에서 진입하는 위저드. 생성 결과를 항목별 편집 가능한 미리보기(이름·소개·축·참모·상황 샘플)로 표시 → 유저 수정 → 저장.
- **저장·사용**: localStorage에 복수 보관(`id: custom-<uuid8>`). 방 생성 시 `POST /api/rooms` body에 `customPersona`(팩 JSON 전체) 첨부 → 서버가 `personaSchema` 재검증 + 직렬화 크기 상한 20KB → RoomDO storage에 저장, 방 참가자 전원 공유. `PublicRoom`의 페르소나 표시는 기존 필드 그대로(id만 custom).
- **안전장치**: 생성 시스템 프롬프트에 실존 인물 비하·혐오·성적 소재 차단 지침. 서버 zod 검증이 구조·길이·개수 상한을 강제. 공개 갤러리 없음(사적 사용) — 검수 체계는 스코프 밖.

## 테스트·검증

- 기존: `npm test`, `npm run typecheck`, `npm run smoke`.
- 신규 단위 테스트: 참모 텍스트 길이 검증·클램프, `personaSchema` 기반 generate 응답 검증, `/api/rooms` customPersona 검증(정상·초과 크기·스키마 위반).
- 공유 이미지·위저드 UI는 수동 확인(모바일 Web Share 포함).
