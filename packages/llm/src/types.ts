export type JsonSchema = Record<string, unknown>;
export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
export type ToolDef = { name: string; description: string; parameters: JsonSchema };
export type ToolCall = { name: string; args: Record<string, unknown> };
export type Usage = { in: number; out: number; cached: number };
export type Logger = { event(name: string, fields: Record<string, unknown>): void };

export type ChainRequest =
  | { system: string; user: string; schema: JsonSchema; temperature?: number; timeoutMs?: number }
  | { messages: Msg[]; schema?: JsonSchema; tools?: ToolDef[]; temperature?: number; timeoutMs?: number };

export type ChainContext = {
  env: Record<string, string | undefined>;
  kind: string; gameId?: string;
  quotaTake?: (provider: string) => Promise<boolean>;
  // throw하거나 정확히 false를 반환하면 실패(다음 프로바이더로 페일오버).
  // undefined/void/true는 통과 — zod 등 throw식 검증자(성공 시 undefined 반환)를 그대로 꽂을 수 있다.
  validate?: (raw: unknown) => boolean | void;
  fetchImpl?: typeof fetch;
  logger?: Logger;
};

export type ChainResult = { raw?: unknown; toolCalls?: ToolCall[]; provider: string; usage: Usage };

export type ProviderCaps = { json: true; tools: boolean; cache: 'implicit' | 'explicit' | 'none' };
export type ProviderAdapter = {
  name: string; caps: ProviderCaps;
  call(req: ChainRequest, ctx: ChainContext, model: string): Promise<ChainResult>;
};
