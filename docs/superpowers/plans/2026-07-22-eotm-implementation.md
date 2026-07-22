# 이달의 사원 독립 서비스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `C:\Users\user\ai-debate-game`의 간신배 게임을 이 저장소로 이식해, Cloudflare Workers + Durable Objects 위에서 SSE로 동작하는 독립 웹서비스 "이달의 사원"을 만든다.

**Architecture:** npm workspaces 모노레포. `apps/worker`(Hono + RoomDO/QuotaDO)가 REST 액션과 SSE 푸시, 게임 상태머신을 담당하고, `apps/web`(React+Vite SPA)을 Workers Assets로 함께 서빙한다. `packages/shared`가 이벤트·API 계약의 단일 진실, `packages/content`가 게임데이터(팩 + 전역 프롬프트/대사)를 zod로 검증해 제공한다. LLM은 Gemini → NVIDIA NIM → mock 체인.

**Tech Stack:** TypeScript(ESM, strict) / Hono / Cloudflare Workers·DO(wrangler) / React 18 + Vite / zod / vitest(+@cloudflare/vitest-pool-workers)

**설계 문서:** `docs/superpowers/specs/2026-07-22-employee-of-the-month-standalone-design.md`

## Global Constraints

- 원본 저장소 `C:\Users\user\ai-debate-game`은 **읽기 전용** — 절대 수정하지 않는다.
- 모든 유저 표시 문구·코드 주석은 한국어.
- 신규 런타임 의존성은 `hono`, `zod`만. (dev: wrangler, vite, react, vitest 계열 허용)
- LLM 호출은 반드시 mock 폴백을 가진다 — 키가 없거나 전부 실패해도 게임이 끝까지 돈다.
- 게임 규칙 수치는 원본 그대로: `MAX_SPEECH_CHARS = 160`, 발언 시간 싱글 0(무제한)/멀티 60·120·180(기본 60), 난이도 easy/normal/hard. 계급 사다리는 페르소나 데이터가 정의한다(현행 데이터 7단계 '사원'→'사장', 최상위 도달 = 우승) — 코드는 계급 수를 하드코딩하지 않는다.
- 페르소나는 v1에서 **조조(caocao)·유비(liubei) 2종만** 이식한다. 나머지는 추후 팩 폴더 추가로 확장.
- **LLM 입출력 계약**: 모든 LLM 호출은 요청에 JSON Schema(Gemini responseSchema / NVIDIA guided_json)를 싣고, 응답은 zod 출력 스키마로 검증한다. 검증 실패 = 페일오버 사유.
- **하드코딩 금지**: 대사·프롬프트·에러/안내 문구를 소스코드에 넣지 않는다 — 전부 `@eotm/content`(팩 또는 `global/strings.json`의 `errors` 포함)에서 온다.
- **로그**: `log.ts`의 타입드 이벤트 핸들러(`logger.*`)로만 남긴다. 호출부에서 임의 이벤트명 문자열·console 직접 호출 금지.
- 클라이언트 feed 아이템·publicRoom 형태는 원본과 최대한 동일하게 유지해 화면 이식 diff를 최소화한다. 단 `syco` 접두어는 제거한다(`syco-verdict`→`verdict` 등).
- 시크릿(`GOOGLE_AI_STUDIO_API_KEY`, `NVIDIA_API_KEY`)은 `.dev.vars`/`wrangler secret`으로만. 코드·커밋 금지. `.env`는 이미 루트에 있고 gitignore됨.
- 각 Task 완료 시 커밋. 커밋 메시지는 한국어 + conventional prefix.

## 파일 구조 (전체 조감)

```
apps/worker/src/
  index.ts                # Worker 엔트리: Hono 라우팅, DO 위임, rate limit
  env.ts                  # Env 바인딩 타입
  log.ts                  # JSON 한 줄 로그 래퍼
  room-do.ts              # RoomDO: HTTP 라우팅·SSE·storage·alarm
  quota-do.ts             # QuotaDO: 일일 LLM 쿼터 + IP rate limit 범용 카운터
  game/logic.ts           # 순수 로직 (이식)
  game/state.ts           # 방 상태 모델·생성·입장·publicRoom·직렬화
  game/engine.ts          # 상태머신 (이식 + SSE/alarm 개편)
  ai/prompts.ts           # 프롬프트 조립 (이식)
  ai/mock.ts              # 결정적 mock (이식)
  ai/verdict.ts           # trimSpeech·finalizeVerdict (이식)
  ai/orchestrate.ts       # advisorTurnsBatch·judgeSpeeches·makeEpilogue (체인 기반)
  ai/chain.ts             # 공급자 체인
  ai/providers/gemini.ts  # Gemini 호출 (이식)
  ai/providers/nvidia.ts  # NVIDIA NIM 호출 (신규)
apps/web/src/
  main.tsx, App.tsx
  api/actions.ts          # POST 래퍼 / api/sse.ts  # EventSource 구독
  store.ts                # useGame() — 원본과 동일한 state/actions 인터페이스 유지
  screens/{Home,Lobby,Game}.jsx   # 이식 (Game = 구 SycoGame)
  components/{ComicCuts,EmployeeFrame,Feed,ActionBar,VerdictCard}.jsx
  comic-assets.js, comic.css, styles.css
packages/shared/src/{events,api,constants}.ts
packages/content/{global,packs}/ + src/{schema,loader}.ts + scripts/gen-index.mjs
```

---

### Task 1: 모노레포 스캐폴딩

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.dev.vars.example`

**Interfaces:**
- Produces: `npm install`이 동작하는 workspaces 루트. 이후 모든 Task가 이 위에 패키지를 추가한다.

- [ ] **Step 1: 루트 package.json 작성**

```json
{
  "name": "employee-of-the-month",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "npm run dev --workspace @eotm/worker",
    "dev:web": "npm run dev --workspace @eotm/web",
    "build": "npm run build --workspace @eotm/web && npm run build --workspace @eotm/worker",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "deploy": "npm run build --workspace @eotm/web && npm run deploy --workspace @eotm/worker"
  }
}
```

- [ ] **Step 2: tsconfig.base.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: .dev.vars.example 작성** — 실제 `.dev.vars`는 Task 13에서 `.env` 값을 복사해 만든다 (커밋 금지, 예시만 커밋)

```ini
# apps/worker/.dev.vars 로 복사한 뒤 실제 키를 채울 것 (.env 파일에 있는 값)
GOOGLE_AI_STUDIO_API_KEY=your-gemini-key
NVIDIA_API_KEY=your-nvidia-key
```

- [ ] **Step 4: 설치 확인** — Run: `npm install` / Expected: 에러 없이 완료(워크스페이스 비어 있어도 정상)

- [ ] **Step 5: 커밋**

```bash
git add package.json tsconfig.base.json .dev.vars.example package-lock.json
git commit -m "chore: npm workspaces 모노레포 스캐폴딩"
```

---

### Task 2: packages/shared — 계약 타입·상수

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/constants.ts`, `src/events.ts`, `src/api.ts`, `src/index.ts`
- Test: `packages/shared/test/constants.test.ts`

**Interfaces:**
- Produces (이후 모든 Task가 import):
  - 상수: `MAX_SPEECH_CHARS = 160`, `SPEAK_TIME_OPTIONS = [60, 120, 180]`, `DIFFICULTIES = ['easy','normal','hard']`
  - 타입: `Phase`, `RoomConfig`, `PublicRoom`, `PublicPlayer`, `PublicPersona`, `Situation`, `QueueEntry`, `Speech`, `Verdict`, `Standing`, `HallEntry`, `FeedItem`, `SpeakTurn`, `TimerInfo`, `EndedPayload`, `ServerEvent`
  - API 타입: `CreateRoomReq/Res`, `JoinRoomReq/Res`, `SpeakReq`, `ApiErr`, `HealthRes`, `PersonaSummary`

- [ ] **Step 1: package.json / tsconfig.json**

```json
{
  "name": "@eotm/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

tsconfig.json: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`

- [ ] **Step 2: 실패하는 테스트 작성** — `test/constants.test.ts`

```ts
import { test, expect } from 'vitest';
import { MAX_SPEECH_CHARS, SPEAK_TIME_OPTIONS, DIFFICULTIES } from '../src/index';

test('게임 규칙 상수는 원본 값을 유지한다', () => {
  expect(MAX_SPEECH_CHARS).toBe(160);
  expect(SPEAK_TIME_OPTIONS).toEqual([60, 120, 180]);
  expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
});
```

Run: `npm test --workspace @eotm/shared` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: constants.ts**

```ts
// 게임 규칙 상수 — 원본 server/sycophant/logic.js·rooms.js의 값을 승계.
export const MAX_SPEECH_CHARS = 160;
export const SPEAK_TIME_OPTIONS = [60, 120, 180] as const; // 멀티 발언 제한시간(초). 싱글은 0(무제한)
export const DEFAULT_SPEAK_TIME = 60;
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export const MAX_ROOM_PLAYERS = 6;
export const ROOM_TTL_MS = 30 * 60 * 1000; // 마지막 활동 후 방 청소
```

- [ ] **Step 4: events.ts** — 원본 publicRoom/chat:new 페이로드 형태를 그대로 타입화한다 (필드명 변경 금지, `syco-` 접두어만 제거)

```ts
import type { DIFFICULTIES } from './constants';

export type Phase = 'SITUATION' | 'PLAYER_TURNS' | 'JUDGING' | 'RESULT' | 'END';
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface Situation { text: string; question: string }
export interface RoomConfig {
  mode: 'single' | 'multi';
  personaId: string;
  speakTime: number;        // 0 = 무제한(싱글)
  aiCompete: boolean;
  difficulty: Difficulty;
  maxPlayers: number;
}
export interface PublicPlayer {
  id: string; nick: string; rank: string; joinOrder: number; favor: number; connected: boolean;
}
export interface PublicPersona {
  id: string; name: string; emoji: string; intro: string;
  axes: string[]; ranks: string[];
  advisors: { name: string; emoji: string; style: string }[];
}
export interface QueueEntry { kind: 'ai' | 'user'; key: string; name: string }
export interface Speech { key: string; name: string; kind: 'ai' | 'user'; text: string }
export interface PublicRoom {
  code: string; hostId: string;
  state: 'LOBBY' | 'PLAYING' | 'ENDED';
  phase: Phase | null; roundNo: number;
  config: RoomConfig; players: PublicPlayer[];
  persona: PublicPersona; situation: Situation | null;
  round: { queue: QueueEntry[]; speeches: Speech[] } | null;
  advisorFavor: Record<string, number>;
  capacity: number;
}
export interface VerdictSpeaker {
  key: string; name: string; kind: 'ai' | 'user';
  axisScores: Record<string, number>; total: number; comment: string;
}
export interface Verdict {
  perSpeaker: VerdictSpeaker[]; adoptedKey: string | null;
  adoptReason: string; totals: Record<string, number>;
}
export interface Standing { id: string; nick: string; rank: string; favor: number; connected: boolean }
export interface HallEntry { roundNo: number; key: string; name: string; kind: 'ai' | 'user'; rank?: string; emoji?: string }
export interface AdoptedInfo { key: string; name: string; kind: 'ai' | 'user'; rank?: string; emoji?: string }

export type FeedItem =
  | { type: 'system'; text: string; tag?: string; ts: number }
  | { type: 'speech'; speakerType: 'ai' | 'user'; playerId?: string; name: string; emoji?: string; style?: string; rank?: string; text: string; ts: number }
  | { type: 'verdict'; roundNo: number; situation: Situation; verdict: Verdict; adoptedName: string | null; adopted: AdoptedInfo | null; standings: Standing[]; source: string; ts: number }
  | { type: 'epilogue'; roundNo: number; story: string; source: string; ts: number };

export interface SpeakTurn { current: string; nick: string; speakTime: number }
export interface TimerInfo { phase: string; deadline: number; total: number } // deadline = epoch ms. 카운트다운은 클라 로컬 렌더
export interface EndedPayload { reason: string; standings: Standing[]; hall: HallEntry[] }

export type ServerEvent =
  | { kind: 'snapshot'; seq: number; room: PublicRoom; feed: FeedItem[]; speakTurn: SpeakTurn | null; timer: TimerInfo | null; ended: EndedPayload | null }
  | { kind: 'room'; seq: number; room: PublicRoom }
  | { kind: 'phase'; seq: number; phase: Phase; roundNo: number; situation?: Situation }
  | { kind: 'turn'; seq: number; turn: SpeakTurn | null }
  | { kind: 'timer'; seq: number; timer: TimerInfo | null }
  | { kind: 'feed'; seq: number; item: FeedItem }
  | { kind: 'ended'; seq: number; payload: EndedPayload };
```

- [ ] **Step 5: api.ts**

