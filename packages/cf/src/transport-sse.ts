// SSE 전송 — 열린 스트림 집합에 data 프레임을 뿌리고, 죽은 sink는 enqueue 실패 시점에 지운다.
// 원본: employee-of-the-month/apps/worker/src/room-do.ts의 sinks/heartbeats/frame/broadcast.
//
// 훅은 팩토리가 받는다(Transport 공통 규약). SSE는 onMessage를 절대 호출하지 않는다 —
// 인바운드는 게임이 별도 HTTP POST로 받기 때문이다. 선택적 훅이라 더미가 필요 없다.
//
// onOpen이 이 재작성의 핵심이다. 이전 판(SSETransport.attach)은 컨트롤러를 호출측에
// 돌려주지 않아, 접속 순간 그 연결에만 스냅샷을 밀어야 하는 eotm이 쓸 수 없었다.
import type { Conn, ConnHooks, Transport } from './interfaces.js';

const HEARTBEAT_MS = 20_000; // 프록시가 유휴 커넥션을 끊지 않게 — 원본 값 그대로
const enc = new TextEncoder();

function frame(msg: unknown): Uint8Array {
  return enc.encode('data: ' + JSON.stringify(msg) + '\n\n');
}

export function sseTransport<TSeat = unknown>(hooks: ConnHooks<TSeat> = {}): Transport {
  const conns = new Set<Conn<TSeat>>();
  const timers = new Map<Conn<TSeat>, ReturnType<typeof setInterval>>();

  function drop(conn: Conn<TSeat>): void {
    conns.delete(conn);
    const t = timers.get(conn);
    if (t) {
      clearInterval(t);
      timers.delete(conn);
    }
  }

  return {
    attach(_req: Request): Response {
      // 컨트롤러가 start 안에서만 생기므로 conn을 그 안에서 만든다. 확정 할당 단언을 쓰는
      // 이유는 cancel 콜백이 conn을 참조하는데 TS가 할당 순서를 못 보기 때문이다.
      let conn!: Conn<TSeat>;
      const stream = new ReadableStream<Uint8Array>({
        start: (c) => {
          let data: TSeat | null = null;
          conn = {
            send(msg: unknown) {
              try {
                c.enqueue(frame(msg));
              } catch {
                drop(conn); // 닫힌 스트림 — 하트비트 인터벌도 함께 정리
              }
            },
            get data() {
              return data;
            },
            setData(v: TSeat) {
              data = v;
            },
          };
          conns.add(conn);
          timers.set(
            conn,
            setInterval(() => {
              try {
                c.enqueue(enc.encode(': hb\n\n'));
              } catch {
                drop(conn);
              }
            }, HEARTBEAT_MS),
          );
          void hooks.onOpen?.(conn);
        },
        cancel: () => {
          drop(conn);
          void hooks.onClose?.(conn);
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no', // nginx류 프록시 버퍼링 차단(실시간 전송) — 원본 그대로
        },
      });
    },

    broadcast(msg: unknown): void {
      // send가 drop을 부를 수 있으므로 순회 중 집합 변형을 피해 복사본을 돈다.
      for (const conn of [...conns]) conn.send(msg);
    },
  };
}
