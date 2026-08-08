// 회의실 코믹 에셋 매핑 — 디자인 프로젝트 '코믹 UI 목업.dc.html' 확정 좌표.
// 이미지 8종(493x394 통일)은 client/public/comic/pose{0..7}.png. 교체하려면 파일만 갈아끼우면 된다.
// face: 얼굴 원(아바타/이니셜/이모지 합성 슬롯)의 중심 x/y·지름 d — 이미지 기준 % 값이라 해상도 독립.
//
// 튜닝 워크플로: 브라우저에서 ?tune=1 로 접속해 포즈별 얼굴 원 위치를 눈으로 맞춘 뒤(값은 곧바로
// localStorage에 저장돼 게임 화면에도 실시간 반영된다) "POSES 코드 복사" 버튼으로 나온 리터럴을
// 아래 POSES 기본값에 붙여넣고 커밋하면 팀 전체에 반영된다 — localStorage override는 개인 브라우저용 임시값.

export const POSES = {
  0: { x: 51,   y: 25,   d: 21 }, // 보스 정면 (문제 상황)
  1: { x: 52.7, y: 36,   d: 23 }, // 손들기
  2: { x: 51.3, y: 38,   d: 23 }, // 턱괴기(주먹)
  3: { x: 51.2, y: 36.9, d: 23 }, // 검지 들기
  4: { x: 52,   y: 39,   d: 23 }, // 팔짱
  5: { x: 53.4, y: 38.5, d: 23 }, // 어깨 으쓱
  6: { x: 43.2, y: 39.4, d: 23 }, // 턱받침 — 유저 지정석
  7: { x: 53.1, y: 24.2, d: 21 }, // 보스 응시 (분노 게이지)
};

// 얼굴 슬롯(색원·프로필 이미지) 기본 투명도 — 포즈 그림 위에 살짝 겹쳐 보이게.
export const FACE_ALPHA = 1;

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

// 아바타 값 종류 판별 — localStorage/서버가 공유하는 avatar 문자열 포맷:
// 미설정(null) | 이미지 dataURL(data:image/...) | 프리셋 아이콘(emoji:😎)
export const AVATAR_EMOJI_PREFIX = 'emoji:';

export function isImageAvatar(avatar) {
  return typeof avatar === 'string' && avatar.startsWith('data:image/');
}

export function isEmojiAvatar(avatar) {
  return typeof avatar === 'string' && avatar.startsWith(AVATAR_EMOJI_PREFIX);
}

export function avatarEmoji(avatar) {
  return avatar.slice(AVATAR_EMOJI_PREFIX.length);
}

// #rrggbb → rgba(r, g, b, alpha). 형식이 아니면 원본을 그대로 돌려준다(방어적 폴백).
export function hexToRgba(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── 튜닝 override (localStorage) ──────────────────────────────────────────
// 튜닝 화면(?tune=1)과 게임 화면이 같은 키를 읽고 써서, 튜닝 값이 새로고침 없이도 게임에 반영된다.
const POSE_OVERRIDE_KEY = 'eotm.poseOverride';
const FACE_ALPHA_KEY = 'eotm.faceAlpha';

function readLocalStorage(key) {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null; // 프라이빗 모드 등 접근 차단 환경 방어
  }
}

function writeLocalStorage(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 저장 실패는 튜닝 편의 기능일 뿐이라 조용히 무시한다.
  }
}

// 현재 유효한 포즈 좌표(기본값 + override 병합)를 돌려준다. 게임 화면·튜닝 화면 공용 접근자.
export function getPoses() {
  let override = null;
  try {
    const raw = readLocalStorage(POSE_OVERRIDE_KEY);
    override = raw ? JSON.parse(raw) : null;
  } catch {
    override = null;
  }
  if (!override) return POSES;
  const merged = {};
  for (const k of Object.keys(POSES)) merged[k] = { ...POSES[k], ...(override[k] || {}) };
  return merged;
}

export function setPoseOverride(poses) {
  writeLocalStorage(POSE_OVERRIDE_KEY, JSON.stringify(poses));
}

export function resetPoseOverride() {
  writeLocalStorage(POSE_OVERRIDE_KEY, null);
}

// 현재 유효한 얼굴 슬롯 투명도(기본값 + override).
export function getFaceAlpha() {
  const raw = readLocalStorage(FACE_ALPHA_KEY);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : FACE_ALPHA;
}

export function setFaceAlpha(alpha) {
  writeLocalStorage(FACE_ALPHA_KEY, String(alpha));
}

export function resetFaceAlpha() {
  writeLocalStorage(FACE_ALPHA_KEY, null);
}
