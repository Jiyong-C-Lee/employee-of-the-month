// 메인 화면 — 디자인 프로젝트 '스타일 탐색' 3a 확정안.
// 히어로(보스 컷 + 말풍선) → 닉네임 한 줄 → 번호 붙은 진입 3개. 보스 선택·회의 설정은
// 다음 화면(BossPick, 3c)이 맡는다. 이 화면은 "누가 들어가는가"만 정한다.
import { useEffect, useState } from 'react';
import { UI } from '@content/ui';
import {
  AVATAR_EMOJI_PREFIX, BOSS_FRONT, avatarEmoji, hashColor, isEmojiAvatar, isImageAvatar, poseUrl,
} from '../comic-assets.js';
import BossPick from './BossPick.jsx';
import '../paper.css';

const AVATAR_KEY = 'eotm.avatar';
const NICK_KEY = 'eotm.nick';
const AVATAR_SIZE = 128;

// 아이콘 선택 프리셋 — 표정·동물·사물 30종 (얼굴 원 안에서 알아보기 좋은 것 위주).
const AVATAR_EMOJI_PRESETS = [
  '😎', '🤓', '😤', '🥸', '😏', '🫡', '🤔', '😴', '🤑', '😇', '👻', '🤠', '🥶', '🥳', '😈',
  '🐱', '🐶', '🦊', '🐼', '🐸', '🐯', '🐷', '🐧', '🦄',
  '☕', '🍕', '🎮', '📈', '💼', '🔥',
];

// 이미지 파일 → 128x128 커버 크롭 → JPEG dataURL(품질 0.8). 실패하면 reject(호출부가 토스트로 안내).
function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-fail'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode-fail'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

// 아바타 원 — 이미지/이모지/이니셜 세 갈래를 한 곳에서 그린다. 닉네임 줄과 3c 헤더 칩이 공유한다.
export function AvatarCircle({ avatar, nick, className = 'ph-avatar' }) {
  if (isImageAvatar(avatar)) {
    return <span className={className} style={{ backgroundImage: `url(${avatar})` }} />;
  }
  if (isEmojiAvatar(avatar)) {
    return <span className={className}>{avatarEmoji(avatar)}</span>;
  }
  const seed = nick.trim() || '?';
  return <span className={className} style={{ background: hashColor(seed) }}>{seed.slice(0, 1)}</span>;
}

