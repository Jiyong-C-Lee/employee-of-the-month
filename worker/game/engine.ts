// 이달의 우수사원 상태 머신: SITUATION → PLAYER_TURNS → JUDGING → RESULT → (다음/END)
// 원본 server/sycophant/engine.js 이식 — 클래스 구조·메서드·분기·문구(line())는 그대로 두고,
// 전송(bcast→bus.emit)·타이머(setInterval→timer 이벤트+alarm)·짧은 연출 지연(setTimeout→bus.delay)만 교체.
import { STRINGS, fmt, type FullPersona } from '@content';
import type {
  AdoptedInfo, FeedItem, ServerEvent, Situation, Standing, Verdict,
} from '@shared';
import { computeStandings, newSituationOrder, publicRoom, roomPersona, type RoomState } from './state';
import { ADVISORS_PER_ROUND, MAX_ROUNDS, buildSpeakQueue, pickApproaches, pickQuirks, pickRoundAdvisors, rankIdxFor, isChampion, MAX_SPEECH_CHARS } from './logic';
import { APPROACHES } from '../ai/prompts';
import { advisorTurnsBatch, judgeSpeeches, makeEpilogue, makeBridge, type Deps } from '../ai/orchestrate';
import { logger } from '../log';
import type { Candidate } from '../ai/prompts';

const JUDGING_PAUSE_MS = 900; // 마지막 발언 → 심판 돌입 사이 숨 고르기

// 발언 공개 후 다음 순번까지의 텀 — 클라이언트 타이핑 연출(글자당 ~28ms)과 보조를 맞춘다.
function speechGapMs(text: string): number {
  return Math.min(7000, 1100 + text.length * 40);
}

export type AiDeps = Deps;

// 판별 유니온(ServerEvent) 각 멤버에서 seq만 제거 — 일반 Omit은 유니온을 공통 키로 뭉갠다.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type EngineEvent = DistributiveOmit<ServerEvent, 'seq'>;

// RoomDO가 구현하는 전송·영속·스케줄 계층. 엔진은 이 인터페이스만 안다.
export interface EngineBus {
  emit(ev: EngineEvent): void; // seq 부여·피드 영속·SSE push는 RoomDO 책임
  persist(): Promise<void>;                 // room 상태 storage 저장
  schedule(at: number, tag: string): Promise<void>; // DO alarm 예약 (턴 마감)
  cancelSchedule(): Promise<void>;
  delay(ms: number, fn: () => void): void;  // 짧은 연출 지연 (setTimeout 래퍼 — 테스트에서 치환)
  /**
   * 응답을 돌려준 뒤에도 계속 돌아야 하는 작업을 런타임에 알린다(RoomDO는 ctx.waitUntil로 구현).
   * 안 알리면 Workers가 요청 종료와 함께 잘라내고, 그 구간 로그도 사라진다 — 프로덕션에서
   * 참모 대사가 조용히 mock으로 떨어지던 원인이다. 선택적이라 fakeBus는 그대로 둬도 된다.
   */
  background?(p: Promise<unknown>): void;
}

type Judged = { verdict: Verdict; source: string };

export class Engine {
  private room: RoomState;
  private bus: EngineBus;
  private deps: AiDeps;
  private persona: FullPersona;
  // 조언자 발언 배치 promise는 RoomState(직렬화 대상)에 담지 않고 엔진 인스턴스가 들고 있는다.
  // DO 재기동으로 유실되면 resumeAfterRestore/nextTurn이 라운드 불일치를 감지해 재생성한다.
  private aiBatch: Promise<{ speeches: { name: string; text: string; approach: string }[] } | null> | null = null;
  private aiBatchRound = 0;

  constructor(room: RoomState, bus: EngineBus, deps: AiDeps) {
    this.room = room;
    this.bus = bus;
    this.deps = deps;
    this.persona = roomPersona(room);
  }

  // ---- 전송·영속 헬퍼 (원본 bcast·타이머 계층 대체) ----

  // 요청 밖으로 이어지는 작업은 전부 여기를 지난다. bus.background가 없으면(테스트 fakeBus)
  // 예전처럼 그냥 띄운다.
  private bg(p: Promise<unknown>): void {
    if (this.bus.background) this.bus.background(p);
    else void p;
  }

  private persist(): void {
    this.room.lastActivity = Date.now();
    void this.bus.persist();
  }

  private emitRoomState(): void {
    this.bus.emit({ kind: 'room', room: publicRoom(this.room) });
  }

  // 방의 시나리오 아크 — 자유 모드면 null.
  private scenario() {
    const id = this.room.config.scenarioId;
    return id ? this.persona.scenarios.find((s) => s.id === id) ?? null : null;
  }

  private setPhase(phase: NonNullable<RoomState['phase']>, extra: { situation?: Situation; bridge?: string } = {}): void {
    this.room.phase = phase;
    this.bus.emit({ kind: 'phase', phase, roundNo: this.room.roundNo, ...extra });
    this.emitRoomState();
    this.persist();
  }