```ts
import type { PublicRoom, RoomConfig } from './events';

export interface ApiErr { error: string }
export interface PersonaSummary {
  id: string; name: string; emoji: string; intro: string;
  axes: string[]; ranks: string[];
  advisors: { name: string; emoji: string; style: string }[];
  situationCount: number;
}
export interface CreateRoomReq { nick: string; config: Partial<RoomConfig> & { personaId: string } }
export interface CreateRoomRes { ok: true; code: string; playerId: string; token: string; room: PublicRoom }
export interface JoinRoomReq { nick: string }
export interface JoinRoomRes { ok: true; code: string; playerId: string; token: string; room: PublicRoom }
export interface AuthedReq { playerId: string; token: string }
export interface SpeakReq extends AuthedReq { text: string }
export interface DebugReq extends AuthedReq { action: 'adoptMe' | 'noAdopt' | 'next' }
export interface OkRes { ok: true }
export interface HealthRes {
  ok: true;
  providers: { gemini: boolean; nvidia: boolean };
  models: { gemini: string; nvidia: string };
}
```

index.ts: `export * from './constants'; export * from './events'; export * from './api';`

- [ ] **Step 6: 테스트 통과 확인** — Run: `npm test --workspace @eotm/shared` → PASS, `npm run typecheck --workspace @eotm/shared` → PASS

- [ ] **Step 7: 커밋** — `git add packages/shared && git commit -m "feat(shared): 이벤트·API 계약 타입과 게임 상수"`

---

### Task 3: packages/content — 게임데이터 팩 + zod 검증

