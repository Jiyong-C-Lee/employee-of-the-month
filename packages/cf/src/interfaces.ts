// 계약 5종 — 이 파일은 선언만 담는다. 구현은 각 부품 파일에.
// core.ts(폐기 예정)와 달리 게임이 상속으로 한 덩어리를 받지 않고 필요한 것만 조합한다.
//
// ── 방 id와 세션 id는 다른 물건이다 ──────────────────────────────
//
// 한 값이 겸직하면 라우팅이 막힌다. 실제로 두 번 막혔다(createGameWorker·roomDelegate 소비자 0).
//
//   방 id  = 주소이자 공개 이름. 어느 DO 인스턴스인지 고르고, 남에게 불러주는 값이다.
//            URL(경로·쿼리)에 둔다. roomDelegate가 이걸 읽는다.
//   세션 id = 이 자리를 이어갈 자격. 본인만 갖는 값이다.
//            본문이나 WS 메시지에 둔다. URL에 두면 히스토리·리퍼러·로그로 샌다.
//
// 겸직하는 값은 더 엄한 쪽(세션) 제약을 물려받아 본문으로 내려간다. 그러면 라우터가
// 방 id를 뽑으려고 본문을 읽어야 하고, 읽는 순간 넘길 요청이 사라진다.
//
// 상관키(로그·LLM gameId 라벨)로 방 id가 또 필요하지만 실어 나를 필요는 없다.
// idFromName으로 주소를 잡은 DO는 `ctx.id.name`으로 자기 이름을 되읽는다.
import type { ChainContext, ChainRequest, ChainResult } from '@narre/llm';

/** 방 상태 스냅샷. 3게임 모두 storage 키 하나에 방 전체를 넣는다(스펙 §3). */
export interface RoomStore<T> {
  load(): Promise<T | null>;
  save(room: T): Promise<void>;
  clear(): Promise<void>;
}

/**
 * DO 알람 다중화. 알람은 인스턴스당 1개뿐이라 게임 타이머와 idle TTL이 그 하나를 나눠 쓴다.
 * fire()가 null을 주면 TTL 만료(= 방 폐기), 문자열이면 게임이 건 알람이다.
 */
export interface Alarms {
  at(tag: string, time: number): Promise<void>;
  ttl(): Promise<void>;
  fire(): Promise<string | null>;
  /**
   * 무장 중인 게임 알람을 소거 없이 들여다본다. 게임 알람이 없으면 null.
   *
   * 재접속 시 UI를 복구하려면 "지금 어떤 마감이 걸려 있나"를 읽어야 한다(eotm이 스냅샷에
   * 남은 발언 시간을 실어 보낸다). 이게 없으면 게임이 storage 키를 직접 뒤져 부품 내부에
   * 손을 대게 된다. 소비자 1개(잠정) — 두 번째가 붙을 때 모양을 재검토한다.
   */
  pending(): Promise<{ tag: string; time: number } | null>;
}

/**
 * 연결 하나. data는 WS serializeAttachment와 SSE 메모리 좌석을 통일한다.
 *
 * TSeat는 그 연결의 좌석이다. 세션 id가 여기 산다. eotm·speedquiz 둘 다 `{ playerId }`를
 * 넣는데 이전 판은 unknown이라 꺼낼 때마다 게임이 캐스팅했다. 타입 인자로 받으면
 * hibernation을 건너온 값도 게임이 선언한 모양으로 돌아온다.
 */
export type Conn<TSeat = unknown> = {
  send(msg: unknown): void;
  readonly data: TSeat | null;
  setData(v: TSeat): void;
};

/**
 * 연결 수명주기 훅. 전부 선택적이다 — SSE는 onMessage를 절대 호출하지 않는다(인바운드는
 * 게임이 HTTP POST로 받는다). 안 쓰는 훅에 더미를 채울 필요가 없다.
 */
export type ConnHooks<TSeat = unknown> = {
  onOpen?(conn: Conn<TSeat>): void | Promise<void>;
  onMessage?(conn: Conn<TSeat>, raw: string): void | Promise<void>;
  onClose?(conn: Conn<TSeat>): void | Promise<void>;
};

/**
 * 클라이언트 전송. 훅은 attach가 아니라 팩토리가 받는다 — hibernation에서 깬 DO는
 * attach 없이 webSocketMessage부터 받으므로, attach 인자로 두면 훅이 비어 메시지가 유실된다.
 */
export interface Transport {
  attach(req: Request): Response | Promise<Response>;
  broadcast(msg: unknown): void;
}

/** 카운터. take·rateLimit은 incr을 접두사만 다르게 부르는 두 호출자다. */
export interface Quota {
  incr(key: string, limit: number, ttlMs: number): Promise<{ ok: boolean; count: number }>;
  take(provider: string, now?: number): Promise<boolean>;
  rateLimit(ip: string, limit?: number, windowMs?: number): Promise<boolean>;
}

/** 게임이 클로저로 감아 주입하는 LLM 호출. 3게임이 이미 같은 모양을 쓴다. */
export type Llm = (args: ChainRequest, opts?: Partial<ChainContext>) => Promise<ChainResult>;
