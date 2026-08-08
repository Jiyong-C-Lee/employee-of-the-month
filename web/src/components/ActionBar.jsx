import { useState } from 'react';
import { UI, fmt } from '@content/ui';

const MAX_SPEECH_CHARS = 160;

export default function ActionBar({ state, actions, share }) {
  const { phase, room, playerId, speakTurn } = state;
  const isHost = room.hostId === playerId;
  const persona = room.persona;
  // 회의 시작(proceed)은 AI 대사 생성을 트리거하므로 중복 클릭을 막는다.
  const [proceeding, setProceeding] = useState(false);
  const T = UI.actionbar;

  if (phase === 'SITUATION') {
    // 상황을 읽는 동안 서버는 대기 — 방장이 눌러야 참모 발언(AI 생성)이 시작된다.
    if (isHost) {
      return (
        <div className="actionbar result">
          <span className="ab-label">{T.readSituation}</span>
          <button
            className="btn primary big next-btn" disabled={proceeding}
            onClick={async () => {
              setProceeding(true);
              const r = await actions.proceed();
              setProceeding(false);
              if (r?.error) actions.toast(r.error);
            }}
          >
            {proceeding ? T.preparing : T.startMeeting}
          </button>
        </div>
      );
    }
    return <div className="actionbar idle"><span className="ab-label">{T.readSituationGuest}</span></div>;
  }

  if (phase === 'PLAYER_TURNS') {
    // 멀티: 전원 동시 작성 → 순차 공개. speakTurn(순번) 대신 제출 여부로 입력창을 판단한다.
    if (room.config.mode === 'multi') {
      const revealing = room.round?.revealing;
      const submitted = room.round?.submitted || [];
      if (revealing) {
        return <div className="actionbar idle"><span className="ab-label waiting">{T.revealing}</span></div>;
      }
      if (!submitted.includes(playerId)) {
        return <SpeakBar onSend={actions.speak} hint={T.multiHint} />;
      }
      const humans = room.players.filter((p) => p.connected).length;
      return (
        <div className="actionbar idle">
          <span className="ab-label waiting">{fmt(T.submitted, { now: submitted.length, total: humans })}</span>
        </div>
      );
    }
    if (speakTurn?.current === playerId) {
      return <SpeakBar onSend={actions.speak} />;
    }
    return (
      <div className="actionbar idle">
        <span className="ab-label waiting">{fmt(T.othersTurn, { nick: speakTurn?.nick || T.someone })}</span>
      </div>
    );
  }

  if (phase === 'JUDGING') {
    return <div className="actionbar judging"><span className="spinner" /> {fmt(T.judging, { name: persona.name })}</div>;
  }

  if (phase === 'RESULT') {
    return (
      <div className="actionbar result">
        {share && (
          <button className="btn share-btn" disabled={share.sharing} onClick={share.onShare}>
            {share.sharing ? UI.game.sharing : UI.game.shareRound}
          </button>
        )}
        {isHost ? (
          <button className="btn primary big next-btn" onClick={async () => { const r = await actions.nextRound(); if (r?.error) actions.toast(r.error); }}>
            {T.next}
          </button>
        ) : (
          <span className="ab-label waiting next-btn">{T.waitNext}</span>
        )}
      </div>
    );
  }

  return <div className="actionbar idle"><span className="ab-label">{T.idle}</span></div>;
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
        placeholder={hint || UI.actionbar.speakPlaceholder}
        rows={3}
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
      />
      <div className="speak-side">
        <span className="char-count">{text.length}/{MAX_SPEECH_CHARS}</span>
        <button className="btn primary" onClick={send}>{UI.actionbar.speakSend}</button>
      </div>
    </div>
  );
}
