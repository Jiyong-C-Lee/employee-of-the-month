export interface Env {
  ROOM_DO: DurableObjectNamespace;
  QUOTA_DO: DurableObjectNamespace;
  // 지역 차단 우회 — 나가는 LLM 요청만 지원 리전을 거친다(@narre/cf makeLlm이 자동으로 쓴다).
  EGRESS_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
  SHARE_KV: KVNamespace; // 라운드 공유 링크 페이로드 (TTL 30일)
  // Gemini 키 2단: FREE(무료 티어, 체인 1순위) → 기본(유료, 무료가 막혔을 때 폴백).
  // dev(.dev.vars)에는 FREE만 두면 유료 키는 자동 스킵된다.
  GOOGLE_AI_STUDIO_FREE_API_KEY?: string;
  GOOGLE_AI_STUDIO_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  OPEN_AI_API_KEY?: string;
  GEMINI_MODEL: string;
  NVIDIA_MODEL: string;
  OPENAI_MODEL: string;
  LLM_DAILY_LIMIT_GEMINI: string;
  // 신설 — @narre/cf QuotaDO는 프로바이더명별로 env를 읽는다(gemini-free → *_GEMINI_FREE).
  // 미설정이면 한도 0이라 무료 경로가 항상 거부된다. 배포 전 반드시 설정한다.
  LLM_DAILY_LIMIT_GEMINI_FREE: string;
  LLM_DAILY_LIMIT_NVIDIA: string;
  LLM_DAILY_LIMIT_OPENAI: string;
  // @narre/llm 기본 체인의 마지막 mock 어댑터를 뺀다. eotm은 페르소나에 맞는 대사를 만드는
  // 게임 고유 mock(ai/mock.ts)이 있어서, 체인이 스키마 더미로 조용히 성공하면
  // orchestrate의 withFallback이 안 돌고 대사 품질이 떨어진다.
  LLM_CHAIN: string;
  // 원가 계량용 환율. 미설정이면 @narre/llm 기본값 1400.
  USD_KRW?: string;
  // 'true'일 때만 디버그 액션(/debug) 허용. 프로덕션 기본 미설정=비활성(I4).
  DEBUG_ACTIONS?: string;
  // 연출 지연 배율. 미설정=1(프로덕션). 테스트가 '0'으로 둬서 발언 사이 텀을 건너뛴다.
  DELAY_SCALE?: string;
}
