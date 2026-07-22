// cloudflare:test의 ProvidedEnv에 우리 Env 바인딩을 병합 — env.QUOTA_DO 등 타입 인식용.
import type { Env } from '../src/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
