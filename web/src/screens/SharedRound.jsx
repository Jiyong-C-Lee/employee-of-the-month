// 공유 링크(/s/:id)로 들어온 손님용 읽기 전용 라운드 뷰.
// 게임 화면(Game.jsx)의 결과 페이지와 같은 컷 컴포넌트로 그대로 그리되,
// 하단 내비는 '다음' 대신 '게임 참여하기' CTA다.
import { useEffect, useState } from 'react';
import { UI, fmt } from '@content/ui';
import {
  BossCard, SituationCut, SpeakGrid, GaugeStrip, AwardCut, AwardFrame, WindowCut, ScoreCut, BossCommentCut, buildPoseMap,
} from '../components/ComicCuts.jsx';
import { HallOfFame } from '../components/EmployeeFrame.jsx';
import '../comic.css';

// 순위 스트립 — 라운드 뷰·세션 뷰가 같은 마크업을 쓴다.
function StandingStrip({ standings, center }) {
  if (!standings || standings.length < 2) return null;
  return (
    <div className="standing-strip" style={center ? { justifyContent: 'center' } : undefined}>
      {standings.map((s, i) => (
        <span key={s.id} className="ss-item">
          {fmt(UI.game.standing, { no: i + 1, nick: s.nick })}
          {' '}<em>{fmt(UI.game.standingSub, { rank: s.rank, favor: s.favor })}</em>
        </span>
      ))}
    </div>
  );
}

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
      .catch(() => setErr(UI.errors.connectFail));
  }, []);

  if (err || !data) {
    return (
      <div className="comic-app">
        <div className="share-missing">
          <p>{err ? `😥 ${err}` : UI.shared.loading}</p>
          {err && <a className="btn primary big" href="/">{UI.shared.goPlay}</a>}
        </div>
      </div>
    );
  }

  const { persona, situation, queue, speeches, verdict, adopted, standings, epilogue, roundNo, players } = data;
  const poseMap = buildPoseMap({ persona, players, queue });

  // 세션 최종 결과 공유 — 게임 종료 화면(올해의 사원·명예의 전당)과 동일 구성.
  if (data.kind === 'session') {
    const mvp = standings?.[0];
    const showMvp = mvp && mvp.favor > 0;
    return (
      <div className="comic-app">
        <header className="comic-appbar">
          <div className="ca-title">{UI.game.title}</div>
          <span className="ca-round">R.{roundNo}</span>
          <span className="ca-phase">{UI.shared.finalResult}</span>
        </header>
        <div className="comic-page">
          <BossCard persona={persona} roundNo={roundNo} phase="END" />
          <div className="cut comic-ended">
            <div className="ce-title">{UI.game.endTitle}</div>
            {showMvp && (
              <div className="mvp-award">
                <AwardFrame
                  title={UI.game.mvpTitle}
                  pose={poseMap?.[mvp.id]}
                  entry={{ kind: 'user', name: mvp.nick }}
                  avatar={(players || []).find((p) => p.id === mvp.id)?.avatar}
                  plate={fmt(UI.game.mvpPlate, { nick: mvp.nick, rank: mvp.rank, favor: mvp.favor })}
                />
              </div>
            )}
            <div className="comic-caption" style={{ alignSelf: 'stretch' }}>{data.reason}</div>
            <HallOfFame hall={data.hall} />
            <StandingStrip standings={standings} center />
          </div>
        </div>
        <div className="actionbar share-cta">
          <a className="btn primary big" href="/">{UI.shared.joinCta}</a>
        </div>
      </div>
    );
  }
  const rows = [...verdict.perSpeaker].sort((a, b) => b.total - a.total);
  const axes = rows[0] ? Object.keys(rows[0].axisScores) : [];
  const last = rows.length >= 2 ? rows[rows.length - 1] : null;
  const showWindow = last && last.key !== verdict.adoptedKey;

  return (
    <div className="comic-app">
      <header className="comic-appbar">
        <div className="ca-title">{UI.game.title}</div>
        <span className="ca-round">R.{roundNo}</span>
        <span className="ca-phase">{UI.shared.sharedRound}</span>
      </header>

      <div className="comic-page">
        <BossCard persona={persona} roundNo={roundNo} phase="END" />
        <div className="comic-sec"><b>{UI.game.sec.situation}</b><i /></div>
        <SituationCut persona={persona} situation={situation} />
        <div className="comic-sec"><b>{UI.game.sec.speak}</b><i /></div>
        <SpeakGrid
          queue={queue} speeches={speeches} speakTurn={null} playerId={null}
          timer={null} players={players} poseMap={poseMap} persona={persona}
        />
        <div className="comic-sec"><b>{UI.game.sec.result}</b><i /></div>
        <GaugeStrip persona={persona} done />
        <div className={`judge-row ${showWindow ? '' : 'solo'}`}>
          <AwardCut adopted={adopted} poseMap={poseMap} players={players} />
          {showWindow && <WindowCut last={last} pose={poseMap[last.key]} persona={persona} players={players} />}
        </div>
        {rows.length > 0 && <ScoreCut verdict={verdict} rows={rows} axes={axes} />}
        {verdict.adoptReason && <BossCommentCut persona={persona} reason={verdict.adoptReason} />}
        <StandingStrip standings={standings} />
        {epilogue && (
          <div className="comic-caption ep">
            <div className="cap-head">{UI.game.epilogueTitle}</div>
            <div>{epilogue}</div>
          </div>
        )}
      </div>

      <div className="actionbar share-cta">
        <a className="btn primary big" href="/">{UI.shared.joinCta}</a>
      </div>
    </div>
  );
}
