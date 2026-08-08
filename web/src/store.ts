// 게임 상태 store. 원본(ai-debate-game/client/src/store.js)의 useGame() 소비 인터페이스를
// 그대로 유지해 화면 이식(다음 태스크) 시 diff를 최소화한다. 전송 방식만 socket.io → SSE + REST로 교체.
import { useEffect, useMemo, useRef, useState, useReducer } from 'react';
import type { EndedPayload, FeedItem, Phase, PublicRoom, ServerEvent, SpeakTurn, TimerInfo } from '@shared';
import { post } from './api/actions';
import { subscribe } from './api/sse';

const SESSION_KEY = 'eotm.session';

export type FeedEntry = FeedItem & { _k: number };

// 리듀서 내부 상태. `deadline`·`lastSeq`는 소비용 public state에는 노출하지 않는 구현 세부사항.
export interface State {
  connected: boolean;
  code: string | null;
  playerId: string | null;
  room: PublicRoom | null;
  phase: Phase | null;
  feed: FeedEntry[];
  speakTurn: SpeakTurn | null;
  deadline: TimerInfo | null;
  ended: EndedPayload | null;
  toast: string | null;
  lastSeq: number;
}

export type Action =
  | { type: 'server'; ev: ServerEvent }
  | { type: 'connected'; value: boolean }
  | { type: 'session'; code: string; playerId: string; room: PublicRoom }
  | { type: 'restore'; code: string; playerId: string }
  | { type: 'toast'; value: string | null }
  | { type: 'reset' };

export const initialState: State = {
  connected: false,
  code: null,
  playerId: null,
  room: null,
  phase: null,
  feed: [],
  speakTurn: null,
  deadline: null,
  ended: null,
  toast: null,
  lastSeq: -1,
};

let feedSeq = 0;
function pushFeed(feed: FeedEntry[], item: FeedItem): FeedEntry[] {
  return [...feed, { _k: ++feedSeq, ...item }].slice(-300);
}

function applyServerEvent(state: State, ev: ServerEvent): State {
  if (ev.seq <= state.lastSeq) return state; // 재접속 스냅샷 직후 중복 이벤트 방지
  switch (ev.kind) {
    case 'snapshot':
      return {
        ...state,
        room: ev.room,
        phase: ev.room.phase ?? state.phase,
        feed: ev.feed.map((item) => ({ _k: ++feedSeq, ...item })),
        speakTurn: ev.speakTurn,
        deadline: ev.timer,
        ended: ev.ended,
        lastSeq: ev.seq,
      };
    case 'room':
      // 한 판 더: 종료된 방이 로비로 리셋되면 지난 판의 잔상(피드·판정·종료 화면)을 함께 비운다.
      if (ev.room.state === 'LOBBY' && state.ended) {
        return { ...state, room: ev.room, phase: null, feed: [], ended: null, speakTurn: null, deadline: null, lastSeq: ev.seq };
      }
      return { ...state, room: ev.room, phase: ev.room.phase ?? state.phase, lastSeq: ev.seq };
    case 'phase':
      // 단계 전환 시 타이머 잔상 제거 + 간신배 순번 초기화(원본 store.js 44행 동작 재현)
      return {
        ...state,
        phase: ev.phase,
        deadline: null,
        speakTurn: ev.phase !== 'PLAYER_TURNS' ? null : state.speakTurn,
        lastSeq: ev.seq,
      };
    case 'turn':
      return { ...state, speakTurn: ev.turn, lastSeq: ev.seq };
    case 'timer':
      return { ...state, deadline: ev.timer, lastSeq: ev.seq };
    case 'feed':
      return { ...state, feed: pushFeed(state.feed, ev.item), lastSeq: ev.seq };
    case 'ended':
      return { ...state, ended: ev.payload, lastSeq: ev.seq };
    default:
      return state;
  }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'server':
      return applyServerEvent(state, action.ev);
    case 'connected':
      return { ...state, connected: action.value };
    case 'session':
      return { ...state, code: action.code, playerId: action.playerId, room: action.room, phase: action.room.phase ?? state.phase };
    case 'restore':
      // 새로고침 재접속: 세션(code·playerId)을 상태로 복원한다. room·phase·speakTurn은 곧 도착할 snapshot이 채운다.
      // 이게 없으면 playerId가 null로 남아 "내 차례" 게이팅(speakTurn.current === playerId)이 실패해 입력창이 안 뜬다.
      return { ...state, code: action.code, playerId: action.playerId };
    case 'toast':
      return { ...state, toast: action.value };
    case 'reset':
      // 메인으로 나가기: 세션·방 상태를 모두 비워 App.tsx가 Home 화면으로 되돌아가게 한다.
      return { ...initialState };
    default:
      return state;
  }
}

function timerFromDeadline(info: TimerInfo | null, now: number): { phase: string; remaining: number; total: number } | null {
  if (!info) return null;
  return { phase: info.phase, remaining: Math.max(0, Math.ceil((info.deadline - now) / 1000)), total: info.total };
}

interface Session {
  code: string;
  playerId: string;
  token: string;
}

