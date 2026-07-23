// 참모 발언 샘플 생성기 — 게임 서버 없이 실제 프롬프트 조립 + Gemini 호출로 대사를 뽑아 저장한다.
// 페르소나/프롬프트를 고친 뒤 결과 품질을 눈으로 검수(모범답안 선별)하는 용도.
//
// 사용법:  node scripts/sample-advisors.mjs [--pack caocao|liubei] [--count 5] [--difficulty normal] [--model gemini-3.5-flash-lite]
//   키는 apps/worker/.dev.vars 의 GOOGLE_AI_STUDIO_API_KEY 를 읽는다.
//   결과: docs/samples/advisor-samples-<pack>.md
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- 인자 ----
const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const packFilter = argOf('pack', null);
const count = Number(argOf('count', '5'));
const difficulty = argOf('difficulty', 'normal');

// ---- .dev.vars 파싱 ----
const devVars = Object.fromEntries(
  readFileSync(join(ROOT, 'apps/worker/.dev.vars'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = devVars.GOOGLE_AI_STUDIO_API_KEY;
if (!KEY) {
  console.error('GOOGLE_AI_STUDIO_API_KEY가 apps/worker/.dev.vars에 없습니다.');
  process.exit(1);
}
const MODEL = argOf('model', devVars.GEMINI_MODEL || 'gemini-flash-lite-latest');

// ---- 콘텐츠 로드 (worker의 prompts.ts 조립 로직을 그대로 재현) ----
const PROMPTS = JSON.parse(readFileSync(join(ROOT, 'packages/content/global/prompts.json'), 'utf8'));
const loadPack = (id) => ({
  persona: JSON.parse(readFileSync(join(ROOT, `packages/content/packs/${id}/persona.json`), 'utf8')),
  situations: JSON.parse(readFileSync(join(ROOT, `packages/content/packs/${id}/situations.json`), 'utf8')),
});
const PACK_IDS = readdirSync(join(ROOT, 'packages/content/packs'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((id) => !packFilter || id === packFilter);

const fmt = (tpl, vars = {}) => {
  const s = Array.isArray(tpl) ? tpl.join('\n') : String(tpl ?? '');
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
};

// apps/worker/src/game/logic.ts pickQuirks와 동일 (직전 제외는 라운드 연쇄가 없으니 생략)
const QUIRK_NONE_P = 0.3;
const pickQuirks = (advisors) =>
  Object.fromEntries(advisors.map((a) => [
    a.name,
    Math.random() < QUIRK_NONE_P ? null : a.quirks[Math.floor(Math.random() * a.quirks.length)],
  ]));

// apps/worker/src/game/logic.ts pickRoundAdvisors와 동일 — 풀에서 라운드 출전 인원만 발탁
const ADVISORS_PER_ROUND = 3;
const pickRoundAdvisors = (advisors, n = ADVISORS_PER_ROUND) => {
  if (advisors.length <= n) return [...advisors];
  const chosen = new Set();
  while (chosen.size < n) chosen.add(Math.floor(Math.random() * advisors.length));
  return advisors.filter((_, i) => chosen.has(i));
};

// apps/worker/src/game/logic.ts pickApproaches와 동일 — 해법 축도 코드가 배정
const pickApproaches = (names, approaches) => {
  const pool = [...approaches].sort(() => Math.random() - 0.5);
  return Object.fromEntries(names.map((name, i) => [name, pool[i % pool.length]]));
};

const advisorBatchSystem = (persona, advisors, quirks, approaches) => {
  const advisorRoster = advisors
    .map((a, i) => {
      const quirk = quirks[a.name];
      const voice = a.voice ? ` / 말투: ${a.voice}` : '';
      const axis = approaches[a.name] ? ` / 이번 해법 축: ${approaches[a.name]}` : '';
      return `${i + 1}. ${a.name} (${a.style}) — 성향: ${a.core}${voice}${axis} / 이번 버릇: ${quirk ?? '없음 — 안건에만 집중한다'}`;
    })
    .join('\n');
  return fmt(PROMPTS.advisorBatchSystem, {
    personaName: persona.name,
    listenerBrief: persona.listenerBrief || persona.intro,
    advisorRoster,
    flaw: PROMPTS.difficulty[difficulty] ?? PROMPTS.difficulty.normal,
  });
};

const advisorBatchUser = (persona, situation) => [
  '# 상황',
  situation.text,
  `# ${persona.name}의 물음: ${situation.question}`,
].join('\n');

// apps/worker/src/ai/prompts.ts epilogueSystem/User와 동일 — 채택안 이후 이야기도 같은 파일에서 검수한다
const epilogueSystem = (persona) => fmt(PROMPTS.epilogueSystem, { personaName: persona.name, personaIntro: persona.intro });
const epilogueUser = (persona, situation, adopted) => [
  '# 상황', situation.text, `# 물음: ${situation.question}`, '', `# 채택된 간언 (${adopted.name})`, adopted.text,
].join('\n');
const epilogueSchema = { type: 'object', properties: { story: { type: 'string' } }, required: ['story'] };

const advisorBatchSchema = (n) => ({
  type: 'object',
  properties: {
    speeches: {
      type: 'array',
      minItems: n,
      maxItems: n,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          text: { type: 'string' },
          approach: { type: 'string' },
        },
        required: ['name', 'text', 'approach'],
      },
    },
  },
  required: ['speeches'],
});

// ---- Gemini 호출 (apps/worker/src/ai/providers/gemini.ts 재현) ----
const toGeminiSchema = (node) => {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) =>
      [k, k === 'type' && typeof v === 'string' ? v.toUpperCase() : toGeminiSchema(v)]));
  }
  return node;
};