  private sysMsg(text: string, tag?: string): void {
    const item: FeedItem = tag
      ? { type: 'system', text, tag, ts: Date.now() }
      : { type: 'system', text, ts: Date.now() };
    this.bus.emit({ kind: 'feed', item });
  }

  // 대사 템플릿 렌더: 인물별 오버라이드(persona.lines) → 전역(STRINGS) 순. 공통 토큰 자동 주입.
  private line(key: string, vars: Record<string, unknown> = {}): string {
    const [group, name] = key.split('.') as [keyof typeof STRINGS, string];
    const template = this.persona.lines?.[name]
      ?? (STRINGS[group] as Record<string, string | string[]> | undefined)?.[name]
      ?? '';
    return fmt(template, { emoji: this.persona.emoji, personaName: this.persona.name, ...vars });
  }

  // 매초 틱 타이머 → 마감 시각(deadline) 이벤트 1발 + alarm 예약. 카운트다운은 클라가 로컬 렌더.
  private clearTimer(): void {
    this.bus.emit({ kind: 'timer', timer: null });
    void this.bus.cancelSchedule();
  }

  private startTimer(seconds: number, tag: string): void {
    const deadline = Date.now() + seconds * 1000;
    this.bus.emit({ kind: 'timer', timer: { phase: 'PLAYER_TURNS', deadline, total: seconds } });
    void this.bus.schedule(deadline, tag);
  }

  // ---- 상태 머신 ----

  start(byPlayerId: string): { ok: true } | { error: string } {
    const room = this.room;
    if (byPlayerId !== room.hostId) return { error: STRINGS.errors.notHost! };
    if (room.state !== 'LOBBY') return { error: STRINGS.errors.alreadyStarted! };
    if (room.config.mode === 'multi' && room.players.length < 2) return { error: STRINGS.errors.needTwo! };
    room.state = 'PLAYING';
    logger.gameStarted({ roomCode: room.code, nicks: room.players.map((p) => p.nick) });
    // 개회 자막(session.open)은 보스 카드가 인물 소개를 이미 렌더하므로 중복 — 발행하지 않는다.
    this.beginRound();
    return { ok: true };
  }

  // 한 판 더 — 종료된 방을 같은 멤버 그대로 로비로 리셋한다. 싱글은 즉시 재시작.
  rematch(byPlayerId: string): { ok: true } | { error: string } {
    const room = this.room;
    if (byPlayerId !== room.hostId) return { error: STRINGS.errors.notHost! };
    if (room.state !== 'ENDED') return { error: STRINGS.errors.notEnded! };
    this.clearTimer();
    room.state = 'LOBBY';
    room.phase = null;
    room.roundNo = 0;
    room.round = null;
    room.hall = [];
    room.advisorFavor = {};
    room.advisorLastQuirk = {};
    room.situationOrder = newSituationOrder(this.persona, room.config.scenarioId); // 시나리오=아크 재시작, 자유=덱 재셔플
    room.scenarioHistory = [];
    room.pendingChampion = null;
    room.endedReason = null;
    room.feed = []; // 지난 판 피드는 비운다 (seq는 계속 증가 — 클라 순서 보장)
    for (const p of room.players) {
      p.favor = 0;
      p.rank = this.persona.ranks[0]!;
    }
    this.aiBatch = null;
    this.aiBatchRound = 0;
    logger.rematch({ roomCode: room.code, players: room.players.length });
    this.emitRoomState();
    this.persist();
    // 싱글은 로비 없이 바로 재시작 (방 생성과 동일 동작)
    if (room.config.mode === 'single') return this.start(byPlayerId);
    return { ok: true };
  }

  private beginRound(): void {
    const room = this.room;
    room.roundNo += 1;
    // 섞어둔 상황 덱에서 뽑는다. 구버전 스냅샷(덱 없음)은 정의 순서로 폴백.
    const situationIdx = room.situationOrder?.[room.roundNo - 1] ?? room.roundNo - 1;
    const situation = this.persona.situations[situationIdx];
    if (!situation) {
      this.endByExhaustion();
      return;
    }
    // 시나리오 2라운드부터: 직전 라운드 기록의 결과(outcome)가 이번 상황의 브릿지 대사가 된다.
    // 아직 생성이 안 끝났거나 mock 폴백(빈 문자열)이면 브릿지 없이 진행 — 연출 레이어일 뿐이다.
    const bridge = this.scenario() && room.roundNo > 1 ? room.scenarioHistory?.at(-1)?.outcome : undefined;
    room.round = { situation, ...(bridge ? { bridge } : {}), speeches: [], queue: [], turnIdx: 0, skipped: [], usedApproaches: [], verdict: null, submissions: {}, revealing: false };
    logger.roundStarted({ roomCode: room.code, roundNo: room.roundNo, situation: situation.text });
    this.setPhase('SITUATION', { situation, ...(bridge ? { bridge } : {}) });
    // 라운드 자막(round.intro·round.question)은 만화 UI의 상황 카드(SituationCut)가 본문·질문을 이미 렌더하므로 중복 — 발행하지 않는다.
    // 자동 진행하지 않는다 — 전원이 상황을 읽는 동안 대기하고, 방장의 proceed로 발언(AI 배치 요청)을 시작한다.
  }