**Files:**
- Create: `packages/content/package.json`, `tsconfig.json`
- Create: `packages/content/global/prompts.json`, `global/strings.json` (원본 복사)
- Create: `packages/content/packs/<id>/{persona.json,situations.json}` × 6종
- Create: `packages/content/scripts/gen-index.mjs`, `src/schema.ts`, `src/loader.ts`, `src/packs.gen.ts`(생성물)
- Test: `packages/content/test/content.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `getPersona(id: string): FullPersona | null` — situations 포함 전체
  - `listPersonas(): PersonaSummary[]` — 공개 요약 (situations 본문 제외)
  - `PROMPTS`, `STRINGS` — 전역 게임데이터 (원본 sycophant-prompts/strings.json 구조 그대로)
  - `fmt(template: string | string[], vars?: Record<string, unknown>): string`
  - `FullPersona` 타입: `{ id,name,emoji,intro,axes,ranks,personaPrompt,judgeAddress?,listenerBrief?,lines?,advisors:[{name,emoji,style,stylePrompt}],situations:[{text,question}] }`

- [ ] **Step 1: 원본 데이터 복사·분해** — 원본을 팩 구조로 쪼개는 일회성 스크립트를 루트에서 실행

```bash
node -e "
const fs = require('fs'); const path = require('path');
const src = 'C:/Users/user/ai-debate-game/server/data';
const dst = 'packages/content';
fs.mkdirSync(dst + '/global', { recursive: true });
fs.copyFileSync(src + '/sycophant-prompts.json', dst + '/global/prompts.json');
fs.copyFileSync(src + '/sycophant-strings.json', dst + '/global/strings.json');
const personas = JSON.parse(fs.readFileSync(src + '/personas.json', 'utf-8'));
const KEEP = ['caocao', 'liubei']; // v1은 조조·유비만. 확장 = 폴더 추가
for (const p of personas.filter((x) => KEEP.includes(x.id))) {
  const dir = dst + '/packs/' + p.id;
  fs.mkdirSync(dir, { recursive: true });
  const { situations, ...meta } = p;
  fs.writeFileSync(dir + '/persona.json', JSON.stringify(meta, null, 2));
  fs.writeFileSync(dir + '/situations.json', JSON.stringify(situations, null, 2));
}
console.log('packs: caocao, liubei');
"
```

Expected 출력: `packs: caocao, liubei`

이어서 `global/strings.json`에 `errors` 섹션을 추가한다 (원본 코드에 하드코딩돼 있던 문구를 데이터로 이관):

```json
"errors": {
  "notHost": "방장만 시작할 수 있습니다.",
  "notHostNext": "방장만 진행할 수 있습니다.",
  "alreadyStarted": "이미 시작되었습니다.",
  "needTwo": "2명 이상 모여야 시작할 수 있습니다.",
  "notYourTurn": "아직 당신의 순번이 아닙니다.",
  "noRoom": "존재하지 않는 방 코드입니다.",
  "roomStarted": "이미 시작된 방입니다.",
  "roomFull": "정원이 가득 찼습니다.",
  "noPersona": "존재하지 않는 인물입니다.",
  "notNow": "지금은 다음으로 갈 수 없습니다.",
  "badAuth": "인증에 실패했습니다.",
  "rateLimited": "방 생성이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
  "codeAllocFail": "방 코드 할당 실패. 다시 시도해 주세요.",
  "connectFail": "서버에 연결할 수 없습니다."
}
```

- [ ] **Step 2: package.json** — gen 스크립트를 test/typecheck 앞에 자동 실행

```json
{
  "name": "@eotm/content",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "gen": "node scripts/gen-index.mjs",
    "pretest": "npm run gen",
    "test": "vitest run",
    "pretypecheck": "npm run gen",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

- [ ] **Step 3: scripts/gen-index.mjs** — packs/ 폴더를 스캔해 정적 import 파일 생성 (Workers는 readdir 불가 → "폴더 추가만으로 페르소나 추가"를 코드젠으로 보장)

```js
// packs/ 디렉토리를 스캔해 src/packs.gen.ts를 생성한다. 페르소나 추가 = 폴더 추가 + npm run gen.
import { readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ids = readdirSync(join(root, 'packs'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const lines = ['// 자동 생성 파일 — 직접 수정 금지. `npm run gen`으로 재생성.'];
ids.forEach((id, i) => {
  lines.push(`import p${i} from '../packs/${id}/persona.json';`);
  lines.push(`import s${i} from '../packs/${id}/situations.json';`);
});
lines.push('export const RAW_PACKS = [');
ids.forEach((_, i) => lines.push(`  { persona: p${i}, situations: s${i} },`));
lines.push('];');
writeFileSync(join(root, 'src', 'packs.gen.ts'), lines.join('\n') + '\n');
console.log(`packs.gen.ts: ${ids.length}개 팩 (${ids.join(', ')})`);
```

- [ ] **Step 4: 실패하는 테스트 작성** — `test/content.test.ts` (원본 tests/personas.test.js 이식 + 스키마 검증)

```ts
import { test, expect } from 'vitest';
import { getPersona, listPersonas, PROMPTS, STRINGS, fmt, personaSchema } from '../src/index';

test('페르소나 2종(조조·유비)이 로드된다', () => {
  const list = listPersonas();
  expect(list.length).toBe(2);
  expect(list.map((p) => p.id).sort()).toEqual(['caocao', 'liubei']);
  for (const p of list) {
    expect(p.id && p.name && p.intro).toBeTruthy();
    expect(p.axes.length).toBeGreaterThanOrEqual(3);
    expect(p.ranks.length).toBe(5);
    expect(p.situationCount).toBeGreaterThanOrEqual(5);
    expect(p.advisors.length).toBeGreaterThanOrEqual(2);
  }
});

test('getPersona는 전체 데이터(상황·프롬프트 포함)를 준다', () => {
  const p = getPersona('caocao')!;
  expect(p.name).toBe('조조');
  expect(p.personaPrompt.length).toBeGreaterThan(20);
  expect(p.situations.every((s) => s.text && s.question)).toBe(true);
  expect(p.advisors.every((a) => a.name && a.style && a.stylePrompt)).toBe(true);
  expect(getPersona('nope')).toBeNull();
});

test('전역 게임데이터가 로드된다', () => {
  expect(PROMPTS.approaches.length).toBeGreaterThan(0);
  expect(PROMPTS.difficulty.normal).toBeTruthy();
  expect(STRINGS.fallback.judgeComment).toBeTruthy();
  expect(fmt('{a}-{b}', { a: 1, b: 'x' })).toBe('1-x');
  expect(fmt(['줄1', '{a}'], { a: 2 })).toBe('줄1\n2');
});

test('스키마 위반 팩은 거부된다', () => {
  expect(() => personaSchema.parse({ id: 'bad' })).toThrow();
});
```

Run: `npm test --workspace @eotm/content` / Expected: FAIL

- [ ] **Step 5: src/schema.ts**

```ts
import { z } from 'zod';

export const advisorSchema = z.object({
  name: z.string().min(1),
  emoji: z.string().min(1),
  style: z.string().min(1),
  stylePrompt: z.string().min(1),
});

export const personaMetaSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  emoji: z.string().min(1),
  intro: z.string().min(1),
  axes: z.array(z.string()).min(3),
  ranks: z.array(z.string()).length(5),
  personaPrompt: z.string().min(20),
  judgeAddress: z.string().optional(),
  listenerBrief: z.string().optional(),
  lines: z.record(z.union([z.string(), z.array(z.string())])).optional(),
  advisors: z.array(advisorSchema).min(2).max(3),
});

export const situationSchema = z.object({ text: z.string().min(1), question: z.string().min(1) });
export const situationsSchema = z.array(situationSchema).min(5);
export const personaSchema = personaMetaSchema.extend({ situations: situationsSchema });
export type FullPersona = z.infer<typeof personaSchema>;

const tmpl = z.union([z.string(), z.array(z.string())]);
export const promptsSchema = z.object({
  difficulty: z.object({ easy: tmpl, normal: tmpl, hard: tmpl }),
  approaches: z.array(z.string()).min(2),
  advisorBatchSystem: tmpl,
  judgeSystem: tmpl,
  judgeHumanBiasLine: z.string(),
  judgeDefaultAddress: z.string(),
  epilogueSystem: tmpl,
}).passthrough(); // _readme 등 허용

export const stringsSchema = z.object({
  session: z.record(tmpl),
  round: z.record(tmpl),
  fallback: z.record(z.string()),
  mock: z.record(tmpl),
  errors: z.record(z.string()), // UI 에러 문구 — 코드 하드코딩 금지, 여기서만
}).passthrough();
```

- [ ] **Step 6: src/loader.ts + src/index.ts**

```ts
// loader.ts — 모듈 로드 시점에 전 팩·전역 데이터를 검증한다. 위반 시 팩 id·필드를 지목하며 throw.
import { RAW_PACKS } from './packs.gen';
import rawPrompts from '../global/prompts.json';
import rawStrings from '../global/strings.json';
import { personaSchema, promptsSchema, stringsSchema, type FullPersona } from './schema';

function fail(where: string, e: unknown): never {
  throw new Error(`[content] ${where} 검증 실패: ${e instanceof Error ? e.message : String(e)}`);
}

const PACKS: FullPersona[] = RAW_PACKS.map(({ persona, situations }) => {
  try {
    return personaSchema.parse({ ...persona, situations });
  } catch (e) {
    fail(`pack "${(persona as { id?: string }).id ?? '?'}"`, e);
  }
});

export const PROMPTS = (() => { try { return promptsSchema.parse(rawPrompts); } catch (e) { fail('global/prompts.json', e); } })();
export const STRINGS = (() => { try { return stringsSchema.parse(rawStrings); } catch (e) { fail('global/strings.json', e); } })();

export function getPersona(id: string): FullPersona | null {
  return PACKS.find((p) => p.id === id) ?? null;
}

// 클라이언트 공개용 요약 (프롬프트·상황 본문 제외 — 스포일러 방지)
export function listPersonas() {
  return PACKS.map((p) => ({
    id: p.id, name: p.name, emoji: p.emoji, intro: p.intro,
    axes: p.axes, ranks: p.ranks,
    advisors: p.advisors.map((a) => ({ name: a.name, emoji: a.emoji, style: a.style })),
    situationCount: p.situations.length,
  }));
}

// {token} 치환. 배열 템플릿은 줄바꿈으로 합친다. 모르는 토큰은 그대로 둔다. (원본 content.js의 fmt)
export function fmt(template: string | string[] | undefined, vars: Record<string, unknown> = {}): string {
  const s = Array.isArray(template) ? template.join('\n') : String(template ?? '');
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
```

index.ts: `export * from './loader'; export * from './schema';`

- [ ] **Step 7: 테스트 통과 확인** — Run: `npm test --workspace @eotm/content` → PASS (gen이 pretest로 자동 실행됨)

- [ ] **Step 8: 커밋** — `git add packages/content && git commit -m "feat(content): 게임데이터 팩 6종 + 전역 프롬프트·대사 + zod 검증 로더"`

---

### Task 4: worker 스캐폴딩 — Hono + wrangler + health/personas

**Files:**
- Create: `apps/worker/package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`
- Create: `apps/worker/src/env.ts`, `src/log.ts`, `src/index.ts`, `src/room-do.ts`(스텁), `src/quota-do.ts`(스텁)
- Test: `apps/worker/test/api.test.ts`

**Interfaces:**
- Consumes: `listPersonas` (@eotm/content), `HealthRes`/`PersonaSummary` (@eotm/shared)
- Produces:
  - `Env` 타입: `{ ROOM_DO: DurableObjectNamespace; QUOTA_DO: DurableObjectNamespace; ASSETS: Fetcher; GOOGLE_AI_STUDIO_API_KEY?: string; NVIDIA_API_KEY?: string; GEMINI_MODEL: string; NVIDIA_MODEL: string; LLM_DAILY_LIMIT_GEMINI: string; LLM_DAILY_LIMIT_NVIDIA: string }`
  - `logger` — 타입드 로그 핸들러 (이벤트별 메서드, 스펙 §11의 이벤트 목록과 1:1)
  - `GET /api/health`, `GET /api/personas` 동작

- [ ] **Step 1: package.json**

```json
{
  "name": "@eotm/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "hono": "^4.5.0",
    "@eotm/shared": "*",
    "@eotm/content": "*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.80.0",
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240925.0"
  }
}
```

tsconfig.json: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["@cloudflare/workers-types"] }, "include": ["src", "test"] }`

- [ ] **Step 2: wrangler.jsonc** — 스펙 §10 체크리스트 그대로

```jsonc
{
  "name": "employee-of-the-month",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-01",
  "observability": { "enabled": true },
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  },
  "durable_objects": {
    "bindings": [
      { "name": "ROOM_DO", "class_name": "RoomDO" },
      { "name": "QUOTA_DO", "class_name": "QuotaDO" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomDO", "QuotaDO"] }],
  "vars": {
    "GEMINI_MODEL": "gemini-flash-lite-latest",
    "NVIDIA_MODEL": "meta/llama-3.3-70b-instruct",
    "LLM_DAILY_LIMIT_GEMINI": "1000",
    "LLM_DAILY_LIMIT_NVIDIA": "5000"
  }
}
```

주의: `../web/dist`가 없으면 wrangler dev가 실패한다 — Step 6에서 빈 dist를 만들어 둔다.

- [ ] **Step 3: vitest.config.ts**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: { wrangler: { configPath: './wrangler.jsonc' } },
    },
  },
});
```

- [ ] **Step 4: src/env.ts + src/log.ts + DO 스텁**

```ts
// env.ts
export interface Env {
  ROOM_DO: DurableObjectNamespace;
  QUOTA_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
  GOOGLE_AI_STUDIO_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  GEMINI_MODEL: string;
  NVIDIA_MODEL: string;
  LLM_DAILY_LIMIT_GEMINI: string;
  LLM_DAILY_LIMIT_NVIDIA: string;
}
```

```ts
// log.ts — 타입드 JSON 로그 핸들러. 이벤트명·필드 정의는 이 파일이 유일한 출처다 (스펙 §11).
// 호출부는 logger.* 만 사용한다 — 임의 이벤트명 문자열·console 직접 호출 금지.
type Level = 'info' | 'warn' | 'error';

function write(level: Level, event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  roomCreated: (f: { roomCode: string; mode: string; personaId: string }) => write('info', 'room_created', f),
  gameStarted: (f: { roomCode: string; nicks: string[] }) => write('info', 'game_started', f),
  gameEnded: (f: { roomCode: string; rounds: number; winnerNick?: string }) => write('info', 'game_ended', f),
  roundStarted: (f: { roomCode: string; roundNo: number; situation: string }) => write('info', 'round_started', f),
  speechSubmitted: (f: { roomCode: string; roundNo: number; nick: string; text: string }) => write('info', 'speech_submitted', f),
  verdictIssued: (f: { roomCode: string; roundNo: number; provider: string; adoptedNick: string | null; totals: Record<string, number>; comments: string[] }) => write('info', 'verdict_issued', f),
  llmCall: (f: { kind: string; provider: string; ok: boolean; latencyMs: number; failedOver?: boolean; error?: string }) => write(f.ok ? 'info' : 'warn', 'llm_call', f),
  quotaExceeded: (f: { provider: string }) => write('warn', 'quota_exceeded', f),
  sseConnect: (f: { roomCode: string; playerId: string }) => write('info', 'sse_connect', f),
  sseDisconnect: (f: { roomCode: string; playerId: string }) => write('info', 'sse_disconnect', f),
  error: (f: { where: string; error: string; stack?: string }) => write('error', 'error', f),
};
```

room-do.ts / quota-do.ts 스텁 (Task 6·8에서 구현):

```ts
// room-do.ts — Task 9~10에서 구현
export class RoomDO implements DurableObject {
  constructor(readonly ctx: DurableObjectState, readonly env: import('./env').Env) {}
  async fetch(_req: Request): Promise<Response> {
    return Response.json({ error: 'not implemented' }, { status: 501 });
  }
}
```

```ts
// quota-do.ts — Task 8에서 구현
export class QuotaDO implements DurableObject {
  constructor(readonly ctx: DurableObjectState, readonly env: import('./env').Env) {}
  async fetch(_req: Request): Promise<Response> {
    return Response.json({ error: 'not implemented' }, { status: 501 });
  }
}
```

- [ ] **Step 5: 실패하는 테스트 작성** — `test/api.test.ts`

```ts
import { test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

test('GET /api/health — 공급자 상태를 준다', async () => {
  const res = await SELF.fetch('http://x/api/health');
  expect(res.status).toBe(200);
  const body = await res.json() as { ok: boolean; providers: { gemini: boolean; nvidia: boolean } };
  expect(body.ok).toBe(true);
  expect(typeof body.providers.gemini).toBe('boolean');
});

test('GET /api/personas — 2종 요약, 상황 본문 없음', async () => {
  const res = await SELF.fetch('http://x/api/personas');
  const list = await res.json() as Record<string, unknown>[];
  expect(list.length).toBe(2);
  expect(list[0]).not.toHaveProperty('situations');
  expect(list[0]).not.toHaveProperty('personaPrompt');
});
```

Run: `npm test --workspace @eotm/worker` / Expected: FAIL

- [ ] **Step 6: src/index.ts** (+ 빈 `apps/web/dist/index.html` 생성: `<!doctype html><title>placeholder</title>`)

```ts
import { Hono } from 'hono';
import { listPersonas } from '@eotm/content';
import type { Env } from './env';
import type { HealthRes } from '@eotm/shared';
export { RoomDO } from './room-do';
export { QuotaDO } from './quota-do';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => {
  const res: HealthRes = {
    ok: true,
    providers: { gemini: Boolean(c.env.GOOGLE_AI_STUDIO_API_KEY), nvidia: Boolean(c.env.NVIDIA_API_KEY) },
    models: { gemini: c.env.GEMINI_MODEL, nvidia: c.env.NVIDIA_MODEL },
  };
  return c.json(res);
});

app.get('/api/personas', (c) => c.json(listPersonas()));

// /api/rooms* 라우팅은 Task 10에서 추가. 그 외는 정적 SPA (Workers Assets가 처리)
export default app;
```

- [ ] **Step 7: 테스트 통과 확인** — Run: `npm test --workspace @eotm/worker` → PASS

- [ ] **Step 8: 커밋** — `git add apps/worker apps/web/dist package-lock.json && git commit -m "feat(worker): Hono 스캐폴딩 + wrangler 설정 + health/personas API"`

---

### Task 5: game/logic.ts — 순수 로직 이식

**Files:**
- Create: `apps/worker/src/game/logic.ts`
- Test: `apps/worker/test/logic.test.ts`

**Interfaces:**
- Produces: `buildSpeakQueue({advisors, advisorFavor, players, roundNo}) -> QueueEntry[]`, `computeAdoption(perSpeaker, candidates) -> {adoptedKey, totals}`, `rankIdxFor(favor, ranks) -> number`, `isChampion(favor, ranks) -> boolean`
- 원본: `C:\Users\user\ai-debate-game\server\sycophant\logic.js` — 로직 변경 금지, 타입만 부여

- [ ] **Step 1: 실패하는 테스트 작성** — `test/logic.test.ts` (원본 tests/sycoLogic.test.js를 vitest로 이식. 원본 테스트 파일을 읽고 전 케이스를 옮긴다. 핵심 케이스:)

```ts
import { test, expect } from 'vitest';
import { buildSpeakQueue, computeAdoption, rankIdxFor, isChampion } from '../src/game/logic';

const P = (id: string, joinOrder: number, favor: number) =>
  ({ id, nick: id, joinOrder, favor }) as { id: string; nick: string; joinOrder: number; favor: number };
const A = (name: string) => ({ name, emoji: '🎓', style: 's', stylePrompt: 'p' });

test('발언 큐: AI 블록 먼저, 사람 블록 나중. 1라운드는 정의순/입장순', () => {
  const q = buildSpeakQueue({ advisors: [A('갑'), A('을')], advisorFavor: {}, players: [P('u2', 1, 0), P('u1', 0, 0)], roundNo: 1 });
  expect(q.map((e) => e.key)).toEqual(['ai:갑', 'ai:을', 'u1', 'u2']);
});

test('2라운드부터 블록 내 총애 높은 순', () => {
  const q = buildSpeakQueue({ advisors: [A('갑'), A('을')], advisorFavor: { 을: 2 }, players: [P('u1', 0, 0), P('u2', 1, 1)], roundNo: 2 });
  expect(q.map((e) => e.key)).toEqual(['ai:을', 'ai:갑', 'u2', 'u1']);
});

test('채택 = 합산 최고점, 동점은 늦게 말한 쪽', () => {
  const candidates = [{ key: 'a', order: 0 }, { key: 'b', order: 1 }];
  const r = computeAdoption(
    [{ key: 'a', axisScores: { x: 9, y: 6 } }, { key: 'b', axisScores: { x: 8, y: 7 } }],
    candidates,
  );
  expect(r.adoptedKey).toBe('b');
  expect(r.totals.a).toBe(15);
});

test('발언자 없으면 채택 없음', () => {
  expect(computeAdoption([], []).adoptedKey).toBeNull();
});

test('승진: 채택 수 = 계급 인덱스, 최고 계급이 우승', () => {
  const ranks = ['인턴', '사원', '팀장', '이사', '부사장'];
  expect(rankIdxFor(0, ranks)).toBe(0);
  expect(rankIdxFor(9, ranks)).toBe(4);
  expect(isChampion(3, ranks)).toBe(false);
  expect(isChampion(4, ranks)).toBe(true);
});
```

Run: `npm test --workspace @eotm/worker -- logic` / Expected: FAIL

- [ ] **Step 2: 구현** — 원본 logic.js를 읽고 그대로 TS화. `MAX_SPEECH_CHARS`는 shared에서 재수출:

```ts
// 순수 로직 (순번·채택·승진). 원본 server/sycophant/logic.js 이식 — 로직 동일.
import type { QueueEntry } from '@eotm/shared';
export { MAX_SPEECH_CHARS } from '@eotm/shared';

interface QueueArgs {
  advisors: { name: string }[];
  advisorFavor?: Record<string, number>;
  players: { id: string; nick: string; joinOrder: number; favor: number }[];
  roundNo: number;
}

// 발언 큐: 사람은 항상 AI 다음(마지막 블록) — 앞 의견을 보고 반박할 수 있는 유리한 자리.
export function buildSpeakQueue({ advisors, advisorFavor = {}, players, roundNo }: QueueArgs): QueueEntry[] {
  const ai = advisors.map((a, i) => ({ kind: 'ai' as const, key: `ai:${a.name}`, name: a.name, favor: advisorFavor[a.name] || 0, idx: i }));
  const us = players.map((p) => ({ kind: 'user' as const, key: p.id, name: p.nick, favor: p.favor, idx: p.joinOrder }));
  const byFavor = <T extends { favor: number; idx: number }>(arr: T[]) => [...arr].sort((a, b) => {
    if (roundNo > 1 && b.favor !== a.favor) return b.favor - a.favor;
    return a.idx - b.idx;
  });
  return [...byFavor(ai), ...byFavor(us)].map(({ kind, key, name }) => ({ kind, key, name }));
}

export function computeAdoption(
  perSpeaker: { key: string; axisScores?: Record<string, number> }[],
  candidates: { key: string; order: number }[],
): { adoptedKey: string | null; totals: Record<string, number> } {
  const orderOf = Object.fromEntries(candidates.map((c) => [c.key, c.order]));
  const totals: Record<string, number> = {};
  let adoptedKey: string | null = null;
  let best = -Infinity;
  for (const s of perSpeaker) {
    const total = Object.values(s.axisScores || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
    totals[s.key] = total;
    const order = orderOf[s.key] ?? -1;
    if (total > best || (total === best && adoptedKey != null && order > (orderOf[adoptedKey] ?? -1))) {
      best = total;
      adoptedKey = s.key;
    }
  }
  return { adoptedKey, totals };
}

export function rankIdxFor(favor: number, ranks: string[]): number {
  return Math.min(favor, ranks.length - 1);
}

export function isChampion(favor: number, ranks: string[]): boolean {
  return rankIdxFor(favor, ranks) === ranks.length - 1;
}
```

- [ ] **Step 3: 테스트 통과 확인** — Run: `npm test --workspace @eotm/worker -- logic` → PASS

- [ ] **Step 4: 커밋** — `git commit -am "feat(worker): 게임 순수 로직 이식 (순번·채택·승진)"`

---

### Task 6: ai/prompts.ts + ai/mock.ts + ai/verdict.ts 이식

**Files:**
- Create: `apps/worker/src/ai/prompts.ts`, `src/ai/schemas.ts`, `src/ai/mock.ts`, `src/ai/verdict.ts`
- Test: `apps/worker/test/ai-pure.test.ts`

**Interfaces:**
- Consumes: `PROMPTS`, `STRINGS`, `fmt`, `getPersona`, `FullPersona` (@eotm/content), `computeAdoption` (Task 5)
- Produces:
  - prompts.ts: `APPROACHES`, `DIFFICULTY`, `advisorBatchSystem(persona, advisors, difficulty)`, `advisorBatchUser(persona, situation)`, `advisorBatchSchema()`, `judgeSystem(persona, difficulty)`, `judgeUser(persona, situation, candidates)`, `judgeSchema(axes)`, `epilogueSystem(persona)`, `epilogueUser(persona, situation, adopted)`, `epilogueSchema()`
  - schemas.ts — LLM **출력** zod 스키마 (JSON Schema와 쌍을 이루는 수신측 검증. 위반 = 페일오버):
    ```ts
    import { z } from 'zod';
    export const advisorBatchOut = z.object({
      speeches: z.array(z.object({ name: z.string(), text: z.string(), approach: z.string() })).min(1),
    });
    export const judgeOut = z.object({
      perSpeaker: z.array(z.object({ key: z.string(), axisScores: z.record(z.number()), comment: z.string() })).min(1),
      adoptedKey: z.string(),
      adoptReason: z.string(),
    });
    export const epilogueOut = z.object({ story: z.string().min(1) });
    ```
    (worker package.json dependencies에 `"zod": "^3.23.0"` 추가)
  - mock.ts: `mockAdvisorTurnsBatch({persona, advisors, situation})`, `mockJudgeSpeeches({persona, situation, candidates})`, `mockEpilogue({persona, situation, adopted})`
  - verdict.ts: `trimSpeech(text, max?)`, `finalizeVerdict(raw, candidates, axes) -> Verdict`
  - `Candidate` 타입: `{ key: string; name: string; kind: 'ai'|'user'; order: number; text: string }`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/ai-pure.test.ts` (원본 tests/sycoAi.test.js에서 순수 부분 이식)

```ts
import { test, expect } from 'vitest';
import { getPersona } from '@eotm/content';
import { mockAdvisorTurnsBatch, mockJudgeSpeeches, mockEpilogue } from '../src/ai/mock';
import { trimSpeech, finalizeVerdict } from '../src/ai/verdict';

const persona = getPersona('caocao')!;
const situation = persona.situations[0]!;

test('mock 조언자 배치: 조언자 수만큼, 160자 이내, approach 부여', () => {
  const r = mockAdvisorTurnsBatch({ persona, advisors: persona.advisors, situation });
  expect(r.speeches.length).toBe(persona.advisors.length);
  for (const s of r.speeches) {
    expect(s.name && s.text).toBeTruthy();
    expect(s.text.length).toBeLessThanOrEqual(160);
  }
});

test('mock 판정: 모든 후보에 전 축 점수', () => {
  const candidates = [
    { key: 's1', name: '발언자1', kind: 'ai' as const, order: 0, text: '살려서 쓰소서.' },
    { key: 's2', name: '발언자2', kind: 'user' as const, order: 1, text: '베어야 합니다.' },
  ];
  const raw = mockJudgeSpeeches({ persona, situation, candidates });
  expect(raw.perSpeaker.length).toBe(2);
  for (const s of raw.perSpeaker) {
    for (const ax of persona.axes) expect(Number.isInteger(s.axisScores[ax])).toBe(true);
  }
});

test('trimSpeech: 초과 시 문장 끝에서 끊는다', () => {
  const t = '가나다. '.repeat(50);
  const cut = trimSpeech(t, 160);
  expect(cut.length).toBeLessThanOrEqual(170);
  expect(cut.endsWith('.')).toBe(true);
});

test('finalizeVerdict: 클램프 + 서버 채택 재계산 + 불일치 시 사유 대체', () => {
  const candidates = [
    { key: 'a', name: 'A', kind: 'user' as const, order: 0, text: 'ㄱ' },
    { key: 'b', name: 'B', kind: 'user' as const, order: 1, text: 'ㄴ' },
  ];
  const raw = {
    perSpeaker: [
      { key: 'a', axisScores: { 실리: 99, 기지: -3 }, comment: 'a평' },
      { key: 'b', axisScores: { 실리: 9, 기지: 9, 체면: 9 }, comment: 'b평' },
    ],
    adoptedKey: 'a',
    adoptReason: 'A 최고',
  };
  const v = finalizeVerdict(raw, candidates, ['실리', '기지', '체면']);
  expect(v.adoptedKey).toBe('b');
  expect(v.adoptReason).not.toBe('A 최고');
  const a = v.perSpeaker.find((s) => s.key === 'a')!;
  expect(a.axisScores['실리']).toBe(10);
  expect(a.axisScores['기지']).toBe(0);
  expect(a.total).toBe(10);
});

test('mock 에필로그: 이야기 생성', () => {
  const r = mockEpilogue({ persona, situation, adopted: { name: '유저', text: '베소서' } });
  expect(r.story.length).toBeGreaterThan(10);
});
```

Run: `npm test --workspace @eotm/worker -- ai-pure` / Expected: FAIL

- [ ] **Step 2: prompts.ts 구현** — 원본 `server/sycophant/prompts.js`를 읽고 그대로 TS화. import만 교체: `PROMPTS, fmt`를 `@eotm/content`에서. `Candidate` 타입을 이 파일에 정의하고 export. responseSchema 3종(advisorBatchSchema/judgeSchema/epilogueSchema)과 조립 함수 6종을 원본 코드 그대로 유지 (변경 없음 — 함수 시그니처에 타입만: `persona: FullPersona`, `situation: Situation`, `difficulty: Difficulty = 'normal'`).

- [ ] **Step 3: mock.ts 구현** — 원본 `server/sycophant/mock.js`를 읽고 그대로 TS화. `STRINGS`는 `@eotm/content`에서 import. seeded RNG·템플릿 로직 변경 금지. export 시그니처는 Interfaces 절 참조.

- [ ] **Step 4: verdict.ts 구현** — 원본 `server/sycophant/ai.js`의 `trimSpeech`(21~30행)와 `finalizeVerdict`(72~109행)를 그대로 TS화:

```ts
// 판정 후처리 순수 함수. 원본 server/sycophant/ai.js에서 분리 이식 — 로직 동일.
import { MAX_SPEECH_CHARS, type Verdict } from '@eotm/shared';
import { STRINGS, fmt } from '@eotm/content';
import { computeAdoption } from '../game/logic';
import type { Candidate } from './prompts';

// 글자 초과 시 문장 중간이 아니라 문장 끝에서 끊는다 (잘린 대사 방지).
export function trimSpeech(text: unknown, max: number = MAX_SPEECH_CHARS): string {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 10);
  let end = -1;
  for (const ch of ['.', '!', '?', '…']) end = Math.max(end, cut.lastIndexOf(ch));
  if (end >= max * 0.4) return cut.slice(0, end + 1);
  return t.slice(0, max);
}

interface RawVerdict {
  perSpeaker?: { key?: string; axisScores?: Record<string, number>; comment?: string }[];
  adoptedKey?: string | null;
  adoptReason?: string;
}

// raw 판정 → 클램프·합산·서버 채택 재계산. key/이름 관용 매칭 포함 (원본 주석 참조).
export function finalizeVerdict(raw: RawVerdict, candidates: Candidate[], axes: string[]): Verdict {
  const rawList = raw.perSpeaker || [];
  const byKey = new Map(rawList.map((s) => [String(s.key), s]));
  const resolve = (c: Candidate) => byKey.get(c.key) ?? byKey.get(c.name) ?? byKey.get(`ai:${c.name}`);
  const perSpeaker = candidates.map((c) => {
    const s = resolve(c) || {};
    const axisScores: Record<string, number> = {};
    for (const ax of axes) {
      const v = Math.round(Number(s.axisScores?.[ax]) || 0);
      axisScores[ax] = Math.max(0, Math.min(10, v));
    }
    return {
      key: c.key, name: c.name, kind: c.kind, axisScores,
      total: Object.values(axisScores).reduce((a, b) => a + b, 0),
      comment: s.comment || STRINGS.fallback.judgeComment!,
    };
  });
  const { adoptedKey, totals } = computeAdoption(perSpeaker, candidates);
  const rawAdopted = candidates.find(
    (c) => c.key === raw.adoptedKey || c.name === raw.adoptedKey || `ai:${c.name}` === raw.adoptedKey,
  )?.key ?? null;
  let adoptReason = raw.adoptReason || '';
  if (adoptedKey && rawAdopted !== adoptedKey) {
    const adopted = perSpeaker.find((s) => s.key === adoptedKey);
    adoptReason = adopted?.comment && adopted.comment !== STRINGS.fallback.judgeComment
      ? adopted.comment
      : fmt(STRINGS.fallback.adoptReason, { adoptedName: adopted?.name ?? '' });
  }
  return { perSpeaker, adoptedKey, adoptReason, totals };
}
```

- [ ] **Step 5: 테스트 통과 확인** — Run: `npm test --workspace @eotm/worker -- ai-pure` → PASS

- [ ] **Step 6: 커밋** — `git commit -am "feat(worker): 프롬프트 조립·mock·판정 검증 이식"`

---

### Task 7: ai/providers + chain — LLM 공급자 체인

**Files:**
- Create: `apps/worker/src/ai/providers/gemini.ts`, `src/ai/providers/nvidia.ts`, `src/ai/parse.ts`, `src/ai/chain.ts`
- Test: `apps/worker/test/chain.test.ts`

**Interfaces:**
- Consumes: `Env` (Task 4), `log` (Task 4)
- Produces:
  - `parse.ts`: `parseLenientJson(text: string): unknown` (원본 llm.js에서 이식)
  - `LlmArgs`: `{ system: string; user: string; schema: object; temperature?: number; timeoutMs?: number }`
  - `Provider`: `{ name: 'gemini' | 'nvidia'; hasKey(env: Env): boolean; callJson(env: Env, args: LlmArgs): Promise<unknown> }`
  - `chain.ts`: `callJsonChain(env: Env, args: LlmArgs, opts?: { quotaTake?: (p: string) => Promise<boolean>; validate?: (raw: unknown) => void }): Promise<{ raw: unknown; provider: 'gemini' | 'nvidia' }>` — 전 공급자 실패 시 `ChainExhaustedError` throw
  - `llm_call` 로그를 여기서 찍는다: `{ event: 'llm_call', provider, ok, latencyMs, failedOver }`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/chain.test.ts` (fetch를 vi.stubGlobal로 대체)

```ts
import { test, expect, vi, afterEach } from 'vitest';
import { callJsonChain, ChainExhaustedError } from '../src/ai/chain';
import type { Env } from '../src/env';

const env = {
  GOOGLE_AI_STUDIO_API_KEY: 'g-key', NVIDIA_API_KEY: 'n-key',
  GEMINI_MODEL: 'gemini-x', NVIDIA_MODEL: 'nv-x',
} as Env;
const args = { system: 's', user: 'u', schema: { type: 'object' } };

afterEach(() => vi.unstubAllGlobals());

function geminiOk(json: object) {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] });
}
function nvidiaOk(json: object) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(json) } }] });
}

test('gemini 성공 시 gemini 결과', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => geminiOk({ a: 1 })));
  const r = await callJsonChain(env, args);
  expect(r.provider).toBe('gemini');
  expect(r.raw).toEqual({ a: 1 });
});

test('gemini 429 → nvidia 페일오버', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).includes('generativelanguage') ? new Response('rate', { status: 429 }) : nvidiaOk({ b: 2 })));
  const r = await callJsonChain(env, args);
  expect(r.provider).toBe('nvidia');
  expect(r.raw).toEqual({ b: 2 });
});

test('validate 실패도 페일오버 사유', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).includes('generativelanguage') ? geminiOk({ bad: true }) : nvidiaOk({ good: true })));
  const r = await callJsonChain(env, args, {
    validate: (raw) => { if ((raw as { bad?: boolean }).bad) throw new Error('bad shape'); },
  });
  expect(r.provider).toBe('nvidia');
});

test('키 없는 공급자는 건너뛰고, 전부 실패면 ChainExhaustedError', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));
  await expect(callJsonChain({ ...env, NVIDIA_API_KEY: undefined } as Env, args)).rejects.toThrow(ChainExhaustedError);
});

test('quotaTake가 false면 그 공급자 스킵', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => nvidiaOk({ c: 3 })));
  const r = await callJsonChain(env, args, { quotaTake: async (p) => p !== 'gemini' });
  expect(r.provider).toBe('nvidia');
});
```

Run: `npm test --workspace @eotm/worker -- chain` / Expected: FAIL

- [ ] **Step 2: parse.ts + providers/gemini.ts** — 원본 `server/llm.js` 이식. `parseLenientJson`·`toGeminiSchema`·fetch 본문 그대로, `process.env` → `env` 인자, `hasKey(env)`로 변경. export: `export const gemini: Provider = { name: 'gemini', hasKey: (env) => Boolean(env.GOOGLE_AI_STUDIO_API_KEY), callJson }`.

- [ ] **Step 3: providers/nvidia.ts 구현**

```ts
// NVIDIA NIM (OpenAI 호환 chat completions). 요청은 nvext.guided_json으로 JSON Schema를
// 강제하고(NIM 구조화 출력), 프롬프트에도 스키마를 명시해 이중 방어. 응답은 관용 파싱 후
// 호출측 zod 검증 — 위반은 체인이 다음 공급자로 넘긴다.
import { parseLenientJson } from '../parse';
import type { Env } from '../../env';
import type { LlmArgs, Provider } from '../chain';

const BASE = 'https://integrate.api.nvidia.com/v1/chat/completions';

async function callJson(env: Env, { system, user, schema, temperature = 0.9, timeoutMs = 30000 }: LlmArgs): Promise<unknown> {
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error('NVIDIA_API_KEY missing');
  const body = {
    model: env.NVIDIA_MODEL,
    messages: [
      { role: 'system', content: `${system}\n\n다음 JSON 스키마를 정확히 따르는 JSON만 출력한다. 다른 텍스트 금지.\n${JSON.stringify(schema)}` },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: 2048,
    nvext: { guided_json: schema }, // NIM 구조화 출력 — 요청측 JSON Schema 강제
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NVIDIA HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('NVIDIA empty response');
  return parseLenientJson(content);
}

export const nvidia: Provider = {
  name: 'nvidia',
  hasKey: (env) => Boolean(env.NVIDIA_API_KEY),
  callJson,
};
```

- [ ] **Step 4: chain.ts 구현**

```ts
// LLM 공급자 체인: gemini → nvidia. 429·타임아웃·스키마 위반 시 다음 공급자로 (스펙 §7).
import { logger } from '../log';
import type { Env } from '../env';
import { gemini } from './providers/gemini';
import { nvidia } from './providers/nvidia';

export interface LlmArgs { system: string; user: string; schema: object; temperature?: number; timeoutMs?: number }
export interface Provider {
  name: 'gemini' | 'nvidia';
  hasKey(env: Env): boolean;
  callJson(env: Env, args: LlmArgs): Promise<unknown>;
}
export class ChainExhaustedError extends Error {
  constructor() { super('모든 LLM 공급자 실패'); }
}

const CHAIN: Provider[] = [gemini, nvidia];

export interface ChainOpts {
  kind?: string;                                      // 로그용 호출 종류 (advisors|judge|epilogue)
  quotaTake?: (provider: string) => Promise<boolean>; // false면 해당 공급자 스킵 (일일 쿼터)
  validate?: (raw: unknown) => void;                  // zod 출력 검증 — throw 시 페일오버
}

export async function callJsonChain(env: Env, args: LlmArgs, opts: ChainOpts = {}): Promise<{ raw: unknown; provider: 'gemini' | 'nvidia' }> {
  let failedOver = false;
  const kind = opts.kind ?? 'unknown';
  for (const p of CHAIN) {
    if (!p.hasKey(env)) continue;
    if (opts.quotaTake && !(await opts.quotaTake(p.name))) {
      logger.quotaExceeded({ provider: p.name });
      continue;
    }
    const t0 = Date.now();
    try {
      const raw = await p.callJson(env, args);
      opts.validate?.(raw);
      logger.llmCall({ kind, provider: p.name, ok: true, latencyMs: Date.now() - t0, failedOver });
      return { raw, provider: p.name };
    } catch (e) {
      logger.llmCall({ kind, provider: p.name, ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
      failedOver = true;
    }
  }
  throw new ChainExhaustedError();
}
```

- [ ] **Step 5: 테스트 통과 확인** — Run: `npm test --workspace @eotm/worker -- chain` → PASS

- [ ] **Step 6: 커밋** — `git commit -am "feat(worker): Gemini→NVIDIA→mock 공급자 체인"`

---

### Task 8: ai/orchestrate.ts + QuotaDO

**Files:**
- Create: `apps/worker/src/ai/orchestrate.ts`
- Modify: `apps/worker/src/quota-do.ts` (스텁 → 구현)
- Test: `apps/worker/test/orchestrate.test.ts`, `test/quota.test.ts`

**Interfaces:**
- Consumes: chain(Task 7), prompts/mock/verdict(Task 6), logic(Task 5)
- Produces:
  - orchestrate.ts (원본 ai.js의 3종 호출을 체인 기반으로):
    - `advisorTurnsBatch(deps, {persona, advisors, situation, difficulty}) -> {speeches: [{name, text, approach}], source}`
    - `judgeSpeeches(deps, {persona, situation, candidates, difficulty}) -> {verdict: Verdict, source}` (익명 마스킹 포함, 원본 로직 그대로)
    - `makeEpilogue(deps, {persona, situation, adopted}) -> {story, source}`
    - `deps = { env: Env; quotaTake?: (p: string) => Promise<boolean> }`, `source`는 `'gemini' | 'nvidia' | 'mock' | 'mock(fallback)'`
  - QuotaDO fetch API: `POST /incr` body `{ key: string; limit: number; ttlMs: number }` → `{ ok: boolean; count: number }` (범용 카운터 — LLM 일일 쿼터와 IP rate limit 겸용)

- [ ] **Step 1: 실패하는 테스트 작성** — `test/quota.test.ts`

```ts
import { test, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';

async function incr(stub: DurableObjectStub, key: string, limit: number) {
  const res = await stub.fetch('http://do/incr', {
    method: 'POST',
    body: JSON.stringify({ key, limit, ttlMs: 60000 }),
  });
  return res.json() as Promise<{ ok: boolean; count: number }>;
}

test('한도 내 incr는 ok, 초과부터 거부', async () => {
  const stub = env.QUOTA_DO.get(env.QUOTA_DO.idFromName('test'));
  expect((await incr(stub, 'k', 2)).ok).toBe(true);
  expect((await incr(stub, 'k', 2)).ok).toBe(true);
  const third = await incr(stub, 'k', 2);
  expect(third.ok).toBe(false);
  expect(third.count).toBe(2);
});
```

`test/orchestrate.test.ts` — 키 없는 env로 mock 폴백 확인:

```ts
import { test, expect } from 'vitest';
import { getPersona } from '@eotm/content';
import { advisorTurnsBatch, judgeSpeeches, makeEpilogue } from '../src/ai/orchestrate';
import type { Env } from '../src/env';

const persona = getPersona('kimceo')!;
const situation = persona.situations[0]!;
const deps = { env: {} as Env }; // 키 없음 → mock 경로

test('키 없으면 mock으로 조언자 배치 생성', async () => {
  const r = await advisorTurnsBatch(deps, { persona, advisors: persona.advisors, situation, difficulty: 'normal' });
  expect(r.source).toBe('mock');
  expect(r.speeches.length).toBe(persona.advisors.length);
});

test('키 없으면 mock 판정 — 익명 마스킹 복원 확인', async () => {
  const candidates = [
    { key: 'ai:박이사', name: '박이사', kind: 'ai' as const, order: 0, text: '숫자부터 봅시다.' },
    { key: 'u1', name: '유저닉', kind: 'user' as const, order: 1, text: '지릅시다.' },
  ];
  const r = await judgeSpeeches(deps, { persona, situation, candidates, difficulty: 'normal' });
  expect(r.source).toBe('mock');
  expect(r.verdict.perSpeaker.map((s) => s.key).sort()).toEqual(['ai:박이사', 'u1']);
  expect(r.verdict.perSpeaker.every((s) => s.name !== '발언자1')).toBe(true);
});

test('키 없으면 mock 에필로그', async () => {
  const r = await makeEpilogue(deps, { persona, situation, adopted: { name: '유저닉', text: '지릅시다.' } });
  expect(r.source).toBe('mock');
  expect(r.story.length).toBeGreaterThan(10);
});
```

Run: `npm test --workspace @eotm/worker -- quota orchestrate` / Expected: FAIL

- [ ] **Step 2: quota-do.ts 구현**

```ts
// 범용 카운터 DO: LLM 일일 쿼터 + IP rate limit. key별 [count, expiresAt]를 storage에 유지.
import type { Env } from './env';

export class QuotaDO implements DurableObject {
  constructor(readonly ctx: DurableObjectState, readonly env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/incr') {
      const { key, limit, ttlMs } = (await req.json()) as { key: string; limit: number; ttlMs: number };
      const now = Date.now();
      const cur = (await this.ctx.storage.get<{ count: number; expiresAt: number }>(key)) ?? { count: 0, expiresAt: now + ttlMs };
      const fresh = cur.expiresAt <= now ? { count: 0, expiresAt: now + ttlMs } : cur;
      if (fresh.count >= limit) return Response.json({ ok: false, count: fresh.count });
      fresh.count += 1;
      await this.ctx.storage.put(key, fresh);
      return Response.json({ ok: true, count: fresh.count });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }
}
```

- [ ] **Step 3: orchestrate.ts 구현** — 원본 `server/sycophant/ai.js`의 `withFallback`·`advisorTurnsBatch`(재시도·approach 재배정 포함)·`judgeSpeeches`(익명 마스킹·복원 포함)·`makeEpilogue`를 그대로 옮기되:
  - `callGeminiJson(...)` 호출부를 `callJsonChain(deps.env, {...}, { kind, quotaTake: deps.quotaTake, validate })`로 교체. `validate`는 Task 6 schemas.ts의 zod 스키마: advisors → `(raw) => advisorBatchOut.parse(raw)`, judge → `judgeOut.parse`, epilogue → `epilogueOut.parse`
  - `hasKey()` 분기를 "체인에 키 있는 공급자가 하나도 없으면 mock" (`gemini.hasKey(env) || nvidia.hasKey(env)`)으로 교체
  - `source`: 성공 시 체인이 돌려준 `provider`, 체인 소진 폴백 시 `'mock(fallback)'`, 키 자체가 없으면 `'mock'`
  - `withFallback` 시그니처: `withFallback(deps, label, chainFn, mockFn)` — 원본의 try/catch 구조 유지, `console.warn` → `log('warn', ...)`
  - 나머지 로직(마스킹 배열 생성, byMasked 복원, 재시도 루프, approach 중복 재배정)은 원본 코드 그대로 복사

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test --workspace @eotm/worker -- quota orchestrate` → PASS

- [ ] **Step 5: 커밋** — `git commit -am "feat(worker): AI 오케스트레이션(체인 기반) + QuotaDO 카운터"`

---

### Task 9: game/state.ts — 방 상태 모델

**Files:**
- Create: `apps/worker/src/game/state.ts`
- Test: `apps/worker/test/state.test.ts`

**Interfaces:**
- Consumes: `getPersona` (@eotm/content), shared 타입·상수
- Produces:
  - `RoomState` 타입: `{ code, hostId, state, phase, roundNo, players: PlayerState[], config: RoomConfig, advisorFavor, hall, round: RoundState | null, feed: FeedItem[], seq: number, tokens: Record<string, string>, pendingChampion: string | null, lastActivity: number }`
  - `PlayerState`: `PublicPlayer + { }` / `RoundState`: `{ situation, queue, speeches, turnIdx, skipped: string[], usedApproaches: string[], verdict: Verdict | null }`
  - `createRoomState(code, hostNick, config) -> { room: RoomState; playerId; token }` — 검증 포함(원본 rooms.js의 config 정규화 그대로: 싱글 speakTime 0·aiCompete true·maxPlayers 1, 멀티 60/120/180·2~6명)
  - `addPlayer(room, nick) -> { playerId; token } | { error }` — LOBBY·정원 검증
  - `authPlayer(room, playerId, token) -> boolean`
  - `publicRoom(room) -> PublicRoom` — 원본 publicRoom의 sycophant 경로 그대로 (tokens 등 내부 필드 제외)
  - `genCode() -> string` (4자, 헷갈리는 문자 제외 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`)
  - `newId() -> string` — `crypto.randomUUID().slice(0, 8)`, `newToken() -> string` — `crypto.randomUUID()`
