import { useEffect, useState } from 'react';
import { AVATAR_EMOJI_PREFIX, avatarEmoji, hashColor, isEmojiAvatar, isImageAvatar } from '../comic-assets.js';
import PersonaWizard, { loadCustomPersonas, deleteCustomPersona } from './PersonaWizard.jsx';

const AVATAR_KEY = 'eotm.avatar';
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

// 익명 피드백 — 접이식 폼, 즉석 전송 (서버 KV 저장). 메일 앱 불필요.
function FeedbackBox({ toast }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (text.trim().length < 2) return toast('의견 내용을 입력해 주세요.');
    setBusy(true);
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), ...(contact.trim() && { contact: contact.trim() }) }),
    }).then((r) => r.json()).catch(() => ({ error: '서버에 연결할 수 없습니다.' }));
    setBusy(false);
    if (res.error) return toast(res.error);
    setText('');
    setContact('');
    setOpen(false);
    toast('전달됐습니다. 감사합니다! 🙏');
  }

  if (!open) {
    return (
      <button type="button" className="feedback-link" onClick={() => setOpen(true)}>
        💬 버그 제보·의견 보내기
      </button>
    );
  }
  return (
    <div className="feedback-box">
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={3}
        placeholder="버그, 아이디어, 아무 의견이나 익명으로 남겨주세요" autoFocus
      />
      <input
        value={contact} onChange={(e) => setContact(e.target.value)} maxLength={100}
        placeholder="답장 받을 연락처 (선택)"
      />
      <div className="row">
        <button type="button" className="btn small" onClick={() => setOpen(false)}>닫기</button>
        <button type="button" className="btn small primary" disabled={busy} onClick={send}>
          {busy ? '보내는 중…' : '보내기'}
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars -- App.tsx가 항상 state를 함께 넘겨 호출부 타입과 맞춘다.
export default function Home({ state, actions }) {
  // menu | single | create | join
  const [mode, setMode] = useState('menu');
  const [nick, setNick] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(() => {
    try { return localStorage.getItem(AVATAR_KEY) || null; } catch { return null; }
  });

  async function onAvatarPick(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 재선택도 change가 뜨도록
    if (!file) return;
    try {
      const dataUrl = await resizeAvatar(file);
      localStorage.setItem(AVATAR_KEY, dataUrl);
      setAvatar(dataUrl);
    } catch {
      actions.toast('이미지를 처리하지 못했습니다.');
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

  // 초대 링크(?code=XXXX)로 들어오면 참가 모드로 자동 전환
  useEffect(() => {
    const p = new URLSearchParams(location.search).get('code');
    if (p) { setCode(p.toUpperCase()); setMode('join'); }
  }, []);

  // 간신배 설정
  const [personas, setPersonas] = useState([]);
  const [personaId, setPersonaId] = useState(null);
  // 커스텀 페르소나 (localStorage) + 위저드 진입 전 화면 기억
  const [customs, setCustoms] = useState(loadCustomPersonas);
  const [wizardReturn, setWizardReturn] = useState('single');
  const [speakTime, setSpeakTime] = useState(60);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [aiCompete, setAiCompete] = useState(false);
  const [difficulty, setDifficulty] = useState('normal');
  const [maxRounds, setMaxRounds] = useState(5);

  // 인물 목록 로드
  useEffect(() => {
    if (personas.length > 0) return;
    fetch('/api/personas')
      .then((r) => r.json())
      .then((list) => {
        setPersonas(list);
        if (!personaId && list[0]) setPersonaId(list[0].id);
      })
      .catch(() => actions.toast('인물 목록을 불러오지 못했습니다.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function join() {
    if (!nick.trim()) return actions.toast('닉네임을 입력하세요.');
    if (!code.trim()) return actions.toast('방 코드를 입력하세요.');
    setBusy(true);
    const res = await actions.joinRoom(code, nick, avatar || undefined);
    setBusy(false);
    if (res.error) actions.toast(res.error);
  }

  async function start(modeKind) {
    if (!nick.trim()) return actions.toast('닉네임을 입력하세요.');
    if (!personaId) return actions.toast('인물을 선택하세요.');
    setBusy(true);
    const config = modeKind === 'single'
      ? { mode: 'single', personaId, difficulty, maxRounds: Number(maxRounds) } // 싱글은 제한시간 없음
      : { mode: 'multi', personaId, speakTime: Number(speakTime), maxPlayers: Number(maxPlayers), aiCompete, difficulty, maxRounds: Number(maxRounds) };
    // 커스텀 페르소나 선택 시 팩 전체를 동봉 — 서버가 재검증 후 방에 영속한다.
    const custom = customs.find((p) => p.id === personaId);
    if (custom) config.customPersona = custom;
    const res = await actions.createRoom(nick, config, avatar || undefined);
    setBusy(false);
    if (res.error) actions.toast(res.error);
  }

  const nickField = (
    <label className="field">
      <span>닉네임</span>
      <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={16} placeholder="예: 김철수" />
    </label>
  );

  const personaPicker = (
    <div className="persona-list">
      {personas.length === 0 && <div className="waiting-note">인물 목록 불러오는 중…</div>}
      {customs.map((p) => (
        <label key={p.id} className={`persona-card custom ${personaId === p.id ? 'sel' : ''}`}>
          <input type="radio" name="persona" value={p.id} checked={personaId === p.id} onChange={() => setPersonaId(p.id)} />
          <span className="pc-emoji">{p.emoji}</span>
          <span className="pc-body">
            <span className="pc-name">{p.name} <em className="pc-custom-badge">커스텀</em></span>
            <span className="pc-intro">{p.intro}</span>
            <span className="pc-axes">채점축: {p.axes.join(' · ')}</span>
          </span>
          <button
            type="button" className="pc-del" aria-label={`${p.name} 삭제`}
            onClick={(e) => {
              e.preventDefault();
              setCustoms(deleteCustomPersona(p.id));
              if (personaId === p.id) setPersonaId(personas[0]?.id ?? null);
            }}
          >✕</button>
        </label>
      ))}
      {personas.map((p) => (
        <label key={p.id} className={`persona-card ${personaId === p.id ? 'sel' : ''}`}>
          <input type="radio" name="persona" value={p.id} checked={personaId === p.id} onChange={() => setPersonaId(p.id)} />
          <span className="pc-emoji">{p.emoji}</span>
          <span className="pc-body">
            <span className="pc-name">{p.name}</span>
            <span className="pc-intro">{p.intro}</span>
            <span className="pc-axes">채점축: {p.axes.join(' · ')}</span>
          </span>
        </label>
      ))}
      <button type="button" className="btn small wizard-open" onClick={() => { setWizardReturn(mode); setMode('wizard'); }}>
        🛠 나만의 보스 만들기
      </button>
    </div>
  );

  const difficultyField = (
    <label className="field">
      <span>AI 참모 난이도</span>
      <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
        <option value="easy">순한맛 (참모가 허술함)</option>
        <option value="normal">보통</option>
        <option value="hard">매운맛 (참모가 날카로움)</option>
      </select>
    </label>
  );

  const roundsField = (
    <label className="field">
      <span>라운드 수 (도달 시 최고 총애자가 '올해의 사원')</span>
      <select value={maxRounds} onChange={(e) => setMaxRounds(e.target.value)}>
        <option value={5}>5라운드 (기본)</option>
        <option value={10}>10라운드</option>
        <option value={15}>15라운드 (풀코스)</option>
      </select>
    </label>
  );

  const speakTimeField = (
    <label className="field">
      <span>발언 제한시간</span>
      <select value={speakTime} onChange={(e) => setSpeakTime(e.target.value)}>
        <option value={60}>1분</option>
        <option value={120}>2분</option>
        <option value={180}>3분</option>
      </select>
    </label>
  );

  return (
    <div className="home">
      <div className="home-card">
        <h1 className="logo">🏆 이달의 사원</h1>
        <p className="tagline">보스의 마음을 움직이는 간언으로 <br/> 사원에서 사장까지 승진해 보세요</p>

        <div className="avatar-setting">
          <span
            className="avatar-preview"
            style={isImageAvatar(avatar) ? { backgroundImage: `url(${avatar})` } : { background: isEmojiAvatar(avatar) ? undefined : hashColor(nick.trim() || '?') }}
          >
            {isImageAvatar(avatar) ? null : isEmojiAvatar(avatar) ? avatarEmoji(avatar) : (nick.trim().slice(0, 1) || '?')}
          </span>
          <div className="avatar-actions">
            <button type="button" className={`btn small ${!avatar ? 'sel' : ''}`} onClick={resetAvatar}>기본</button>
            <label className="btn small">
              사진 업로드
              <input type="file" accept="image/*" onChange={onAvatarPick} style={{ display: 'none' }} />
            </label>
          </div>
        </div>
        <div className="avatar-emoji-list">
          {AVATAR_EMOJI_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              className={`avatar-emoji-btn ${avatar === AVATAR_EMOJI_PREFIX + e ? 'sel' : ''}`}
              onClick={() => pickEmojiAvatar(e)}
              aria-label={`아이콘 ${e} 선택`}
            >
              {e}
            </button>
          ))}
        </div>

        {mode === 'menu' && (
          <div className="stack">
            <button className="btn primary big" onClick={() => setMode('single')}>👤 혼자 하기 (AI 참모와 경쟁)</button>
            <button className="btn big" onClick={() => setMode('create')}>👥 방 만들기 (동료와 경쟁)</button>
            <button className="btn big" onClick={() => setMode('join')}>🔑 방 코드로 참가</button>
          </div>
        )}

        {mode === 'join' && (
          <div className="stack">
            {nickField}
            <label className="field">
              <span>방 코드</span>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} placeholder="예: AB12" style={{ textTransform: 'uppercase', letterSpacing: '4px', fontSize: '1.3rem' }} />
            </label>
            <div className="row">
              <button className="btn" onClick={() => setMode('menu')}>뒤로</button>
              <button className="btn primary" disabled={busy} onClick={join}>참가</button>
            </div>
          </div>
        )}

        {mode === 'single' && (
          <div className="stack">
            {nickField}
            {personaPicker}
            {difficultyField}
            {roundsField}
            <div className="row">
              <button className="btn" onClick={() => setMode('menu')}>뒤로</button>
              <button className="btn primary" disabled={busy} onClick={() => start('single')}>출근하기 ▶</button>
            </div>
          </div>
        )}

        {mode === 'wizard' && (
          <PersonaWizard
            toast={actions.toast}
            onCancel={() => setMode(wizardReturn)}
            onSaved={(p) => {
              setCustoms(loadCustomPersonas());
              setPersonaId(p.id);
              setMode(wizardReturn);
            }}
          />
        )}

        {mode === 'menu' && <FeedbackBox toast={actions.toast} />}

        {mode === 'create' && (
          <div className="stack">
            {nickField}
            {personaPicker}
            {speakTimeField}
            <label className="field">
              <span>정원 (빈자리는 AI 참모가 채웁니다)</span>
              <select value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)}>
                <option value={2}>2명</option>
                <option value={3}>3명</option>
                <option value={4}>4명</option>
                <option value={5}>5명</option>
                <option value={6}>6명</option>
              </select>
            </label>
            <label className="field check">
              <span>AI 참모도 채택 경쟁 참전</span>
              <input type="checkbox" checked={aiCompete} onChange={(e) => setAiCompete(e.target.checked)} />
            </label>
            {difficultyField}
            {roundsField}
            <div className="row">
              <button className="btn" onClick={() => setMode('menu')}>뒤로</button>
              <button className="btn primary" disabled={busy} onClick={() => start('multi')}>방 생성</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
