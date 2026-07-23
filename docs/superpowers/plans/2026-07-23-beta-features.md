# 베타 기능 4종 구현 계획 — 출력량 튜닝·OG/분석·공유하기·커스텀 페르소나

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참모 대사 길이를 50~120자로 정착시키고, OG/분석·라운드 이미지 공유·AI 보조 커스텀 페르소나를 추가한다.

**Architecture:** 콘텐츠(prompts.json)와 zod 안전망으로 대사 길이를 상·하한 협공. 공유는 클라이언트 캡처(html-to-image) 전용으로 서버 무변경. 커스텀 페르소나는 Worker 생성 API 1개 + localStorage 보관 + 방 생성 시 팩 JSON 전달·서버 재검증으로 RoomDO에 영속.

**Tech Stack:** 기존 스택(Hono·DO·React·Vite·zod·vitest) + 신규 의존성 `html-to-image`, `@fontsource/nanum-gothic`(web), `sharp`(루트 devDep, OG 이미지 생성 스크립트 전용).

**스펙:** `docs/superpowers/specs/2026-07-23-beta-features-design.md`
(스펙과의 의도적 차이 1건: 커스텀 페르소나 situations를 8→**10개** 생성 — 기본 라운드 수 10과 맞추기 위함. 방 생성 시 maxRounds는 상황 수로 클램프.)

## Global Constraints

- 참모 대사: **50~120자**(프롬프트), zod 하한 **40자**, 서버 클램프 상한 **120자**. 유저 입력 `MAX_SPEECH_CHARS = 160`은 **불변**.
- 커스텀 페르소나: 직렬화 **20,000자 이하**, 생성 **IP당 일 5회**(QuotaDO), id는 `custom-` 접두.
- UI 문구·에러 문자열은 코드 하드코딩 금지 — `packages/content/global/strings.json`의 `errors`에만 추가.
- 프롬프트 본문은 `packages/content/global/prompts.json`에만 — 코드에는 토큰 치환만.
- 각 태스크 종료 시 `npm test`(해당 워크스페이스)와 `npm run typecheck` 통과 후 커밋.
- 커밋 메시지 말미: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 참모 대사 길이 상수 + 서버 안전망

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `apps/worker/src/ai/schemas.ts`
- Modify: `apps/worker/src/ai/orchestrate.ts:75`
- Test: `apps/worker/test/ai-pure.test.ts`, `packages/shared/test/constants.test.ts`

**Interfaces:**
- Produces: `ADVISOR_SPEECH_MIN_CHARS = 40`, `ADVISOR_SPEECH_MAX_CHARS = 120` (`@eotm/shared` export — Task 2의 프롬프트 문구와 값 일치해야 함)

- [ ] **Step 1: 실패하는 테스트 작성** — `apps/worker/test/ai-pure.test.ts`에 추가:

```ts
import { advisorBatchOut } from '../src/ai/schemas';
import { ADVISOR_SPEECH_MAX_CHARS } from '@eotm/shared';

const LONG_OK = '회장님, 지금 필요한 건 사과문이 아니라 개업식입니다. 본사 1층을 헐어 무료 시식장을 열면 불만 고객이 단골로 바뀝니다.'; // 40자 이상

describe('advisor speech length guard', () => {
  it('40자 미만 단답은 zod 검증에서 거부된다 (체인 페일오버 유도)', () => {
    const raw = { speeches: [{ name: 'A', text: '태워버리시죠.', approach: '고치기' }] };
    expect(() => advisorBatchOut.parse(raw)).toThrow();
  });
  it('40자 이상 대사는 통과한다', () => {
    const raw = { speeches: [{ name: 'A', text: LONG_OK, approach: '고치기' }] };
    expect(() => advisorBatchOut.parse(raw)).not.toThrow();
  });
  it('trimSpeech는 120 상한에서 문장 경계로 자른다', () => {
    const t = `${LONG_OK} 추가로 현수막은 제가 이미 주문해 두었습니다. 이건 잘려야 하는 문장입니다만 아직도 안 끝났습니다 정말로요.`;
    const out = trimSpeech(t, ADVISOR_SPEECH_MAX_CHARS);
    expect(out.length).toBeLessThanOrEqual(ADVISOR_SPEECH_MAX_CHARS + 1);
    expect(/[.!?…]$/.test(out)).toBe(true);
  });
});
```

(`trimSpeech`는 이 파일에서 이미 import 중이면 재사용, 아니면 `../src/ai/verdict`에서 import.)

- [ ] **Step 2: 실패 확인** — Run: `npm test -w @eotm/worker -- ai-pure`
  Expected: FAIL (`ADVISOR_SPEECH_MAX_CHARS` 미존재 / min 검증 없음)

- [ ] **Step 3: 구현** — `packages/shared/src/constants.ts`에 추가:

```ts
// 참모 대사 길이 밴드 — 프롬프트(50~120자)와 쌍. 하한 미달은 zod 페일오버, 상한 초과는 문장 경계 클램프.
export const ADVISOR_SPEECH_MIN_CHARS = 40;
export const ADVISOR_SPEECH_MAX_CHARS = 120;
```

`apps/worker/src/ai/schemas.ts`:

```ts
import { ADVISOR_SPEECH_MIN_CHARS } from '@eotm/shared';

export const advisorBatchOut = z.object({
  speeches: z.array(z.object({
    name: z.string(),
    text: z.string().min(ADVISOR_SPEECH_MIN_CHARS),
    approach: z.string(),
  })).min(1),
});
```

`apps/worker/src/ai/orchestrate.ts` 75행의 `trimSpeech(s.text)` → `trimSpeech(s.text, ADVISOR_SPEECH_MAX_CHARS)` (import에 `ADVISOR_SPEECH_MAX_CHARS` 추가). mock 경로(`mock.ts`)는 검증·클램프 대상 아님 — 손대지 않는다.

- [ ] **Step 4: 통과 확인** — Run: `npm test -w @eotm/worker && npm test -w @eotm/shared`
  Expected: PASS. 기존 orchestrate/e2e 테스트의 mock 대사가 40자 미만이라 chain validate를 통과 못 해 실패하는 케이스가 있으면, 해당 테스트 픽스처의 대사를 40자 이상으로 갱신한다(로직 변경 금지).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ai): 참모 대사 길이 밴드(40~120) 서버 안전망"`

---

### Task 2: prompts.json — 길이 규칙 50~120자·예시·판정 길이편향 방지·캐싱 재배치

**Files:**
- Modify: `packages/content/global/prompts.json`
- Test: 기존 `packages/content/test/content.test.ts` (스키마 검증 통과 확인만)

