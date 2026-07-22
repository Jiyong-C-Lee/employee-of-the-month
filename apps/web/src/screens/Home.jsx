import { useEffect, useState } from 'react';

// eslint-disable-next-line no-unused-vars -- App.tsx가 항상 state를 함께 넘겨 호출부 타입과 맞춘다.
export default function Home({ state, actions }) {
  // menu | single | create | join
  const [mode, setMode] = useState('menu');
  const [nick, setNick] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  // 초대 링크(?code=XXXX)로 들어오면 참가 모드로 자동 전환
  useEffect(() => {
    const p = new URLSearchParams(location.search).get('code');
    if (p) { setCode(p.toUpperCase()); setMode('join'); }
  }, []);

  // 간신배 설정
  const [personas, setPersonas] = useState([]);
  const [personaId, setPersonaId] = useState(null);
  const [speakTime, setSpeakTime] = useState(60);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [aiCompete, setAiCompete] = useState(false);
  const [difficulty, setDifficulty] = useState('normal');

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
    const res = await actions.joinRoom(code, nick);
    setBusy(false);
    if (res.error) actions.toast(res.error);
  }

  async function start(modeKind) {
    if (!nick.trim()) return actions.toast('닉네임을 입력하세요.');
    if (!personaId) return actions.toast('인물을 선택하세요.');
    setBusy(true);
    const config = modeKind === 'single'
      ? { mode: 'single', personaId, difficulty } // 싱글은 제한시간 없음
      : { mode: 'multi', personaId, speakTime: Number(speakTime), maxPlayers: Number(maxPlayers), aiCompete, difficulty };
    const res = await actions.createRoom(nick, config);
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
      {personas.map((p) => (
        <label key={p.id} className={`persona-card ${personaId === p.id ? 'sel' : ''}`}>
          <input type="radio" name="persona" value={p.id} checked={personaId === p.id} onChange={() => setPersonaId(p.id)} />
          <span className="pc-emoji">{p.emoji}</span>
          <span className="pc-body">
            <span className="pc-name">{p.name}</span>
            <span className="pc-intro">{p.intro}</span>
            <span className="pc-axes">채점축: {p.axes.join(' · ')}</span>
            <span className="pc-goal">목표: {p.ranks[0]} → {p.ranks[p.ranks.length - 1]}</span>
          </span>
        </label>
      ))}
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
        <p className="tagline">AI 보스가 가장 듣고 싶어할 말로 채택을 노리고, 사원에서 사장까지 승진하는 눈치 게임</p>

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
            <div className="row">
              <button className="btn" onClick={() => setMode('menu')}>뒤로</button>
              <button className="btn primary" disabled={busy} onClick={() => start('single')}>출근하기 ▶</button>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <div className="stack">
            {nickField}
            {personaPicker}
            {speakTimeField}
            {difficultyField}
            <label className="field">
              <span>정원</span>
              <select value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)}>
                <option value={2}>2명</option>
                <option value={3}>3명</option>
                <option value={4}>4명</option>
                <option value={5}>5명</option>
                <option value={6}>6명</option>
              </select>
            </label>
            <label className="field check">
              <span>AI 조언자도 채택 경쟁 참전</span>
              <input type="checkbox" checked={aiCompete} onChange={(e) => setAiCompete(e.target.checked)} />
            </label>
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
