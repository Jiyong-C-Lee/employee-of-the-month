// storage 스냅샷 — 3게임 모두 키 하나에 방 전체를 넣는다. 키 이름만 달라서 인자로 받는다
// (sultan·eotm은 'room', speedquiz GameDO는 'game').
import type { RoomStore } from './interfaces.js';

export function doRoomStore<T>(ctx: DurableObjectState, key = 'room'): RoomStore<T> {
  return {
    async load(): Promise<T | null> {
      return (await ctx.storage.get<T>(key)) ?? null;
    },
    async save(room: T): Promise<void> {
      await ctx.storage.put(key, room);
    },
    // 방 폐기 — 알람 태그 등 부속 키까지 함께 지운다.
    async clear(): Promise<void> {
      await ctx.storage.deleteAll();
    },
  };
}

/** 테스트용 인메모리 구현. 게임 로직 테스트가 DO 없이 돌게 한다. */
export function memRoomStore<T>(): RoomStore<T> {
  let room: T | null = null;
  return {
    async load() {
      return room;
    },
    async save(r: T) {
      room = r;
    },
    async clear() {
      room = null;
    },
  };
}
