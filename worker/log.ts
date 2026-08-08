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
  // 멀티 방 입장 — 퍼널 분석용 (방 생성 대비 실제 합류 인원).
  playerJoined: (f: { roomCode: string; playerId: string; nick: string; playerCount: number }) => write('info', 'player_joined', f),
  gameStarted: (f: { roomCode: string; nicks: string[] }) => write('info', 'game_started', f),
  gameEnded: (f: { roomCode: string; rounds: number; winnerNick?: string; reason?: string }) => write('info', 'game_ended', f),
  // 한 판 더 — 리텐션 지표 (같은 방 재경기 횟수).
  rematch: (f: { roomCode: string; players: number }) => write('info', 'rematch', f),
  // 익명 피드백 본문 — Workers Logs에서 바로 확인용 (원본은 KV fb:*).
  feedback: (f: { text: string; contact: string }) => write('info', 'feedback', f),
  roundStarted: (f: { roomCode: string; roundNo: number; situation: string }) => write('info', 'round_started', f),
  speechSubmitted: (f: { roomCode: string; roundNo: number; nick: string; text: string }) => write('info', 'speech_submitted', f),
  // 참모 대사 배치 — 품질 검수·모범답안 수집용. source로 실 LLM인지 mock 폴백인지 구분한다.
  advisorSpeeches: (f: { roomCode: string; roundNo: number; source: string; speeches: { name: string; approach: string; text: string }[] }) => write('info', 'advisor_speeches', f),
  epilogue: (f: { roomCode: string; roundNo: number; source: string; adoptedName: string; story: string }) => write('info', 'epilogue', f),
  verdictIssued: (f: { roomCode: string; roundNo: number; provider: string; adoptedNick: string | null; totals: Record<string, number>; comments: string[] }) => write('info', 'verdict_issued', f),
  // roomCode: 세션별 LLM 비용·지연 추적용 (방 밖 호출 — persona-gen 등 — 은 없음).
  llmCall: (f: { kind: string; provider: string; ok: boolean; latencyMs: number; failedOver?: boolean; error?: string; roomCode?: string }) => write(f.ok ? 'info' : 'warn', 'llm_call', f),
  // 커스텀 페르소나 생성 결과 — 품질 검수용 전문 로그 (wrangler tail로 확인).
  personaGenerated: (f: { id: string; input: Record<string, unknown>; persona: Record<string, unknown> }) => write('info', 'persona_generated', f),
  quotaExceeded: (f: { provider: string }) => write('warn', 'quota_exceeded', f),
  // @narre/llm ChainContext.logger 통로. 패키지가 보내는 이벤트 이름(llm_call·quota_exceeded)을
  // 그대로 흘린다 — 기존 로그 필터가 깨지지 않게 하려는 것이다. ok:false는 warn으로 올린다.
  chain: (name: string, fields: Record<string, unknown>) =>
    write(fields.ok === false ? 'warn' : 'info', name, fields),
  // 체인이 전소해 게임 고유 mock으로 떨어진 이유. 조용히 삼키면 프로덕션에서 대사 품질이
  // 떨어져도 원인을 못 본다.
  chainFallback: (f: { error: string; roomCode?: string }) => write('warn', 'chain_fallback', f),
  sseConnect: (f: { roomCode: string; playerId: string }) => write('info', 'sse_connect', f),
  sseDisconnect: (f: { roomCode: string; playerId: string }) => write('info', 'sse_disconnect', f),
  error: (f: { where: string; error: string; stack?: string }) => write('error', 'error', f),
};