  // 참모 회의 시작 (방장 전용) — 상황을 다 읽은 뒤 눌러야 AI 대사 생성이 시작된다.
  proceed(byPlayerId: string): { ok: true } | { error: string } {
    if (byPlayerId !== this.room.hostId) return { error: STRINGS.errors.notHostNext! };
    if (this.room.state !== 'PLAYING' || this.room.phase !== 'SITUATION') return { error: STRINGS.errors.notNow! };
    this.beginSpeeches();
    return { ok: true };
  }

  // 조언자 발언 배치를 한 번의 콜로 생성. promise는 인스턴스에 보관(라운드 번호로 유효성 판정).
  private startAiBatch(): void {
    const room = this.room;
    const aiAdvisors = room.round!.queue
      .filter((e) => e.kind === 'ai')
      .map((e) => this.persona.advisors.find((a) => a.name === e.name))
      .filter((a): a is FullPersona['advisors'][number] => Boolean(a));
    // 라운드별 버릇 샘플링 — 뽑힌 버릇은 다음 라운드 제외 목록에 기록한다.
    const quirks = pickQuirks(aiAdvisors, room.advisorLastQuirk ?? {});
    room.advisorLastQuirk = room.advisorLastQuirk ?? {};
    for (const [name, q] of Object.entries(quirks)) {
      if (q) room.advisorLastQuirk[name] = q;
    }
    // 해법 축도 코드가 배정 — 모델 자율에 맡기면 같은 축으로 쏠려 대사가 반복된다.
    const approaches = pickApproaches(aiAdvisors.map((a) => a.name), APPROACHES);
    this.aiBatch = aiAdvisors.length > 0
      ? advisorTurnsBatch(this.deps, {
        persona: this.persona,
        advisors: aiAdvisors,
        situation: room.round!.situation,
        difficulty: room.config.difficulty,
        quirks,
        approaches,
      }).then((batch) => {
        // 참모 대사도 로그에 남긴다 — 품질 검수·모범답안 수집용 (source로 mock 폴백 여부 구분).
        logger.advisorSpeeches({
          roomCode: room.code,
          roundNo: room.roundNo,
          source: batch.source,
          speeches: batch.speeches.map((s) => ({ name: s.name, approach: s.approach, text: s.text })),
        });
        return batch;
      }).catch((e) => {
        logger.error({ where: 'engine.advisorBatch', error: e instanceof Error ? e.message : String(e) });
        return null;
      })
      : Promise.resolve(null);
    this.aiBatchRound = room.roundNo;
    // 참모 배치는 응답 이후에도 도는 LLM 대기다. 런타임에 알려 잘리지 않게 한다.
    if (this.aiBatch) this.bg(this.aiBatch);
  }

  // 통합 순번: AI 조언자와 사람이 총애 높은 순으로 섞여 말한다. 뒤 순번이 앞 발언을 밟는 구조.
  private beginSpeeches(): void {
    if (this.room.state !== 'PLAYING' || this.room.phase !== 'SITUATION') return;
    const room = this.room;
    // AI 출전 수: 싱글은 고정, 멀티는 정원의 빈자리만큼 채운다 (6명 방에 2명 입장 → AI 4명, 만석이면 0명).
    // 참모 풀에서 라운드마다 새로 발탁 — 한 판 안에서도 여러 참모가 번갈아 등장한다.
    const aiCount = room.config.mode === 'single'
      ? ADVISORS_PER_ROUND
      : Math.max(0, room.config.maxPlayers - room.players.length);
    room.round!.queue = buildSpeakQueue({
      advisors: pickRoundAdvisors(this.persona.advisors, aiCount),
      advisorFavor: room.advisorFavor,
      players: room.players,
      roundNo: room.roundNo,
    });
    room.round!.turnIdx = 0;

    // 조언자 전원 대사를 미리 생성 (레이트리밋 대응) — 공개는 순번대로 한 명씩.
    this.startAiBatch();

    this.setPhase('PLAYER_TURNS');
    // "발언 시작" 안내 자막은 만화 UI에서 불필요 — 규칙(160자·제한시간)은 입력창·타이머가 보여준다.
    if (room.config.mode === 'multi') {
      // 멀티: 전원이 동시에 작성하는 입력 창을 연다. 한 명씩 기다리는 릴레이 방식은 대기 시간이 지루해서 폐기.
      // 제한시간은 라운드당 한 번, 전원 제출(또는 마감) 후 순번대로 공개한다.
      if (room.config.speakTime > 0) {
        this.startTimer(room.config.speakTime, `inputWindow:${room.roundNo}`);
      }
      this.persist();
      return;
    }
    this.bg(this.nextTurn());
  }

