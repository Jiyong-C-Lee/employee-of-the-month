// sseTransport 계약 — 접속 즉시 onOpen이 그 연결에만 프레임을 밀 수 있어야 한다.
// 이게 없어서 eotm이 이전 판 SSETransport를 못 썼다(스펙 §1).
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

function stubFor(name: string) {
  return env.TEST_DO.get(env.TEST_DO.idFromName(name));
}

// SSE 스트림에서 data 프레임 n개를 읽어 파싱한다. 하트비트 주석(': hb')은 건너뛴다.
async function readFrames(res: Response, n: number, timeoutMs = 5000): Promise<unknown[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const out: unknown[] = [];
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (out.length < n && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) out.push(JSON.parse(line.slice(6)));
    }
  }
  await reader.cancel();
  return out;
}

async function call(stub: ReturnType<typeof stubFor>, body: object) {
  const res = await stub.fetch('http://do/', { method: 'POST', body: JSON.stringify(body) });
  return (await res.json()) as Record<string, unknown>;
}

describe('sseTransport', () => {
  it('접속 즉시 onOpen이 그 연결에만 스냅샷을 민다', async () => {
    const stub = stubFor('sse-onopen');
    const res = await stub.fetch('http://do/sse');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await readFrames(res, 1)).toEqual([{ kind: 'snapshot' }]);
  });

  it('broadcast가 붙어 있는 모든 연결에 간다', async () => {
    const stub = stubFor('sse-broadcast');
    const a = await stub.fetch('http://do/sse');
    const b = await stub.fetch('http://do/sse');
    await call(stub, { action: 'broadcast', value: { n: 1 } });
    // 첫 프레임은 onOpen 스냅샷, 두 번째가 broadcast다.
    expect(await readFrames(a, 2)).toEqual([{ kind: 'snapshot' }, { n: 1 }]);
    expect(await readFrames(b, 2)).toEqual([{ kind: 'snapshot' }, { n: 1 }]);
  });

  it('Conn.data를 setData로 심고 다시 읽는다', async () => {
    const stub = stubFor('sse-seat');
    const res = await stub.fetch('http://do/sse?seat=p1');
    // onOpen이 setData({ playerId }) 후 그 값을 프레임으로 되쏜다.
    expect(await readFrames(res, 2)).toEqual([{ kind: 'snapshot' }, { seat: { playerId: 'p1' } }]);
  });
});
