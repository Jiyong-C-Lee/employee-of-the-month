// RoomDO 테스트 공용 헬퍼 — Task 12 E2E에서도 재사용한다.
import { env } from 'cloudflare:test';
import type { ServerEvent } from '@eotm/shared';

// 방 코드로 RoomDO 스텁을 얻는다.
export function stub(code: string): DurableObjectStub {
  return env.ROOM_DO.get(env.ROOM_DO.idFromName(code));
}

// RoomDO에 JSON POST 후 상태·본문을 돌려준다.
export async function post(
  s: DurableObjectStub,
  path: string,
  body: object,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await s.fetch(`http://do${path}`, { method: 'POST', body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// SSE 스트림 리더에서 predicate를 만족하는 이벤트가 나올 때까지 소비한다.
// heartbeat 주석(`: hb`)은 건너뛴다. 누적 이벤트도 함께 반환한다.
export async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (ev: ServerEvent) => boolean,
  timeoutMs = 30000,
): Promise<{ ev: ServerEvent; events: ServerEvent[] }> {
  const dec = new TextDecoder();
  const events: ServerEvent[] = [];
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue; // heartbeat 주석 등
      const ev = JSON.parse(dataLine.slice(6)) as ServerEvent;
      events.push(ev);
      if (predicate(ev)) return { ev, events };
    }
  }
  throw new Error('readUntil 타임아웃');
}