  // 멀티: 전원 제출·마감 후 순차 공개 시작. 공개 루프는 nextTurn이 담당한다(유저 발언은 submissions에서 꺼냄).
  private startReveal(): void {
    const room = this.room;
    if (room.state !== 'PLAYING' || room.phase !== 'PLAYER_TURNS' || room.round!.revealing) return;
    this.clearTimer();
    room.round!.revealing = true;
    this.emitRoomState();
    this.persist();
    this.bg(this.nextTurn());
  }

  private async nextTurn(): Promise<void> {
    const room = this.room;
    if (room.state !== 'PLAYING' || room.phase !== 'PLAYER_TURNS') return;
    const queue = room.round!.queue;
    if (room.round!.turnIdx >= queue.length) {
      // 마지막 발언의 타이핑 연출이 끝날 때까지 숨 고르고 심판으로.
      this.bus.delay(JUDGING_PAUSE_MS, () => { this.bg(this.beginJudging()); });
      return;
    }
    const entry = queue[room.round!.turnIdx]!;

    // 재기동 직후 같은 순번이 두 번 공개되는 것 방지 — 이미 발언이 기록된 순번은 건너뛴다.
    if (room.round!.speeches.some((s) => s.key === entry.key)) {
      room.round!.turnIdx += 1;
      this.bg(this.nextTurn());
      return;
    }

    // AI 조언자 차례: 미리 배치 생성해 둔 대사를 순번대로 공개.
    if (entry.kind === 'ai') {
      const roundNo = room.roundNo;
      this.bus.emit({ kind: 'turn', turn: { current: entry.key, nick: entry.name, speakTime: 0 } });
      const advisor = this.persona.advisors.find((a) => a.name === entry.name)!;
      let text: string = STRINGS.fallback.advisorSpeechFail ?? '';
      if (this.aiBatchRound !== roundNo || !this.aiBatch) this.startAiBatch(); // 재기동 후 유실분 재생성
      const batch = await this.aiBatch;
      const speechItem = batch?.speeches?.find((s) => s.name === entry.name);
      if (speechItem) {
        text = speechItem.text;
        if (speechItem.approach) room.round!.usedApproaches.push(speechItem.approach);
      }
      if (room.state !== 'PLAYING' || room.roundNo !== roundNo || room.phase !== 'PLAYER_TURNS') return;
      room.round!.speeches.push({ key: entry.key, name: entry.name, kind: 'ai', text });
      this.bus.emit({
        kind: 'feed',
        item: { type: 'speech', speakerType: 'ai', name: entry.name, emoji: advisor.emoji, style: advisor.style, text, ts: Date.now() },
      });
      this.emitRoomState(); // 만화 컷 UI가 발언 스냅샷으로 그린다
      this.persist();
      this.bus.delay(speechGapMs(text), () => {
        room.round!.turnIdx += 1;
        this.bg(this.nextTurn());
      });
      return;
    }

    // 사람 차례 (멀티 공개 루프): 미리 제출된 본문을 순번대로 공개한다.
    if (room.config.mode === 'multi') {
      const text = room.round!.submissions?.[entry.key];
      if (!text) {
        if (!room.round!.skipped.includes(entry.key)) room.round!.skipped.push(entry.key);
        room.round!.turnIdx += 1;
        this.bg(this.nextTurn());
        return;
      }
      const p = room.players.find((x) => x.id === entry.key);
      room.round!.speeches.push({ key: entry.key, name: entry.name, kind: 'user', text });
      this.bus.emit({
        kind: 'feed',
        item: { type: 'speech', speakerType: 'user', playerId: entry.key, name: entry.name, rank: p?.rank, text, ts: Date.now() },
      });
      this.emitRoomState();
      this.persist();
      this.bus.delay(speechGapMs(text), () => {
        room.round!.turnIdx += 1;
        this.bg(this.nextTurn());
      });
      return;
    }

    // 사람 차례 (싱글 릴레이): 입력을 기다린다.
    const cur = room.players.find((p) => p.id === entry.key);
    if (!cur?.connected) {
      room.round!.skipped.push(entry.key);
      room.round!.turnIdx += 1;
      this.bg(this.nextTurn());
      return;
    }
    this.bus.emit({ kind: 'turn', turn: { current: entry.key, nick: cur.nick, speakTime: room.config.speakTime } });
    if (room.config.speakTime > 0) {
      this.startTimer(room.config.speakTime, `turnTimeout:${room.roundNo}:${room.round!.turnIdx}`);
    } else {
      this.clearTimer(); // 싱글: 제한시간 없음 — 발언할 때까지 대기
    }
    this.persist();
  }

