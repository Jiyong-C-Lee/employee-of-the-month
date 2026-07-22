// EventSource 구독. 자동 재접속은 브라우저 내장 동작에 맡기고, 재접속 시 서버가 snapshot을 다시 보내준다.
import type { ServerEvent } from '@eotm/shared';

export function subscribe(
  code: string,
  playerId: string,
  token: string,
  handlers: {
    onEvent: (ev: ServerEvent) => void;
    onOpen: () => void;
    onError: () => void;
  },
): () => void {
  const es = new EventSource(`/api/rooms/${code}/events?playerId=${playerId}&token=${token}`);
  es.onopen = handlers.onOpen;
  es.onerror = handlers.onError;
  es.onmessage = (e) => handlers.onEvent(JSON.parse(e.data) as ServerEvent);
  return () => es.close();
}
