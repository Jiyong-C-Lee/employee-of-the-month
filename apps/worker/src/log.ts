// log.ts — 타입드 JSON 로그 핸들러. 이벤트명·필드 정의는 이 파일이 유일한 출처다 (스펙 §11).
// 호출부는 logger.* 만 사용한다 — 임의 이벤트명 문자열·console 직접 호출 금지.
type Level = 'info' | 'warn' | 'error';

function write(level: Level, event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  roomCreated: (f: { roomCode: string; mode: string; personaId: string }) => write('info', 'room_created', f),
  gameStarted: (f: { roomCode: string; nicks: string[] }) => write('info', 'game_started', f),
  gameEnded: (f: { roomCode: string; rounds: number; winnerNick?: string }) => write('info', 'game_ended', f),
  roundStarted: (f: { roomCode: string; roundNo: number; situation: string }) => write('info', 'round_started', f),
  speechSubmitted: (f: { roomCode: string; roundNo: number; nick: string; text: string }) => write('info', 'speech_submitted', f),
  verdictIssued: (f: { roomCode: string; roundNo: number; provider: string; adoptedNick: string | null; totals: Record<string, number>; comments: string[] }) => write('info', 'verdict_issued', f),
  llmCall: (f: { kind: string; provider: string; ok: boolean; latencyMs: number; failedOver?: boolean; error?: string }) => write(f.ok ? 'info' : 'warn', 'llm_call', f),
  quotaExceeded: (f: { provider: string }) => write('warn', 'quota_exceeded', f),
  sseConnect: (f: { roomCode: string; playerId: string }) => write('info', 'sse_connect', f),
  sseDisconnect: (f: { roomCode: string; playerId: string }) => write('info', 'sse_disconnect', f),
  error: (f: { where: string; error: string; stack?: string }) => write('error', 'error', f),
};
