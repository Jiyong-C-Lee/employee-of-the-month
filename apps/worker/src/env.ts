export interface Env {
  ROOM_DO: DurableObjectNamespace;
  QUOTA_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
  GOOGLE_AI_STUDIO_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  GEMINI_MODEL: string;
  NVIDIA_MODEL: string;
  LLM_DAILY_LIMIT_GEMINI: string;
  LLM_DAILY_LIMIT_NVIDIA: string;
}