  // 턴 마감 alarm. 태그의 라운드·턴이 현재와 일치할 때만 기권 처리 (지연 알람·경합 방지).
  onAlarm(tag: string): void {
    const room = this.room;

    // 멀티 입력 창 마감 — 미제출자는 기권 처리하고 제출분만 순차 공개.
    const w = /^inputWindow:(\d+)$/.exec(tag);
    if (w) {
      if (room.state !== 'PLAYING' || room.phase !== 'PLAYER_TURNS') return;
      if (room.roundNo !== Number(w[1]) || room.round!.revealing) return;
      const missed = room.players.filter((p) => !room.round!.submissions?.[p.id]);
      for (const p of missed) room.round!.skipped.push(p.id);
      if (missed.length > 0) this.sysMsg(this.line('round.inputTimeout', { count: missed.length }), 'timeout');
      this.startReveal();
      return;
    }

    const m = /^turnTimeout:(\d+):(\d+)$/.exec(tag);
    if (!m) return;
    const roundNo = Number(m[1]);
    const turnIdx = Number(m[2]);
    if (room.state !== 'PLAYING' || room.phase !== 'PLAYER_TURNS') return;
    if (room.roundNo !== roundNo || room.round!.turnIdx !== turnIdx) return;
    const entry = room.round!.queue[turnIdx];
    if (!entry || entry.kind !== 'user') return;
    this.clearTimer();
    const cur = room.players.find((p) => p.id === entry.key);
    room.round!.skipped.push(entry.key);
    this.sysMsg(this.line('round.timeout', { nick: cur?.nick ?? '' }), 'timeout');
    room.round!.turnIdx += 1;
    this.persist();
    this.bg(this.nextTurn());
  }

  handleSpeak(playerId: string, text: string): { error: string } | undefined {
    const room = this.room;
    if (room.phase !== 'PLAYER_TURNS') return;

    // 멀티: 동시 입력 창 — 순번 없이 제출을 받고, 전원 제출되면 순차 공개를 시작한다.
    if (room.config.mode === 'multi') {
      if (room.round!.revealing) return { error: STRINGS.errors.notYourTurn! };
      const p = room.players.find((x) => x.id === playerId);
      if (!p) return { error: STRINGS.errors.notYourTurn! };
      if (room.round!.submissions?.[playerId]) return { error: STRINGS.errors.alreadySubmitted ?? STRINGS.errors.notYourTurn! };
      const cleanMulti = String(text || '').trim().slice(0, MAX_SPEECH_CHARS);
      if (!cleanMulti) return;
      room.round!.submissions = { ...(room.round!.submissions ?? {}), [playerId]: cleanMulti };
      logger.speechSubmitted({ roomCode: room.code, roundNo: room.roundNo, nick: p.nick, text: cleanMulti });
      this.emitRoomState(); // 제출 인원 표시 갱신 (본문은 비공개)
      this.persist();
      // 전원 제출(끊긴 사람은 제외) 시 마감 전이라도 바로 공개 시작.
      const waiting = room.players.some((x) => x.connected && !room.round!.submissions?.[x.id]);
      if (!waiting) this.startReveal();
      return;
    }

    const entry = room.round!.queue[room.round!.turnIdx];
    if (!entry || entry.kind !== 'user' || entry.key !== playerId) {
      // 개인 채널 없음 — {error} 반환 → RoomDO가 HTTP 400으로 응답.
      return { error: STRINGS.errors.notYourTurn! };
    }
    const clean = String(text || '').trim().slice(0, MAX_SPEECH_CHARS);
    if (!clean) return;
    this.clearTimer();
    const p = room.players.find((x) => x.id === playerId)!;
    room.round!.speeches.push({ key: playerId, name: p.nick, kind: 'user', text: clean });
    logger.speechSubmitted({ roomCode: room.code, roundNo: room.roundNo, nick: p.nick, text: clean });
    this.bus.emit({
      kind: 'feed',
      item: { type: 'speech', speakerType: 'user', playerId, name: p.nick, rank: p.rank, text: clean, ts: Date.now() },
    });
    this.emitRoomState(); // 만화 컷 UI가 발언 스냅샷으로 그린다
    room.round!.turnIdx += 1;
    this.persist();
    this.bg(this.nextTurn());
    return;
  }

