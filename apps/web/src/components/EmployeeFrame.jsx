// 「이달의 우수사원」 액자 연출 (회의실 밈 오마주). 채택자의 아바타를 액자에 건다.
const AVATAR_COLORS = ['#e0685c', '#5c8ae0', '#5cb87a', '#c78be0', '#e0a75c', '#5cc4c9'];

function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function FrameAvatar({ adopted, size = 'md' }) {
  if (adopted.kind === 'ai') {
    return <span className={`ef-avatar ai ${size}`}>{adopted.emoji || '🤖'}</span>;
  }
  return (
    <span className={`ef-avatar ${size}`} style={{ background: hashColor(adopted.name) }}>
      {adopted.name.slice(0, 1)}
    </span>
  );
}

// 라운드 종료 액자 카드
export default function EmployeeFrame({ adopted, roundNo }) {
  return (
    <div className="employee-frame">
      <div className="ef-title">Employee of the Month</div>
      <div className="ef-photo">
        <FrameAvatar adopted={adopted} size="lg" />
      </div>
      <div className="ef-plate">
        <b>{adopted.name}</b>
        <span className="ef-sub">{adopted.kind === 'ai' ? 'AI 참모' : adopted.rank} · Round {roundNo}</span>
      </div>
    </div>
  );
}

// 세션 종료 명예의 전당 (라운드별 미니 액자 나열)
export function HallOfFame({ hall }) {
  if (!hall || hall.length === 0) return null;
  return (
    <div className="hall-of-fame">
      <div className="hof-title">🏆 명예의 전당</div>
      <div className="hof-row">
        {hall.map((h) => (
          <div key={h.roundNo} className="hof-frame">
            <FrameAvatar adopted={h} size="sm" />
            <span className="hof-name">{h.name}</span>
            <span className="hof-round">R{h.roundNo}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
