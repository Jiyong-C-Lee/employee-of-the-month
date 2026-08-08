// Hono 미들웨어 — 팩토리(createGameWorker) 대신 조합 가능한 조각으로 낸다. Hono가 이미
// 조합형이라 게임이 자기 라우터를 짜면서 필요한 것만 끼운다.
//
// createGameWorker가 room-id를 `?room=` 하나로 못 박아 세 게임 중 아무도 못 쓴 것이 실패
// 원인이었다. roomIdFrom 훅이 그 자리를 대신한다: eotm은 경로 `:code`, speedquiz는 쿼리
// `?room=`을 각각 한 줄로 답한다.
import type { Context, Handler, MiddlewareHandler } from 'hono';

const DEFAULT_MESSAGE = '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.';

function namespaceOf(c: Context, binding: string): DurableObjectNamespace {
  return (c.env as Record<string, unknown>)[binding] as DurableObjectNamespace;
}

export type RateLimitOptions = {
  /** QuotaDO 네임스페이스 바인딩 이름. */
  binding: string;
  /** 한도. 생략하면 QuotaDO가 env.RL_PER_MIN을 본다. */
  limit?: number;
  /** 윈도(ms). 생략하면 QuotaDO 기본값인 분당. */
  windowMs?: number;
  message?: string;
};

/**
 * IP rate limit. cf-connecting-ip가 없으면(로컬 dev) 통과시킨다 — 프로덕션은 Cloudflare가
 * 항상 채우므로, 헤더 부재를 dev 신호로 쓰는 것이 3게임 공통 관례다.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip');
    if (!ip) return next();
    const ns = namespaceOf(c, opts.binding);
    const quota = ns.get(ns.idFromName('global')) as unknown as {
      rateLimit(ip: string, limit?: number, windowMs?: number): Promise<boolean>;
    };
    if (!(await quota.rateLimit(ip, opts.limit, opts.windowMs))) {
      return c.json({ error: opts.message ?? DEFAULT_MESSAGE }, 429);
    }
    return next();
  };
}

export type RoomDelegateOptions = {
  /** 방 DO 네임스페이스 바인딩 이름. */
  binding: string;
  /**
   * 요청에서 방 id를 뽑는다. DO 인스턴스 선택에 쓰인다.
   *
   * **URL(경로·쿼리)에서만 뽑는다. 본문을 읽으면 안 된다.** 읽는 순간 c.req.raw의 스트림이
   * 소모돼 아래 stub.fetch가 넘길 본문을 잃는다. 방 id는 공개 이름이라 URL에 두는 것이
   * 맞고, URL에 못 두는 값(세션 id·토큰)은 애초에 방 id가 아니다(interfaces.ts 머리말).
   */
  roomIdFrom(c: Context): string | Promise<string>;
  /** DO에 넘길 경로. 예: (c) => `/${c.req.param('action')}`. */
  path(c: Context): string;
};

/**
 * 요청을 방 DO로 그대로 넘기는 종단 핸들러. 메서드·헤더·본문·쿼리를 보존한다.
 *
 * 방을 **만드는** 경로에는 쓰지 않는다. 생성은 위임이 아니라 발급이다 — id를 짓고,
 * 충돌하면 다시 짓고(eotm), 본문을 새로 싸서 내려보낸다. 그건 게임이 직접 짜는 게 맞다.
 */
export function roomDelegate(opts: RoomDelegateOptions): Handler {
  return async (c) => {
    const id = await opts.roomIdFrom(c);
    const ns = namespaceOf(c, opts.binding);
    const stub = ns.get(ns.idFromName(id));
    const url = new URL(c.req.raw.url);
    return stub.fetch(`http://do${opts.path(c)}${url.search}`, c.req.raw as never) as unknown as Response;
  };
}
