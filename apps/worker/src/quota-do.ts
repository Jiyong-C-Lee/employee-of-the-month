// quota-do.ts — Task 8에서 구현
export class QuotaDO implements DurableObject {
  constructor(readonly ctx: DurableObjectState, readonly env: import('./env').Env) {}
  async fetch(_req: Request): Promise<Response> {
    return Response.json({ error: 'not implemented' }, { status: 501 });
  }
}