  private async beginJudging(): Promise<void> {
    if (this.room.phase === 'JUDGING' || this.room.phase === 'RESULT') return;
    this.setPhase('JUDGING');
    // 심판 자막(round.judging)은 분노 게이지 스트립이 '검토 중…'을 이미 렌더하므로 중복 — 발행하지 않는다.

    const room = this.room;
    // 채택 후보: 유저 발언 + (aiCompete면 조언자 발언). order = 발언 순서.
    const candidates: Candidate[] = room.round!.speeches
      .filter((s) => s.kind === 'user' || room.config.aiCompete)
      .map((s, i) => ({ key: s.key, name: s.name, kind: s.kind, order: i, text: s.text }));

    let judged: Judged;
    try {
      judged = await judgeSpeeches(this.deps, {
        persona: this.persona, situation: room.round!.situation, candidates, difficulty: room.config.difficulty,
        // 시나리오: 지난 라운드 기록을 기억한 채 채점 (재탕·지난 결과와 어긋난 발언 감점). 토큰 상한으로 최근 3개.
        history: this.scenario() ? (room.scenarioHistory ?? []).slice(-3) : [],
      });
    } catch (e) {
      logger.error({ where: 'engine.judge', error: e instanceof Error ? e.message : String(e) });
      judged = { verdict: { perSpeaker: [], adoptedKey: null, adoptReason: '', totals: {} }, source: 'error' };
    }
    if (room.state !== 'PLAYING') return;
    this.applyVerdict(judged, candidates);
  }

  private applyVerdict(judged: Judged, candidates: Candidate[]): void {
    const room = this.room;
    const verdict = judged.verdict;
    room.round!.verdict = verdict;

    let adoptedName: string | null = null;
    let adoptedInfo: AdoptedInfo | null = null; // 액자(이달의 우수사원) 연출용
    // 멀티는 1위(채택) +2, 2위 +1 — 라운드 상한 안에 승부가 나도록 보상을 가파르게 준다. 싱글은 채택 +1.
    const topGain = room.config.mode === 'multi' ? 2 : 1;
    const grantFavor = (key: string, name: string, kind: 'ai' | 'user', gain: number): void => {
      if (kind === 'user') {
        const p = room.players.find((x) => x.id === key);
        if (!p) return;
        p.favor += gain;
        p.rank = this.persona.ranks[rankIdxFor(p.favor, this.persona.ranks)]!;
        if (isChampion(p.favor, this.persona.ranks)) room.pendingChampion = room.pendingChampion ?? p.id;
      } else {
        room.advisorFavor[name] = (room.advisorFavor[name] || 0) + gain;
      }
    };
    if (verdict.adoptedKey) {
      const adopted = candidates.find((c) => c.key === verdict.adoptedKey);
      adoptedName = adopted?.name ?? null;
      if (adopted) {
        grantFavor(adopted.key, adopted.name, adopted.kind, topGain);
        if (adopted.kind === 'user') {
          const p = room.players.find((x) => x.id === adopted.key)!;
          adoptedInfo = { key: p.id, name: p.nick, kind: 'user', rank: p.rank };
        } else {
          const adv = this.persona.advisors.find((a) => a.name === adopted.name);
          adoptedInfo = { key: adopted.key, name: adopted.name, kind: 'ai', emoji: adv?.emoji };
        }
      }
      // 멀티 2위: 총점 차순위(채택자 제외, 0점 초과)에게 +1.
      if (room.config.mode === 'multi') {
        const runnerUp = candidates
          .filter((c) => c.key !== verdict.adoptedKey && (verdict.totals[c.key] ?? 0) > 0)
          .sort((a, b) => (verdict.totals[b.key] ?? 0) - (verdict.totals[a.key] ?? 0))[0];
        if (runnerUp) grantFavor(runnerUp.key, runnerUp.name, runnerUp.kind, 1);
      }
      if (adoptedInfo) room.hall.push({ roundNo: room.roundNo, ...adoptedInfo });
    }

    // 시나리오: 라운드 기록 누적 + 다음 상황으로 넘어가는 브릿지를 미리 생성해 둔다(RESULT 열람 시간 활용).
    // 브릿지는 판정 기억의 "결과"이기도 하다 — 생성 실패·미완이면 다음 라운드가 브릿지 없이 뜰 뿐 진행 무영향.
    if (this.scenario()) {
      const adopted = verdict.adoptedKey ? candidates.find((c) => c.key === verdict.adoptedKey) ?? null : null;
      const history = (room.scenarioHistory = room.scenarioHistory ?? []);
      const entry: NonNullable<RoomState['scenarioHistory']>[number] = {
        situationText: room.round!.situation.text,
        adoptedText: adopted?.text ?? null,
      };
      history.push(entry);
      const roundNo = room.roundNo;
      const nextIdx = room.situationOrder?.[roundNo]; // 다음 라운드(roundNo+1)의 상황
      const next = nextIdx != null ? this.persona.situations[nextIdx] : undefined;
      if (next && judged.source !== 'debug') {
        this.bg(makeBridge(this.deps, {
          persona: this.persona,
          prevSituation: room.round!.situation,
          adopted: adopted ? { name: adopted.name, text: adopted.text } : null,
          nextSituation: next,
        }).then((r) => {
          logger.bridge({ roomCode: room.code, roundNo, source: r.source, bridge: r.bridge });
          if (!r.bridge || this.room.state !== 'PLAYING') return;
          entry.outcome = r.bridge;
          this.persist();
        }).catch((e) => logger.error({ where: 'engine.bridge', error: e instanceof Error ? e.message : String(e) })));
      }
    }

    this.setPhase('RESULT');
    logger.verdictIssued({
      roomCode: room.code,
      roundNo: room.roundNo,
      provider: judged.source,
      adoptedNick: adoptedName,
      totals: verdict.totals,
      comments: verdict.perSpeaker.map((s) => s.comment),
    });
    this.bus.emit({
      kind: 'feed',
      item: {
        type: 'verdict',
        roundNo: room.roundNo,
        situation: room.round!.situation,
        verdict,
        adoptedName,
        adopted: adoptedInfo,
        standings: this.standings(),
        source: judged.source,
        ts: Date.now(),
      },
    });
    if (verdict.adoptedKey) {
      // 채택 안내 sysMsg는 보스 총평 컷과 중복이라 내보내지 않는다 (승진 확정만 자막으로).
      if (room.pendingChampion) {
        const champ = room.players.find((p) => p.id === room.pendingChampion);
        this.sysMsg(this.line('round.champion', { nick: champ?.nick ?? '', topRank: this.persona.ranks.at(-1) }), 'champion');
      }
      // 에필로그는 비동기 연출 레이어 — 실패해도 진행 무관. 디버그 판정은 생략.
      const adopted = candidates.find((c) => c.key === verdict.adoptedKey);
      if (judged.source !== 'debug' && adopted) {
        makeEpilogue(this.deps, { persona: this.persona, situation: room.round!.situation, adopted: { name: adopted.name, text: adopted.text } })
          .then((r) => {
            // 에필로그 본문도 로그에 남긴다 — 시점 이탈 같은 품질 문제 추적용.
            logger.epilogue({ roomCode: room.code, roundNo: room.roundNo, source: r.source, adoptedName: adopted.name, story: r.story });
            if (this.room.state !== 'PLAYING' || this.room.roundNo !== room.roundNo) return;
            this.bus.emit({ kind: 'feed', item: { type: 'epilogue', roundNo: room.roundNo, story: r.story, source: r.source, ts: Date.now() } });
          })
          .catch((e) => logger.error({ where: 'engine.epilogue', error: e instanceof Error ? e.message : String(e) }));
      }
    }
    this.emitRoomState();
    this.persist();
  }

