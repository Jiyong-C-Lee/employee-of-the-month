// createLogger 테스트 — console 캡처로 이벤트 이름·필드·레벨을 검증한다.
// 원본: employee-of-the-month/apps/worker/src/log.ts (llmCall·quotaExceeded 필드 유지).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, EVENT_LLM_CALL, EVENT_QUOTA_EXCEEDED } from '../src/logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('event()는 console.log에 {level:"info", event, ...fields}를 한 줄 JSON으로 쓴다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger();
    logger.event('room_created', { roomCode: 'ABCD', mode: 'classic' });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toEqual({ level: 'info', event: 'room_created', roomCode: 'ABCD', mode: 'classic' });
  });

  it('base 필드를 모든 이벤트에 병합한다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger({ roomCode: 'ABCD' });
    logger.event('player_joined', { playerId: 'p1' });

    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toEqual({ level: 'info', event: 'player_joined', roomCode: 'ABCD', playerId: 'p1' });
  });

  it('llmCall(ok:true)는 info 레벨로 llm_call 이벤트를 쓴다', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger();
    logger.llmCall({ kind: 'chain', provider: 'gemini', ok: true, latencyMs: 120 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: 'info', event: EVENT_LLM_CALL, provider: 'gemini', ok: true });
  });

  it('llmCall(ok:false)는 warn 레벨로 llm_call 이벤트를 쓴다', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createLogger();
    logger.llmCall({ kind: 'chain', provider: 'nvidia', ok: false, latencyMs: 50, error: 'timeout' });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: 'warn', event: EVENT_LLM_CALL, provider: 'nvidia', ok: false, error: 'timeout' });
  });

  it('quotaExceeded는 warn 레벨로 quota_exceeded 이벤트를 쓴다', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createLogger();
    logger.quotaExceeded({ provider: 'gemini' });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toEqual({ level: 'warn', event: EVENT_QUOTA_EXCEEDED, provider: 'gemini' });
  });

  it('error()는 console.error에 {level:"error", event, ...fields}를 한 줄 JSON으로 쓴다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger();
    logger.error('error', { gameId: 'g1', where: '/ask', error: 'boom' });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toEqual({ level: 'error', event: 'error', gameId: 'g1', where: '/ask', error: 'boom' });
  });
});