**Interfaces:**
- Consumes: Task 1의 길이 밴드 값(문구에 50~120 명시)
- Produces: `advisorBatchSystem`·`judgeSystem` 신규 배열 (토큰 이름 불변 — prompts.ts 수정 불필요)

- [ ] **Step 1: `advisorBatchSystem` 교체** — 배열을 아래로 통째 교체. 원칙: **불변 규칙 전부 앞, 가변 토큰(`{listenerBrief}`·`{advisorRoster}`·`{flaw}`) 맨 뒤** (Gemini 암묵 캐싱용). 기존 규칙 문장은 유지하되 길이 규칙만 갱신·승격:

```json
"advisorBatchSystem": [
  "너는 코미디 파티 게임의 NPC 대사 작가다. 보스의 참모들이 회의실에서 순서대로 의견을 한 마디씩 낸다. 아래 참모 명단 전원의 대사를 한 번에 쓴다.",
  "규칙:",
  "- speeches 배열에 참모 명단 순서 그대로, 참모마다 정확히 1건씩 쓴다. name 필드는 명단의 이름을 한 글자도 바꾸지 말고 그대로 복사한다.",
  "- **발화의 중심은 이번 안건이다.** 참모마다 상황 속 구체 요소(인물·숫자·사물·사건)를 최소 하나 직접 짚고, 그에 대한 자기 성향의 해법을 낸다. 어느 안건에 갖다 붙여도 통하는 뜬구름 발언은 실패다.",
  "- 상황 지문에 참모 본인의 언행·처지가 언급돼 있으면 그것과 모순되지 않게 말한다(본인 얘기인 줄 모르는 척하면 실패).",
  "- 명단의 '이번 버릇'이 있으면 발화에 자연스럽게 한 번만 녹인다. 버릇은 양념이지 본론이 아니다 — 버릇이 발화의 절반을 넘으면 실패다. '없음'이면 버릇 없이 성향과 말투로만 말한다.",
  "- 참모는 보스의 1인칭('내 회사', '내 돈')으로 말하지 않는다. 보스를 부를 때는 상대에 맞는 호칭(회장님, 대표님 등)을 쓴다.",
  "- 참모는 회의석에서 보스에게 보고하는 중이다 — 존댓말이 기본이다. 명단의 말투에 반존대가 명시된 참모만 예외이며, 그 경우에도 반말 명령·청유('~하자', '~해라', '~미루자')로 문장을 끝내면 실패다.",
  "- 이 게임은 코미디다. 참모는 진지한 전략가가 아니라 **예능 캐릭터**다. 그럴듯한 척하지만 어딘가 나사가 하나 빠져 있어야 한다: 뜬금없는 비유, 과장된 궤변, 소인배 같은 잇속 챙기기, 쓸데없이 구체적인 디테일, 진지한 얼굴로 하는 헛소리, 황당하게 스케일이 큰 해법. 듣는 사람이 피식 웃으면 성공이다.",
  "- 나사는 어긋난 논리·잇속·디테일에서 나와야 한다. 잔혹 행위나 인물 학대 자체를 개그로 삼지 마라.",
  "- 단, 개그를 위해 캐릭터를 버리진 마라. 각 참모는 자기 성향을 지키고, 자기 딴에는 지극히 진지하다.",
  "- 두 번째 참모부터는 앞 참모의 발언 중 하나를 짚어 반박하거나 받아친다(이름을 불러도 좋다). 첫 참모는 자기 성향대로 포문을 연다.",
  "- 각 참모는 명단에 지정된 '이번 해법 축'의 방향으로 해법을 낸다(고치기=보완해서 실행, 빼기=버리거나 축소, 포장·재해석=명분 세탁, 미루기=시간 벌기, 남탓=책임 전가, 정면돌파=정공법, 역이용=위기를 기회로). approach 필드에는 지정된 축을 한 글자도 바꾸지 말고 그대로 복사한다. 같은 개그의 릴레이는 금지다.",
  "- **길이 규칙 (가장 중요):** 대사는 한국어 2~3문장, 공백 포함 50~120자. 한 문장 단답은 실패, 120자 초과도 실패다. 근거나 디테일 한 조각을 반드시 넣되, 반드시 문장을 끝까지 완결시킨다. 쉼표는 3개 이하, 소리 내 읽기 좋은 리듬으로.",
  "- 길이 감각 예시 (내용·소재는 따라하지 말고 분량 감각만 참고): \"사과문 대신 본사 1층에 무료 시식장을 여시죠. 불만 고객이 줄을 서면 그게 곧 개업식 아니겠습니까. 현수막은 제가 이미 주문했습니다.\"",
  "- 그 시점의 보스가 알 수 없는 미래 정보(이후 결과·결말)는 절대 언급하지 않는다.",
  "- 지정된 JSON 스키마로만 출력한다.",
  "# 의견을 듣는 상대(보스): {personaName}",
  "{listenerBrief}",
  "# 참모 명단 (발언 순서대로 — 성향은 항상 유지, '이번 버릇'은 이 라운드에만 주어진 양념이다)",
  "{advisorRoster}",
  "# 이번 라운드 결점 지시",
  "- 참모는 유저가 밟고 넘어설 판을 깔아주는 페이스메이커다. 절대 완벽한 모범답안을 쓰지 마라. {flaw}."
]
```

(첫 줄에서 `{personaName}` 제거, 보스 섹션 헤더로 이동 — 정적 프리픽스가 페르소나와 무관하게 동일해진다.)

- [ ] **Step 2: `judgeSystem` 수정** — ① 길이 편향 방지 1줄을 "오직 발언 내용만으로 채점한다" 다음에 삽입: `"- 발언의 길이는 채점 근거가 아니다. 짧아도 정곡을 찌르면 후하게, 길어도 알맹이가 없으면 깎아라."` ② 캐싱 재배치: 2행의 `"{personaPrompt}"`를 배열 끝(`"- 지정된 JSON 스키마로만..."` 뒤)으로 이동하고 앞에 `"# 네 인물 설정"` 헤더 행을 추가. 나머지 행·토큰은 그대로.

- [ ] **Step 3: 검증** — Run: `npm test -w @eotm/content && npm test -w @eotm/worker && npm run typecheck`
  Expected: PASS (프롬프트는 스키마 통과만 확인하면 됨 — 토큰 치환 테스트가 있으면 문구 변경으로 깨질 수 있으니 기대값 갱신).

- [ ] **Step 4: 실호출 확인 (선택, 키 있을 때)** — `npm run dev` 상태에서 `npm run smoke` 실행, wrangler 로그의 참모 대사가 50~120자대인지 육안 확인.

