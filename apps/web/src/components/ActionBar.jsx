import { useState } from 'react';

const MAX_SPEECH_CHARS = 160;

export default function ActionBar({ state, actions, share }) {
  const { phase, room, playerId, speakTurn } = state;
  const isHost = room.hostId === playerId;
  const persona = room.persona;
  // 회의 시작(proceed)은 AI 대사 생성을 트리거하므로 중복 클릭을 막는다.
  const [proceeding, setProceeding] = useState(false);

  if (phase === 'SITUATION') {
    // 상황을 읽는 동안 서버는 대기 — 방장이 눌러야 참모 발언(AI 생성)이 시작된다.
    if (isHost) {
      return (
        <div className="actionbar result">
          <span className="ab-label">📜 상황을 읽어보세요…</span>
          <button
            className="btn primary big next-btn" disabled={proceeding}
            onClick={async () => {
              setProceeding(true);
              const r = await actions.proceed();
              setProceeding(false);
              if (r?.error) actions.toast(r.error);
            }}
          >
            {proceeding ? '준비 중…' : '회의 시작 ▶'}
          </button>
        </div>
      );
    }
    return <div className="actionbar idle"><span className="ab-label">📜 상황을 읽어보세요… (방장이 회의를 시작합니다)</span></div>;
  }

  if (phase === 'PLAYER_TURNS') {
    // 멀티: 전원 동시 작성 → 순차 공개. speakTurn(순번) 대신 제출 여부로 입력창을 판단한다.
    if (room.config.mode === 'multi') {
      const revealing = room.round?.revealing;
      const submitted = room.round?.submitted || [];
      if (revealing) {
        return <div className="actionbar idle"><span className="ab-label waiting">📣 의견을 순서대로 공개하는 중…</span></div>;
      }
      if (!submitted.includes(playerId)) {
        return <SpeakBar onSend={actions.speak} hint="시간 안에 제출하세요. 전원 제출되면 순서대로 공개됩니다." />;
      }
      const humans = room.players.filter((p) => p.connected).length;
      return (
        <div className="actionbar idle">
          <span className="ab-label waiting">✅ 제출 완료 — 다른 참가자 대기 중… ({submitted.length}/{humans})</span>
        </div>
      );
    }
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
        {share && (
          <button className="btn share-btn" disabled={share.sharing} onClick={share.onShare}>
            {share.sharing ? '링크 만드는 중…' : '🔗 라운드 결과 공유'}
          </button>
        )}
        {isHost ? (
          <button className="btn primary big next-btn" onClick={async () => { const r = await actions.nextRound(); if (r?.error) actions.toast(r.error); }}>
            다음 ▶
          </button>
        ) : (
          <span className="ab-label waiting next-btn">방장이 다음으로 넘기기를 기다리는 중…</span>
        )}
      </div>
    );
  }

  return <div className="actionbar idle"><span className="ab-label">다음 단계를 준비 중…</span></div>;
}

function SpeakBar({ onSend, hint }) {
  const [text, setText] = useState('');
  const send = () => {
    if (text.trim()) { onSend(text); setText(''); }
  };
  return (
    <div className="actionbar submit speak">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_SPEECH_CHARS))}
        placeholder={hint || '당신의 차례! 윗분이 가장 듣고 싶어할 한 마디를… (Ctrl+Enter 전송)'}
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
