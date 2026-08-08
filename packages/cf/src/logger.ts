// logger.ts — @narre/llm의 Logger 인터페이스(event(name, fields))를 구현하는 타입드 JSON
// 로그 팩토리. {level, event, ...fields} 한 줄 포맷과 llmCall·quotaExceeded 헬퍼는
// employee-of-the-month/apps/worker/src/log.ts 이식 — 이벤트 이름은 여기 상수가 유일 출처다.
// 호출부는 event() 문자열 리터럴 직접 호출 대신 llmCall·quotaExceeded 헬퍼를 쓴다.
//
// cf가 llm에 의존하는 근거: llm/src/types.ts는 workers-types에도, cf에도 의존하지 않는
// 순수 타입 계약이다(순환 없음) — @narre/llm ← @narre/cf 단방향이라 워크스페이스 의존
// 추가가 안전하다. cf의 createLogger가 llm의 Logger를 구현해야 ChainContext.logger로
// 그대로 꽂을 수 있으므로, 타입을 중복 정의하지 않고 import하는 쪽이 근거 있는 결합이다.
import type { Logger } from '@narre/llm';

type Level = 'info' | 'warn' | 'error';

// 이벤트 이름 상수 — 유일 출처.
export const EVENT_LLM_CALL = 'llm_call';
export const EVENT_QUOTA_EXCEEDED = 'quota_exceeded';

function write(level: Level, event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export type LlmCallFields = {
  kind: string;
  provider: string;
  ok: boolean;
  latencyMs: number;
  failedOver?: boolean;
  error?: string;
  roomCode?: string;
};

export type QuotaExceededFields = { provider: string };

export type CfLogger = Logger & {
  llmCall(fields: LlmCallFields): void;
  quotaExceeded(fields: QuotaExceededFields): void;
  // event()는 항상 info로 찍는다 — 크래시를 level:error로 걸러내려는 호출부는 이걸 쓴다.
  error(event: string, fields: Record<string, unknown>): void;
};

// base 필드(roomCode 등 공통 태그)를 모든 이벤트에 병합해 두는 로거를 만든다.
export function createLogger(base: Record<string, unknown> = {}): CfLogger {
  return {
    // Logger 인터페이스 — @narre/llm ChainContext.logger로 그대로 꽂힌다.
    event(name: string, fields: Record<string, unknown>): void {
      write('info', name, { ...base, ...fields });
    },
    // roomCode: 세션별 LLM 비용·지연 추적용 — 원본 주석 보존.
    llmCall(fields: LlmCallFields): void {
      write(fields.ok ? 'info' : 'warn', EVENT_LLM_CALL, { ...base, ...fields });
    },
    quotaExceeded(fields: QuotaExceededFields): void {
      write('warn', EVENT_QUOTA_EXCEEDED, { ...base, ...fields });
    },
    error(event: string, fields: Record<string, unknown>): void {
      write('error', event, { ...base, ...fields });
    },
  };
}
