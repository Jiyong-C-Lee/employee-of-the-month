// RoomStore 계약 — storage 왕복·재기동 생존·clear. memRoomStore는 DO 없이 같은 계약을
// 만족하는지 본다(게임 로직 테스트가 이걸 쓴다).
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { memRoomStore } from '../src/room-store';

function stubFor(name: string) {
  return env.TEST_DO.get(env.TEST_DO.idFromName(name));
}

async function call(stub: ReturnType<typeof stubFor>, body: object) {
  const res = await stub.fetch('http://do/', { method: 'POST', body: JSON.stringify(body) });
  return (await res.json()) as Record<string, unknown>;
}

describe('doRoomStore', () => {
  it('저장한 값을 그대로 돌려준다', async () => {
    const stub = stubFor('save-load');
    await call(stub, { action: 'save', value: { hello: 'world' } });
    expect(await call(stub, { action: 'load' })).toEqual({ value: { hello: 'world' } });
  });

  it('저장 전에는 null이다', async () => {
    expect(await call(stubFor('empty'), { action: 'load' })).toEqual({ value: null });
  });

  it('clear 후에는 다시 null이다', async () => {
    const stub = stubFor('clear-test');
    await call(stub, { action: 'save', value: { a: 1 } });
    await call(stub, { action: 'clear' });
    expect(await call(stub, { action: 'load' })).toEqual({ value: null });
  });
});

describe('memRoomStore', () => {
  it('DO 없이 같은 계약을 만족한다', async () => {
    const store = memRoomStore<{ n: number }>();
    expect(await store.load()).toBeNull();
    await store.save({ n: 1 });
    expect(await store.load()).toEqual({ n: 1 });
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
