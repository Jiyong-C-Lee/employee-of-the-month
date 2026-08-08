// 테스트용 전송 — DO 없이 broadcast를 모으고 Conn을 직접 내준다. 게임 로직 테스트가
// 전송 계층 없이 돌게 하는 것이 목적이다(eotm engine.test.ts의 fakeBus와 같은 역할).
import type { Conn, ConnHooks, Transport } from './interfaces.js';

export type FakeTransport<TSeat = unknown> = Transport & {
  /** broadcast로 나간 메시지 누적. */
  sent: unknown[];
  /** 연결 하나를 연다. onOpen 훅이 있으면 호출한다. */
  open(): Conn<TSeat>;
  /** 특정 연결이 받은 메시지 목록. open()이 돌려준 Conn을 그대로 넘긴다. */
  received(conn: Conn<TSeat>): unknown[];
};

export function fakeTransport<TSeat = unknown>(hooks: ConnHooks<TSeat> = {}): FakeTransport<TSeat> {
  const inbox = new Map<Conn<TSeat>, unknown[]>();

  const fake: FakeTransport<TSeat> = {
    sent: [],

    open(): Conn<TSeat> {
      let data: TSeat | null = null;
      const box: unknown[] = [];
      const conn: Conn<TSeat> = {
        send(msg: unknown) {
          box.push(msg);
        },
        get data() {
          return data;
        },
        setData(v: TSeat) {
          data = v;
        },
      };
      inbox.set(conn, box);
      void hooks.onOpen?.(conn);
      return conn;
    },

    received(conn: Conn<TSeat>): unknown[] {
      return inbox.get(conn) ?? [];
    },

    attach(): Response {
      return new Response(null, { status: 200 });
    },

    broadcast(msg: unknown): void {
      fake.sent.push(msg);
      for (const conn of inbox.keys()) conn.send(msg);
    },
  };

  return fake;
}