- RoomState는 그대로 JSON 직렬화 가능해야 한다(함수·타이머 없음) — DO storage 저장 형식.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/state.test.ts`

```ts
import { test, expect } from 'vitest';
import { createRoomState, addPlayer, authPlayer, publicRoom } from '../src/game/state';

test('싱글 방 생성: speakTime 0, aiCompete 강제, 정원 1', () => {
  const { room, playerId, token } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' });
  expect(room.config).toMatchObject({ mode: 'single', speakTime: 0, aiCompete: true, maxPlayers: 1 });
  expect(room.players[0]!.rank).toBe('사원'); // caocao 데이터의 1계급 (전 페르소나 공통 회사 직급)
  expect(authPlayer(room, playerId, token)).toBe(true);
  expect(authPlayer(room, playerId, 'wrong')).toBe(false);
});

test('멀티 방: speakTime 정규화(허용 외 → 60), 입장·정원', () => {
  const { room } = createRoomState('AB12', '호스트', { mode: 'multi', personaId: 'kimceo', speakTime: 45, maxPlayers: 2 });
  expect(room.config.speakTime).toBe(60);
  const j = addPlayer(room, '게스트');
  expect('playerId' in j).toBe(true);
  expect('error' in addPlayer(room, '넘침')).toBe(true); // 정원 2 초과
});

