// WebSocket Hibernation 전송 — 참가자 연결을 ctx.acceptWebSocket로 물고, 방송은
// ctx.getWebSockets()를 순회한다. 원본: ai-speed-game/worker/room-do.mjs의 fetch()/broadcast().
//
// 훅을 팩토리가 받는 이유가 여기서 결정적이다. hibernation에서 깬 DO는 attach 없이
// webSocketMessage부터 받는다. 훅이 attach 인자였다면 그 시점에 비어 있어 메시지가 유실된다.
// DO 생성자가 wsTransport를 다시 만들면서 훅을 배선하므로 깨어난 뒤에도 안전하다.
//
// Conn.data는 serializeAttachment에 얹는다 — hibernation을 건너 살아남는 유일한 연결별
// 저장소다(speedquiz가 좌석 playerId를 여기 넣는다).
import type { Conn, ConnHooks, Transport } from './interfaces.js';

export type WsTransport = Transport & {
  /** DO의 webSocketMessage 훅에서 넘긴다. */
  message(ws: WebSocket, raw: string): Promise<void>;
  /** DO의 webSocketClose·webSocketError 훅에서 넘긴다. */
  close(ws: WebSocket): Promise<void>;
};

export function wsTransport<TSeat = unknown>(
  ctx: DurableObjectState,
  hooks: ConnHooks<TSeat> = {},
): WsTransport {
  function connFor(ws: WebSocket): Conn<TSeat> {
    return {
      send(msg: unknown) {
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          /* 끊긴 소켓은 webSocketClose가 정리한다 — 원본 전제 보존 */
        }
      },
      get data() {
        // 좌석을 한 번도 안 붙인 연결은 undefined가 온다. null로 맞춰 SSE 쪽과 같게 한다.
        return (ws.deserializeAttachment() as TSeat | null) ?? null;
      },
      setData(v: TSeat) {
        ws.serializeAttachment(v);
      },
    };
  }

  return {
    attach(req: Request): Response {
      if (req.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket 전용 엔드포인트입니다', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      ctx.acceptWebSocket(server);
      void hooks.onOpen?.(connFor(server));
      return new Response(null, { status: 101, webSocket: client });
    },

    broadcast(msg: unknown): void {
      const text = JSON.stringify(msg);
      for (const ws of ctx.getWebSockets()) {
        try {
          ws.send(text);
        } catch {
          /* 끊긴 소켓은 webSocketClose가 정리한다 */
        }
      }
    },

    async message(ws: WebSocket, raw: string): Promise<void> {
      await hooks.onMessage?.(connFor(ws), raw);
    },

    async close(ws: WebSocket): Promise<void> {
      await hooks.onClose?.(connFor(ws));
    },
  };
}
