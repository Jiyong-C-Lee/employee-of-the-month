import MenuPanel from '../components/MenuPanel.jsx';

export default function Lobby({ state, actions }) {
  const { room, playerId } = state;
  const isHost = room.hostId === playerId;
  const need = room.capacity;
  // 멀티는 2명 이상이면 시작 가능(정원까지 안 채워도 됨)
  const ready = room.players.length >= 2;
  const shareUrl = `${location.origin}?code=${room.code}`;

  async function start() {
    const res = await actions.start();
    if (res?.error) actions.toast(res.error);
  }

  function copyCode() {
    navigator.clipboard?.writeText(room.code).then(() => actions.toast('방 코드 복사됨!'));
  }
  function copyLink() {
    navigator.clipboard?.writeText(shareUrl).then(() => actions.toast('초대 링크 복사됨!'));
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="lobby-head">
          <h2>대기실</h2>
          <MenuPanel code={room.code} onLeave={actions.leave} />
        </div>
        <div className="code-box">
          <div>
            <div className="code-label">방 코드</div>
            <div className="code-value" onClick={copyCode} title="클릭하여 복사">{room.code}</div>
          </div>
          <button className="btn" onClick={copyLink}>초대 링크 복사</button>
        </div>

        <div className="config-summary">
          <span>보스 {room.persona.emoji} {room.persona.name}</span>
          <span>발언 {room.config.speakTime > 0 ? `${Math.round(room.config.speakTime / 60)}분` : '제한 없음'}</span>
          <span>정원 {room.config.maxPlayers}명</span>
          <span>AI 참전 {room.config.aiCompete ? 'ON' : 'OFF'}</span>
          <span>난이도 {{ easy: '순한맛', normal: '보통', hard: '매운맛' }[room.config.difficulty] || '보통'}</span>
        </div>

        <div className="lobby-players">
          <div className="lp-head">참가자 {room.players.length} / {need}</div>
          {room.players.map((p) => (
            <div key={p.id} className="lp-row">
              <span className="dot" data-on={p.connected} />
              <span className="lp-nick">{p.nick} <em>{p.rank}</em></span>
              {p.id === room.hostId && <span className="badge host">방장</span>}
              {p.id === playerId && <span className="badge me">나</span>}
            </div>
          ))}
          {Array.from({ length: Math.max(0, need - room.players.length) }).map((_, i) => (
            <div key={`empty-${i}`} className="lp-row empty">빈 자리…</div>
          ))}
        </div>

        {isHost ? (
          <button className="btn primary big" disabled={!ready} onClick={start}>
            {ready ? '게임 시작' : '2명 이상 모이면 시작 가능'}
          </button>
        ) : (
          <div className="waiting-note">방장이 시작하기를 기다리는 중…</div>
        )}
      </div>
    </div>
  );
}
