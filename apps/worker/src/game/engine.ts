// 이달의 사원 상태 머신: SITUATION → PLAYER_TURNS → JUDGING → RESULT → (다음/END)
// 원본 server/sycophant/engine.js 이식 — 클래스 구조·메서드·분기·문구(line())는 그대로 두고,
// 전송(bcast→bus.emit)·타이머(setInterval→timer 이벤트+alarm)·짧은 연출 지연(setTimeout→bus.delay)만 교체.
import { getPersona, STRINGS, fmt, type FullPersona } from '@eotm/content';
import type {
  AdoptedInfo, FeedItem, ServerEvent, Situation, Standing, Verdict,
} from '@eotm/shared';
import { computeStandings, publicRoom, type RoomState } from './state';
import { buildSpeakQueue, rankIdxFor, isChampion, MAX_SPEECH_CHARS } from './logic';
import { advisorTurnsBatch, judgeSpeeches, makeEpilogue, type Deps } from '../ai/orchestrate';
import { logger } from '../log';
import type { Candidate } from '../ai/prompts';

const REVEAL_DELAY_SEC = 2.5;
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
    const persona = getPersona(room.config.personaId);
    if (!persona) throw new Error(STRINGS.errors.noPersona);
    this.persona = persona;
  }

  // ---- 전송·영속 헬퍼 (원본 bcast·타이머 계층 대체) ----

  private persist(): void {
    this.room.lastActivity = Date.now();
    void this.bus.persist();
  }

  private emitRoomState(): void {
    this.bus.emit({ kind: 'room', room: publicRoom(this.room) });
  }

  private setPhase(phase: NonNullable<RoomState['phase']>, extra: { situation?: Situation } = {}): void {
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
    this.sysMsg(this.line('session.open', { intro: this.persona.intro }));
    this.beginRound();
    return { ok: true };
  }

  private beginRound(): void {
    const room = this.room;
    room.roundNo += 1;
    const situation = this.persona.situations[room.roundNo - 1];
    if (!situation) {
      this.endByExhaustion();
      return;
    }
    room.round = { situation, speeches: [], queue: [], turnIdx: 0, skipped: [], usedApproaches: [], verdict: null };
    logger.roundStarted({ roomCode: room.code, roundNo: room.roundNo, situation: situation.text });
    this.setPhase('SITUATION', { situation });
    // 라운드 자막(round.intro·round.question)은 만화 UI의 상황 카드(SituationCut)가 본문·질문을 이미 렌더하므로 중복 — 발행하지 않는다.
    this.bus.delay(REVEAL_DELAY_SEC * 1000, () => this.beginSpeeches());
  }

  // 조언자 발언 배치를 한 번의 콜로 생성. promise는 인스턴스에 보관(라운드 번호로 유효성 판정).
  private startAiBatch(): void {
    const room = this.room;
    const aiAdvisors = room.round!.queue
      .filter((e) => e.kind === 'ai')
      .map((e) => this.persona.advisors.find((a) => a.name === e.name))
      .filter((a): a is FullPersona['advisors'][number] => Boolean(a));
    this.aiBatch = aiAdvisors.length > 0
      ? advisorTurnsBatch(this.deps, {
        persona: this.persona,
        advisors: aiAdvisors,
        situation: room.round!.situation,
        difficulty: room.config.difficulty,
      }).catch((e) => {
        logger.error({ where: 'engine.advisorBatch', error: e instanceof Error ? e.message : String(e) });
        return null;
      })
      : Promise.resolve(null);
    this.aiBatchRound = room.roundNo;
  }

  // 통합 순번: AI 조언자와 사람이 총애 높은 순으로 섞여 말한다. 뒤 순번이 앞 발언을 밟는 구조.
  private beginSpeeches(): void {
    if (this.room.state !== 'PLAYING' || this.room.phase !== 'SITUATION') return;
    const room = this.room;
    room.round!.queue = buildSpeakQueue({
      advisors: this.persona.advisors,
      advisorFavor: room.advisorFavor,
      players: room.players,
      roundNo: room.roundNo,
    });
    room.round!.turnIdx = 0;

    // 조언자 전원 대사를 미리 생성 (레이트리밋 대응) — 공개는 순번대로 한 명씩.
    this.startAiBatch();

    this.setPhase('PLAYER_TURNS');
    // "발언 시작" 안내 자막은 만화 UI에서 불필요 — 규칙(160자·제한시간)은 입력창·타이머가 보여준다.
    void this.nextTurn();
  }

  private async nextTurn(): Promise<void> {
    const room = this.room;
    if (room.state !== 'PLAYING' || room.phase !== 'PLAYER_TURNS') return;
    const queue = room.round!.queue;
    if (room.round!.turnIdx >= queue.length) {
      // 마지막 발언의 타이핑 연출이 끝날 때까지 숨 고르고 심판으로.
      this.bus.delay(JUDGING_PAUSE_MS, () => { void this.beginJudging(); });
      return;
    }
    const entry = queue[room.round!.turnIdx]!;

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
        void this.nextTurn();
      });
      return;
    }

    // 사람 차례.
    const cur = room.players.find((p) => p.id === entry.key);
    if (!cur?.connected) {
      room.round!.skipped.push(entry.key);
      room.round!.turnIdx += 1;
      void this.nextTurn();
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
    void this.nextTurn();
  }

  handleSpeak(playerId: string, text: string): { error: string } | undefined {
    const room = this.room;
    if (room.phase !== 'PLAYER_TURNS') return;
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
    void this.nextTurn();
    return;
  }

  private async beginJudging(): Promise<void> {
    if (this.room.phase === 'JUDGING' || this.room.phase === 'RESULT') return;
    this.setPhase('JUDGING');
    this.sysMsg(this.line('round.judging'));

    const room = this.room;
    // 채택 후보: 유저 발언 + (aiCompete면 조언자 발언). order = 발언 순서.
    const candidates: Candidate[] = room.round!.speeches
      .filter((s) => s.kind === 'user' || room.config.aiCompete)
      .map((s, i) => ({ key: s.key, name: s.name, kind: s.kind, order: i, text: s.text }));

    let judged: Judged;
    try {
      judged = await judgeSpeeches(this.deps, {
        persona: this.persona, situation: room.round!.situation, candidates, difficulty: room.config.difficulty,
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
    if (verdict.adoptedKey) {
      const adopted = candidates.find((c) => c.key === verdict.adoptedKey);
      adoptedName = adopted?.name ?? null;
      if (adopted?.kind === 'user') {
        const p = room.players.find((x) => x.id === adopted.key);
        if (p) {
          p.favor += 1;
          p.rank = this.persona.ranks[rankIdxFor(p.favor, this.persona.ranks)]!;
          if (isChampion(p.favor, this.persona.ranks)) room.pendingChampion = p.id;
          adoptedInfo = { key: p.id, name: p.nick, kind: 'user', rank: p.rank };
        }
      } else if (adopted) {
        room.advisorFavor[adopted.name] = (room.advisorFavor[adopted.name] || 0) + 1;
        const adv = this.persona.advisors.find((a) => a.name === adopted.name);
        adoptedInfo = { key: adopted.key, name: adopted.name, kind: 'ai', emoji: adv?.emoji };
      }
      if (adoptedInfo) room.hall.push({ roundNo: room.roundNo, ...adoptedInfo });
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
    this.beginRound();
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
    logger.gameEnded({ roomCode: room.code, rounds: room.roundNo, winnerNick: standings[0]?.nick });
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

  // DO 재기동 시 SITUATION/AI 턴/JUDGING에 멈춘 진행을 재개. 각 재킥은 idempotent(phase 가드) 하다.
  resumeAfterRestore(): void {
    const room = this.room;
    if (room.state !== 'PLAYING' || !room.round) return;
    if (room.phase === 'SITUATION') {
      this.beginSpeeches();
    } else if (room.phase === 'PLAYER_TURNS') {
      if (room.round.turnIdx >= room.round.queue.length) {
        // 발언 종료 후 심판 대기 창에서 재기동 — beginJudging 재킥으로 정지 방지(I5).
        void this.beginJudging();
      } else {
        // AI·사람 턴 모두 nextTurn으로 재발행 — turn 이벤트 재발행과 (멀티)turnTimeout·(싱글)TTL 알람을 되살린다(C1).
        void this.nextTurn();
      }
    } else if (room.phase === 'JUDGING') {
      void this.beginJudging();
    }
  }
}