function loadSession(): Session | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(session: Session) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(SESSION_KEY);
}

export interface PublicState {
  connected: boolean;
  code: string | null;
  playerId: string | null;
  room: PublicRoom | null;
  phase: Phase | null;
  timer: { phase: string; remaining: number; total: number } | null;
  feed: FeedEntry[];
  speakTurn: SpeakTurn | null;
  ended: EndedPayload | null;
  toast: string | null;
}

export interface GameActions {
  createRoom(nick: string, config: object, avatar?: string): Promise<unknown>;
  joinRoom(code: string, nick: string, avatar?: string): Promise<unknown>;
  start(): Promise<unknown>;
  proceed(): Promise<unknown>;
  speak(text: string): Promise<unknown>;
  nextRound(): Promise<unknown>;
  rematch(): Promise<unknown>;
  debugAction(action: string): Promise<unknown>;
  leave(): Promise<void>;
  toast(msg: string): void;
}

export function useGame(): { state: PublicState; actions: GameActions } {
  const [state, dispatch] = useReducer(reducer, initialState);
  const sessionRef = useRef<Session | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const [tick, setTick] = useState(0); // 500ms마다 증가시켜 timer 파생값을 재계산

  const connect = (session: Session) => {
    unsubRef.current?.();
    sessionRef.current = session;
    unsubRef.current = subscribe(session.code, session.playerId, session.token, {
      onOpen: () => dispatch({ type: 'connected', value: true }),
      onError: () => dispatch({ type: 'connected', value: false }),
      onEvent: (ev) => dispatch({ type: 'server', ev }),
    });
  };

  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      // 세션을 먼저 상태에 복원한 뒤 구독 — snapshot 도착 전에도 playerId 게이팅이 성립하게 한다.
      dispatch({ type: 'restore', code: saved.code, playerId: saved.playerId });
      connect(saved);
    }
    return () => unsubRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  const timer = useMemo(() => timerFromDeadline(state.deadline, Date.now()), [state.deadline, tick]);

  const showToast = (msg: string) => {
    dispatch({ type: 'toast', value: msg });
    setTimeout(() => dispatch({ type: 'toast', value: null }), 3500);
  };

  const withSession = async (
    run: (session: Session) => Promise<unknown>,
  ): Promise<unknown> => {
    const session = sessionRef.current;
    if (!session) return { error: '세션이 없습니다.' };
    const res = await run(session);
    if (res && typeof res === 'object' && 'error' in res) showToast((res as { error: string }).error);
    return res;
  };

  const actions: GameActions = {
    async createRoom(nick, config, avatar) {
      const res = await post<{ ok: true; code: string; playerId: string; token: string; room: PublicRoom }>('/rooms', { nick, config, avatar });
      if ('error' in res) {
        showToast(res.error);
        return res;
      }
      const session = { code: res.code, playerId: res.playerId, token: res.token };
      saveSession(session);
      dispatch({ type: 'session', code: res.code, playerId: res.playerId, room: res.room });
      connect(session);
      return res;
    },
    async joinRoom(code, nick, avatar) {
      const res = await post<{ ok: true; code: string; playerId: string; token: string; room: PublicRoom }>(`/rooms/${code}/join`, { nick, avatar });
      if ('error' in res) {
        showToast(res.error);
        return res;
      }
      const session = { code: res.code, playerId: res.playerId, token: res.token };
      saveSession(session);
      dispatch({ type: 'session', code: res.code, playerId: res.playerId, room: res.room });
      connect(session);
      return res;
    },
    start() {
      return withSession((s) => post(`/rooms/${s.code}/start`, { playerId: s.playerId, token: s.token }));
    },
    proceed() {
      return withSession((s) => post(`/rooms/${s.code}/proceed`, { playerId: s.playerId, token: s.token }));
    },
    speak(text) {
      return withSession((s) => post(`/rooms/${s.code}/speak`, { playerId: s.playerId, token: s.token, text }));
    },
    nextRound() {
      return withSession((s) => post(`/rooms/${s.code}/next`, { playerId: s.playerId, token: s.token }));
    },
    rematch() {
      return withSession((s) => post(`/rooms/${s.code}/rematch`, { playerId: s.playerId, token: s.token }));
    },
    debugAction(action) {
      return withSession((s) => post(`/rooms/${s.code}/debug`, { playerId: s.playerId, token: s.token, action }));
    },
    async leave() {
      const session = sessionRef.current;
      if (session) await post(`/rooms/${session.code}/leave`, { playerId: session.playerId, token: session.token });
      unsubRef.current?.();
      unsubRef.current = null;
      sessionRef.current = null;
      clearSession();
      dispatch({ type: 'reset' });
    },
    toast: showToast,
  };

  const publicState: PublicState = {
    connected: state.connected,
    code: state.code,
    playerId: state.playerId,
    room: state.room,
    phase: state.phase,
    timer,
    feed: state.feed,
    speakTurn: state.speakTurn,
    ended: state.ended,
    toast: state.toast,
  };

  return { state: publicState, actions };
}