- [ ] **Step 5: Commit** — `git commit -am "feat(content): 참모 대사 50~120자 규칙·예시 + 판정 길이편향 방지 + 캐싱용 프롬프트 재배치"`

---

### Task 3: OG 메타·파비콘 + Cloudflare Web Analytics

**Files:**
- Create: `scripts/og.mjs`, `apps/web/public/og.png`, `apps/web/public/favicon.svg`, `apps/web/public/icon-192.png`, `apps/web/public/icon-512.png`, `apps/web/public/apple-touch-icon.png`
- Modify: `apps/web/index.html`, `apps/web/src/main.tsx`, 루트 `package.json`(devDep sharp)

- [ ] **Step 1: sharp 설치** — Run: `npm i -D sharp` (루트)

- [ ] **Step 2: `scripts/og.mjs` 작성** — SVG 템플릿을 PNG로 래스터라이즈 (시스템 한글 폰트 사용, Windows=Malgun Gothic):

```js
// OG 이미지·아이콘 생성기. 실행: node scripts/og.mjs  (산출물은 apps/web/public/)
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const BG = '#1d2733', ACCENT = '#f5c542', FG = '#ffffff';
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="60" y="60" width="1080" height="510" rx="24" fill="none" stroke="${ACCENT}" stroke-width="6"/>
  <text x="600" y="290" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="110" font-weight="800" fill="${FG}">이달의 사원</text>
  <text x="600" y="390" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="44" fill="${ACCENT}">보스의 마음을 움직여 사원에서 사장까지</text>
  <text x="600" y="500" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="34" fill="#9fb0c3">AI 참모들과 겨루는 아부 서바이벌 파티게임</text>
</svg>`;
const iconSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${BG}"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="${size * 0.55}" font-weight="800" fill="${ACCENT}">사</text>
</svg>`;

await sharp(Buffer.from(ogSvg)).png().toFile('apps/web/public/og.png');
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(Buffer.from(iconSvg(size))).png().toFile(`apps/web/public/${file}`);
}
writeFileSync('apps/web/public/favicon.svg', iconSvg(64));
console.log('OK: og.png + icons');
```

- [ ] **Step 3: 실행·확인** — Run: `node scripts/og.mjs` → Expected: `OK`, `apps/web/public/`에 5개 파일. og.png를 열어 한글 렌더 확인.

- [ ] **Step 4: `index.html` 메타 추가** — `<title>` 아래에 삽입 (`__BASE__`는 현재 배포 URL — `npm run deploy` 출력의 `https://employee-of-the-month.<account>.workers.dev`를 넣고, 커스텀 도메인 연결 시 갱신):

```html
<meta name="description" content="AI 보스의 마음을 움직이는 간언으로 사원에서 사장까지 승진하는 아부 서바이벌 파티게임" />
<meta property="og:type" content="website" />
<meta property="og:title" content="이달의 사원" />
<meta property="og:description" content="AI 보스의 마음을 움직이는 간언으로 사원에서 사장까지 승진하는 아부 서바이벌 파티게임" />
<meta property="og:image" content="__BASE__/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

- [ ] **Step 5: 분석 비콘** — `apps/web/src/main.tsx` 상단(렌더 전)에:

```ts
// Cloudflare Web Analytics — 토큰이 설정된 빌드에서만 로드 (쿠키 없음, 동의 배너 불필요).
const cfToken = import.meta.env.VITE_CF_BEACON_TOKEN as string | undefined;
if (cfToken) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: cfToken }));
  document.head.appendChild(s);
}
```

수동 단계(코드 밖, README '배포'절에 한 줄 추가): CF 대시보드 → Web Analytics → 사이트 등록 → 토큰을 빌드 시 `VITE_CF_BEACON_TOKEN`으로 주입.

- [ ] **Step 6: 검증·커밋** — Run: `npm run typecheck && npm run build -w @eotm/web` → PASS 확인 후
  `git add -A && git commit -m "feat(web): OG 메타·파비콘·설명 + CF Web Analytics 옵트인 비콘"`

---

### Task 4: Nanum Gothic 로컬 번들 (공유 캡처 선행조건)

**Files:**
- Modify: `apps/web/index.html`(구글폰트 link 3줄 제거), `apps/web/src/main.tsx`, `apps/web/package.json`

- [ ] **Step 1:** Run: `npm i -w apps/web @fontsource/nanum-gothic`
- [ ] **Step 2:** `main.tsx` 최상단 import 3줄 추가:

```ts
import '@fontsource/nanum-gothic/400.css';
import '@fontsource/nanum-gothic/700.css';
import '@fontsource/nanum-gothic/800.css';
```

- [ ] **Step 3:** `index.html`에서 `fonts.googleapis.com`/`fonts.gstatic.com` `preconnect`·`stylesheet` 3줄 삭제. (CSS의 `font-family: 'Nanum Gothic'` 선언은 fontsource가 같은 패밀리명을 등록하므로 무변경.)
- [ ] **Step 4:** Run: `npm run dev:web` → 브라우저 Network 탭에서 폰트가 로컬(`/node_modules/.vite` 또는 번들)에서 오는지, 화면 폰트 유지 확인. `npm run build -w @eotm/web` PASS.
- [ ] **Step 5:** `git add -A && git commit -m "feat(web): Nanum Gothic 로컬 번들 전환 (캡처 폰트 보장·CDN 제거)"`

---

### Task 5: 라운드 공유 — 캡처 카드 + Web Share/다운로드

**Files:**
- Create: `apps/web/src/components/ShareCard.jsx`, `apps/web/src/share.js`
- Modify: `apps/web/src/screens/Game.jsx`, `apps/web/src/comic.css`, `apps/web/package.json`

**Interfaces:**
- Consumes: `Game.jsx`의 `verdictItem`(FeedItem type 'verdict': `situation`·`verdict`·`adopted`·`roundNo`), `epilogueItem.story`, `room.round.speeches`, `room.persona`
- Produces: `shareRoundImage(node, {title, url}): Promise<'shared'|'downloaded'|'cancel'>`, `<ShareCard persona situation speeches verdict epilogue roundNo />`

- [ ] **Step 1:** Run: `npm i -w apps/web html-to-image`
- [ ] **Step 2: `share.js` 작성**:

```js
// 라운드 캡처·공유. 모바일=Web Share(파일), 미지원=PNG 다운로드.
import { toBlob } from 'html-to-image';

