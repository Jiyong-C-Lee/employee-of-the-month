// LLM 배선 — 게임이 매번 손으로 짜던 `callJsonChain` 감싸기를 한 자리로 모은다.
//
// 세 게임이 같은 다섯 가지를 꽂고 있었다: env·kind 기본값·gameId 라벨·쿼터·로거.
// 여섯 번째가 이그레스인데 sultan만 갖고 있었고, 그게 사고를 냈다.
//
// **이그레스는 게임별 선택이 아니다.** 아시아 콜로에서 나가는 Gemini 요청은
// "User location is not supported for the API use"(HTTP 400)로 거부된다. 게임 디자인과
// 무관하게 "Cloudflare에서 Gemini를 부른다"는 사실의 속성이다. 옵트인으로 뒀더니
// speedquiz가 빠뜨린 채 배포돼 매 호출이 조용히 mock으로 떨어졌다. 그래서 여기서는
// 기본으로 켜고, 바인딩이 없으면 조용히 넘어가지 않고 던진다.
import { callJsonChain, type Logger } from '@narre/llm';
import { egressFetch, DEFAULT_EGRESS_LOCATION_HINT } from './egress-do.js';
import type { Llm } from './interfaces.js';

type QuotaStub = { take(provider: string): Promise<boolean> };

export type MakeLlmOptions = {
  /** 로그와 LLM 호출을 한 세션으로 묶는 상관키. DO 안이라면 `ctx.id.name`이 그대로 쓰인다. */
  gameId?: string;
  logger?: Logger;
  /** 나가는 요청을 내보낼 리전. 기본은 북미(wnam). */
  locationHint?: DurableObjectLocationHint;
  /** 바인딩 이름을 바꾼 게임을 위한 탈출구. 기본 관례는 QUOTA_DO·EGRESS_DO다. */
  quotaBinding?: string;
  egressBinding?: string;
};

function bindingOf(env: Record<string, unknown>, name: string, why: string): DurableObjectNamespace {
  const ns = env[name];
  if (!ns) throw new Error(`makeLlm: ${name} 바인딩이 없다 — ${why}`);
  return ns as DurableObjectNamespace;
}

/**
 * 게임이 주입할 LLM 호출자를 만든다. 쿼터와 이그레스를 바인딩 이름 관례로 스스로 찾는다.
 *
 * 이그레스 DO는 gameId마다 따로 만든다(sultan 관례). locationHint는 생성 시점에만
 * 적용되므로 판마다 새 인스턴스를 잡는 편이 리전 배치를 확실하게 한다.
 */
export function makeLlm(env: unknown, opts: MakeLlmOptions = {}): Llm {
  const bindings = env as Record<string, unknown>;
  const quotaNs = bindingOf(bindings, opts.quotaBinding ?? 'QUOTA_DO', 'LLM 프로바이더 일일 한도를 셀 곳이 없다');
  const egressNs = bindingOf(
    bindings,
    opts.egressBinding ?? 'EGRESS_DO',
    '지역 차단을 우회할 수 없다. wrangler.jsonc에 EgressDO 바인딩과 마이그레이션을 추가할 것',
  );

  const quota = quotaNs.get(quotaNs.idFromName('global')) as unknown as QuotaStub;
  const egress = egressNs.get(
    egressNs.idFromName(`egress:${opts.gameId ?? 'global'}`),
    { locationHint: opts.locationHint ?? DEFAULT_EGRESS_LOCATION_HINT },
  );
  const fetchImpl = egressFetch(egress);

  return (args, callOpts = {}) =>
    callJsonChain(args, {
      ...callOpts,
      // env는 바인딩(DO·ASSETS)까지 들고 있어 문자열 맵이 아니다. 체인은 문자열 키만 읽는다.
      env: bindings as Record<string, string | undefined>,
      kind: callOpts.kind ?? 'unknown',
      gameId: opts.gameId,
      quotaTake: (provider) => quota.take(provider),
      fetchImpl,
      logger: opts.logger,
    });
}
