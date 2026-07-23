// 공유 링크(/s/:id)로 들어온 손님용 읽기 전용 라운드 뷰.
// 게임 화면(Game.jsx)의 결과 페이지와 같은 컷 컴포넌트로 그대로 그리되,
// 하단 내비는 '다음' 대신 '게임 참여하기' CTA다.
import { useEffect, useState } from 'react';
import {
  BossCard, SituationCut, SpeakGrid, GaugeStrip, AwardCut, WindowCut, ScoreCut, BossCommentCut, buildPoseMap,
} from '../components/ComicCuts.jsx';
import '../comic.css';

export default function SharedRound() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const id = location.pathname.split('/')[2] || '';
    fetch(`/api/share/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const j = await r.json();
        if (j.error) setErr(j.error);
        else setData(j);
      })
      .catch(() => setErr('서버에 연결할 수 없습니다.'));
  }, []);

  if (err || !data) {
    return (
      <div className="comic-app">
        <div className="share-missing">
          <p>{err ? `😥 ${err}` : '불러오는 중…'}</p>
          {err && <a className="btn primary big" href="/">🎮 게임 하러 가기</a>}
        </div>
      </div>
    );
  }

  const { persona, situation, queue, speeches, verdict, adopted, standings, epilogue, roundNo, players } = data;
  const poseMap = buildPoseMap({ persona, players, queue });
  const rows = [...verdict.perSpeaker].sort((a, b) => b.total - a.total);
  const axes = rows[0] ? Object.keys(rows[0].axisScores) : [];
  const last = rows.length >= 2 ? rows[rows.length - 1] : null;
  const showWindow = last && last.key !== verdict.adoptedKey;

  return (
    <div className="comic-app">
      <header className="comic-appbar">
        <div className="ca-title">이달의 사원</div>
        <span className="ca-round">R.{roundNo}</span>
        <span className="ca-phase">공유된 라운드</span>
      </header>

      <div className="comic-page">
        <BossCard persona={persona} roundNo={roundNo} phase="END" />
        <div className="comic-sec"><b>① 문제 상황</b><i /></div>
        <SituationCut persona={persona} situation={situation} />
        <div className="comic-sec"><b>② 발언</b><i /></div>
        <SpeakGrid
          queue={queue} speeches={speeches} speakTurn={null} playerId={null}
          timer={null} players={players} poseMap={poseMap} persona={persona}
        />
        <div className="comic-sec"><b>③ 결과</b><i /></div>
        <GaugeStrip persona={persona} done />
        <div className={`judge-row ${showWindow ? '' : 'solo'}`}>
          <AwardCut adopted={adopted} poseMap={poseMap} players={players} />
          {showWindow && <WindowCut last={last} pose={poseMap[last.key]} persona={persona} players={players} />}
        </div>
        {rows.length > 0 && <ScoreCut verdict={verdict} rows={rows} axes={axes} />}
        {verdict.adoptReason && <BossCommentCut persona={persona} reason={verdict.adoptReason} />}
        {standings?.length > 1 && (
          <div className="standing-strip">
            {standings.map((s, i) => (
              <span key={s.id} className="ss-item">#{i + 1} {s.nick} <em>{s.rank} · 🏆×{s.favor}</em></span>
            ))}
          </div>
        )}
        {epilogue && (
          <div className="comic-caption ep">
            <div className="cap-head">📖 그 후 이야기</div>
            <div>{epilogue}</div>
          </div>
        )}
      </div>

      <div className="actionbar share-cta">
        <a className="btn primary big" href="/">🎮 나도 게임 참여하기</a>
      </div>
    </div>
  );
}
