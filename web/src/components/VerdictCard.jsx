import EmployeeFrame from './EmployeeFrame.jsx';

// 판정 카드: 축별 점수표 + 채택자 액자 + 보스 한줄평.
export default function VerdictCard({ item }) {
  const { verdict, adoptedName, adopted, roundNo, source } = item;
  const axes = verdict.perSpeaker[0] ? Object.keys(verdict.perSpeaker[0].axisScores) : [];
  // 총점 내림차순 정렬 표시
  const rows = [...verdict.perSpeaker].sort((a, b) => b.total - a.total);

  return (
    <div className="result-card syco-verdict">
      <div className="svc-banner">
        <span className="svc-round">Round {roundNo} 판정</span>
        {adoptedName
          ? <span className="svc-adopted">🏆 채택: {adoptedName}</span>
          : <span className="svc-adopted none">채택 없음</span>}
      </div>

      {adopted && <EmployeeFrame adopted={adopted} roundNo={roundNo} />}

      <div className="svc-table-wrap">
        <table className="svc-table">
          <thead>
            <tr>
              <th className="svc-th-name">발언자</th>
              {axes.map((ax) => <th key={ax}>{ax}</th>)}
              <th>합계</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key} className={s.key === verdict.adoptedKey ? 'adopted-row' : ''}>
                <td className="svc-nick">
                  {s.key === verdict.adoptedKey && '🏆 '}
                  {s.name}{s.kind === 'ai' && <em className="adv-mark"> (참모)</em>}
                </td>
                {axes.map((ax) => <td key={ax} className="svc-num">{s.axisScores[ax]}</td>)}
                <td className="svc-num svc-total">{s.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="svc-comments">
        {rows.map((s) => (
          <div key={s.key} className="svc-comment-line">
            <b>{s.name}</b> — {s.comment}
          </div>
        ))}
      </div>

      {verdict.adoptReason && <div className="svc-reason">🗣️ {verdict.adoptReason}</div>}
      <div className="rc-source" style={{ padding: '0 16px 10px' }}>{source}</div>
    </div>
  );
}