// 익명 피드백 — 접이식 폼, 즉석 전송 (서버 KV 저장). 메일 앱 불필요.
function FeedbackBox({ toast }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (text.trim().length < 2) return toast(UI.errors.feedbackEmpty);
    setBusy(true);
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), ...(contact.trim() && { contact: contact.trim() }) }),
    }).then((r) => r.json()).catch(() => ({ error: UI.errors.connectFail }));
    setBusy(false);
    if (res.error) return toast(res.error);
    setText('');
    setContact('');
    setOpen(false);
    toast(UI.home.feedbackThanks);
  }

  if (!open) {
    return (
      <div className="ph-foot">
        <button type="button" onClick={() => setOpen(true)}>{UI.home.feedbackOpen}</button>
      </div>
    );
  }
  return (
    <div className="ph-feedback">
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={3}
        placeholder={UI.home.feedbackText} autoFocus
      />
      <input
        value={contact} onChange={(e) => setContact(e.target.value)} maxLength={100}
        placeholder={UI.home.feedbackContact}
      />
      <div className="row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>{UI.home.feedbackClose}</button>
        <button type="button" className="btn primary" disabled={busy} onClick={send}>
          {busy ? UI.home.feedbackSending : UI.home.feedbackSend}
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars -- App.tsx가 항상 state를 함께 넘겨 호출부 타입과 맞춘다.
export default function Home({ state, actions }) {
  // menu | join | single | multi  (single·multi는 보스 선택 화면으로 넘어간다)
  const [mode, setMode] = useState('menu');
  // 처음 온 사람에겐 풀에서 하나 뽑아 채워 준다 — 빈 칸부터 마주하지 않게. 마음에 안 들면 지우고 쓴다.
  const [nick, setNick] = useState(() => {
    try {
      const saved = localStorage.getItem(NICK_KEY);
      if (saved) return saved;
    } catch { /* 사파리 프라이빗 등 — 아래 랜덤으로 간다 */ }
    const pool = UI.home.nickPool;
    return pool[Math.floor(Math.random() * pool.length)];
  });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [faceOpen, setFaceOpen] = useState(false);
  const [avatar, setAvatar] = useState(() => {
    try { return localStorage.getItem(AVATAR_KEY) || null; } catch { return null; }
  });

  // 닉네임은 재방문에도 남는다 — 3a는 닉네임이 이미 채워진 상태를 기본으로 그린다.
  useEffect(() => {
    try { localStorage.setItem(NICK_KEY, nick); } catch { /* 사파리 프라이빗 등 — 무시 */ }
  }, [nick]);

  // 초대 링크(?code=XXXX)로 들어오면 참가 모드로 자동 전환
  useEffect(() => {
    const p = new URLSearchParams(location.search).get('code');
    if (p) { setCode(p.toUpperCase()); setMode('join'); }
  }, []);

  async function onAvatarPick(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 재선택도 change가 뜨도록
    if (!file) return;
    try {
      const dataUrl = await resizeAvatar(file);
      localStorage.setItem(AVATAR_KEY, dataUrl);
      setAvatar(dataUrl);
    } catch {
      actions.toast(UI.errors.avatarFail);
    }
  }

  function resetAvatar() {
    localStorage.removeItem(AVATAR_KEY);
    setAvatar(null);
  }

  function pickEmojiAvatar(emoji) {
    const value = AVATAR_EMOJI_PREFIX + emoji;
    localStorage.setItem(AVATAR_KEY, value);
    setAvatar(value);
  }

  async function join() {
    if (!nick.trim()) return actions.toast(UI.errors.needNick);
    if (!code.trim()) return actions.toast(UI.errors.needCode);
    setBusy(true);
    const res = await actions.joinRoom(code, nick, avatar || undefined);
    setBusy(false);
    if (res.error) actions.toast(res.error);
  }

  // 보스 선택 화면 — 싱글·멀티가 같은 화면을 쓰고 시작 버튼 문구·설정 항목만 갈린다.
  if (mode === 'single' || mode === 'multi') {
    return (
      <BossPick
        mode={mode}
        nick={nick}
        avatar={avatar}
        actions={actions}
        onBack={() => setMode('menu')}
      />
    );
  }

  const MENU = UI.home.menu;

  return (
    <div className="paper">
      <div className="paper-card ph-card">
        <div className="ph-hero">
          <i className="ph-stripes" />
          {/* 얼굴 합성 없이 에셋 그대로 — 메인은 특정 보스의 화면이 아니다. */}
          <div className="ph-boss">
            <img src={poseUrl(BOSS_FRONT)} alt="" />
          </div>
          <div className="ph-bubble">
            {UI.home.bossLine}
            <b>{UI.home.bossLineStrong}</b>
            <i className="tail-ink" />
            <i className="tail-fill" />
          </div>
        </div>

        <div className="ph-body">
          <h1 className="ph-title">{UI.home.title}</h1>
          <div className="ph-rule" />
          <p className="ph-tagline">
            {UI.home.tagline.map((line, i) => (
              <span key={line}>{i > 0 && <br />}{line}</span>
            ))}
          </p>

          <div className="ph-nick">
            <AvatarCircle avatar={avatar} nick={nick} />
            <div className="ph-nick-body">
              <div className="ph-nick-label">{UI.home.nickLabel}</div>
              <input
                value={nick}
                onChange={(e) => setNick(e.target.value)}
                maxLength={16}
                placeholder={UI.home.nickPlaceholder}
                aria-label={UI.home.nickLabel}
              />
            </div>
            <button type="button" className="ph-face-btn" onClick={() => setFaceOpen((v) => !v)}>
              {UI.home.changeFace}
            </button>
          </div>

          {faceOpen && (
            <div className="ph-face-sheet">
              <div className="ph-face-head">
                <b>{UI.home.faceTitle}</b>
                <button type="button" className="btn small" onClick={() => setFaceOpen(false)}>{UI.home.faceDone}</button>
              </div>
              <div className="ph-face-grid">
                {AVATAR_EMOJI_PRESETS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={avatar === AVATAR_EMOJI_PREFIX + e ? 'sel' : ''}
                    onClick={() => pickEmojiAvatar(e)}
                    aria-label={e}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="ph-face-actions">
                <button type="button" className="btn small" onClick={resetAvatar}>{UI.home.faceDefault}</button>
                <label className="btn small" style={{ textAlign: 'center' }}>
                  {UI.home.facePhoto}
                  <input type="file" accept="image/*" onChange={onAvatarPick} style={{ display: 'none' }} />
                </label>
              </div>
            </div>
          )}

          {mode === 'menu' && (
            <>
              <div className="ph-menu">
                <MenuItem item={MENU.single} primary onClick={() => setMode('single')} />
                <MenuItem item={MENU.create} onClick={() => setMode('multi')} />
                <MenuItem item={MENU.join} onClick={() => setMode('join')} />
              </div>
              <FeedbackBox toast={actions.toast} />
            </>
          )}

          {mode === 'join' && (
            <div className="ph-join">
              <div className="ph-join-label">{UI.home.codeLabel}</div>
              <input
                className="ph-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={4}
                placeholder={UI.home.codePlaceholder}
                aria-label={UI.home.codeLabel}
                autoFocus
              />
              <div className="ph-row">
                <button type="button" className="btn" onClick={() => setMode('menu')}>{UI.home.back}</button>
                <button type="button" className="btn primary" disabled={busy} onClick={join}>{UI.home.joinAction}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ item, primary, onClick }) {
  return (
    // 번호·설명이 중첩 span이라 스크린리더가 이름을 못 뽑는다. 이름을 명시한다.
    <button
      type="button"
      className={`ph-item ${primary ? 'primary' : ''}`}
      aria-label={`${item.title} — ${item.desc}`}
      onClick={onClick}
    >
      <span className="ph-no" aria-hidden="true">{item.no}</span>
      <span className="ph-item-body">
        <b>{item.title}</b>
        <span className="ph-desc">{item.desc}</span>
      </span>
      <span className="ph-arrow">▶</span>
    </button>
  );
}