  private standings(): Standing[] {
    return computeStandings(this.room);
  }

  nextRound(byPlayerId: string): { ok: true } | { error: string } {
    if (byPlayerId !== this.room.hostId) return { error: STRINGS.errors.notHostNext! };
    if (this.room.phase !== 'RESULT') return { error: STRINGS.errors.notNow! };
    this.advanceRound();
    return { ok: true };
  }

  private advanceRound(): void {
    if (this.room.pendingChampion) {
      const champ = this.room.players.find((p) => p.id === this.room.pendingChampion);
      this.endSession(this.line('session.championReason', { nick: champ?.nick ?? '', topRank: this.persona.ranks.at(-1) }));
      return;
    }
    // 라운드 상한(방 설정) — 최고 직급 등극자가 없으면 최고 총애자를 '올해의 사원'으로 발표하고 끝낸다.
    // 구버전 방 스냅샷(config.maxRounds 없음)은 기본 상한으로 폴백.
    const cap = this.room.config.maxRounds ?? MAX_ROUNDS;
    if (this.room.roundNo >= cap) {
      // 시나리오: 아크 비트 소진 = 저작된 종장 문구로 막을 내린다 (뒤에 우승 발표를 잇는다).
      const sc = this.scenario();
      if (sc) this.endByScenarioFinale(sc.finaleText, cap);
      else this.endByMaxRounds(cap);
      return;
    }
    this.beginRound();
  }

  private endByScenarioFinale(finaleText: string, cap: number): void {
    const standings = this.standings();
    const top = standings[0];
    const winnerLine = top && top.favor > 0
      ? this.line('session.maxRoundsMvp', { maxRounds: cap, nick: top.nick, favor: top.favor })
      : this.line('session.maxRoundsNone', { maxRounds: cap });
    this.endSession(`${finaleText} ${winnerLine}`);
  }

  private endByMaxRounds(cap: number): void {
    const standings = this.standings();
    const top = standings[0];
    this.endSession(top && top.favor > 0
      ? this.line('session.maxRoundsMvp', { maxRounds: cap, nick: top.nick, favor: top.favor })
      : this.line('session.maxRoundsNone', { maxRounds: cap }));
  }