test('없는 페르소나는 생성 거부', () => {
  expect(() => createRoomState('AB12', 'h', { mode: 'single', personaId: 'nope' })).toThrow();
});

test('publicRoom은 내부 필드를 숨기고 페르소나 요약을 포함', () => {
  const { room } = createRoomState('AB12', '호스트', { mode: 'single', personaId: 'caocao' });
  const pub = publicRoom(room);
  expect(pub).not.toHaveProperty('tokens');
  expect(pub.persona.name).toBe('조조');
  expect(pub.persona).not.toHaveProperty('situations');
  expect(pub.capacity).toBe(1);
});

test('RoomState는 JSON 왕복이 된다', () => {
  const { room } = createRoomState('AB12', 'h', { mode: 'single', personaId: 'caocao' });
  expect(JSON.parse(JSON.stringify(room))).toEqual(room);
});
```

Run: `npm test --workspace @eotm/worker -- state` / Expected: FAIL

- [ ] **Step 2: 구현** — 원본 `server/rooms.js`의 sycophant 경로(createRoom 33~53행, makePlayer, joinRoom, publicRoom 129~149행)를 RoomState 형태로 이식. 에러 문구('존재하지 않는 인물입니다.' 등)는 하드코딩하지 않고 전부 `STRINGS.errors.*` 키를 사용한다. debate 분기 제거. `rankForScore` 의존 제거(간신배는 `persona.ranks[0]`만 사용). `_timer`·`socketId` 제거, `tokens`(playerId→token 맵)·`feed`·`seq`·`lastActivity` 추가. config 정규화 값은 원본 그대로: `speakTime: mode==='single' ? 0 : ([60,120,180].includes(N) ? N : 60)`, `difficulty: ['easy','normal','hard'].includes(d) ? d : 'normal'`, `maxPlayers: single 1 / multi clamp(2..6, 기본 4)`.

- [ ] **Step 3: 테스트 통과 확인** — Run: `npm test --workspace @eotm/worker -- state` → PASS

- [ ] **Step 4: 커밋** — `git commit -am "feat(worker): 방 상태 모델·생성·입장·publicRoom"`

---

### Task 10: game/engine.ts — 상태머신 (SSE·alarm 개편)

**Files:**
- Create: `apps/worker/src/game/engine.ts`
- Test: `apps/worker/test/engine.test.ts`

**Interfaces:**
- Consumes: state(Task 9), logic(Task 5), orchestrate(Task 8), content
- Produces:
  - `EngineBus` 인터페이스 — RoomDO가 구현:
    ```ts
    interface EngineBus {
      emit(ev: Omit<ServerEvent, 'seq'>): void;  // seq 부여·피드 영속·SSE push는 RoomDO 책임
      persist(): Promise<void>;                   // room 상태 storage 저장
      schedule(at: number, tag: string): Promise<void>;   // DO alarm 예약 (턴 마감·정리)
      cancelSchedule(): Promise<void>;
      delay(ms: number, fn: () => void): void;    // 짧은 연출 지연 (setTimeout 래퍼 — 테스트에서 치환)
    }
    ```
  - `class Engine { constructor(room: RoomState, bus: EngineBus, deps: AiDeps) }` 메서드:
    - `start(byPlayerId) -> {ok} | {error}` / `handleSpeak(playerId, text) -> void` / `nextRound(byPlayerId) -> {ok} | {error}` / `debug(playerId, action) -> {ok} | {error}` / `setConnected(playerId, connected)` / `onAlarm(tag: string)` — `turnTimeout:{roundNo}:{turnIdx}` 태그 처리
    - `resumeAfterRestore()` — DO 재기동 시 SITUATION/AI 턴에 멈춘 진행 재개
  - `AiDeps = { env: Env; quotaTake?: (p: string) => Promise<boolean> }`

**이식 지침 (원본 `server/sycophant/engine.js` 1:1 대응):**

| 원본 | 신규 |
|---|---|
| `bcast.emitRoom('room:update', publicRoom)` | `bus.emit({kind:'room', room: publicRoom(this.room)})` |
| `bcast.emitRoom('phase:change', {...})` | `bus.emit({kind:'phase', ...})` |
| `bcast.emitRoom('chat:new', item)` | `bus.emit({kind:'feed', item})` (verdict/epilogue도 feed 아이템 — shared `FeedItem` 참조) |
| `bcast.emitRoom('speak:turn', t)` | `bus.emit({kind:'turn', turn: t})` |
| `bcast.emitRoom('syco:verdict'/'syco:epilogue', p)` | `bus.emit({kind:'feed', item: {type:'verdict'/'epilogue', ...p, ts: Date.now()}})` |
| `bcast.emitRoom('ended', p)` | `bus.emit({kind:'ended', payload: p})` |
| `startTimer(sec, ...)` (매초 틱) | `bus.emit({kind:'timer', timer:{phase, deadline: Date.now()+sec*1000, total: sec}})` + `bus.schedule(deadline, 'turnTimeout:R:T')` |
| `clearTimer()` | `bus.emit({kind:'timer', timer: null})` + `bus.cancelSchedule()` |
| `setTimeout(짧은 연출)` (REVEAL 2.5초, speechGapMs, JUDGING_PAUSE 900ms) | `bus.delay(ms, fn)` — DO 활성 중 setTimeout. 재기동 유실은 `resumeAfterRestore`가 복구 |
| `bcast.emitPlayer(pid, 'error', ...)` | handleSpeak이 `{error}` 반환 → RoomDO가 HTTP 400으로 응답 (개인 채널 불필요) |
| `room._pendingChampion` | `room.pendingChampion` (직렬화 가능 필드) |
| `line()` / STRINGS / fmt | `@eotm/content`에서 import — 코드 동일 |

각 액션 처리 끝에 `bus.persist()` + `room.lastActivity = Date.now()` 갱신. `speechGapMs`·`REVEAL_DELAY_SEC`·`JUDGING_PAUSE_MS` 상수 원본 값 유지 (2.5초 / `min(7000, 1100+len*40)` / 900ms). 엔진의 에러 반환 문구('방장만 시작할 수 있습니다.' 등)와 시스템 대사는 전부 `STRINGS.errors.*` / `line()`(STRINGS.session·round) 경유 — 코드 내 리터럴 금지. 로그는 `logger.gameStarted/roundStarted/verdictIssued/gameEnded` 사용.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/engine.test.ts`. FakeBus로 이벤트를 배열에 수집, `delay`는 즉시 실행(`fn()`), `schedule`은 태그 기록. AI는 키 없는 env → mock 경로(결정적).

