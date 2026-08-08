// Alarms 계약 — 태그 왕복·TTL 복귀·게임 알람 보호·직렬화 경합.
// 마지막 케이스가 핵심이다: at()과 ttl()을 await 없이 동시에 던져도 게임 알람이 살아남아야
// 한다. eotm이 alarmChain으로 따로 막던 문제를 부품이 흡수했는지 보는 것이다.
import { describe, it, expect } from 'vitest';
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { fakeAlarms } from '../src/alarms';

function stubFor(name: string) {
  return env.TEST_DO.get(env.TEST_DO.idFromName(name));
}

async function call(stub: ReturnType<typeof stubFor>, body: object) {
  const res = await stub.fetch('http://do/', { method: 'POST', body: JSON.stringify(body) });
  return (await res.json()) as Record<string, unknown>;
}

describe('doAlarms', () => {
  it('건 태그를 fire에서 그대로 돌려준다', async () => {
    const stub = stubFor('tag-roundtrip');
    await call(stub, { action: 'alarmAt', tag: 'turnTimeout:3', time: Date.now() + 60_000 });
    expect(await call(stub, { action: 'alarmFire' })).toEqual({ tag: 'turnTimeout:3' });
  });

  it('fire는 태그를 소거한다 — 두 번째 호출은 null이다', async () => {
    const stub = stubFor('tag-consumed');
    await call(stub, { action: 'alarmAt', tag: 'x', time: Date.now() + 60_000 });
    await call(stub, { action: 'alarmFire' });
    expect(await call(stub, { action: 'alarmFire' })).toEqual({ tag: null });
  });

  it('태그가 없으면 fire가 null을 준다 — TTL 만료 신호', async () => {
    expect(await call(stubFor('no-tag'), { action: 'alarmFire' })).toEqual({ tag: null });
  });

  it('게임 알람이 무장돼 있으면 ttl()이 덮어쓰지 않는다', async () => {
    const stub = stubFor('ttl-guard');
    await call(stub, { action: 'alarmAt', tag: 'inputWindow:1', time: Date.now() + 60_000 });
    await call(stub, { action: 'alarmTtl' });
    // 태그가 살아 있어야 한다 — ttl이 덮었다면 태그가 지워지고 null이 나온다.
    expect(await call(stub, { action: 'alarmFire' })).toEqual({ tag: 'inputWindow:1' });
  });

  it('태그가 없을 때 ttl()은 idle TTL 알람을 건다', async () => {
    const stub = stubFor('ttl-arm');
    expect(await call(stub, { action: 'alarmArmed' })).toEqual({ armed: false });
    await call(stub, { action: 'alarmTtl' });
    expect(await call(stub, { action: 'alarmArmed' })).toEqual({ armed: true });
  });

  it('at과 ttl을 동시에 던져도 게임 알람이 살아남는다 (직렬화)', async () => {
    const stub = stubFor('serialize-race');
    await call(stub, { action: 'alarmRace', tag: 'turnTimeout:9', time: Date.now() + 60_000 });
    expect(await call(stub, { action: 'alarmFire' })).toEqual({ tag: 'turnTimeout:9' });
  });

  it('TTL 발화 시 방이 폐기된다', async () => {
    const stub = stubFor('ttl-expire');
    await call(stub, { action: 'save', value: { a: 1 } });
    await call(stub, { action: 'alarmTtl' });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await call(stub, { action: 'load' })).toEqual({ value: null });
  });

  it('pending은 소거 없이 무장 중인 게임 알람을 보여준다', async () => {
    const stub = stubFor('pending-peek');
    const at = Date.now() + 60_000;
    expect(await call(stub, { action: 'alarmPending' })).toEqual({ pending: null });
    await call(stub, { action: 'alarmAt', tag: 'turnTimeout:2', time: at });
    expect(await call(stub, { action: 'alarmPending' })).toEqual({ pending: { tag: 'turnTimeout:2', time: at } });
    // 소거되지 않았어야 한다 — 두 번 봐도 그대로다.
    expect(await call(stub, { action: 'alarmPending' })).toEqual({ pending: { tag: 'turnTimeout:2', time: at } });
    expect(await call(stub, { action: 'alarmFire' })).toEqual({ tag: 'turnTimeout:2' });
  });
});

describe('fakeAlarms', () => {
  it('DO 없이 같은 계약을 만족하고 예약 내역을 남긴다', async () => {
    const a = fakeAlarms();
    expect(await a.fire()).toBeNull();
    await a.at('turnTimeout:1', 12345);
    expect(a.scheduled).toEqual([{ tag: 'turnTimeout:1', time: 12345 }]);
    await a.ttl(); // 게임 알람 무장 중 — 무시된다
    expect(a.ttlArmed).toBe(0);
    expect(await a.fire()).toBe('turnTimeout:1');
    await a.ttl(); // 이제는 무장된다
    expect(a.ttlArmed).toBe(1);
  });
});
