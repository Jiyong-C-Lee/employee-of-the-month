// room-do.ts — Task 9~10에서 구현
export class RoomDO implements DurableObject {
  constructor(readonly ctx: DurableObjectState, readonly env: import('./env').Env) {}
  async fetch(_req: Request): Promise<Response> {
    return Response.json({ error: 'not implemented' }, { status: 501 });
  }
}
