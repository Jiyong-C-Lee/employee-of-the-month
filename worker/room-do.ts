// RoomDO — 방 하나의 권위 인스턴스. 게임 규칙은 Engine에 위임하고, 여기는 라우팅·인증·
// 스냅샷 재구성만 맡는다. Worker(index.ts)가 HTTP로 이 DO에 위임 호출한다.
//
// 원본(employee-of-the-month/apps/worker/src/room-do.ts, 340줄)에서 배관 약 110줄이 부품으로
// 빠졌다: sinks/heartbeats/frame/broadcast → sseTransport, alarmChain/alarmTag/setCleanupAlarm/
// armTtlIfIdle → doAlarms, storage.get/put('room') → doRoomStore, makeQuotaTake → QuotaDO.take.
import { doRoomStore, doAlarms, sseTransport } from '@narre/cf';
import type { Alarms, RoomStore, Transport } from '@narre/cf';
import { Engine, type EngineBus, type EngineEvent } from './game/engine';
import { createRoomState, addPlayer, authPlayer, computeStandings, publicRoom, type RoomState } from './game/state';
import { ROOM_TTL_MS, type ServerEvent, type SpeakTurn, type TimerInfo, type EndedPayload } from '@shared';
import { STRINGS, personaSchema, type FullPersona } from '@content';
import { makeLlm, hasAnyKey } from './ai/llm';
import { logger } from './log';
import type { Env } from './env';

const CUSTOM_PERSONA_MAX_CHARS = 20_000; // 커스텀 페르소나 직렬화 상한 — storage 남용 차단
const FEED_CAP = 300; // 최근 피드만 유지 (스냅샷 크기 억제)

