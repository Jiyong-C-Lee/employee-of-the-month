# 이달의 우수사원

> 보스의 마음을 움직이는 간언으로, 사원에서 사장까지.

**플레이: [eotm.narre.io](https://eotm.narre.io)** — 설치 없이 브라우저에서 바로 시작합니다.

---

## 어떤 게임인가

당신은 갓 입사한 말단 사원입니다. 회장이 골치 아픈 안건을 꺼내면, AI 참모 셋과 나란히 서서 한 마디씩 올립니다. 회장은 그중 **딱 하나만 채택**합니다.

채택되면 승진합니다. 꼴찌는 창밖으로 던져집니다.

- **정답이 없습니다.** 회장마다 보는 것이 다릅니다. 조조는 실리·기지·체면을, 유비는 대의·의리·실속을 봅니다. 같은 말도 누구 앞이냐에 따라 명언이 되고 헛소리가 됩니다.
- **눈치가 실력입니다.** 앞사람 발언을 밟고 넘어설지, 반박할지, 슬쩍 얹어갈지. 순번이 뒤일수록 정보는 많지만 기대치도 올라갑니다.
- **회장이 직접 채점합니다.** 채택 사유와 축별 점수, 그리고 "그 후 이야기"까지 그 자리에서 나옵니다.

### 모드

| | |
|---|---|
| **혼자 출근하기** | AI 참모 3인과 채택 경쟁. 바로 시작합니다. |
| **방 만들기** | 4자리 코드를 뽑아 최대 6명까지. 빈자리는 AI가 채웁니다. |
| **방 코드로 참가** | 받은 코드를 입력해 합류합니다. |

### 보스

조조 회장 · 유비 대표 · 손권 회장 · 마왕 · 제우스 회장 · 선조 회장. 여섯 명이 각자 다른 채점축과 역린을 갖고 있습니다.

마음에 드는 사람이 없으면 **나만의 보스 만들기**로 이름과 컨셉만 넣으면 됩니다. 참모진·승진 사다리·상황까지 AI가 만들어 줍니다.

---

## 로컬에서 돌리기

Node.js 20 이상이 필요합니다.

```bash
git clone https://github.com/Jiyong-C-Lee/employee-of-the-month.git
cd employee-of-the-month
npm install
npm run dev
```

첫 실행이면 API 키를 물어봅니다.

```
  1. Google AI Studio — 무료 등급  (https://aistudio.google.com/apikey)
  2. Google AI Studio — 유료 등급
  3. NVIDIA NIM                    (https://build.nvidia.com)
  0. 키 없이 시작

  번호를 고르세요 [0]:
```

**`0`을 골라도 게임은 끝까지 돌아갑니다** — 내장 mock이 참모 대사와 판정을 대신 만듭니다. 다만 대사가 미리 정해진 틀이라, 실제 재미를 보려면 무료 키 하나라도 넣는 편이 낫습니다.

고른 값은 저장소 루트의 `.dev.vars`에 저장되고 다음부터는 묻지 않습니다. 이 파일은 `.gitignore`에 있습니다.

준비가 끝나면 `http://localhost:8787` 을 엽니다.

### 키를 나중에 넣거나 바꾸려면

`.dev.vars`를 직접 열어 고칩니다. 항목은 `.dev.vars.example`에 있습니다.

| 변수 | 발급처 |
|---|---|
| `GOOGLE_AI_STUDIO_FREE_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) — 무료 등급 |
| `GOOGLE_AI_STUDIO_API_KEY` | 같은 곳의 유료 등급 |
| `NVIDIA_API_KEY` | [NVIDIA NIM](https://build.nvidia.com) |

위에서부터 순서대로 시도해 먼저 성공하는 것을 씁니다. 전부 실패하면 mock으로 떨어지고 게임은 계속됩니다.

### 화면을 고칠 때

```bash
npm run dev      # 워커 (8787) — 게임 API. 이것부터 띄웁니다.
npm run dev:web  # Vite (5173) — 화면만 즉시 반영. /api는 8787로 넘깁니다.
```

화면 작업은 `http://localhost:5173`이 편합니다. 저장하면 새로고침 없이 반영됩니다. **8787이 꺼져 있으면 화면은 떠도 인물 목록이 안 나옵니다.**

### 그 밖의 명령

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

**엔진이 진실이고 LLM은 서술만 합니다.** 점수·승진·탈락 판정은 전부 `worker/game/`의 코드가 결정합니다. LLM은 그 결과를 말로 옮길 뿐이라, 모델이 바뀌거나 실패해도 게임 규칙은 흔들리지 않습니다.

**플레이어에게 보이는 문자열과 밸런스 수치는 코드에 없습니다.** 전부 `content/` 아래 JSON입니다.

| 파일 | 내용 |
|---|---|
| `content/packs/<보스>/persona.json` | 성격 · 채점축 · 참모진 · 승진 사다리 |
| `content/packs/<보스>/situations.json` | 그 보스가 꺼내는 안건들 |
| `content/global/ui.json` | 화면에 보이는 모든 라벨·버튼·안내문 |
| `content/global/strings.json` | 게임 진행 대사 |
| `content/global/prompts.json` | LLM 프롬프트 |

보스를 추가하려면 `content/packs/` 아래 폴더를 만들고 `npm run gen`을 돌리면 됩니다.

### 새 상황이 매번 다른 이유

한 라운드의 흐름은 이렇습니다.

```
상황 공개 → 참모 발언 (LLM) → 내 발언 → 회장 판정 (LLM) → 결과 · 에필로그
```

참모 발언과 판정만 LLM이 맡습니다. 누가 채택됐는지, 몇 점인지, 누가 승진하고 누가 떨어지는지는 서버가 계산합니다.

---

## 기술

Cloudflare Workers 위에서 돕니다. 서버 한 대 없이 전 세계 엣지에서 실행됩니다.

- **Durable Objects** — 방 하나 = 객체 하나. 발언 순서와 타이머를 그 안에서 관리합니다.
- **SSE** — 참가자에게 진행 상황을 실시간으로 밀어 줍니다.
- **LLM 체인** — 무료 등급부터 순서대로 시도하고, 다 실패하면 mock으로 떨어집니다. 일일 호출 한도는 Durable Object가 셉니다.
- **React + Vite** — 화면.

---

## 배포

```bash
npm run deploy
```

`wrangler.jsonc`의 워커 이름과 `migrations` 태그는 그대로 두세요. 태그를 바꾸면 진행 중인 방이 끊깁니다.

프로덕션 키는 파일이 아니라 `wrangler secret`으로 관리합니다.

```bash
npx wrangler secret put GOOGLE_AI_STUDIO_FREE_API_KEY
```
