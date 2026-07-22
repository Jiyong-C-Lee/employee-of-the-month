// RoomDO — 방 하나의 권위 인스턴스. SSE 브로드캐스트·storage 영속·alarm 배선을 맡고,
// 게임 규칙은 Engine(Task 10)에 위임한다. Worker(index.ts)가 HTTP로 이 DO에 위임 호출한다.
import { Engine, type EngineBus, type EngineEvent, type AiDeps } from './game/engine';
import { createRoomState, addPlayer, authPlayer, publicRoom, type RoomState } from './game/state';
import { ROOM_TTL_MS, type ServerEvent, type SpeakTurn, type TimerInfo, type EndedPayload } from '@eotm/shared';
import { STRINGS } from '@eotm/content';
import { logger } from './log';
import type { Env } from './env';

const HEARTBEAT_MS = 20_000;
const FEED_CAP = 300; // 최근 피드만 유지 (스냅샷 크기 억제)
const QUOTA_TTL_MS = 24 * 60 * 60 * 1000;
const enc = new TextEncoder();

// SSE 프레임 인코딩 — 이벤트 1건을 data 라인으로.
function frame(ev: ServerEvent): Uint8Array {
  return enc.encode('data: ' + JSON.stringify(ev) + '\n\n');
}

function jsonRes(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

interface AuthedBody { playerId: string; token: string }

export class RoomDO implements DurableObject {
  room: RoomState | null = null;
  engine: Engine | null = null;
  sinks = new Set<ReadableStreamDefaultController<Uint8Array>>();
  // 스냅샷용 최신값 캐시 — RoomState에 담지 않는 파생 뷰이므로 emit 시 갱신한다.
  lastTurn: SpeakTurn | null = null;
  lastTimer: TimerInfo | null = null;
  lastEnded: EndedPayload | null = null;

  constructor(readonly ctx: DurableObjectState, readonly env: Env) {
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomState>('room');
      if (saved) {
        this.room = saved;
        this.engine = this.makeEngine(saved);
        this.engine.resumeAfterRestore();
      }
    });
  }

  // ---- 엔진 배선 ----

  private makeEngine(room: RoomState): Engine {
    const deps: AiDeps = { env: this.env, quotaTake: this.makeQuotaTake() };
    return new Engine(room, this.makeBus(), deps);
  }

  // 공급자별 일일 쿼터를 QuotaDO(global)에 위임. false면 chain이 해당 공급자를 스킵한다.
  private makeQuotaTake(): (provider: string) => Promise<boolean> {
    return async (provider: string): Promise<boolean> => {
      const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const key = `llm:${provider}:${day}`;
      const limitStr = provider === 'gemini' ? this.env.LLM_DAILY_LIMIT_GEMINI : this.env.LLM_DAILY_LIMIT_NVIDIA;
      const limit = parseInt(limitStr, 10);
      const dostub = this.env.QUOTA_DO.get(this.env.QUOTA_DO.idFromName('global'));
      const res = await dostub.fetch('http://quota/incr', {
        method: 'POST',
        body: JSON.stringify({ key, limit, ttlMs: QUOTA_TTL_MS }),
      });
      const data = (await res.json()) as { ok: boolean };
      return data.ok;
    };
  }

  // 엔진이 아는 유일한 전송·영속·스케줄 계층.
  private makeBus(): EngineBus {
    return {
      emit: (ev: EngineEvent) => this.emit(ev),
      persist: () => this.ctx.storage.put('room', this.room),
      schedule: async (at: number, tag: string) => {
        // 턴 마감 알람 — DO 알람은 1개뿐이라 tag로 종류를 구분한다.
        await this.ctx.storage.put('alarmTag', tag);
        await this.ctx.storage.setAlarm(at);
      },
      cancelSchedule: async () => {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.delete('alarmTag');
      },
      delay: (ms: number, fn: () => void) => { setTimeout(fn, ms); },
    };
  }

  // seq 부여 → 피드 영속·최신값 캐시 갱신 → 전 sink 브로드캐스트.
  private emit(ev: EngineEvent): void {
    const room = this.room;
    if (!room) return;
    const event = { ...ev, seq: ++room.seq } as ServerEvent;
    if (ev.kind === 'feed') {
      room.feed.push(ev.item);
      if (room.feed.length > FEED_CAP) room.feed = room.feed.slice(-FEED_CAP);
    } else if (ev.kind === 'turn') {
      this.lastTurn = ev.turn;
    } else if (ev.kind === 'timer') {
      this.lastTimer = ev.timer;
    } else if (ev.kind === 'ended') {
      this.lastEnded = ev.payload;
    }
    this.broadcast(event);
  }

  private broadcast(event: ServerEvent): void {
    const data = frame(event);
    for (const c of this.sinks) {
      try {
        c.enqueue(data);
      } catch {
        this.sinks.delete(c); // 닫힌 스트림 정리
      }
    }
  }

  // ---- HTTP 라우팅 ----

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/events') return this.handleEvents(url);
    if (req.method !== 'POST') return jsonRes({ error: STRINGS.errors.noRoom }, 404);

    if (path === '/create') return this.handleCreate(req);

    const body = (await req.json()) as Record<string, unknown>;
    if (path === '/join') return this.handleJoin(body);

    // 이하 인증 필요 라우트.
    if (!this.room) return jsonRes({ error: STRINGS.errors.noRoom }, 404);
    const { playerId, token } = body as unknown as AuthedBody;
    if (!authPlayer(this.room, playerId, token)) return jsonRes({ error: STRINGS.errors.badAuth }, 401);

    switch (path) {
      case '/start': return this.handleEngineAction(() => this.engine!.start(playerId));
      case '/next': return this.handleEngineAction(() => this.engine!.nextRound(playerId));
      case '/debug': return this.handleEngineAction(() => this.engine!.debug(playerId, String(body.action ?? '')));
      case '/speak': return this.handleSpeak(playerId, String(body.text ?? ''));
      case '/leave': return this.handleLeave(playerId);
      default: return jsonRes({ error: STRINGS.errors.noRoom }, 404);
    }
  }

  private async handleCreate(req: Request): Promise<Response> {
    if (await this.ctx.storage.get('room')) return jsonRes({ error: STRINGS.errors.roomStarted }, 409);
    const { code, nick, config } = (await req.json()) as {
      code: string; nick: string; config: Parameters<typeof createRoomState>[2];
    };
    const { room, playerId, token } = createRoomState(code, nick, config);
    this.room = room;
    this.engine = this.makeEngine(room);
    await this.ctx.storage.put('room', room);
    logger.roomCreated({ roomCode: room.code, mode: room.config.mode, personaId: room.config.personaId });
    // 싱글은 대기 없이 즉시 시작 (원본 index.js 동작).
    if (room.config.mode === 'single') this.engine.start(playerId);
    await this.armTtlIfIdle();
    return jsonRes({ ok: true, code: room.code, playerId, token, room: publicRoom(room) });
  }

  private async handleJoin(body: Record<string, unknown>): Promise<Response> {
    if (!this.room) return jsonRes({ error: STRINGS.errors.noRoom }, 404);
    const r = addPlayer(this.room, String(body.nick ?? ''));
    if ('error' in r) return jsonRes({ error: r.error }, 400);
    await this.ctx.storage.put('room', this.room);
    this.emit({ kind: 'room', room: publicRoom(this.room) });
    await this.armTtlIfIdle();
    return jsonRes({ ok: true, code: this.room.code, playerId: r.playerId, token: r.token, room: publicRoom(this.room) });
  }

  private async handleEngineAction(action: () => { ok: true } | { error: string }): Promise<Response> {
    const r = action();
    if ('error' in r) return jsonRes(r, 400);
    await this.armTtlIfIdle();
    return jsonRes({ ok: true });
  }

  private async handleSpeak(playerId: string, text: string): Promise<Response> {
    const r = this.engine!.handleSpeak(playerId, text);
    if (r) return jsonRes(r, 400); // {error} → 400
    await this.armTtlIfIdle();
    return jsonRes({ ok: true });
  }

  private async handleLeave(playerId: string): Promise<Response> {
    this.engine!.setConnected(playerId, false);
    await this.armTtlIfIdle();
    return jsonRes({ ok: true });
  }

  // ---- SSE ----

  private handleEvents(url: URL): Response {
    const playerId = url.searchParams.get('playerId') ?? '';
    const token = url.searchParams.get('token') ?? '';
    if (!this.room) return jsonRes({ error: STRINGS.errors.noRoom }, 404);
    if (!authPlayer(this.room, playerId, token)) return jsonRes({ error: STRINGS.errors.badAuth }, 401);

    let hb: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        // 접속 즉시 현재 상태 전체를 스냅샷으로 전달 (신규 접속·재접속 동일).
        const snapshot: ServerEvent = {
          kind: 'snapshot',
          seq: this.room!.seq,
          room: publicRoom(this.room!),
          feed: this.room!.feed,
          speakTurn: this.lastTurn,
          timer: this.lastTimer,
          ended: this.lastEnded,
        };
        c.enqueue(frame(snapshot));
        this.sinks.add(c);
        hb = setInterval(() => {
          try { c.enqueue(enc.encode(': hb\n\n')); } catch { /* 닫힘 — cancel이 정리 */ }
        }, HEARTBEAT_MS);
        this.engine?.setConnected(playerId, true);
        logger.sseConnect({ roomCode: this.room!.code, playerId });
      },
      cancel: (c) => {
        this.sinks.delete(c);
        if (hb) clearInterval(hb);
        this.engine?.setConnected(playerId, false);
        if (this.room) logger.sseDisconnect({ roomCode: this.room.code, playerId });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // nginx류 프록시 버퍼링 차단 (실시간 전송)
      },
    });
  }

  // ---- alarm ----

  async alarm(): Promise<void> {
    const tag = await this.ctx.storage.get<string>('alarmTag');
    await this.ctx.storage.delete('alarmTag');
    if (tag === 'cleanup') {
      await this.ctx.storage.deleteAll(); // 방 소멸 — TTL 만료
      return;
    }
    if (tag?.startsWith('turnTimeout:')) this.engine?.onAlarm(tag);
    // 턴 알람 처리 후 다시 TTL 알람을 건다 (엔진이 새 턴 알람을 걸었으면 건드리지 않는다).
    await this.armTtlIfIdle();
  }

  // 턴 타임아웃 알람이 없을 때만 TTL(cleanup) 알람을 예약한다. DO 알람은 1개뿐이다.
  private async armTtlIfIdle(): Promise<void> {
    if (!this.room) return;
    const tag = await this.ctx.storage.get<string>('alarmTag');
    if (tag?.startsWith('turnTimeout:')) return; // 턴 알람 활성 — 유지
    await this.ctx.storage.put('alarmTag', 'cleanup');
    await this.ctx.storage.setAlarm(this.room.lastActivity + ROOM_TTL_MS);
  }
}
