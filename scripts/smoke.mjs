// 헤드리스 스모크 E2E: 싱글 모드 1라운드 완주(방 생성 → SSE 구독 → 내 차례 발언 → 판정 수신)를 검증한다.
// 대상은 BASE_URL(기본 로컬 wrangler dev). 원본 scripts/syco-smoke.mjs의 시나리오를 REST/SSE 계약으로 재작성.
const BASE = process.env.BASE_URL || 'http://localhost:8787';
const TIMEOUT_MS = 120_000;

async function post(path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`POST ${path} 실패(${res.status}): ${JSON.stringify(json)}`);
  return json;
}

const health = await (await fetch(`${BASE}/api/health`)).json();
console.log('health:', JSON.stringify(health));

const { code, playerId, token } = await post('/rooms', {
  nick: '스모크',
  config: { mode: 'single', personaId: 'caocao' },
});
if (!code) throw new Error('방 생성 실패: code 없음');
console.log('room:', code, 'player:', playerId);

const controller = new AbortController();
const hardCutoff = setTimeout(() => controller.abort(), TIMEOUT_MS);

const es = await fetch(
  `${BASE}/api/rooms/${code}/events?playerId=${playerId}&token=${token}`,
  { signal: controller.signal },
);
if (!es.ok || !es.body) throw new Error(`SSE 구독 실패: ${es.status}`);
const reader = es.body.getReader();
const dec = new TextDecoder();
let buf = '';
let spoke = false;

try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!chunk.startsWith('data: ')) continue; // heartbeat(: hb) 등 주석 프레임 제외
      const ev = JSON.parse(chunk.slice(6));

      if (ev.kind === 'turn' && ev.turn?.current === playerId && !spoke) {
        spoke = true;
        await post(`/rooms/${code}/speak`, { playerId, token, text: '실리와 명분을 모두 취하는 길이 있습니다.' });
        console.log('발언 완료');
      }
      if (ev.kind === 'feed' && ev.item?.type === 'verdict') {
        console.log('판정 수신:', ev.item.verdict.adoptedKey, '(source:', ev.item.source + ')');
        clearTimeout(hardCutoff);
        console.log('SMOKE PASS');
        process.exit(0);
      }
    }
  }
} catch (e) {
  if (controller.signal.aborted) throw new Error('SMOKE FAIL: 타임아웃(120s) 내 판정 미수신');
  throw e;
}
throw new Error('SMOKE FAIL: 스트림 종료(판정 미수신)');