```ts
import { test, expect } from 'vitest';
import { Engine, type EngineBus } from '../src/game/engine';
import { createRoomState } from '../src/game/state';
import type { ServerEvent } from '@eotm/shared';
import type { Env } from '../src/env';

function fakeBus() {
  const events: Omit<ServerEvent, 'seq'>[] = [];
  const scheduled: string[] = [];
  const bus: EngineBus = {
    emit: (ev) => events.push(ev),
    persist: async () => {},
    schedule: async (_at, tag) => { scheduled.push(tag); },
    cancelSchedule: async () => {},
    delay: (_ms, fn) => fn(), // 연출 지연 생략 — 즉시 진행
  };
  return { bus, events, scheduled };
}
const deps = { env: {} as Env }; // mock 경로

function findFeed(events: Omit<ServerEvent, 'seq'>[], type: string) {
  return events.filter((e) => e.kind === 'feed' && (e as { item: { type: string } }).item.type === type);
}

test('싱글 1라운드: 시작→조언자 발언→내 발언→판정→RESULT', async () => {
  const { room, playerId } = createRoomState('T1', '나', { mode: 'single', personaId: 'caocao' });
  const { bus, events } = fakeBus();
  const eng = new Engine(room, bus, deps);
  expect(eng.start(playerId)).toEqual({ ok: true });
  // mock AI 배치는 비동기 — 조언자 발언·내 순번까지 진행을 기다린다
  await vi_waitUntil(() => room.phase === 'PLAYER_TURNS' && room.round!.queue[room.round!.turnIdx]?.kind === 'user');
  expect(findFeed(events, 'speech').length).toBe(room.persona ? 0 : 0 + 3); // 조언자 3명 발언
  eng.handleSpeak(playerId, '제 생각은 이렇습니다.');
  await vi_waitUntil(() => room.phase === 'RESULT');
  expect(findFeed(events, 'verdict').length).toBe(1);
  expect(room.round!.verdict).not.toBeNull();
});

test('멀티: 순번 아닌 발언 거부, 타임아웃 알람 예약', async () => {
  const { room, playerId } = createRoomState('T2', '호스트', { mode: 'multi', personaId: 'kimceo', maxPlayers: 2 });
  // addPlayer로 게스트 추가 후 start → PLAYER_TURNS에서 speakTurn·schedule 태그 확인
  // (전체 코드는 구현 시 위 싱글 테스트 패턴을 따른다)
});

// vitest의 vi.waitUntil 사용: import { vi } from 'vitest'; const vi_waitUntil = (p:()=>boolean)=>vi.waitUntil(p, {timeout:3000});
```

주의: 위 첫 테스트의 조언자 발언 수 단언은 구현 후 실제 mock 출력(조언자 3명)에 맞춰 `toBe(3)`으로 확정한다. Run → FAIL 확인.

- [ ] **Step 2: 구현** — 위 이식 지침 표에 따라 원본 engine.js 전체(16~368행)를 옮긴다. 클래스 구조·메서드명·분기·문구 호출(`line()`) 전부 유지. 추가분:
  - `onAlarm(tag)`: `turnTimeout:{roundNo}:{turnIdx}` 파싱 → 현재 라운드·턴과 일치할 때만 원본의 타임아웃 처리(skipped 추가 → sysMsg → 다음 턴) 실행
  - `resumeAfterRestore()`: `state==='PLAYING'`일 때 — phase가 `SITUATION`이면 `beginSpeeches()` 재킥, `PLAYER_TURNS`이고 현재 턴이 AI면 `nextTurn()` 재킥, `JUDGING`이면 `beginJudging()` 재실행 (idempotent 가드 유지)
  - `beginJudging`의 candidates 계산·`applyVerdict`·`standings`·`endByExhaustion`·`endSession`·`debug` 원본 그대로
- [ ] **Step 3: 테스트 통과 확인** — Run: `npm test --workspace @eotm/worker -- engine` → PASS
- [ ] **Step 4: 커밋** — `git commit -am "feat(worker): 게임 엔진 이식 — SSE 이벤트·alarm 타이머 기반"`

---

### Task 11: RoomDO — SSE·storage·alarm 배선

**Files:**
- Modify: `apps/worker/src/room-do.ts` (스텁 → 구현)
- Test: `apps/worker/test/room-do.test.ts`

**Interfaces:**
- Consumes: Engine/EngineBus(Task 10), state(Task 9), shared
- Produces — RoomDO 내부 HTTP API (Worker가 위임 호출):
  - `POST /create` `{ code, nick, config }` → `CreateRoomRes` (이미 존재하면 409)
  - `POST /join` `{ nick }` → `JoinRoomRes`
  - `POST /start` · `/next` `{ playerId, token }` → `{ok}|{error}`
  - `POST /speak` `{ playerId, token, text }` → `{ok}|{error}`
  - `POST /debug` `{ playerId, token, action }` → `{ok}|{error}`
  - `POST /leave` `{ playerId, token }` → `{ok}`
  - `GET /events?playerId=&token=` → SSE 스트림 (`text/event-stream`)

