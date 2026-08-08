// wsTransport 계약 — 업그레이드 거부·onMessage 왕복·Conn.data(serializeAttachment) 보존·broadcast.
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { fakeTransport } from '../src/transport-fake';

function stubFor(name: string) {
  return env.TEST_DO.get(env.TEST_DO.idFromName(name));
}

async function openWs(stub: ReturnType<typeof stubFor>): Promise<WebSocket> {
  const res = await stub.fetch('http://do/ws', { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  return ws;
}

function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS 메시지 타임아웃')), timeoutMs);
    ws.addEventListener(
      'message',
      (ev) => {
        clearTimeout(timer);
        resolve(JSON.parse(String((ev as MessageEvent).data)));
      },
      { once: true },
    );
  });
}

describe('wsTransport', () => {
  it('Upgrade 헤더가 없으면 426을 준다', async () => {
    const res = await stubFor('ws-no-upgrade').fetch('http://do/ws');
    expect(res.status).toBe(426);
    await res.text();
  });

  it('onMessage로 받은 것을 그대로 되쏜다', async () => {
    const ws = await openWs(stubFor('ws-echo'));
    const got = nextMessage(ws);
    ws.send(JSON.stringify({ t: 'ping' }));
    expect(await got).toEqual({ echo: { t: 'ping' } });
    ws.close();
  });

  it('setData로 심은 좌석이 다음 메시지에서도 읽힌다', async () => {
    const ws = await openWs(stubFor('ws-seat'));
    const first = nextMessage(ws);
    ws.send(JSON.stringify({ t: 'seat', playerId: 'p7' }));
    expect(await first).toEqual({ echo: { t: 'seat', playerId: 'p7' } });
    const second = nextMessage(ws);
    ws.send(JSON.stringify({ t: 'whoami' }));
    expect(await second).toEqual({ seat: { playerId: 'p7' } });
    ws.close();
  });

  it('broadcast가 붙어 있는 모든 소켓에 간다', async () => {
    const stub = stubFor('ws-broadcast');
    const a = await openWs(stub);
    const b = await openWs(stub);
    const gotA = nextMessage(a);
    const gotB = nextMessage(b);
    const res = await stub.fetch('http://do/', {
      method: 'POST',
      body: JSON.stringify({ action: 'wsBroadcast', value: { n: 2 } }),
    });
    await res.json();
    expect(await gotA).toEqual({ n: 2 });
    expect(await gotB).toEqual({ n: 2 });
    a.close();
    b.close();
  });
});

describe('fakeTransport', () => {
  it('DO 없이 broadcast를 모으고 Conn을 내준다', async () => {
    const seen: string[] = [];
    const tp = fakeTransport({
      onOpen: (c) => c.send({ kind: 'hello' }),
      onMessage: (_c, raw) => {
        seen.push(raw);
      },
    });
    const conn = tp.open();
    conn.setData({ playerId: 'p1' });
    expect(conn.data).toEqual({ playerId: 'p1' });
    expect(tp.received(conn)).toEqual([{ kind: 'hello' }]);
    tp.broadcast({ n: 1 });
    expect(tp.sent).toEqual([{ n: 1 }]);
    expect(tp.received(conn)).toEqual([{ kind: 'hello' }, { n: 1 }]);
    expect(seen).toEqual([]); // onMessage는 전송이 부르지 않는다
  });
});
