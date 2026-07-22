import { useState } from 'react';

const MAX_SPEECH_CHARS = 160;

export default function ActionBar({ state, actions }) {
  const { phase, room, playerId, speakTurn } = state;
  const isHost = room.hostId === playerId;
  const persona = room.persona;

  if (phase === 'SITUATION') {
    return <div className="actionbar idle"><span className="ab-label">📜 상황을 읽어보세요…</span></div>;
  }

  if (phase === 'PLAYER_TURNS') {
    if (speakTurn?.current === playerId) {
      return <SpeakBar onSend={actions.speak} />;
    }
    return (
      <div className="actionbar idle">
        <span className="ab-label waiting">🎤 {speakTurn?.nick || '누군가'} 님이 발언 중… (앞 의견에 얹거나 반박할 말을 미리 생각해두세요)</span>
      </div>
    );
  }

  if (phase === 'JUDGING') {
    return <div className="actionbar judging"><span className="spinner" /> {persona.name}이(가) 의견들을 검토하는 중…</div>;
  }

  if (phase === 'RESULT') {
    return (
      <div className="actionbar result">
        {isHost ? (
          <button className="btn primary big" onClick={async () => { const r = await actions.nextRound(); if (r?.error) actions.toast(r.error); }}>
            다음 ▶
          </button>
        ) : (
          <span className="ab-label waiting">방장이 다음으로 넘기기를 기다리는 중…</span>
        )}
      </div>
    );
  }

  return <div className="actionbar idle"><span className="ab-label">다음 단계를 준비 중…</span></div>;
}

function SpeakBar({ onSend }) {
  const [text, setText] = useState('');
  const send = () => {
    if (text.trim()) { onSend(text); setText(''); }
  };
  return (
    <div className="actionbar submit speak">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_SPEECH_CHARS))}
        placeholder="당신의 차례! 윗분이 가장 듣고 싶어할 한 마디를… (Ctrl+Enter 전송)"
        rows={3}
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
      />
      <div className="speak-side">
        <span className="char-count">{text.length}/{MAX_SPEECH_CHARS}</span>
        <button className="btn primary" onClick={send}>의견 올리기</button>
      </div>
    </div>
  );
}
