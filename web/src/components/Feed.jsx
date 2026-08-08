import { useEffect, useRef } from 'react';
import VerdictCard from './VerdictCard.jsx';

export default function Feed({ feed, playerId }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feed.length]);

  return (
    <div className="feed">
      {feed.map((m) => {
        if (m.type === 'verdict') return <VerdictCard key={m._k} item={m} />;
        if (m.type === 'epilogue') {
          return (
            <div key={m._k} className="epilogue-card">
              <div className="ep-head">📖 그 후 이야기</div>
              <div className="ep-story">{m.story}</div>
              <div className="ep-note">※ 에필로그는 연출일 뿐, 점수와 무관합니다</div>
            </div>
          );
        }
        if (m.type === 'system') {
          return <div key={m._k} className="msg system">{m.text}</div>;
        }
        // speech: 간신배 간언 (AI 조언자 / 유저)
        if (m.speakerType === 'ai') {
          return (
            <div key={m._k} className="msg user advisor">
              <span className="msg-author">
                {m.emoji} {m.name} <em className="adv-style">{m.style}</em>
              </span>
              <span className="msg-text">{m.text}</span>
            </div>
          );
        }
        const mineSpeech = m.playerId === playerId;
        return (
          <div key={m._k} className={`msg user speech ${mineSpeech ? 'mine' : ''}`}>
            <span className="msg-author">🎤 {m.name} <em>{m.rank}</em></span>
            <span className="msg-text">{m.text}</span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
