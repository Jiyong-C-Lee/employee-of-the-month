// 알람 다중화 — DO 알람은 인스턴스당 1개뿐이라 게임 타이머와 idle TTL이 그 하나를 나눠 쓴다.
// storage에 태그를 같이 넣어 어느 쪽이 걸린 알람인지 구분한다.
//
// 원본: eotm apps/worker/src/room-do.ts의 alarmTag + alarmChain(I1·I2). speedquiz
// worker/room-do.mjs는 같은 문제를 room.phase 분기로 풀었다 — 태그 쪽이 게임 알람 종류가
// 둘 이상일 때(eotm의 turnTimeout·inputWindow)도 버틴다.
import type { Alarms } from './interfaces.js';

const TAG_KEY = 'alarmTag';

export function doAlarms(ctx: DurableObjectState, { ttlMs }: { ttlMs: number }): Alarms {
  // 알람 storage 조작을 호출 순서대로 직렬 실행한다. 안 하면 clear→start가 마이크로태스크
  // 경합으로 뒤섞여 게임 알람이 유실된다(원본 I1).
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  return {
    at(tag: string, time: number): Promise<void> {
      return serial(async () => {
        await ctx.storage.put(TAG_KEY, tag);
        await ctx.storage.setAlarm(time);
      });
    },

    // 게임 알람이 무장 중이면 아무것도 하지 않는다. 덮어쓰면 턴 마감이 유실된다(원본 I2).
    ttl(): Promise<void> {
      return serial(async () => {
        if (await ctx.storage.get<string>(TAG_KEY)) return;
        await ctx.storage.setAlarm(Date.now() + ttlMs);
      });
    },

    // 소거 없이 조회한다. 재접속 스냅샷이 남은 마감 시각을 실어 보내는 데 쓴다.
    pending(): Promise<{ tag: string; time: number } | null> {
      return serial(async () => {
        const tag = await ctx.storage.get<string>(TAG_KEY);
        if (!tag) return null;
        const time = await ctx.storage.getAlarm();
        return time === null ? null : { tag, time };
      });
    },

    // null = 게임 태그 없음 = idle TTL 만료. 호출측이 방을 지운다.
    fire(): Promise<string | null> {
      return serial(async () => {
        const tag = (await ctx.storage.get<string>(TAG_KEY)) ?? null;
        if (tag !== null) await ctx.storage.delete(TAG_KEY);
        return tag;
      });
    },
  };
}

export type FakeAlarms = Alarms & {
  scheduled: { tag: string; time: number }[];
  ttlArmed: number;
};

/** 테스트용 인메모리 구현. 예약 내역을 남겨 게임 로직 테스트가 검사할 수 있게 한다. */
export function fakeAlarms(): FakeAlarms {
  let tag: string | null = null;
  let time = 0;
  const fake: FakeAlarms = {
    scheduled: [],
    ttlArmed: 0,
    async at(t: string, at: number) {
      tag = t;
      time = at;
      fake.scheduled.push({ tag: t, time: at });
    },
    async pending() {
      return tag === null ? null : { tag, time };
    },
    async ttl() {
      if (tag !== null) return;
      fake.ttlArmed += 1;
    },
    async fire() {
      const t = tag;
      tag = null;
      return t;
    },
  };
  return fake;
}