  // 플레이테스트용 디버그 액션 (클라이언트 ?debug=1 패널에서 호출).
  // adoptMe: 이번 라운드를 즉시 "나 채택"으로 판정 / noAdopt: 즉시 채택 없음 / next: RESULT에서 강제 진행.
  debug(playerId: string, action: string): { ok: true } | { error: string } {
    const room = this.room;
    if (room.state !== 'PLAYING') return { error: STRINGS.errors.debugNotPlaying! };
    if (action === 'adoptMe' || action === 'noAdopt') {
      if (!['SITUATION', 'PLAYER_TURNS', 'JUDGING'].includes(room.phase!)) {
        return { error: STRINGS.errors.debugRoundOnly! };
      }
      const p = room.players.find((x) => x.id === playerId);
      if (!p) return { error: STRINGS.errors.debugNoPlayer! };
      this.clearTimer();
      const adopt = action === 'adoptMe';
      const axisScores = Object.fromEntries(this.persona.axes.map((ax) => [ax, adopt ? 9 : 1]));
      const total = Object.values(axisScores).reduce((a, b) => a + b, 0);
      const candidates: Candidate[] = [{ key: p.id, name: p.nick, kind: 'user', order: 0, text: STRINGS.fallback.debugSpeech! }];
      const verdict: Verdict = {
        perSpeaker: [{ key: p.id, name: p.nick, kind: 'user', axisScores, total, comment: STRINGS.fallback.debugComment! }],
        adoptedKey: adopt ? p.id : null,
        adoptReason: adopt ? STRINGS.fallback.debugReason! : '',
        totals: { [p.id]: total },
      };
      this.applyVerdict({ verdict, source: 'debug' }, candidates);
      return { ok: true };
    }
    if (action === 'next') {
      if (room.phase !== 'RESULT') return { error: STRINGS.errors.debugResultOnly! };
      this.advanceRound();
      return { ok: true };
    }
    return { error: STRINGS.errors.debugUnknown! };
  }

  // 상황 풀 소진: 멀티=총애 최다 우승(동률 공동), 싱글=실패 엔딩.
  private endByExhaustion(): void {
    const room = this.room;
    const standings = this.standings();
    if (room.config.mode === 'multi') {
      const top = standings[0]?.favor ?? 0;
      const winners = standings.filter((s) => s.favor === top && top > 0).map((s) => s.nick);
      this.endSession(winners.length > 0
        ? this.line('session.exhaustMultiWin', { winners: winners.join(', ') })
        : this.line('session.exhaustMultiNone'));
    } else {
      const me = standings[0];
      this.endSession(this.line('session.exhaustSingle', { topRank: this.persona.ranks.at(-1), finalRank: me?.rank }));
    }
  }

  private endSession(reason: string): void {
    const room = this.room;
    this.clearTimer();
    room.state = 'ENDED';
    room.phase = 'END';
    room.endedReason = reason; // 재기동 후 스냅샷 ended 재구성용
    const standings = this.standings();
    logger.gameEnded({ roomCode: room.code, rounds: room.roundNo, winnerNick: standings[0]?.nick, reason });
    // hall = 라운드별 채택자 (명예의 전당 연출용)
    this.bus.emit({ kind: 'ended', payload: { reason, standings, hall: room.hall } });
    this.sysMsg(this.line('session.end', { reason }));
    this.emitRoomState();
    this.persist();
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.room.players.find((x) => x.id === playerId);
    if (p) {
      p.connected = connected;
      this.emitRoomState();
      this.persist();
    }
  }

  // DO 재기동 시 AI 턴/JUDGING에 멈춘 진행을 재개. 각 재킥은 idempotent(phase 가드) 하다.
  // SITUATION은 재킥하지 않는다 — 방장의 proceed를 기다리는 대기 상태가 정상이다.
  resumeAfterRestore(): void {
    const room = this.room;
    if (room.state !== 'PLAYING' || !room.round) return;
    if (room.phase === 'PLAYER_TURNS') {
      if (room.config.mode === 'multi' && !room.round.revealing) {
        // 멀티 입력 창 중 재기동 — inputWindow 알람은 DO storage에 살아 있으므로 대기만 하면 된다.
        // 다만 알람 발동 직전/유실 시에도 전원 제출 상태면 즉시 공개로 넘어간다.
        const waiting = room.players.some((x) => x.connected && !room.round!.submissions?.[x.id]);
        if (!waiting) this.startReveal();
      } else if (room.round.turnIdx >= room.round.queue.length) {
        // 발언 종료 후 심판 대기 창에서 재기동 — beginJudging 재킥으로 정지 방지(I5).
        this.bg(this.beginJudging());
      } else {
        // 공개 루프·(싱글)사람 턴 모두 nextTurn으로 재개 — 이미 공개된 순번은 중복 가드가 건너뛴다(C1).
        this.bg(this.nextTurn());
      }
    } else if (room.phase === 'JUDGING') {
      this.bg(this.beginJudging());
    }
  }
}
