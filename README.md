# 이달의 우수사원

> 보스의 마음을 움직이는 간언으로, 사원에서 사장까지.

**플레이: [eotm.narre.io](https://eotm.narre.io)**

---

## 게임 소개

갓 입사한 말단 사원이 된다. 회장이 골치 아픈 안건을 던지면 AI 참모 셋과 나란히 한 마디씩 올리고, 회장은 그중 **딱 하나만 채택**한다. 채택되면 승진, 꼴찌는 창밖.

- **정답이 없다** — 회장마다 채점축이 다르다. 조조는 실리·기지·체면, 유비는 대의·의리·실속.
- **눈치가 실력** — 앞 발언을 밟을지 얹을지. 뒤 순번일수록 정보는 많지만 기대치도 높다.
- **회장이 직접 채점** — 채택 사유·축별 점수·에필로그까지 그 자리에서.

### 모드

| | |
|---|---|
| **혼자 출근하기** | AI 참모 3인과 채택 경쟁 |
| **방 만들기** | 4자리 코드로 최대 6명. 빈자리는 AI가 채움 |
| **방 코드로 참가** | 받은 코드로 합류 |

### 보스

- 기본 6인 — 조조 회장 · 유비 대표 · 손권 회장 · 마왕 · 제우스 회장 · 선조 회장
- 커스텀 — 이름과 컨셉만 넣으면 참모진·승진 사다리·상황까지 AI가 생성

---

## 로컬 실행

Node.js 20 이상.

```bash
git clone https://github.com/Jiyong-C-Lee/employee-of-the-month.git
cd employee-of-the-month
npm install
npm run dev
```

첫 실행이면 API 키를 묻는다.

```
  1. Google AI Studio — 무료 등급  (https://aistudio.google.com/apikey)
  2. Google AI Studio — 유료 등급
  3. NVIDIA NIM                    (https://build.nvidia.com)
  0. 키 없이 시작

  번호를 고르세요 [0]:
```

- **`0`을 골라도 완주 가능** — 내장 mock이 대사·판정을 대신 만든다. 다만 정해진 틀이라 무료 키 하나는 넣는 편이 낫다.
- 선택값은 루트 `.dev.vars`에 저장되고 다음부터 묻지 않는다. `.gitignore`에 포함.
- 접속: `http://localhost:8787`

### 키 변경

`.dev.vars`를 직접 고친다. 항목은 `.dev.vars.example`.

| 변수 | 발급처 |
|---|---|
| `GOOGLE_AI_STUDIO_FREE_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) — 무료 등급 |
| `GOOGLE_AI_STUDIO_API_KEY` | 같은 곳의 유료 등급 |
| `NVIDIA_API_KEY` | [NVIDIA NIM](https://build.nvidia.com) |

위에서부터 순차 시도, 전부 실패하면 mock으로 떨어진다.

### 화면 개발

```bash
npm run dev      # 워커 (8787) — 게임 API
npm run dev:web  # Vite (5173) — 화면. /api는 8787로 프록시
```

- 화면 작업은 5173 권장. 저장 즉시 반영.
- **8787이 꺼지면 화면은 떠도 인물 목록이 안 나온다.**

### 기타 명령

```bash
npm test        # 88개 (게임 로직 · 워커 · 콘텐츠 검증)
npm run build   # web/dist 생성
npm run gen     # 페르소나 팩 인덱스 재생성
```

---

## 구조

```
worker/     게임 서버. 상태 머신 · 채점 · LLM 오케스트레이션
web/        화면 (React). 만화 컷 형태의 한 페이지
shared/     양쪽이 함께 쓰는 타입
content/    페르소나 팩 · 문자열 · 프롬프트 (전부 JSON)
packages/   Cloudflare 배관 · LLM 체인 · 공용 UI 셸
```

**엔진이 진실, LLM은 서술.** 채택자·점수·승진·탈락은 `worker/game/`이 계산한다. LLM은 참모 발언과 판정 문장만 맡는다.

```
상황 공개 → 참모 발언 (LLM) → 내 발언 → 회장 판정 (LLM) → 결과 · 에필로그
```

**문자열·수치는 코드에 없다.** 전부 `content/` 아래 JSON이다.

| 파일 | 내용 |
|---|---|
| `packs/<보스>/persona.json` | 성격 · 채점축 · 참모진 · 승진 사다리 |
| `packs/<보스>/situations.json` | 그 보스가 꺼내는 안건 |
| `global/ui.json` | 화면 라벨·버튼·안내문 |
| `global/strings.json` | 게임 진행 대사 |
| `global/prompts.json` | LLM 프롬프트 |

보스 추가 = `content/packs/` 아래 폴더 생성 후 `npm run gen`.

---

## 기술

- **Cloudflare Workers** — 서버 없이 엣지에서 실행. 방 하나 = Durable Object 하나로 발언 순서·타이머를 쥐고, 진행 상황은 SSE로 민다.
- **LLM 체인** — 무료 등급부터 순차 시도. 일일 호출 한도는 Durable Object가 센다.
- **React + Vite**

---

## 배포

```bash
npm run deploy
```

- `wrangler.jsonc`의 워커 이름과 `migrations` 태그는 고정. 바꾸면 진행 중인 방이 끊긴다.
- 프로덕션 키는 파일이 아니라 `wrangler secret`으로 관리.

```bash
npx wrangler secret put GOOGLE_AI_STUDIO_FREE_API_KEY
```
