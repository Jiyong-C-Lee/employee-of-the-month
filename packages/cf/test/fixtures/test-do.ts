// 부품 계약 검증용 DO. 게임 로직은 없다 — action 문자열로 각 부품을 왕복시킨다.
// wrangler.jsonc(테스트 전용)의 TEST_DO 바인딩이 이 클래스를 가리킨다.
//
// 응답 본문은 호출측이 항상 끝까지 읽어야 한다. 안 읽으면 vitest-pool-workers의 격리
// storage teardown이 Windows에서 EBUSY로 실패한다(기존 room-do.test.ts 주석의 제약 그대로).
import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { doRoomStore } from '../../src/room-store.js';
import { doAlarms } from '../../src/alarms.js';
import { sseTransport } from '../../src/transport-sse.js';
import { wsTransport, type WsTransport } from '../../src/transport-ws.js';
import type { Alarms, RoomStore, Transport } from '../../src/interfaces.js';

export const TEST_TTL_MS = 1000;

type TestEnv = Record<string, unknown>;

type Body = { action?: string; value?: unknown; tag?: string; time?: number };

export class TestDO extends DurableObject<TestEnv> {
  private readonly store: RoomStore<unknown>;
  private readonly alarms: Alarms;
  private readonly sse: Transport;
  private readonly ws: WsTransport;
  private seatHint: string | null = null;
  lastTag: string | null = null;

  constructor(ctx: DurableObjectState, env: TestEnv) {
    super(ctx, env);
    this.store = doRoomStore<unknown>(ctx);
    this.alarms = doAlarms(ctx, { ttlMs: TEST_TTL_MS });
    this.sse = sseTransport({
      onOpen: (conn) => {
        conn.send({ kind: 'snapshot' });
        if (this.seatHint) {
          conn.setData({ playerId: this.seatHint });
          conn.send({ seat: conn.data });
        }
      },
    });
    this.ws = wsTransport(ctx, {
      onMessage: (conn, raw) => {
        const msg = JSON.parse(raw) as { t?: string; playerId?: string };
        if (msg.t === 'seat') conn.setData({ playerId: msg.playerId });
        if (msg.t === 'whoami') {
          conn.send({ seat: conn.data });
          return;
        }
        conn.send({ echo: msg });
      },
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/sse') {
      this.seatHint = url.searchParams.get('seat');
      return this.sse.attach(req);
    }
    if (url.pathname === '/ws') return this.ws.attach(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    switch (body.action) {
      case 'save':
        await this.store.save(body.value);
        return Response.json({ ok: true });
      case 'load':
        return Response.json({ value: await this.store.load() });
      case 'clear':
        await this.store.clear();
        return Response.json({ ok: true });
      case 'alarmAt':
        await this.alarms.at(String(body.tag), Number(body.time));
        return Response.json({ ok: true });
      case 'alarmTtl':
        await this.alarms.ttl();
        return Response.json({ ok: true });
      case 'alarmPending':
        return Response.json({ pending: await this.alarms.pending() });
      case 'alarmFire':
        return Response.json({ tag: await this.alarms.fire() });
      case 'alarmArmed':
        return Response.json({ armed: (await this.ctx.storage.getAlarm()) !== null });
      // at과 ttl을 await 없이 동시에 던진다 — 직렬화가 되면 게임 알람이 살아남는다.
      case 'alarmRace': {
        const a = this.alarms.at(String(body.tag), Number(body.time));
        const b = this.alarms.ttl();
        await Promise.all([a, b]);
        return Response.json({ ok: true });
      }
      case 'broadcast':
        this.sse.broadcast(body.value);
        return Response.json({ ok: true });
      case 'wsBroadcast':
        this.ws.broadcast(body.value);
        return Response.json({ ok: true });
      default:
        return Response.json({ error: '알 수 없는 action' }, { status: 400 });
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.ws.message(ws as never, typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ws.close(ws as never);
  }

  async alarm(): Promise<void> {
    const tag = await this.alarms.fire();
    if (tag === null) {
      await this.store.clear(); // TTL 만료 = 방 폐기
      return;
    }
    this.lastTag = tag;
    await this.alarms.ttl();
  }
}