function jsonRes(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

interface AuthedBody { playerId: string; token: string }

export class RoomDO implements DurableObject {
  room: RoomState | null = null;
  engine: Engine | null = null;

  private readonly store: RoomStore<RoomState>;
  private readonly alarms: Alarms;
  private readonly sse: Transport;
  // attach 직전에 채우는 인증된 playerId와 스냅샷. onOpen 훅이 그대로 꺼내 쓴다.
  //
  // 스냅샷을 미리 만들어 두는 이유: onOpen 안에서 await하면 그 사이 setConnected가 쏜
  // room 브로드캐스트가 스냅샷을 앞질러 도착한다. 클라이언트는 첫 프레임이 스냅샷이라고
  // 전제하므로 순서가 뒤집히면 화면이 복구되지 않는다. 원본도 스트림 생성 전에 만들었다.
  private pendingSeat = '';
  private pendingSnapshot: ServerEvent | null = null;

  constructor(readonly ctx: DurableObjectState, readonly env: Env) {
    this.store = doRoomStore<RoomState>(ctx);
    this.alarms = doAlarms(ctx, { ttlMs: ROOM_TTL_MS });
    this.sse = sseTransport({
      onOpen: (conn) => {
        const seat = this.pendingSeat;
        conn.setData({ playerId: seat });
        // 스냅샷이 반드시 첫 프레임이어야 한다 — 동기로 먼저 민다.
        if (this.pendingSnapshot) conn.send(this.pendingSnapshot);
        this.engine?.setConnected(seat, true);
        if (this.room) logger.sseConnect({ roomCode: this.room.code, playerId: seat });
      },
      onClose: (conn) => {
        const seat = (conn.data as { playerId?: string } | null)?.playerId ?? '';
        this.engine?.setConnected(seat, false);
        if (this.room) logger.sseDisconnect({ roomCode: this.room.code, playerId: seat });
      },
    });

    ctx.blockConcurrencyWhile(async () => {
      const saved = await this.store.load();
      if (saved) {
        this.room = saved;
        this.engine = this.makeEngine(saved);
        this.engine.resumeAfterRestore();
      }
    });
  }

  // ---- 엔진 배선 ----

  private makeEngine(room: RoomState): Engine {
    const quota = this.env.QUOTA_DO.get(this.env.QUOTA_DO.idFromName('global')) as unknown as {
      take(provider: string): Promise<boolean>;
    };
    const deps = {
      llm: makeLlm(this.env, quota, room.code),
      hasKey: hasAnyKey(this.env),
      roomCode: room.code,
    };
    return new Engine(room, this.makeBus(), deps);
  }

  // 엔진이 아는 유일한 전송·영속·스케줄 계층.
  private makeBus(): EngineBus {
    return {
      emit: (ev: EngineEvent) => this.emit(ev),
      persist: () => this.store.save(this.room!),
      schedule: (at: number, tag: string) => this.alarms.at(tag, at),
      // 턴 알람 취소 = 태그 소거 후 TTL 복귀. fire()가 "태그를 꺼내 지운다"라 취소에도 쓴다.
      // ttl()만 부르면 태그가 살아 있어 무시되므로(부품이 게임 알람을 보호한다) 순서가 중요하다.
      cancelSchedule: async () => {
        await this.alarms.fire();
        await this.alarms.ttl();
      },
      // 연출 지연도 요청 밖이다. 타이머가 도는 동안 DO가 살아 있게 waitUntil로 감싼다.
      //
      // DELAY_SCALE로 배율을 건다. 테스트는 0으로 둬서 연출을 건너뛴다 — 안 그러면
      // 참모 발언마다 최대 7초(speechGapMs)를 실제로 기다려 워커 테스트가 36초씩 걸린다.
      // 미설정이 프로덕션 기본값(1)이다.
      delay: (ms: number, fn: () => void) => {
        const scaled = ms * Number(this.env.DELAY_SCALE ?? '1');
        this.ctx.waitUntil(new Promise<void>((resolve) => {
          setTimeout(() => {
            try { fn(); } finally { resolve(); }
          }, scaled);
        }));
      },
      // 응답 이후에도 이어지는 작업(LLM 대기·턴 진행)을 런타임에 알린다.
      // 안 알리면 Workers가 잘라내고 참모 대사가 조용히 mock으로 떨어진다.
      background: (p: Promise<unknown>) => {
        this.ctx.waitUntil(p.catch((e) => {
          logger.error({ where: 'engine.background', error: e instanceof Error ? e.message : String(e) });
        }));
      },
    };
  }

  // seq 부여 → 피드 영속 → 전 연결 브로드캐스트. 파생 뷰(turn/timer/ended)는 캐시하지 않고
  // 스냅샷 시점에 room 상태에서 재구성한다(C1 — 재기동 후 캐시 유실로 인한 정지 방지).
  private emit(ev: EngineEvent): void {
    const room = this.room;
    if (!room) return;
    const event = { ...ev, seq: ++room.seq } as ServerEvent;
    if (ev.kind === 'feed') {
      room.feed.push(ev.item);
      if (room.feed.length > FEED_CAP) room.feed = room.feed.slice(-FEED_CAP);
    }
    this.sse.broadcast(event);
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
      case '/proceed': return this.handleEngineAction(() => this.engine!.proceed(playerId));
      case '/next': return this.handleEngineAction(() => this.engine!.nextRound(playerId));
      case '/rematch': return this.handleEngineAction(() => this.engine!.rematch(playerId));
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
    if (await this.store.load()) return jsonRes({ error: STRINGS.errors.roomStarted }, 409);
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
    await this.store.save(room);
    logger.roomCreated({ roomCode: room.code, mode: room.config.mode, personaId: room.config.personaId });
    // 싱글은 대기 없이 즉시 시작 (원본 index.js 동작).
    if (room.config.mode === 'single') this.engine.start(playerId);
    await this.alarms.ttl();
    return jsonRes({ ok: true, code: room.code, playerId, token, room: publicRoom(room) });
  }

  private async handleJoin(body: Record<string, unknown>): Promise<Response> {
    if (!this.room) return jsonRes({ error: STRINGS.errors.noRoom }, 404);
    const r = addPlayer(this.room, String(body.nick ?? ''), body.avatar);
    if ('error' in r) return jsonRes({ error: r.error }, 400);
    await this.store.save(this.room);
    const joined = this.room.players.find((p) => p.id === r.playerId);
    logger.playerJoined({ roomCode: this.room.code, playerId: r.playerId, nick: joined?.nick ?? '', playerCount: this.room.players.length });
    this.emit({ kind: 'room', room: publicRoom(this.room) });
    await this.alarms.ttl();
    return jsonRes({ ok: true, code: this.room.code, playerId: r.playerId, token: r.token, room: publicRoom(this.room) });
  }

  private async handleEngineAction(action: () => { ok: true } | { error: string }): Promise<Response> {
    const r = action();
    if ('error' in r) return jsonRes(r, 400);
    await this.alarms.ttl();
    return jsonRes({ ok: true });
  }

  private async handleSpeak(playerId: string, text: string): Promise<Response> {
    const r = this.engine!.handleSpeak(playerId, text);
    if (r) return jsonRes(r, 400); // {error} → 400
    await this.alarms.ttl();
    return jsonRes({ ok: true });
  }

  private async handleLeave(playerId: string): Promise<Response> {
    this.engine!.setConnected(playerId, false);
    await this.alarms.ttl();
    return jsonRes({ ok: true });
  }

  // ---- SSE ----

  // 인증은 attach 전에 끝낸다 — onOpen 훅 안에서는 응답 코드를 바꿀 수 없다.
  private async handleEvents(url: URL): Promise<Response> {
    const playerId = url.searchParams.get('playerId') ?? '';
    const token = url.searchParams.get('token') ?? '';
    if (!this.room) return jsonRes({ error: STRINGS.errors.noRoom }, 404);
    if (!authPlayer(this.room, playerId, token)) return jsonRes({ error: STRINGS.errors.badAuth }, 401);
    this.pendingSeat = playerId;
    this.pendingSnapshot = await this.buildSnapshot();
    return this.sse.attach(new Request(url.toString()));
  }

  // 접속 시 그 연결에만 밀어 넣을 현재 상태 전체 (신규 접속·재접속 동일).
  private async buildSnapshot(): Promise<ServerEvent> {
    const derived = await this.derivedSnapshot();
    return {
      kind: 'snapshot',
      seq: this.room!.seq,
      room: publicRoom(this.room!),
      feed: this.room!.feed,
      speakTurn: derived.speakTurn,
      timer: derived.timer,
      ended: derived.ended,
    };
  }

  // 스냅샷의 파생 뷰를 room 상태·무장 중인 알람에서 재구성한다(C1).
  // - 사람 턴이면 speakTurn 재구성(입력창 복구). 턴 마감 알람이 있으면 timer도 함께.
  // - 종료 상태면 ended 페이로드를 room에서 재구성(종료 화면 복구).
  //
  // 원본은 storage의 'alarmTag' 키와 getAlarm()을 직접 읽었다. 그 키가 doAlarms 내부 구현이
  // 됐으므로 pending()으로 조회한다 — 이 메서드는 eotm이 첫 소비자다.
  private async derivedSnapshot(): Promise<{ speakTurn: SpeakTurn | null; timer: TimerInfo | null; ended: EndedPayload | null }> {
    const room = this.room!;
    let speakTurn: SpeakTurn | null = null;
    let timer: TimerInfo | null = null;
    let ended: EndedPayload | null = null;

    if (room.state === 'PLAYING' && room.phase === 'PLAYER_TURNS' && room.round) {
      const armed = await this.alarms.pending();
      if (armed?.tag.startsWith('inputWindow:')) {
        // 멀티 동시 입력 창 — 전원 공용 타이머만 복구 (입력창 노출은 publicRoom의 submitted/revealing으로 판단).
        timer = { phase: 'PLAYER_TURNS', deadline: armed.time, total: room.config.speakTime };
      } else {
        const entry = room.round.queue[room.round.turnIdx];
        if (entry?.kind === 'user' && room.config.mode === 'single') {
          const p = room.players.find((x) => x.id === entry.key);
          speakTurn = { current: entry.key, nick: p?.nick ?? entry.name, speakTime: room.config.speakTime };
          if (armed?.tag.startsWith('turnTimeout:')) {
            timer = { phase: 'PLAYER_TURNS', deadline: armed.time, total: room.config.speakTime };
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
    const tag = await this.alarms.fire();
    if (tag === null) {
      await this.store.clear(); // TTL 만료 = 방 소멸
      return;
    }
    if (tag.startsWith('turnTimeout:') || tag.startsWith('inputWindow:')) this.engine?.onAlarm(tag);
    // 게임 알람 처리 후 TTL로 되돌린다 (엔진이 새 알람을 걸었으면 부품이 알아서 무시한다).
    await this.alarms.ttl();
  }
}
