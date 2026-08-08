// EgressDO — 나가는 HTTP 호출의 출발지 리전을 고정하기 위한 상태 없는 중계 DO.
//
// 존재 이유: CF는 워커 배포 리전을 못 고르고, 접속자와 가까운 colo(APAC 엣지 — 홍콩 등)에서
// 실행된다. Google AI Studio(generativelanguage.googleapis.com)는 호출자 IP의 국가로
// 차단하는데, location hint는 대륙 단위뿐이고 apac에 홍콩이 포함돼 있어 배제가 안 된다.
// 그래서 지원 리전에 이 DO만 핀으로 박아(호출부의 locationHint) 외부 LLM 호출을 여기서만
// 대리로 내보낸다. 게임 상태 DO 전체를 옮기면 모든 요청이 왕복하므로, 그건 하지 않는다 —
// 추가 왕복은 어차피 수 초 걸리는 LLM 응답에 묻히고 실시간 경로는 건드리지 않는다.
//
// 게임 로직을 전혀 모르는 범용 부품이다.
//
// 원본: C:\Users\user\marriage_problem\worker\egress-do.mjs (미커밋 유일본). 리전 우회
// 로직·허용 호스트 목록을 그대로 보존해 TS로 이식했다.

// SSRF 방어 — 이 DO는 내부 바인딩으로만 닿지만, 중계기는 목적지를 좁혀두는 게 맞다.
export const ALLOWED_HOSTS = new Set(['generativelanguage.googleapis.com', 'integrate.api.nvidia.com']);

// 지원 리전 기본값 — wnam(북미 서부)은 apac 힌트가 홍콩을 포함해 배제 못 하는 것과 달리
// 지원 리전으로 확정 가능한 최단 선택이다(marriage_problem game-do.mjs 원본 근거).
// 하드코딩 대신 옵션+기본값으로 둔다 — 호출부가 필요하면 다른 리전으로 override 가능.
//
// 사용법(호출부 예시):
//   const stub = env.EGRESS_DO.get(
//     env.EGRESS_DO.idFromName(`egress:${gameId}`),
//     { locationHint: DEFAULT_EGRESS_LOCATION_HINT },
//   );
//   const fetchImpl = egressFetch(stub); // ctx.fetchImpl로 꽂는다 (@narre/llm ChainContext).
export const DEFAULT_EGRESS_LOCATION_HINT: DurableObjectLocationHint = 'wnam';

type EgressBody = { url?: string; init?: RequestInit };

export class EgressDO {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: unknown,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const { url, init } = (await req.json().catch(() => ({}) as EgressBody)) as EgressBody;

    let target: URL;
    try {
      target = new URL(url ?? '');
    } catch {
      return Response.json({ error: 'bad url' }, { status: 400 });
    }
    // SSRF 방어 — 이 DO는 내부 바인딩으로만 닿지만, 중계기는 목적지를 좁혀두는 게 맞다.
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      return Response.json({ error: `host not allowed: ${target.hostname}` }, { status: 403 });
    }

    const res = await fetch(target.toString(), init);
    // 상태·본문만 넘긴다 — 호출부가 Response로 복원해 쓰므로 스트리밍은 필요 없다.
    return Response.json({ status: res.status, body: await res.text() });
  }
}

// EgressDO 스텁을 받아 @narre/llm의 ChainContext.fetchImpl로 꽂을 수 있는 fetch 호환
// 함수를 돌려주는 브리지. signal은 구조화 복제가 안 되므로 중계 요청 자체에 건다.
export function egressFetch(stub: { fetch(input: string, init?: RequestInit): Promise<Response> }): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const { signal, ...rest } = init;
    const res = await stub.fetch('http://egress/fetch', {
      method: 'POST',
      body: JSON.stringify({ url, init: rest }),
      signal,
    });
    if (!res.ok) throw new Error(`egress relay HTTP ${res.status}`);
    const out = (await res.json()) as { status: number; body: string };
    // 공급자 응답을 Response로 복원 — 호출부(callJsonChain 등)의 res.ok/res.text() 계약을 유지한다.
    return new Response(out.body, { status: out.status });
  }) as typeof fetch;
}
