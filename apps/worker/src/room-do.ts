// RoomDO — 방 하나의 권위 인스턴스. SSE 브로드캐스트·storage 영속·alarm 배선을 맡고,
// 게임 규칙은 Engine(Task 10)에 위임한다. Worker(index.ts)가 HTTP로 이 DO에 위임 호출한다.
import { Engine, type EngineBus, type EngineEvent, type AiDeps } from './game/engine';
import { createRoomState, addPlayer, authPlayer, computeStandings, publicRoom, type RoomState } from './game/state';
import { ROOM_TTL_MS, type ServerEvent, type SpeakTurn, type TimerInfo, type EndedPayload } from '@eotm/shared';
import { STRINGS, personaSchema, type FullPersona } from '@eotm/content';
import { logger } from './log';
import type { Env } from './env';

const HEARTBEAT_MS = 20_000;
const CUSTOM_PERSONA_MAX_CHARS = 20_000; // 커스텀 페르소나 직렬화 상한 — storage 남용 차단
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
  // sink별 heartbeat 인터벌 — sink 제거 시 함께 정리한다(M2).
  heartbeats = new Map<ReadableStreamDefaultController<Uint8Array>, ReturnType<typeof setInterval>>();
  // DO 알람은 1개뿐 — schedule/cancel/TTL 재무장이 마이크로태스크 경합으로 뒤섞이지 않게 직렬화한다(I1).
  private alarmChain: Promise<unknown> = Promise.resolve();

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
    const deps: AiDeps = { env: this.env, quotaTake: this.makeQuotaTake(), roomCode: room.code };
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

  // 알람 storage 조작을 호출 순서대로 직렬 실행한다 — clear→start 마이크로태스크 경합 방지(I1).
  private runAlarmOp<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.alarmChain.then(fn, fn);
    this.alarmChain = next.catch(() => {});
    return next;
  }

  // 턴 알람을 걷어내고 TTL(cleanup) 알람으로 되돌린다 — DO 알람은 1개뿐이므로 항상 하나는 무장 상태로 유지(I2).
  private async setCleanupAlarm(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put('alarmTag', 'cleanup');
    await this.ctx.storage.setAlarm(this.room.lastActivity + ROOM_TTL_MS);
  }

  // 엔진이 아는 유일한 전송·영속·스케줄 계층.
  private makeBus(): EngineBus {
    return {
      emit: (ev: EngineEvent) => this.emit(ev),
      persist: () => this.ctx.storage.put('room', this.room),
      schedule: (at: number, tag: string) => this.runAlarmOp(async () => {
        // 턴 마감 알람 — DO 알람은 1개뿐이라 tag로 종류를 구분한다.
        await this.ctx.storage.put('alarmTag', tag);
        await this.ctx.storage.setAlarm(at);
      }),
      // 턴 알람 취소 시 알람을 비우지 않고 TTL로 되돌린다 — 싱글 무제한 턴에서 방치 방 영구 잔존 방지(I2).
      cancelSchedule: () => this.runAlarmOp(() => this.setCleanupAlarm()),
      delay: (ms: number, fn: () => void) => { setTimeout(fn, ms); },
    };
  }

  // seq 부여 → 피드 영속 → 전 sink 브로드캐스트. 파생 뷰(turn/timer/ended)는 캐시하지 않고
  // 스냅샷 시점에 room 상태에서 재구성한다(C1 — 재기동 후 캐시 유실로 인한 정지 방지).
  private emit(ev: EngineEvent): void {
    const room = this.room;
    if (!room) return;
    const event = { ...ev, seq: ++room.seq } as ServerEvent;
    if (ev.kind === 'feed') {
      room.feed.push(ev.item);
      if (room.feed.length > FEED_CAP) room.feed = room.feed.slice(-FEED_CAP);
    }
    this.broadcast(event);
  }

  private broadcast(event: ServerEvent): void {
    const data = frame(event);
    for (const c of this.sinks) {
      try {
        c.enqueue(data);
      } catch {
        this.removeSink(c); // 닫힌 스트림 정리 — heartbeat 인터벌도 함께(M2)
      }
    }
  }

  // sink 제거 시 해당 heartbeat 인터벌도 정리한다(M2 — 닫힌 스트림의 유령 인터벌 누수 방지).
  private removeSink(c: ReadableStreamDefaultController<Uint8Array>): void {
    this.sinks.delete(c);
    const hb = this.heartbeats.get(c);
    if (hb) {
      clearInterval(hb);
      this.heartbeats.delete(c);
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
      case '/debug':
        // 디버그 액션은 DEBUG_ACTIONS='true'일 때만 — 프로덕션에서 adoptMe 등 부정승리 차단(I4).
        if (this.env.DEBUG_ACTIONS !== 'true') return jsonRes({ error: STRINGS.errors.noRoom }, 404);
        return this.handleEngineAction(() => this.engine!.debug(playerId, String(body.action ?? '')));
      case '/speak': return this.handleSpeak(playerId, String(body.text ?? ''));
      case '/leave': return this.handleLeave(playerId);
      default: return jsonRes({ error: STRINGS.errors.noRoom }, 404);
    }
  }

  private async handleCreate(req: Request): Promise<Response> {
    if (await this.ctx.storage.get('room')) return jsonRes({ error: STRINGS.errors.roomStarted }, 409);
    const { code, nick, config, avatar } = (await req.json()) as {
      code: string; nick: string;
      config: Parameters<typeof createRoomState>[2] & { customPersona?: unknown };
      avatar?: unknown;
    };
    // 커스텀 페르소나 — 클라이언트가 보낸 팩 JSON을 content zod로 재검증 후에만 수용.
    let customPersona: FullPersona | undefined;
    if (config?.customPersona) {
      if (JSON.stringify(config.customPersona).length > CUSTOM_PERSONA_MAX_CHARS) {
        return jsonRes({ error: STRINGS.errors.personaTooBig }, 400);
      }
      const v = personaSchema.safeParse(config.customPersona);
      if (!v.success || !v.data.id.startsWith('custom-')) {
        return jsonRes({ error: STRINGS.errors.personaInvalid }, 400);
      }
      customPersona = v.data;
      delete config.customPersona; // RoomConfig에는 싣지 않는다 — room.customPersona로만 영속
    }
    const { room, playerId, token } = createRoomState(code, nick, config, avatar, customPersona);
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
    const r = addPlayer(this.room, String(body.nick ?? ''), body.avatar);
    if ('error' in r) return jsonRes({ error: r.error }, 400);
    await this.ctx.storage.put('room', this.room);
    const joined = this.room.players.find((p) => p.id === r.playerId);
    logger.playerJoined({ roomCode: this.room.code, playerId: r.playerId, nick: joined?.nick ?? '', playerCount: this.room.players.length });
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

  private async handleEvents(url: URL): Promise<Response> {
    const playerId = url.searchParams.get('playerId') ?? '';
    const token = url.searchParams.get('token') ?? '';
    if (!this.room) return jsonRes({ error: STRINGS.errors.noRoom }, 404);
    if (!authPlayer(this.room, playerId, token)) return jsonRes({ error: STRINGS.errors.badAuth }, 401);

    // 파생 뷰(turn/timer/ended)를 storage·room 상태에서 재구성 — 재기동 후 캐시 유실로 인한 정지 방지(C1).
    const derived = await this.derivedSnapshot();
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        // 접속 즉시 현재 상태 전체를 스냅샷으로 전달 (신규 접속·재접속 동일).
        const snapshot: ServerEvent = {
          kind: 'snapshot',
          seq: this.room!.seq,
          room: publicRoom(this.room!),
          feed: this.room!.feed,
          speakTurn: derived.speakTurn,
          timer: derived.timer,
          ended: derived.ended,
        };
        c.enqueue(frame(snapshot));
        this.sinks.add(c);
        const hb = setInterval(() => {
          try { c.enqueue(enc.encode(': hb\n\n')); } catch { /* 닫힘 — cancel이 정리 */ }
        }, HEARTBEAT_MS);
        this.heartbeats.set(c, hb);
        this.engine?.setConnected(playerId, true);
        logger.sseConnect({ roomCode: this.room!.code, playerId });
      },
      cancel: (c) => {
        this.removeSink(c);
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

  // 스냅샷의 파생 뷰를 room 상태·storage 알람에서 재구성한다(C1).
  // - 사람 턴이면 speakTurn 재구성(입력창 복구). 멀티 turnTimeout 알람이 있으면 timer도 함께(마감시각은 storage에서).
  // - 종료 상태면 ended 페이로드를 room에서 재구성(종료 화면 복구).
  private async derivedSnapshot(): Promise<{ speakTurn: SpeakTurn | null; timer: TimerInfo | null; ended: EndedPayload | null }> {
    const room = this.room!;
    let speakTurn: SpeakTurn | null = null;
    let timer: TimerInfo | null = null;
    let ended: EndedPayload | null = null;

    if (room.state === 'PLAYING' && room.phase === 'PLAYER_TURNS' && room.round) {
      const tag = await this.ctx.storage.get<string>('alarmTag');
      if (tag?.startsWith('inputWindow:')) {
        // 멀티 동시 입력 창 — 전원 공용 타이머만 복구 (입력창 노출은 publicRoom의 submitted/revealing으로 판단).
        const at = await this.ctx.storage.getAlarm();
        if (at) timer = { phase: 'PLAYER_TURNS', deadline: at, total: room.config.speakTime };
      } else {
        const entry = room.round.queue[room.round.turnIdx];
        if (entry?.kind === 'user' && room.config.mode === 'single') {
          const p = room.players.find((x) => x.id === entry.key);
          speakTurn = { current: entry.key, nick: p?.nick ?? entry.name, speakTime: room.config.speakTime };
          if (tag?.startsWith('turnTimeout:')) {
            const at = await this.ctx.storage.getAlarm();
            if (at) timer = { phase: 'PLAYER_TURNS', deadline: at, total: room.config.speakTime };
          }
        }
      }
    } else if (room.state === 'ENDED') {
      ended = { reason: room.endedReason ?? '', standings: computeStandings(room), hall: room.hall };
    }
    return { speakTurn, timer, ended };
  }

  // ---- alarm ----

  async alarm(): Promise<void> {
    const tag = await this.runAlarmOp(async () => {
      const t = await this.ctx.storage.get<string>('alarmTag');
      await this.ctx.storage.delete('alarmTag');
      return t;
    });
    if (tag === 'cleanup') {
      await this.ctx.storage.deleteAll(); // 방 소멸 — TTL 만료
      return;
    }
    if (tag?.startsWith('turnTimeout:') || tag?.startsWith('inputWindow:')) this.engine?.onAlarm(tag);
    // 턴 알람 처리 후 다시 TTL 알람을 건다 (엔진이 새 턴 알람을 걸었으면 건드리지 않는다).
    await this.armTtlIfIdle();
  }

  // 턴 타임아웃 알람이 없을 때만 TTL(cleanup) 알람을 예약한다. DO 알람은 1개뿐이다. 알람 체인으로 직렬화(I1).
  private armTtlIfIdle(): Promise<void> {
    return this.runAlarmOp(async () => {
      if (!this.room) return;
      const tag = await this.ctx.storage.get<string>('alarmTag');
      // 게임 진행용 알람(턴 마감·입력 창 마감) 활성 중이면 유지 — TTL로 덮어쓰면 마감이 유실된다.
      if (tag?.startsWith('turnTimeout:') || tag?.startsWith('inputWindow:')) return;
      await this.setCleanupAlarm();
    });
  }
}