**구현 요점:**

```ts
// room-do.ts 골격 (전체 구현의 뼈대 — 세부는 아래 요점 목록)
import { Engine, type EngineBus } from './game/engine';
import { createRoomState, addPlayer, authPlayer, publicRoom, type RoomState } from './game/state';
import { ROOM_TTL_MS, type ServerEvent, type FeedItem, type SpeakTurn, type TimerInfo, type EndedPayload } from '@eotm/shared';
import { log } from './log';
import type { Env } from './env';

export class RoomDO implements DurableObject {
  room: RoomState | null = null;
  engine: Engine | null = null;
  sinks = new Set<ReadableStreamDefaultController<Uint8Array>>();
  lastTurn: SpeakTurn | null = null;   // 스냅샷용 최신값 캐시
  lastTimer: TimerInfo | null = null;
  lastEnded: EndedPayload | null = null;

  constructor(readonly ctx: DurableObjectState, readonly env: Env) {
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomState>('room');
      if (saved) {
        this.room = saved;
        this.engine = this.makeEngine(saved);
        this.engine.resumeAfterRestore();
      }
    });
  }
  // ... fetch 라우팅, makeEngine(bus 구현), alarm(), sse 인코딩
}
```

- **EngineBus 구현**: `emit(ev)` → `seq = ++room.seq` 부여, `kind==='feed'`면 `room.feed.push(item)`(최근 300개 슬라이스), `kind==='turn'/'timer'/'ended'`면 lastX 캐시 갱신, 전 sink에 `data: JSON.stringify(event)\n\n` 인코딩 push. `persist()` → `ctx.storage.put('room', this.room)`. `schedule(at, tag)` → `ctx.storage.put('alarmTag', tag)` + `ctx.storage.setAlarm(at)`. `cancelSchedule()` → `deleteAlarm` + tag 삭제. `delay(ms, fn)` → `setTimeout`.
- **SSE**: `new ReadableStream({ start(c){ 스냅샷 전송; sinks.add(c); }, cancel(c){ sinks.delete(c); } })`. 헤더 `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`. 스냅샷: `{kind:'snapshot', seq: room.seq, room: publicRoom(room), feed: room.feed, speakTurn: lastTurn, timer: lastTimer, ended: lastEnded}`. heartbeat: 20초 interval로 `: hb\n\n` 주석 push (스트림별 interval, cancel 시 clear). 접속 시 `setConnected(playerId, true)` + `log('info','sse_connect',...)`, cancel 시 `setConnected(false)` + disconnect 로그.
- **alarm()**: `alarmTag` 읽어 `cleanup`이면 `ctx.storage.deleteAll()`(방 소멸), `turnTimeout:*`이면 `engine.onAlarm(tag)`. 모든 액션 후 TTL 재예약: 활성 타이머가 없을 때 `setAlarm(lastActivity + ROOM_TTL_MS)` + tag `cleanup` — 단, 턴 타임아웃 알람이 활성일 땐 건드리지 않는다 (알람은 DO당 1개 — 턴 알람 처리 직후 TTL 알람을 다시 건다).
- **/create**: `storage.get('room')` 존재 시 409. `createRoomState` → 저장 → 엔진 생성 → `mode==='single'`이면 즉시 `engine.start(playerId)` (원본 index.js 73행 동작). `logger.roomCreated(...)`.
- **인증**: `/speak`·`/start`·`/next`·`/debug`·`/leave`는 `authPlayer(room, playerId, token)` 실패 시 401 + `STRINGS.errors.badAuth`.
- **SSE 접속/해제**: `logger.sseConnect/sseDisconnect`.
- **speech 로그**: handleSpeak 성공 경로에서 `logger.speechSubmitted({roomCode, roundNo, nick, text})` (스펙 §11 게임플레이 로그).

- [ ] **Step 1: 실패하는 테스트 작성** — `test/room-do.test.ts`

```ts
import { test, expect } from 'vitest';
import { env } from 'cloudflare:test';

function stub(code: string) {
  return env.ROOM_DO.get(env.ROOM_DO.idFromName(code));
}
async function post(s: DurableObjectStub, path: string, body: object) {
  const res = await s.fetch(`http://do${path}`, { method: 'POST', body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

test('생성→SSE 스냅샷→발언→판정 이벤트가 스트림에 흐른다 (싱글, mock AI)', async () => {
  const s = stub('TEST1');
  const create = await post(s, '/create', { code: 'TEST1', nick: '나', config: { mode: 'single', personaId: 'caocao' } });
  expect(create.status).toBe(200);
  const { playerId, token } = create.body as { playerId: string; token: string };

  const res = await s.fetch(`http://do/events?playerId=${playerId}&token=${token}`);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain('"kind":"snapshot"');

  // 내 순번이 될 때까지 이벤트 소비 후 발언 → verdict feed 수신 확인
  // (turn 이벤트에서 current === playerId 확인 후 /speak POST, 이후 verdict 타입 feed 대기)
  // 구현 시 보조 함수 readUntil(reader, predicate, timeoutMs)로 작성한다.
});

test('중복 생성은 409, 잘못된 토큰은 401', async () => {
  const s = stub('TEST2');
  await post(s, '/create', { code: 'TEST2', nick: '나', config: { mode: 'single', personaId: 'kimceo' } });
  expect((await post(s, '/create', { code: 'TEST2', nick: '또', config: { mode: 'single', personaId: 'kimceo' } })).status).toBe(409);
  expect((await post(s, '/speak', { playerId: 'x', token: 'y', text: 'ㅎ' })).status).toBe(401);
});
```

Run → FAIL 확인

- [ ] **Step 2: 구현** — 위 구현 요점대로. SSE 인코딩 헬퍼: `const enc = new TextEncoder(); const send = (c, ev) => c.enqueue(enc.encode('data: ' + JSON.stringify(ev) + '\n\n'));`
- [ ] **Step 3: 테스트 통과 확인** — Run: `npm test --workspace @eotm/worker -- room-do` → PASS
- [ ] **Step 4: 커밋** — `git commit -am "feat(worker): RoomDO — SSE 스트림·storage 영속·alarm 배선"`

---

### Task 12: Worker 라우팅 + rate limit + E2E 통합 테스트

**Files:**
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/test/e2e.test.ts`

**Interfaces:**
- Consumes: RoomDO(Task 11), QuotaDO(Task 8)
- Produces: 스펙 §5.1의 외부 REST 표면 전체 — `POST /api/rooms`, `POST /api/rooms/:code/{join,start,speak,next,leave,debug}`, `GET /api/rooms/:code/events`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/e2e.test.ts` (SELF.fetch로 외부 API만 사용해 싱글 1라운드 완주)

```ts
import { test, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

async function api(path: string, body?: object) {
  const res = await SELF.fetch(`http://x/api${path}`, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  return { status: res.status, res };
}

test('E2E: 방 생성 → SSE 구독 → 발언 → 판정 수신 (mock AI)', async () => {
  const { res: createRes } = await api('/rooms', { nick: '테스터', config: { mode: 'single', personaId: 'caocao' } });
  const { code, playerId, token } = await createRes.json() as { code: string; playerId: string; token: string };
  expect(code).toMatch(/^[A-Z2-9]{4}$/);

  const { res: sse } = await api(`/rooms/${code}/events?playerId=${playerId}&token=${token}`);
  expect(sse.headers.get('content-type')).toContain('text/event-stream');
  // readUntil 헬퍼(Task 11 테스트와 공유 — test/helpers.ts로 추출)로
  // turn(current===playerId) 대기 → POST /speak → feed(type==='verdict') 대기 → 통과
});

test('방 생성 rate limit: 같은 IP 연속 생성 제한(분당 5)', async () => {
  const mk = () => api('/rooms', { nick: 'x', config: { mode: 'single', personaId: 'kimceo' } });
  for (let i = 0; i < 5; i++) expect((await mk()).status).toBe(200);
  expect((await mk()).status).toBe(429);
});

test('존재하지 않는 방 join은 404', async () => {
  expect((await api('/rooms/ZZZZ/join', { nick: 'x' })).status).toBe(404);
});
```

Run → FAIL 확인

- [ ] **Step 2: index.ts에 라우팅 추가**

```ts
// POST /api/rooms — 방 생성. IP당 분당 5회 rate limit (QuotaDO).
app.post('/api/rooms', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const quota = c.env.QUOTA_DO.get(c.env.QUOTA_DO.idFromName('global'));
  const rl = await quota.fetch('http://do/incr', {
    method: 'POST',
    body: JSON.stringify({ key: `room-create:${ip}`, limit: 5, ttlMs: 60_000 }),
  }).then((r) => r.json() as Promise<{ ok: boolean }>);
  if (!rl.ok) return c.json({ error: STRINGS.errors.rateLimited }, 429); // 문구는 content에서

  const body = await c.req.json();
  // 코드 충돌 시 재시도 (DO /create가 409를 돌려줌)
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    const room = c.env.ROOM_DO.get(c.env.ROOM_DO.idFromName(code));
    const res = await room.fetch('http://do/create', { method: 'POST', body: JSON.stringify({ ...body, code }) });
    if (res.status !== 409) return new Response(res.body, res);
  }
  return c.json({ error: STRINGS.errors.codeAllocFail }, 503);
});

// /api/rooms/:code/* — RoomDO로 위임 (GET events 포함)
app.all('/api/rooms/:code/:action', (c) => {
  const code = c.req.param('code').toUpperCase();
  const room = c.env.ROOM_DO.get(c.env.ROOM_DO.idFromName(code));
  const url = new URL(c.req.raw.url);
  return room.fetch(`http://do/${c.req.param('action')}${url.search}`, c.req.raw);
});
```

`genCode`는 state.ts에서 import. RoomDO의 `/join` 등은 room 미존재 시 404를 돌려주도록 Task 11 구현에 포함되어 있어야 한다 (`this.room === null` 가드).

- [ ] **Step 3: 테스트 통과 확인** — Run: `npm test --workspace @eotm/worker` → 전체 PASS
- [ ] **Step 4: 커밋** — `git commit -am "feat(worker): 외부 REST 라우팅 + rate limit + E2E 통합 테스트"`

---

### Task 13: web 스캐폴딩 — SSE 클라이언트·store

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`
- Create: `apps/web/src/api/actions.ts`, `src/api/sse.ts`, `src/store.ts`
- Create: `apps/worker/.dev.vars` (로컬 전용 — `.env` 값 복사, 커밋 금지)
- Test: `apps/web/test/store.test.ts`

**Interfaces:**
- Consumes: `ServerEvent`·API 타입 (@eotm/shared)
- Produces: `useGame() -> { state, actions }` — **원본 store.js와 동일한 소비 인터페이스** (화면 이식 diff 최소화):
  - `state`: `{ connected, code, playerId, room, phase, timer, feed, speakTurn, ended, toast }` — `feed` 아이템에 `_k` 키 부여(원본과 동일), `timer`는 `{phase, remaining, total} | null` (deadline에서 로컬 계산)
  - `actions`: `{ createRoom(nick, config), joinRoom(code, nick), start(), speak(text), nextRound(), debugAction(action), toast(msg) }` — create/join/start/next는 `{ok}|{error}`를 resolve하는 Promise

- [ ] **Step 1: 패키지·설정 파일**

package.json:

```json
{
  "name": "@eotm/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1", "@eotm/shared": "*" },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1", "vite": "^5.3.4",
    "typescript": "^5.5.0", "vitest": "^2.0.0",
    "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0"
  }
}
```

vite.config.ts — dev 프록시를 wrangler(8787)로:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787' } },
  },
});
```

tsconfig.json: base 상속 + `"jsx": "react-jsx"`, `"allowJs": true` (이식 .jsx 허용), include `["src", "test"]`.

- [ ] **Step 2: 실패하는 테스트 작성** — `test/store.test.ts` (리듀서 순수 부분)

```ts
import { test, expect } from 'vitest';
import { reducer, initialState } from '../src/store';
import type { ServerEvent } from '@eotm/shared';

const snap = {
  kind: 'snapshot', seq: 5,
  room: { code: 'AB12', phase: 'PLAYER_TURNS' } as never,
  feed: [{ type: 'system', text: '안녕', ts: 1 }],
  speakTurn: { current: 'p1', nick: '나', speakTime: 0 },
  timer: null, ended: null,
} satisfies ServerEvent;

