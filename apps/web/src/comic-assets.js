// 회의실 코믹 에셋 매핑 — 디자인 프로젝트 '코믹 UI 목업.dc.html' 확정 좌표.
// 이미지 8종(493x394 통일)은 client/public/comic/pose{0..7}.png. 교체하려면 파일만 갈아끼우면 된다.
// face: 얼굴 원(아바타/이니셜/이모지 합성 슬롯)의 중심 x/y·지름 d — 이미지 기준 % 값이라 해상도 독립.

export const POSES = {
  0: { x: 50.5, y: 26,   d: 21 }, // 보스 정면 (문제 상황)
  1: { x: 55,   y: 28,   d: 23 }, // 손들기
  2: { x: 50,   y: 38,   d: 23 }, // 턱괴기(주먹)
  3: { x: 49,   y: 36,   d: 23 }, // 검지 들기
  4: { x: 52,   y: 39,   d: 23 }, // 팔짱
  5: { x: 51,   y: 38,   d: 23 }, // 어깨 으쓱
  6: { x: 44,   y: 41,   d: 23 }, // 턱받침 — 유저 지정석
  7: { x: 52.5, y: 25.5, d: 21 }, // 보스 응시 (분노 게이지)
};

export const BOSS_FRONT = 0; // 문제 상황 컷
export const BOSS_GAZE = 7;  // 심판 컷 — 분노 게이지에서 회의를 응시
export const USER_POSE = 6;  // 내 컷 (유저 지정석)
export const SEAT_POSES = [1, 2, 3, 4, 5]; // 참모·타 유저 컷에 순환 배정

export function poseUrl(n) {
  return `/comic/pose${n}.png`;
}

// 유저 얼굴 슬롯 색 (이름 해시 → 고정색)
export const AVATAR_COLORS = ['#d07be0', '#e0a35b', '#5cb87a', '#5c8ae0', '#e0685c', '#5cc4c9'];

export function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
