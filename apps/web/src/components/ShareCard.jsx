// 라운드 공유 이미지 전용 레이아웃. html-to-image가 이 DOM을 그대로 찍는다 — 인터랙션 요소 금지.
export default function ShareCard({ cardRef, persona, situation, speeches, verdict, epilogue, roundNo }) {
  const adoptedKey = verdict?.adoptedKey;
  const rows = verdict ? [...verdict.perSpeaker].sort((a, b) => b.total - a.total) : [];
  return (
    <div ref={cardRef} className="share-card">
      <div className="shc-head">
        <span className="shc-emoji">{persona.emoji}</span>
        <b>{persona.name}의 회의실</b>
        <span className="shc-round">Round {roundNo}</span>
      </div>
      {situation && (
        <div className="shc-situation">
          <p>{situation.text}</p>
          <p className="shc-q">❝ {situation.question} ❞</p>
        </div>
      )}
      <div className="shc-speeches">
        {speeches.map((s) => (
          <div key={s.key} className={`shc-line ${s.key === adoptedKey ? 'adopted' : ''}`}>
            <b>{s.key === adoptedKey ? '🏆 ' : ''}{s.name}{s.kind === 'ai' ? ' (참모)' : ''}</b>
            <span>{s.text}</span>
          </div>
        ))}
      </div>
      {rows.length > 0 && (
        <div className="shc-scores">
          {rows.map((r, i) => <span key={r.key}>#{i + 1} {r.name} {r.total}점</span>)}
        </div>
      )}
      {verdict?.adoptReason && <div className="shc-reason">🗣️ {verdict.adoptReason}</div>}
      {epilogue && <div className="shc-ep">📖 {epilogue}</div>}
      <div className="shc-footer">🏆 이달의 사원 — {location.origin}</div>
    </div>
  );
}