async function callGemini(system, user, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema), temperature: 1.0 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  return JSON.parse(text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 실행 ----
mkdirSync(join(ROOT, 'docs/samples'), { recursive: true });

for (const id of PACK_IDS) {
  const { persona, situations } = loadPack(id);
  // 상황을 무작위로 count개 뽑는다 (중복 없이)
  const picked = [...situations].sort(() => Math.random() - 0.5).slice(0, Math.min(count, situations.length));
  const out = [
    `# 참모 발언 샘플 — ${persona.name} (${id})`,
    '',
    `- 모델: ${MODEL} / 난이도: ${difficulty} / 생성일: ${new Date().toISOString().slice(0, 10)}`,
    `- 라운드마다 참모별 버릇을 코드가 샘플링한다 (없음 확률 ${QUIRK_NONE_P * 100}%).`,
    '- 마음에 드는 발언에 ✅, 별로면 ❌ 표시해두면 프롬프트·버릇 튜닝에 쓴다.',
    '',
  ];

  for (let i = 0; i < picked.length; i++) {
    const situation = picked[i];
    const roundAdvisors = pickRoundAdvisors(persona.advisors);
    const quirks = pickQuirks(roundAdvisors);
    const approaches = pickApproaches(roundAdvisors.map((a) => a.name), PROMPTS.approaches);
    process.stdout.write(`[${id}] ${i + 1}/${picked.length} "${situation.question}" ... `);
    try {
      const r = await callGemini(
        advisorBatchSystem(persona, roundAdvisors, quirks, approaches),
        advisorBatchUser(persona, situation),
        advisorBatchSchema(roundAdvisors.length),
      );
      out.push(`## ${i + 1}. ${situation.question}`, '', `> ${situation.text}`, '');
      out.push('이번 라운드 출전·축·버릇:');
      for (const a of roundAdvisors) out.push(`- ${a.name} [${approaches[a.name]}]: ${quirks[a.name] ?? '(없음 — 안건 집중)'}`);
      out.push('');
      for (const s of r.speeches) {
        const adv = persona.advisors.find((a) => a.name === s.name);
        out.push(`- ${adv?.emoji ?? ''} **${s.name}** [${approaches[s.name] ?? s.approach}]  `, `  ${s.text}`);
      }
      // 무작위 발언 하나를 채택안 삼아 에필로그까지 생성 — 시점 이탈(타사 무대 표류) 같은 결함을 함께 검수
      const adopted = r.speeches[Math.floor(Math.random() * r.speeches.length)];
      try {
        await sleep(2000);
        const ep = await callGemini(epilogueSystem(persona), epilogueUser(persona, situation, adopted), epilogueSchema);
        out.push('', `> 📖 그 후 이야기 (채택: ${adopted.name})  `, `> ${ep.story}`);
      } catch (e) {
        out.push('', `(에필로그 실패: ${e.message})`);
      }
      out.push('');
      console.log('ok');
    } catch (e) {
      out.push(`## ${i + 1}. ${situation.question}`, '', `(호출 실패: ${e.message})`, '');
      console.log(`실패 — ${e.message}`);
    }
    await sleep(2500); // 무료 티어 레이트리밋 여유
  }

  const file = join(ROOT, `docs/samples/advisor-samples-${id}.md`);
  writeFileSync(file, out.join('\n'), 'utf8');
  console.log(`저장: docs/samples/advisor-samples-${id}.md`);
}