export async function shareRoundImage(node, { title, url }) {
  const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: '#fdf6e3' });
  if (!blob) throw new Error('capture-fail');
  const file = new File([blob], 'eotm-round.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `${title}\n${url}` });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancel';
      // 공유 시트 실패 → 다운로드 폴백으로 계속
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'eotm-round.png';
  a.click();
  URL.revokeObjectURL(a.href);
  return 'downloaded';
}
```

- [ ] **Step 3: `ShareCard.jsx` 작성** — 캡처 전용 정적 레이아웃(버튼·타이머 없음), 화면 밖 고정 배치는 호출부가 담당:

```jsx
// 라운드 공유 이미지 전용 레이아웃. html-to-image가 이 DOM을 그대로 찍는다 — 인터랙션 요소 금지.
export default function ShareCard({ cardRef, persona, situation, speeches, verdict, epilogue, roundNo }) {
  const adoptedKey = verdict?.adoptedKey;
  const rows = verdict ? [...verdict.perSpeaker].sort((a, b) => b.total - a.total) : [];
  return (
    <div ref={cardRef} className="share-card">
      <div className="shc-head">
        <span className="shc-emoji">{persona.emoji}</span>
        <b>{persona.name}의 회의실</b>
        <span className="shc-round">Round {roundNo}</span>
      </div>
      {situation && (
        <div className="shc-situation">
          <p>{situation.text}</p>
          <p className="shc-q">❝ {situation.question} ❞</p>
        </div>
      )}
      <div className="shc-speeches">
        {speeches.map((s) => (
          <div key={s.key} className={`shc-line ${s.key === adoptedKey ? 'adopted' : ''}`}>
            <b>{s.key === adoptedKey ? '🏆 ' : ''}{s.name}{s.kind === 'ai' ? ' (참모)' : ''}</b>
            <span>{s.text}</span>
          </div>
        ))}
      </div>
      {rows.length > 0 && (
        <div className="shc-scores">
          {rows.map((r, i) => <span key={r.key}>#{i + 1} {r.name} {r.total}점</span>)}
        </div>
      )}
      {verdict?.adoptReason && <div className="shc-reason">🗣️ {verdict.adoptReason}</div>}
      {epilogue && <div className="shc-ep">📖 {epilogue}</div>}
      <div className="shc-footer">🏆 이달의 사원 — {location.origin}</div>
    </div>
  );
}
```

- [ ] **Step 4: `comic.css`에 스타일 추가** (기존 만화 팔레트 톤 준수 — 파일 상단 변수 재사용):

```css
/* ---- 라운드 공유 카드 (캡처 전용) ---- */
.share-card-holder { position: fixed; left: -10000px; top: 0; }
.share-card { width: 720px; padding: 28px; background: #fdf6e3; color: #222; font-family: 'Nanum Gothic', sans-serif; display: flex; flex-direction: column; gap: 14px; border: 4px solid #222; }
.shc-head { display: flex; align-items: center; gap: 10px; font-size: 22px; border-bottom: 3px solid #222; padding-bottom: 10px; }
.shc-emoji { font-size: 30px; }
.shc-round { margin-left: auto; font-weight: 800; }
.shc-situation p { margin: 4px 0; line-height: 1.5; }
.shc-q { font-weight: 800; }
.shc-line { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 2px solid #222; border-radius: 8px; background: #fff; line-height: 1.45; }
.shc-line.adopted { background: #fff3c4; border-width: 3px; }
.shc-scores { display: flex; flex-wrap: wrap; gap: 8px 14px; font-weight: 700; font-size: 14px; }
.shc-reason, .shc-ep { font-size: 14px; line-height: 1.5; }
.shc-footer { border-top: 2px dashed #222; padding-top: 8px; font-size: 13px; text-align: center; color: #555; }
```

- [ ] **Step 5: `Game.jsx` 배선** — 상단에 import (`ShareCard`, `shareRoundImage`) + 컴포넌트 내부:

```jsx
const shareRef = useRef(null);
const [sharing, setSharing] = useState(false);
async function onShare() {
  if (!shareRef.current || sharing) return;
  setSharing(true);
  try {
    await shareRoundImage(shareRef.current, { title: `이달의 사원 R.${room.roundNo}`, url: location.origin });
  } catch {
    actions.toast('이미지 생성에 실패했습니다.');
  } finally {
    setSharing(false);
  }
}
```

`resultBlock` 안(BossCommentCut 아래)에 버튼, 페이지 말미(`comic-page` 밖 아님, `comic-app` 안)에 홀더 추가:

```jsx
<button className="btn small share-btn" disabled={sharing} onClick={onShare}>{sharing ? '캡처 중…' : '📤 이 라운드 공유'}</button>
```

```jsx
{resulted && (
  <div className="share-card-holder" aria-hidden="true">
    <ShareCard cardRef={shareRef} persona={persona} situation={verdictItem.situation}
      speeches={speeches} verdict={verdictItem.verdict} epilogue={epilogueItem?.story} roundNo={verdictItem.roundNo} />
  </div>
)}
```

- [ ] **Step 6: 수동 검증** — `npm run dev` + `npm run dev:web`, 싱글 1라운드 완주(`?debug=1` 가능) 후: 데스크톱 Chrome=PNG 다운로드 확인(폰트·이모지·전체 발언 포함), 모바일(또는 devtools 모바일 에뮬 + https)=공유 시트. `npm run build -w @eotm/web` PASS.
- [ ] **Step 7:** `git add -A && git commit -m "feat(web): 라운드 결과 이미지 공유 (캡처 카드 + Web Share/다운로드)"`

---

### Task 6: 커스텀 페르소나 생성 API (worker)

**Files:**
- Modify: `packages/content/src/schema.ts`(promptsSchema에 키 추가), `packages/content/global/prompts.json`, `packages/content/global/strings.json`, `packages/content/src/index.ts`(export 확인·추가)
- Create: `apps/worker/src/ai/persona-gen.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/test/persona-gen.test.ts` (신규)

**Interfaces:**
- Produces:
  - `POST /api/personas/generate` — req `{ name, concept, voiceHint?, taboo?, axes? }` → res `{ ok: true, persona: GeneratedPersona & { id: string } }` | `{ error }` (400 입력 오류 / 429 쿼터 / 502 생성 실패)
  - `generatedPersonaSchema` (zod, id 없음) — Task 7의 서버 재검증은 content의 `personaSchema`(id 포함)를 쓴다
  - strings.errors 추가 키: `personaGenFail`, `personaGenQuota`, `personaBadInput`, `personaInvalid`(Task 7용), `personaTooBig`(Task 7용)

- [ ] **Step 1: 실패하는 테스트 작성** — `apps/worker/test/persona-gen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { personaGenInputSchema, generatedPersonaSchema, personaGenUser } from '../src/ai/persona-gen';

const VALID_GEN = {
  name: '건물주 할머니', emoji: '🏢',
  intro: '역세권 건물 12채를 가진 할머니 회장. 월세와 손주 자랑이 인생의 전부다.',
  axes: ['월세', '체면', '손주'], ranks: ['세입자', '관리인', '반장', '소장', '본부장', '부회장', '공동건물주'],
  personaPrompt: '너는 건물 12채를 가진 할머니 회장이다. 월세 수입과 체면, 손주 자랑을 무엇보다 중시한다.',
  listenerBrief: '월세·체면·손주를 챙겨주는 말에 흡족해한다.',
  judgeAddress: "발언자를 '젊은이'라고 부른다",
  advisors: [
    { name: '공인중개사 박실장', emoji: '🗝️', style: '수완가', core: '모든 문제를 시세로 환산한다.', quirks: ['평당가로 말한다', '계약서를 품고 다닌다', '입지 얘기에 흥분한다', '복비 걱정을 한다'] },
    { name: '경비 김반장', emoji: '🧹', style: '원칙파', core: '건물 규칙이 곧 법이다.', quirks: ['분리수거를 강조한다', '순찰 일지를 인용한다', 'CCTV를 신뢰한다', '엘리베이터 사용법에 엄격하다'] },
    { name: '손주 최애봉', emoji: '🎮', style: '한량', core: '용돈이 걸리면 갑자기 똑똑해진다.', quirks: ['게임에 비유한다', '용돈 인상을 끼워넣는다', '할머니 최고를 외친다', '숙제를 미룬다'] },
    { name: '세무사 정과장', emoji: '🧾', style: '신중파', core: '모든 해법의 끝은 절세다.', quirks: ['영수증을 요구한다', '공제 항목을 왼다', '5월을 두려워한다', '현금 얘기에 정색한다'] },
  ],
  situations: Array.from({ length: 10 }, (_, i) => ({ text: `상황 ${i + 1}: 3층 세입자가 월세를 석 달째 밀리며 화분만 늘려간다.`, question: '이 일을 어찌하면 좋겠나?' })),
};

describe('persona-gen', () => {
  it('입력: 이름·컨셉 필수, 상한 검증', () => {
    expect(personaGenInputSchema.safeParse({ name: '건물주 할머니', concept: '월세가 인생' }).success).toBe(true);
    expect(personaGenInputSchema.safeParse({ name: '', concept: 'x' }).success).toBe(false);
    expect(personaGenInputSchema.safeParse({ name: 'a'.repeat(30), concept: 'x' }).success).toBe(false);
  });
  it('생성 결과 스키마: 유효 팩 통과, 참모 부족은 거부', () => {
    expect(generatedPersonaSchema.safeParse(VALID_GEN).success).toBe(true);
    expect(generatedPersonaSchema.safeParse({ ...VALID_GEN, advisors: VALID_GEN.advisors.slice(0, 1) }).success).toBe(false);
  });
  it('user 프롬프트에 입력 필드가 들어간다 (빈 선택 필드는 "AI가 정한다")', () => {
    const u = personaGenUser({ name: '건물주 할머니', concept: '월세가 인생' });
    expect(u).toContain('건물주 할머니');
    expect(u).toContain('월세가 인생');
    expect(u).toContain('AI가 정한다');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -w @eotm/worker -- persona-gen` → FAIL (모듈 없음)

- [ ] **Step 3: content 쪽 구현**
  - `schema.ts` `promptsSchema`에 `personaGenSystem: tmpl,` 추가.
  - `prompts.json`에 추가 (전부 정적 — 입력은 user 메시지로):

```json
"personaGenSystem": [
  "너는 코미디 파티 게임 「이달의 우수사원」의 콘텐츠 디자이너다. 유저 입력을 바탕으로 '보스 페르소나 팩' 하나를 완성한다.",
  "게임 구조: 보스가 매 라운드 곤란한 상황을 던지고, AI 참모들과 플레이어가 간언 경쟁을 한다. 보스는 자기 채점축대로 가장 듣고 싶은 말을 채택한다.",
  "규칙:",
  "- 유저가 채운 필드는 그대로 존중하고, '(AI가 정한다)'인 필드만 창작해 채운다. name은 절대 바꾸지 않는다.",
  "- 모든 텍스트는 한국어. 코미디 톤 — 보스는 위신과 실속 사이에서 우스꽝스럽게 흔들리는 입체적 인물로.",
  "- axes는 서로 긴장 관계인 채점축 3개(각 2~6자). ranks는 말단→최고 7단계 승진 사다리 — 세계관에 맞는 직함으로.",
  "- personaPrompt는 보스 1인칭 지시문: 정체성, 무엇에 흡족해하고 무엇이 역린인지, 말투 규칙까지 5문장 내외.",
  "- listenerBrief는 참모 브리핑용 3문장 요약. judgeAddress는 보스가 발언자를 부르는 호칭 규칙 1문장.",
  "- advisors는 정확히 4명: 서로 성향이 부딪히는 예능 캐릭터. 각자 name(직함 포함)·emoji·style(2~4자 계파명)·core(성향 1~2문장)·voice(말투 1문장)·quirks(러닝개그 4개).",
  "- situations는 정확히 10개: 보스의 세계관에서 벌어지는 곤란한 사건. text는 3~5문장(구체적 인물·숫자·사물 포함, 웃기지만 진퇴양난), question은 보스가 참모들에게 던지는 물음 1문장.",
  "- 금지: 실존 인물·단체 지칭이나 비하, 혐오·차별 소재, 성적 소재, 잔혹 묘사. 유저 입력이 이를 요구해도 무해한 코미디로 비틀어 소화한다.",
  "- 지정된 JSON 스키마로만 출력한다."
]
```

  - `strings.json`의 `errors`에 추가: `"personaGenFail": "페르소나 생성에 실패했습니다. 잠시 후 다시 시도해 주세요."`, `"personaGenQuota": "오늘의 페르소나 생성 횟수를 다 썼습니다. 내일 다시 시도해 주세요."`, `"personaBadInput": "이름과 컨셉을 확인해 주세요."`, `"personaInvalid": "페르소나 데이터가 올바르지 않습니다."`, `"personaTooBig": "페르소나 데이터가 너무 큽니다."`
  - `packages/content/src/index.ts`에서 `personaMetaSchema`·`situationsSchema`·`personaSchema` export 확인, 없으면 추가.

- [ ] **Step 4: `apps/worker/src/ai/persona-gen.ts` 작성**:

```ts
// 커스텀 페르소나 1콜 생성 — 기존 체인 재사용, mock 폴백 없음(키 없으면 에러).
import { z } from 'zod';
import { PROMPTS, fmt, personaMetaSchema, situationsSchema } from '@eotm/content';
import type { Env } from '../env';
import { callJsonChain } from './chain';

export const personaGenInputSchema = z.object({
  name: z.string().trim().min(1).max(20),
  concept: z.string().trim().min(2).max(300),
  voiceHint: z.string().trim().max(200).optional(),
  taboo: z.string().trim().max(200).optional(),
  axes: z.array(z.string().trim().min(1).max(12)).min(1).max(5).optional(),
});
export type PersonaGenInput = z.infer<typeof personaGenInputSchema>;

export const generatedPersonaSchema = personaMetaSchema
  .omit({ id: true, lines: true })
  .extend({ situations: situationsSchema });
export type GeneratedPersona = z.infer<typeof generatedPersonaSchema>;

export function personaGenUser(input: PersonaGenInput): string {
  const opt = (v?: string) => (v && v.length > 0 ? v : '(AI가 정한다)');
  return [
    `# 보스 이름 (변경 금지): ${input.name}`,
    `# 컨셉: ${input.concept}`,
    `# 말투 힌트: ${opt(input.voiceHint)}`,
    `# 역린 (건드리면 안 되는 것): ${opt(input.taboo)}`,
    `# 채점축 희망: ${input.axes?.length ? input.axes.join(', ') : '(AI가 정한다)'}`,
  ].join('\n');
}

function personaGenSchema(): object {
  const str = { type: 'string' };
  const strArr = (n: number) => ({ type: 'array', items: str, minItems: n, maxItems: n });
  return {
    type: 'object',
    properties: {
      name: str, emoji: str, intro: str,
      axes: strArr(3), ranks: strArr(7),
      personaPrompt: str, judgeAddress: str, listenerBrief: str,
      advisors: {
        type: 'array', minItems: 4, maxItems: 4,
        items: {
          type: 'object',
          properties: { name: str, emoji: str, style: str, core: str, voice: str, quirks: { type: 'array', items: str, minItems: 4, maxItems: 6 } },
          required: ['name', 'emoji', 'style', 'core', 'voice', 'quirks'],
        },
      },
      situations: {
        type: 'array', minItems: 10, maxItems: 10,
        items: { type: 'object', properties: { text: str, question: str }, required: ['text', 'question'] },
      },
    },
    required: ['name', 'emoji', 'intro', 'axes', 'ranks', 'personaPrompt', 'judgeAddress', 'listenerBrief', 'advisors', 'situations'],
  };
}

export async function generatePersona(
  env: Env,
  input: PersonaGenInput,
  quotaTake?: (provider: string) => Promise<boolean>,
): Promise<GeneratedPersona> {
  const { raw } = await callJsonChain(
    env,
    { system: fmt(PROMPTS.personaGenSystem), user: personaGenUser(input), schema: personaGenSchema(), temperature: 1.0, timeoutMs: 60000 },
    { kind: 'persona-gen', quotaTake, validate: (r) => { generatedPersonaSchema.parse(r); } },
  );
  const persona = generatedPersonaSchema.parse(raw);
  persona.name = input.name; // 이름은 입력이 정답
  return persona;
}
```

- [ ] **Step 5: 라우트 추가** — `apps/worker/src/index.ts` (`/api/personas` 아래):

```ts
const PERSONA_GEN_LIMIT = 5;
const PERSONA_GEN_TTL_MS = 24 * 60 * 60 * 1000;

// POST /api/personas/generate — 커스텀 페르소나 AI 생성. IP당 일 5회.
app.post('/api/personas/generate', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const quota = c.env.QUOTA_DO.get(c.env.QUOTA_DO.idFromName('global'));
  const rl = await quota
    .fetch('http://do/incr', {
      method: 'POST',
      body: JSON.stringify({ key: `persona-gen:${ip}`, limit: PERSONA_GEN_LIMIT, ttlMs: PERSONA_GEN_TTL_MS }),
    })
    .then((r) => r.json() as Promise<{ ok: boolean }>);
  if (!rl.ok) return c.json({ error: STRINGS.errors.personaGenQuota }, 429);

  const parsed = personaGenInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: STRINGS.errors.personaBadInput }, 400);
  try {
    const persona = await generatePersona(c.env, parsed.data);
    return c.json({ ok: true, persona: { id: `custom-${crypto.randomUUID().slice(0, 8)}`, ...persona } });
  } catch {
    return c.json({ error: STRINGS.errors.personaGenFail }, 502);
  }
});
```

(import 추가: `generatePersona, personaGenInputSchema` from `./ai/persona-gen`.)

- [ ] **Step 6: 통과 확인** — Run: `npm test -w @eotm/worker && npm test -w @eotm/content && npm run typecheck` → PASS
- [ ] **Step 7:** `git add -A && git commit -m "feat(worker): 커스텀 페르소나 AI 생성 API (/api/personas/generate, 일 5회)"`

---

### Task 7: customPersona 방 생성 연동 (서버)

**Files:**
- Modify: `packages/shared/src/events.ts`, `packages/shared/src/api.ts`, `apps/worker/src/game/state.ts`, `apps/worker/src/room-do.ts`, `apps/worker/src/game/engine.ts`(getPersona 사용부)
- Test: `apps/worker/test/state.test.ts`, `apps/worker/test/room-do.test.ts`

**Interfaces:**
- Consumes: Task 6의 persona 응답 형태(`id: custom-*` 포함 팩 JSON)
- Produces:
  - shared `CustomPersona` 인터페이스, `CreateRoomReq.config.customPersona?: CustomPersona`
  - `roomPersona(room: RoomState): FullPersona` — 이후 모든 서버 코드의 페르소나 단일 조회 경로
  - `createRoomState(code, nick, config, avatar?, customPersona?: FullPersona)`

- [ ] **Step 1: 실패하는 테스트 작성** — `state.test.ts`에 추가 (VALID_GEN 팩 픽스처는 Task 6 테스트에서 복사, `id: 'custom-test1234'` 추가):

```ts
it('customPersona로 방을 만들면 그 페르소나로 방이 선다', () => {
  const { room } = createRoomState('AB12', '호스트', { personaId: custom.id, mode: 'single' }, undefined, custom);
  expect(room.customPersona?.name).toBe('건물주 할머니');
  expect(publicRoom(room).persona.name).toBe('건물주 할머니');
  expect(room.players[0].rank).toBe(custom.ranks[0]);
});
it('customPersona의 maxRounds는 상황 수를 넘지 않는다', () => {
  const { room } = createRoomState('AB12', '호스트', { personaId: custom.id, maxRounds: 20 }, undefined, custom);
  expect(room.config.maxRounds).toBe(custom.situations.length); // 10
});
```

`room-do.test.ts`에 추가: `/create` body에 `config.customPersona` 정상(→200, 방 페르소나 반영) / 스키마 위반(advisors 1명 →400 `personaInvalid`) / 20,000자 초과(situations 텍스트 뻥튀기 →400 `personaTooBig`) 3케이스 — 기존 create 테스트 패턴(helpers.ts) 재사용.

- [ ] **Step 2: 실패 확인** — Run: `npm test -w @eotm/worker -- state room-do` → FAIL

- [ ] **Step 3: shared 타입** — `events.ts`에:

```ts
// 커스텀 페르소나 팩 (클라 localStorage 보관 → 방 생성 시 서버로 전달; 서버는 content zod로 재검증)
export interface CustomPersona {
  id: string; name: string; emoji: string; intro: string;
  axes: string[]; ranks: string[];
  personaPrompt: string; judgeAddress?: string; listenerBrief?: string;
  advisors: { name: string; emoji: string; style: string; core: string; voice?: string; quirks: string[] }[];
  situations: { text: string; question: string }[];
}
```

`api.ts`: `CreateRoomReq`의 config 타입을 `Partial<RoomConfig> & { personaId: string; customPersona?: CustomPersona }`로.

- [ ] **Step 4: state.ts** —
  - `RoomState`에 `customPersona?: FullPersona;` 추가 (storage 직렬화에 그대로 실림 — 구버전 스냅샷엔 없어도 안전).
  - 헬퍼 추가 + 기존 `getPersona(room.config.personaId)` 호출 3곳(`addPlayer`·`publicRoom`) 교체:

```ts
// 방의 페르소나 단일 조회 경로 — 커스텀이 있으면 커스텀, 없으면 내장 팩.
export function roomPersona(room: RoomState): FullPersona {
  const p = room.customPersona ?? getPersona(room.config.personaId);
  if (!p) throw new Error(STRINGS.errors.noPersona);
  return p;
}
```

  - `createRoomState(code, hostNick, config, avatar?, customPersona?: FullPersona)`: `customPersona`가 오면 `getPersona` 대신 그것을 쓰고 `normalized.personaId = customPersona.id`, room에 `customPersona` 저장. `maxRounds` 정규화 뒤에 `normalized.maxRounds = Math.min(normalized.maxRounds, persona.situations.length);` 추가(내장 팩 20개엔 무영향).

- [ ] **Step 5: room-do.ts `handleCreate`** — body에서 `config.customPersona` 추출·검증 후 `createRoomState`에 전달:

```ts
import { personaSchema } from '@eotm/content';
const CUSTOM_PERSONA_MAX_CHARS = 20_000;

// handleCreate 내부, createRoomState 호출 전:
let customPersona;
if (config?.customPersona) {
  const rawPersona = config.customPersona;
  if (JSON.stringify(rawPersona).length > CUSTOM_PERSONA_MAX_CHARS) {
    return jsonRes({ error: STRINGS.errors.personaTooBig }, 400);
  }
  const v = personaSchema.safeParse(rawPersona);
  if (!v.success || !v.data.id.startsWith('custom-')) {
    return jsonRes({ error: STRINGS.errors.personaInvalid }, 400);
  }
  customPersona = v.data;
}
const { room, playerId, token } = createRoomState(code, nick, config, avatar, customPersona);
```

- [ ] **Step 6: engine.ts** — `getPersona(...)` 사용부를 전부 `roomPersona(this.room)`(import from `./state`)로 교체. `grep -n "getPersona" apps/worker/src/game/engine.ts`로 전수 확인.

- [ ] **Step 7: 통과 확인** — Run: `npm test -w @eotm/worker && npm run typecheck` → PASS
- [ ] **Step 8:** `git add -A && git commit -m "feat(worker): 방 생성 시 커스텀 페르소나 수용 (재검증·20KB 상한·roomPersona 단일화)"`

---

### Task 8: 커스텀 페르소나 위저드 UI + 홈 연동

**Files:**
- Create: `apps/web/src/screens/PersonaWizard.jsx`
- Modify: `apps/web/src/screens/Home.jsx`, `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `POST /api/personas/generate`(Task 6), `CreateRoomReq.config.customPersona`(Task 7), 기존 `actions.createRoom(nick, config, avatar)`·`actions.toast`
- Produces: localStorage `eotm.customPersonas` = `CustomPersona[]` (최대 8개, 초과 시 오래된 것 제거)

- [ ] **Step 1: `PersonaWizard.jsx` 작성** — 단일 컴포넌트, 2단계(step: 'input' | 'preview'):

```jsx
import { useState } from 'react';

const STORE_KEY = 'eotm.customPersonas';
const MAX_SAVED = 8;

export function loadCustomPersonas() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
export function saveCustomPersona(p) {
  const list = [p, ...loadCustomPersonas().filter((x) => x.id !== p.id)].slice(0, MAX_SAVED);
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
  return list;
}
export function deleteCustomPersona(id) {
  const list = loadCustomPersonas().filter((x) => x.id !== id);
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
  return list;
}

// 커스텀 페르소나 생성 위저드: 입력 → AI 생성 → 미리보기·수정 → 저장.
export default function PersonaWizard({ onSaved, onCancel, toast }) {
  const [step, setStep] = useState('input');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', concept: '', voiceHint: '', taboo: '', axes: '' });
  const [persona, setPersona] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function generate() {
    if (!form.name.trim()) return toast('보스 이름을 입력하세요.');
    if (form.concept.trim().length < 2) return toast('컨셉을 입력하세요.');
    setBusy(true);
    const axes = form.axes.split(',').map((s) => s.trim()).filter(Boolean);
    const body = {
      name: form.name.trim(), concept: form.concept.trim(),
      ...(form.voiceHint.trim() && { voiceHint: form.voiceHint.trim() }),
      ...(form.taboo.trim() && { taboo: form.taboo.trim() }),
      ...(axes.length > 0 && { axes }),
    };
    const res = await fetch('/api/personas/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => ({ error: '서버에 연결할 수 없습니다.' }));
    setBusy(false);
    if (res.error) return toast(res.error);
    setPersona(res.persona);
    setStep('preview');
  }

  function save() {
    saveCustomPersona(persona);
    onSaved(persona);
  }

  if (step === 'input') {
    return (
      <div className="stack wizard">
        <h2>🛠 나만의 보스 만들기</h2>
        <label className="field"><span>보스 이름 *</span>
          <input value={form.name} onChange={set('name')} maxLength={20} placeholder="예: 건물주 할머니" /></label>
        <label className="field"><span>컨셉 *</span>
          <textarea value={form.concept} onChange={set('concept')} maxLength={300} rows={3}
            placeholder="예: 역세권 건물 12채를 가진 할머니 회장. 월세와 손주 자랑이 인생의 전부." /></label>
        <label className="field"><span>말투 힌트 (비우면 AI가 정함)</span>
          <input value={form.voiceHint} onChange={set('voiceHint')} maxLength={200} placeholder="예: 구수한 사투리, 반말" /></label>
        <label className="field"><span>역린 (비우면 AI가 정함)</span>
          <input value={form.taboo} onChange={set('taboo')} maxLength={200} placeholder="예: 재개발 무산 얘기" /></label>
        <label className="field"><span>채점축 (쉼표 구분, 비우면 AI가 정함)</span>
          <input value={form.axes} onChange={set('axes')} placeholder="예: 월세, 체면, 손주" /></label>
        <div className="row">
          <button className="btn" onClick={onCancel}>뒤로</button>
          <button className="btn primary" disabled={busy} onClick={generate}>{busy ? 'AI 생성 중… (최대 1분)' : '✨ AI로 생성'}</button>
        </div>
      </div>
    );
  }

  const setP = (k) => (e) => setPersona({ ...persona, [k]: e.target.value });
  return (
    <div className="stack wizard">
      <h2>{persona.emoji} 생성 결과 확인</h2>
      <label className="field"><span>이름</span><input value={persona.name} onChange={setP('name')} maxLength={20} /></label>
      <label className="field"><span>이모지</span><input value={persona.emoji} onChange={setP('emoji')} maxLength={4} /></label>
      <label className="field"><span>소개</span><textarea value={persona.intro} onChange={setP('intro')} rows={2} /></label>
      <label className="field"><span>채점축 (쉼표 구분 3개)</span>
        <input value={persona.axes.join(', ')} onChange={(e) => setPersona({ ...persona, axes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
      <div className="wizard-detail">
        <div className="wd-sec"><b>승진 사다리</b><p>{persona.ranks.join(' → ')}</p></div>
        <div className="wd-sec"><b>참모진</b>
          {persona.advisors.map((a) => <p key={a.name}>{a.emoji} {a.name} ({a.style}) — {a.core}</p>)}</div>
        <div className="wd-sec"><b>상황 샘플</b><p>{persona.situations[0]?.text}</p></div>
      </div>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => setStep('input')}>← 다시 입력</button>
        <button className="btn" disabled={busy} onClick={generate}>{busy ? '생성 중…' : '🔄 다시 생성'}</button>
        <button className="btn primary" onClick={save}>저장하고 사용</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Home.jsx 연동** —
  - import: `PersonaWizard, { loadCustomPersonas, deleteCustomPersona }`.
  - state 추가: `const [customs, setCustoms] = useState(loadCustomPersonas);` / mode에 `'wizard'` 추가(진입 전 mode를 기억해 복귀: `const [wizardReturn, setWizardReturn] = useState('single')`).
  - `personaPicker` 상단에 커스텀 카드 + 만들기 버튼:

```jsx
{customs.map((p) => (
  <label key={p.id} className={`persona-card custom ${personaId === p.id ? 'sel' : ''}`}>
    <input type="radio" name="persona" value={p.id} checked={personaId === p.id} onChange={() => setPersonaId(p.id)} />
    <span className="pc-emoji">{p.emoji}</span>
    <span className="pc-body">
      <span className="pc-name">{p.name} <em className="pc-custom-badge">커스텀</em></span>
      <span className="pc-intro">{p.intro}</span>
      <span className="pc-axes">채점축: {p.axes.join(' · ')}</span>
    </span>
    <button type="button" className="pc-del" aria-label="삭제"
      onClick={(e) => { e.preventDefault(); setCustoms(deleteCustomPersona(p.id)); if (personaId === p.id) setPersonaId(personas[0]?.id ?? null); }}>✕</button>
  </label>
))}
<button type="button" className="btn small" onClick={() => { setWizardReturn(mode); setMode('wizard'); }}>🛠 나만의 보스 만들기</button>
```

  - `start()`에서 커스텀 선택 시 config에 팩 동봉:

```jsx
const custom = customs.find((p) => p.id === personaId);
const config = /* 기존 config 구성 */;
if (custom) config.customPersona = custom;
```

  - 렌더 분기 추가:

```jsx
{mode === 'wizard' && (
  <PersonaWizard toast={actions.toast} onCancel={() => setMode(wizardReturn)}
    onSaved={(p) => { setCustoms(loadCustomPersonas()); setPersonaId(p.id); setMode(wizardReturn); }} />
)}
```

- [ ] **Step 3: styles.css** — `.wizard textarea { resize: vertical; }`, `.pc-custom-badge`(작은 강조 배지), `.pc-del`(카드 우상단 소형 버튼), `.wd-sec`(구분선 목록) 4개 클래스를 기존 `.persona-card`·`.field` 톤에 맞춰 추가.

- [ ] **Step 4: 수동 검증** — dev 서버에서: 위저드 생성(키 없으면 502 토스트 확인 — 정상 동작) → 실키로 생성 → 수정·저장 → 홈 목록에 카드 → 싱글 시작 → 게임에서 커스텀 보스·참모·상황 등장 → 새 탭에서 멀티 방 참가 시 같은 페르소나 보이는지. `npm run build -w @eotm/web` PASS.
- [ ] **Step 5:** `git add -A && git commit -m "feat(web): 커스텀 페르소나 위저드 (AI 생성·미리보기 수정·localStorage 보관)"`

---

### Task 9: 최종 검증·문서

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Run: `npm test && npm run typecheck && npm run build -w @eotm/web` → 전부 PASS
- [ ] **Step 2:** `npm run dev` + `npm run smoke` → `SMOKE PASS`
- [ ] **Step 3:** README에 짧게 추가: 커스텀 페르소나(생성 API·일 5회 제한), 공유 기능, `VITE_CF_BEACON_TOKEN`·OG `__BASE__` 치환·`node scripts/og.mjs` 재생성 방법.
- [ ] **Step 4:** 수동 체크리스트 실행 후 결과 기록:
  - 참모 대사 3라운드 표본이 50~120자 범위인가
  - 카톡 채팅방에 배포 URL 붙였을 때 OG 카드가 뜨는가 (배포 후)
  - 모바일에서 라운드 공유 → 카톡 이미지 전송 성공하는가
  - 커스텀 페르소나로 멀티 2인 게임 1라운드 완주되는가
- [ ] **Step 5:** `git add -A && git commit -m "docs: 베타 기능 4종 사용·운영 노트"`
