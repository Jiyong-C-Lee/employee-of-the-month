import { UI, fmt } from '@content/ui';
import MenuPanel from '../components/MenuPanel.jsx';

export default function Lobby({ state, actions }) {
  const { room, playerId } = state;
  const isHost = room.hostId === playerId;
  const need = room.capacity;
  // 멀티는 2명 이상이면 시작 가능(정원까지 안 채워도 됨)
  const ready = room.players.length >= 2;
  const shareUrl = `${location.origin}?code=${room.code}`;
  const T = UI.lobby;

  async function start() {
    const res = await actions.start();
    if (res?.error) actions.toast(res.error);
  }

  function copyCode() {
    navigator.clipboard?.writeText(room.code).then(() => actions.toast(T.codeCopied));
  }
  function copyLink() {
    navigator.clipboard?.writeText(shareUrl).then(() => actions.toast(T.linkCopied));
  }

  const speakLabel = room.config.speakTime > 0
    ? fmt(T.speakMin, { min: Math.round(room.config.speakTime / 60) })
    : T.speakNone;

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="lobby-head">
          <h2>{T.title}</h2>
          <MenuPanel code={room.code} onLeave={actions.leave} />
        </div>
        <div className="code-box">
          <div>
            <div className="code-label">{T.codeLabel}</div>
            <div className="code-value" onClick={copyCode} title={T.codeCopyHint}>{room.code}</div>
          </div>
          <button className="btn" onClick={copyLink}>{T.copyLink}</button>
        </div>

        <div className="config-summary">
          <span>{fmt(T.boss, { emoji: room.persona.emoji, name: room.persona.name })}</span>
          <span>{fmt(T.speak, { value: speakLabel })}</span>
          <span>{fmt(T.capacity, { n: room.config.maxPlayers })}</span>
          <span>{fmt(T.rounds, { n: room.config.maxRounds ?? 10 })}</span>
          <span>{fmt(T.aiCompete, { onOff: room.config.aiCompete ? T.on : T.off })}</span>
          <span>{fmt(T.difficulty, { label: T.diff[room.config.difficulty] || T.diff.normal })}</span>
        </div>

        <div className="lobby-players">
          <div className="lp-head">{fmt(T.players, { now: room.players.length, need })}</div>
          {room.players.map((p) => (
            <div key={p.id} className="lp-row">
              <span className="dot" data-on={p.connected} />
              <span className="lp-nick">{p.nick} <em>{p.rank}</em></span>
              {p.id === room.hostId && <span className="badge host">{T.host}</span>}
              {p.id === playerId && <span className="badge me">{T.me}</span>}
            </div>
          ))}
          {Array.from({ length: Math.max(0, need - room.players.length) }).map((_, i) => (
            <div key={`empty-${i}`} className="lp-row empty">{T.emptySeat}</div>
          ))}
        </div>

        {isHost ? (
          <button className="btn primary big" disabled={!ready} onClick={start}>
            {ready ? T.start : T.needTwo}
          </button>
        ) : (
          <div className="waiting-note">{T.waitHost}</div>
        )}
      </div>
    </div>
  );
}