test('snapshot은 feed를 리셋하고 상태를 채운다', () => {
  const s = reducer(initialState, { type: 'server', ev: snap });
  expect(s.room?.code).toBe('AB12');
  expect(s.feed.length).toBe(1);
  expect(s.speakTurn?.current).toBe('p1');
});

test('feed 이벤트는 누적되고 _k가 부여된다', () => {
  let s = reducer(initialState, { type: 'server', ev: snap });
  s = reducer(s, { type: 'server', ev: { kind: 'feed', seq: 6, item: { type: 'system', text: '둘', ts: 2 } } });
  expect(s.feed.length).toBe(2);
  expect(s.feed[1]).toHaveProperty('_k');
});

test('중복 seq는 무시한다 (재접속 스냅샷 직후 이벤트 중복 방지)', () => {
  let s = reducer(initialState, { type: 'server', ev: snap });
  s = reducer(s, { type: 'server', ev: { kind: 'feed', seq: 5, item: { type: 'system', text: '중복', ts: 2 } } });
  expect(s.feed.length).toBe(1);
});

test('timer 이벤트는 deadline 원본을 저장한다', () => {
  let s = reducer(initialState, { type: 'server', ev: snap });
  s = reducer(s, { type: 'server', ev: { kind: 'timer', seq: 7, timer: { phase: 'PLAYER_TURNS', deadline: Date.now() + 60000, total: 60 } } });
  expect(s.deadline?.total).toBe(60);
});
```

Run: `npm test --workspace @eotm/web` / Expected: FAIL

- [ ] **Step 3: api/actions.ts + api/sse.ts**

```ts
// actions.ts — REST 액션 래퍼. 실패는 { error } 객체로 정규화.
export async function post<T>(path: string, body: object): Promise<T | { error: string }> {
  try {
    const res = await fetch(`/api${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return await res.json() as T | { error: string };
  } catch {
    return { error: '서버에 연결할 수 없습니다.' };
  }
}
```

```ts
// sse.ts — EventSource 구독. 자동 재접속은 브라우저 내장, 재접속 시 서버가 스냅샷을 다시 준다.
import type { ServerEvent } from '@eotm/shared';

export function subscribe(code: string, playerId: string, token: string, handlers: {
  onEvent: (ev: ServerEvent) => void;
  onOpen: () => void;
  onError: () => void;
}): () => void {
  const es = new EventSource(`/api/rooms/${code}/events?playerId=${playerId}&token=${token}`);
  es.onopen = handlers.onOpen;
  es.onerror = handlers.onError;
  es.onmessage = (e) => handlers.onEvent(JSON.parse(e.data) as ServerEvent);
  return () => es.close();
}
```

- [ ] **Step 4: store.ts 구현** — `reducer`/`initialState` export(테스트 대상) + `useGame()`. 리듀서는 `ServerEvent`를 원본 state 형태로 사상:
  - `snapshot` → room·feed(리셋, `_k` 재부여)·speakTurn·deadline·ended 일괄 반영, `lastSeq` 갱신
  - `ev.seq <= lastSeq`면 무시 / `room`→room·phase / `phase`→phase (+`speakTurn` 초기화, 원본 44행 동작) / `turn`→speakTurn / `timer`→`deadline` 저장 / `feed`→push(`_k`, 최근 300) / `ended`→ended
  - `useGame()`: 세션은 `sessionStorage['eotm.session']` `{code, playerId, token}`. 마운트 시 세션 있으면 subscribe. `timer`는 500ms interval로 `deadline`에서 `{phase, remaining: Math.max(0, Math.ceil((deadline-now)/1000)), total}` 계산해 파생(원본과 동일한 소비 형태). actions는 Interfaces 절 시그니처대로 — `createRoom`은 `POST /rooms` 성공 시 세션 저장+subscribe, `speak`은 `POST /rooms/:code/speak` 결과 `{error}`면 toast.
- [ ] **Step 5: App.tsx + main.tsx** — 원본 App.jsx에서 debate 분기 제거:

```tsx
import { useGame } from './store';
import Home from './screens/Home.jsx';
import Lobby from './screens/Lobby.jsx';
import Game from './screens/Game.jsx';

export default function App() {
  const { state, actions } = useGame();
  let screen;
  if (!state.room) screen = <Home state={state} actions={actions} />;
  else if (state.room.state === 'LOBBY') screen = <Lobby state={state} actions={actions} />;
  else screen = <Game state={state} actions={actions} />;
  return (
    <div className="app">
      {!state.connected && state.room && <div className="conn-banner">서버 연결 중…</div>}
      {state.toast && <div className="toast">{state.toast}</div>}
      {screen}
    </div>
  );
}
```

(이 시점엔 screens/*.jsx가 없어 빌드가 깨진다 — Step 6에서 빈 플레이스홀더 3개를 만들어 두고 Task 14가 실제 이식으로 교체: `export default function Home(){ return null; }` 형태.)

- [ ] **Step 6: .dev.vars 생성** — `apps/worker/.dev.vars`에 루트 `.env`의 `GOOGLE_AI_STUDIO_API_KEY`·`NVIDIA_API_KEY` 값을 복사한다(수동). `git status`로 두 파일 모두 untracked에 없음을 확인.
- [ ] **Step 7: 테스트·빌드 확인** — Run: `npm test --workspace @eotm/web` → PASS, `npm run build --workspace @eotm/web` → dist 생성
- [ ] **Step 8: 커밋** — `git add apps/web package-lock.json && git commit -m "feat(web): SSE 클라이언트·store — 원본 useGame 인터페이스 유지"`

---

### Task 14: web 화면 이식

**Files:**
- Create: `apps/web/src/screens/{Home,Lobby,Game}.jsx`, `src/components/{ComicCuts,EmployeeFrame,Feed,ActionBar,VerdictCard}.jsx`, `src/comic-assets.js`, `src/comic.css`, `src/styles.css`, `public/` 에셋

**Interfaces:**
- Consumes: `useGame()`의 state/actions (Task 13 — 원본과 동일 형태)
- Produces: 완성된 SPA. 빌드 산출물이 worker assets로 서빙됨.

- [ ] **Step 1: 원본 파일 복사** — `C:\Users\user\ai-debate-game\client\src\`에서:
  - `screens/Home.jsx`, `screens/Lobby.jsx`, `screens/SycoGame.jsx`(→`Game.jsx`), `components/{ComicCuts,EmployeeFrame,Feed,SycoActionBar(→ActionBar),SycoVerdictCard(→VerdictCard)}.jsx`, `comic-assets.js`, `comic.css`, `styles.css`, `client/public/` 전체(만화 에셋)
  - 복사하지 않는 것: `Game.jsx`(토론), `Header/Sidebar/ResultCard/ActionBar(토론용)`, `socket.js`
- [ ] **Step 2: 기계적 치환** (전 파일 일괄):
  - import 경로: `SycoActionBar`→`ActionBar`, `SycoVerdictCard`→`VerdictCard`, `SycoGame`→`Game`
  - feed 타입 문자열: `'syco-verdict'`→`'verdict'`, `'syco-epilogue'`→`'epilogue'`
  - `actions.createSycoRoom(...)`→`actions.createRoom(...)` (Home.jsx)
  - Home.jsx에서 토론 게임 생성·입장 UI 블록 제거 — "이달의 사원" 단일 진입 플로우로 정리 (게임 선택 메뉴 삭제, 간신배 설정 폼을 홈 기본으로)
  - styles.css에서 토론 전용 셀렉터(`.debate-`, `.pick-`, `.claim-` 등) 블록 제거 — 남은 클래스가 실제 사용되는지 `grep`으로 확인하며 정리
  - 서비스명 표기: 화면 타이틀·index.html `<title>`을 "이달의 사원"으로
- [ ] **Step 3: 동작 확인 (로컬 통합)** — 터미널 2개:
  - `npm run build --workspace @eotm/web && npm run dev` (wrangler dev, 8787) → 브라우저에서 `http://localhost:8787` 접속, 싱글 게임 1라운드 완주 (mock 또는 실키)
  - Expected: 홈 → 페르소나 선택 → 게임 화면 → 조언자 만화 컷 → 발언 → 판정 카드 → 에필로그
- [ ] **Step 4: 커밋** — `git add apps/web && git commit -m "feat(web): 게임 화면·만화 UI 이식"`

---

### Task 15: 스모크 E2E + README + 배포

**Files:**
- Create: `scripts/smoke.mjs`, `README.md`
- Modify: 루트 `package.json` (smoke 스크립트 추가)

**Interfaces:**
- Consumes: 외부 REST API 전체
- Produces: `npm run smoke` — wrangler dev(또는 배포 URL) 대상 헤드리스 1라운드 완주 검증. 프로덕션 배포.

- [ ] **Step 1: scripts/smoke.mjs 작성** — 원본 `scripts/syco-smoke.mjs`의 시나리오를 REST/SSE로 재작성:

```js
// 헤드리스 스모크: 싱글 1라운드 완주. BASE_URL 대상 (기본 wrangler dev).
const BASE = process.env.BASE_URL || 'http://localhost:8787';

async function post(path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

const health = await (await fetch(`${BASE}/api/health`)).json();
console.log('health:', JSON.stringify(health));

const { code, playerId, token } = await post('/rooms', { nick: '스모크', config: { mode: 'single', personaId: 'caocao' } });
if (!code) throw new Error('방 생성 실패');
console.log('room:', code);

const es = await fetch(`${BASE}/api/rooms/${code}/events?playerId=${playerId}&token=${token}`);
const reader = es.body.getReader();
const dec = new TextDecoder();
let buf = '';
let spoke = false;
const deadline = Date.now() + 120_000;

while (Date.now() < deadline) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let idx;
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
    if (!chunk.startsWith('data: ')) continue;
    const ev = JSON.parse(chunk.slice(6));
    if (ev.kind === 'turn' && ev.turn?.current === playerId && !spoke) {
      spoke = true;
      await post(`/rooms/${code}/speak`, { playerId, token, text: '실리와 명분을 모두 취하는 길이 있습니다.' });
      console.log('발언 완료');
    }
    if (ev.kind === 'feed' && ev.item?.type === 'verdict') {
      console.log('판정 수신:', ev.item.verdict.adoptedKey, '(source:', ev.item.source + ')');
      console.log('SMOKE PASS');
      process.exit(0);
    }
  }
}
throw new Error('SMOKE FAIL: 판정 미수신');
```

루트 package.json scripts에 `"smoke": "node scripts/smoke.mjs"` 추가.

- [ ] **Step 2: 스모크 실행** — `npm run dev` 띄운 상태에서 Run: `npm run smoke` / Expected: `SMOKE PASS`
- [ ] **Step 3: README.md 작성** — 프로젝트 소개(서비스명·게임 규칙 한 단락), 모노레포 구조 표, 로컬 개발(`npm install` → `.dev.vars` 준비 → `npm run dev` + `npm run dev:web`), 테스트(`npm test`), 배포 절차(아래), 콘텐츠 팩 추가 방법(폴더 추가 → `npm run gen -w @eotm/content`), 스펙·플랜 문서 링크.
- [ ] **Step 4: 프로덕션 배포**

```bash
npx wrangler secret put GOOGLE_AI_STUDIO_API_KEY --config apps/worker/wrangler.jsonc   # .env 값 입력
npx wrangler secret put NVIDIA_API_KEY --config apps/worker/wrangler.jsonc
npm run deploy
```

Expected: `https://employee-of-the-month.<account>.workers.dev` 출력

- [ ] **Step 5: 배포 검증** — Run: `BASE_URL=https://employee-of-the-month.<account>.workers.dev npm run smoke` → `SMOKE PASS`, `curl <URL>/api/health` → providers `{gemini: true, nvidia: true}`. 브라우저로 1판 플레이. `wrangler tail`로 `llm_call` 로그에 provider·latencyMs 찍히는지 확인.
- [ ] **Step 6: 커밋·푸시** — `git add -A && git commit -m "feat: 스모크 E2E·README·배포" && git push`

---

## Self-Review 결과

- **스펙 커버리지**: §3 아키텍처(Task 10·11), §4 구조(1~3), §5 계약(2·11·12), §6 도메인(5·6·8·10), §7 안전장치(7·8·12), §8 테스트(각 Task+15), §10 배포(4·15), §11 로깅(4·7·11) — 커버됨. CI/CD·커스텀 도메인은 스펙 §12 범위 제외와 일치.
- **타입 일관성**: `Candidate`(prompts.ts 정의)를 verdict/orchestrate가 공유. `source` 값 집합 `'gemini'|'nvidia'|'mock'|'mock(fallback)'` 일관. `EngineBus.emit`은 `Omit<ServerEvent,'seq'>` — RoomDO가 seq 부여.
- **주의 지점**: Task 10·11의 원본 이식 단계는 원본 파일 직접 참조가 전제 — 원본 저장소 경로가 없으면 진행 불가하니 작업 전 존재 확인.
