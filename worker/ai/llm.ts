// LLM 배선 — @narre/cf의 makeLlm에 eotm의 로거를 얹는다.
// 원본 ai/chain.ts(48) · ai/providers/{gemini,nvidia}.ts(120) · ai/parse.ts(13)가 이 파일로 대체됐다.
//
// 부품으로 옮기면서 이그레스가 붙었다. 그전까지 eotm은 우회 없이 Gemini를 불렀고,
// 아시아 콜로에서는 "User location is not supported for the API use"(HTTP 400)로 거부돼
// 매번 게임 고유 mock으로 조용히 떨어졌다. speedquiz 첫 배포에서 같은 증상이 잡혀 드러났다.
import { makeLlm as makeCfLlm, type Llm } from '@narre/cf';
import { logger } from '../log';
import type { Env } from '../env';

/** 실 LLM 키가 하나라도 있는지. 없으면 orchestrate가 체인을 건너뛰고 게임 고유 mock을 쓴다. */
export function hasAnyKey(env: Env): boolean {
  return Boolean(env.GOOGLE_AI_STUDIO_FREE_API_KEY || env.GOOGLE_AI_STUDIO_API_KEY || env.NVIDIA_API_KEY);
}

type QuotaStub = { take(provider: string): Promise<boolean> };

/**
 * 게임이 주입할 llm 호출자를 만든다. 쿼터·이그레스는 부품이 바인딩 이름 관례로 찾는다.
 *
 * quota 인자는 호출부 호환을 위해 남겨 뒀다. 부품이 QUOTA_DO를 직접 잡으므로 쓰이지 않는다.
 * roomCode는 로그에 세션을 귀속시키기 위한 것이고 패키지 쪽 이름은 gameId다.
 */
export function makeLlm(env: Env, _quota: QuotaStub, roomCode?: string): Llm {
  return makeCfLlm(env, {
    gameId: roomCode,
    logger: { event: (name, fields) => logger.chain(name, fields) },
  });
}
