export interface Env {
  ROOM_DO: DurableObjectNamespace;
  QUOTA_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
  SHARE_KV: KVNamespace; // 라운드 공유 링크 페이로드 (TTL 30일)
  GOOGLE_AI_STUDIO_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  GEMINI_MODEL: string;
  NVIDIA_MODEL: string;
  LLM_DAILY_LIMIT_GEMINI: string;
  LLM_DAILY_LIMIT_NVIDIA: string;
  // 'true'일 때만 디버그 액션(/debug) 허용. 프로덕션 기본 미설정=비활성(I4).
  DEBUG_ACTIONS?: string;
}
