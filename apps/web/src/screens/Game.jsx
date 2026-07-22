// 이달의 사원 — 회의실 만화 페이지 UI.
// 한 라운드 = 스크롤되는 만화 한 페이지: 상황 → 발언 컷 → 심판(분노 게이지) → 결과(액자·창밖) → 채점표 → 총평.
import { useEffect, useRef } from 'react';
import ActionBar from '../components/ActionBar.jsx';
import MenuPanel from '../components/MenuPanel.jsx';
import { HallOfFame } from '../components/EmployeeFrame.jsx';
import {
  BossCard, SituationCut, SpeakGrid, GaugeStrip, AwardCut, WindowCut, ScoreCut, BossCommentCut,
  PHASE_LABEL, fmtSec, buildPoseMap,
} from '../components/ComicCuts.jsx';
import '../comic.css';

export default function Game({ state, actions }) {
  const { room, phase, timer, playerId, feed, ended, speakTurn } = state;
  const persona = room.persona;
  const situation = room.situation;
  const queue = room.round?.queue ?? [];
  const speeches = room.round?.speeches ?? [];

  // 현재 라운드의 판정·에필로그·최근 자막은 피드에서 찾는다 (연출 이벤트라 방 상태에 없음)
  const verdictItem = findLast(feed, (m) => m.type === 'verdict' && m.roundNo === room.roundNo);
  const epilogueItem = findLast(feed, (m) => m.type === 'epilogue' && m.roundNo === room.roundNo);
  const lastSystem = findLast(feed, (m) => m.type === 'system');

  const pageRef = useRef(null);
  useEffect(() => {
    const el = pageRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [phase, speeches.length, speakTurn?.current, !!verdictItem, !!epilogueItem, !!ended]);

  const showTimer = timer && phase === 'PLAYER_TURNS' && timer.phase === 'PLAYER_TURNS' && timer.total > 0;
  const judging = phase === 'JUDGING';
  const resulted = (phase === 'RESULT' || phase === 'END') && verdictItem;
  // 캐릭터별 고정 포즈 (라운드·순번·뷰어가 바뀌어도 몸이 안 바뀐다)
  const poseMap = buildPoseMap({ persona, players: room.players });

  let resultBlock = null;
  if (resulted) {
    const verdict = verdictItem.verdict;
    const rows = [...verdict.perSpeaker].sort((a, b) => b.total - a.total);
    const axes = rows[0] ? Object.keys(rows[0].axisScores) : [];
    const last = rows.length >= 2 ? rows[rows.length - 1] : null;
    const showWindow = last && last.key !== verdict.adoptedKey;
    resultBlock = (
      <>
        <div className="comic-sec"><b>③ 결과</b><i /></div>
        <GaugeStrip persona={persona} done />
        <div className={`judge-row ${showWindow ? '' : 'solo'}`}>
          <AwardCut adopted={verdictItem.adopted} poseMap={poseMap} playerId={playerId} players={room.players} />
          {showWindow && <WindowCut last={last} pose={poseMap[last.key]} />}
        </div>
        {rows.length > 0 && <ScoreCut verdict={verdict} rows={rows} axes={axes} />}
        {verdict.adoptReason && <BossCommentCut persona={persona} reason={verdict.adoptReason} />}
        {verdictItem.standings?.length > 1 && (
          <div className="standing-strip">
            {verdictItem.standings.map((s, i) => (
              <span key={s.id} className="ss-item">#{i + 1} {s.nick} <em>{s.rank} · 🏆×{s.favor}</em></span>
            ))}
          </div>
        )}
      </>
    );
  }

  // 판정·검토 중엔 승진 확정 자막만 보여준다 (총평·판정 컷과 중복 방지).
  const caption = (() => {
    if (ended || !lastSystem) return null;
    if (judging || resulted) return lastSystem.tag === 'champion' ? lastSystem : null;
    return lastSystem;
  })();

  const debugMode = new URLSearchParams(window.location.search).has('debug');

  return (
    <div className="comic-app">
      <header className="comic-appbar">
        <div className="ca-title">이달의 사원</div>
        {room.roundNo > 0 && <span className="ca-round">R.{room.roundNo}</span>}
        <span className="ca-phase">{ended ? PHASE_LABEL.END : PHASE_LABEL[phase] || '대기'}</span>
        {showTimer && <span className={`ca-timer ${timer.remaining <= 10 ? 'low' : ''}`}>⏱ {fmtSec(timer.remaining)}</span>}
        <MenuPanel code={room.code} onLeave={actions.leave} />
      </header>

      <div className="comic-page" ref={pageRef}>
        <BossCard persona={persona} roundNo={room.roundNo} phase={ended ? 'END' : phase} />

        {situation && (
          <>
            <div className="comic-sec"><b>① 문제 상황</b><i /></div>
            <SituationCut persona={persona} situation={situation} />
          </>
        )}

        {queue.length > 0 && (
          <>
            <div className="comic-sec"><b>② 발언 {phase === 'PLAYER_TURNS' ? '진행 중' : ''}</b><i /></div>
            <SpeakGrid
              queue={queue}
              speeches={speeches}
              speakTurn={phase === 'PLAYER_TURNS' ? speakTurn : null}
              playerId={playerId}
              timer={showTimer ? timer : null}
              players={room.players}
              poseMap={poseMap}
            />
          </>
        )}

        {judging && (
          <>
            <div className="comic-sec"><b>③ 심판</b><i /></div>
            <GaugeStrip persona={persona} />
          </>
        )}

        {resultBlock}

        {epilogueItem && (
          <div className="comic-caption ep">
            <div className="cap-head">📖 그 후 이야기</div>
            <div>{epilogueItem.story}</div>
            <div className="cap-note">※ 에필로그는 연출일 뿐, 점수와 무관합니다</div>
          </div>
        )}

        {ended && <ComicEnded ended={ended} />}

        {caption && <div className="comic-caption">{caption.text}</div>}
      </div>

      {!ended && <ActionBar state={state} actions={actions} />}

      {debugMode && !ended && <DebugPanel actions={actions} />}
    </div>
  );
}

// ?debug=1 로 여는 플레이테스트 패널: 승진 루프·사장 엔딩을 빠르게 확인한다.
function DebugPanel({ actions }) {
  const run = (action) => actions.debugAction(action).then((r) => r?.error && actions.toast(r.error));
  return (
    <div className="debug-panel">
      <b>DEBUG</b>
      <button onClick={() => run('adoptMe')}>이번 R 나 채택</button>
      <button onClick={() => run('noAdopt')}>채택 없음 처리</button>
      <button onClick={() => run('next')}>다음 라운드 ▶</button>
    </div>
  );
}

function ComicEnded({ ended }) {
  return (
    <div className="cut comic-ended">
      <div className="ce-title">🏁 세션 종료</div>
      <div className="comic-caption" style={{ alignSelf: 'stretch' }}>{ended.reason}</div>
      <HallOfFame hall={ended.hall} />
      <div className="standing-strip" style={{ justifyContent: 'center' }}>
        {ended.standings.map((s, i) => (
          <span key={s.id} className="ss-item">#{i + 1} {s.nick} <em>{s.rank} · 🏆×{s.favor}</em></span>
        ))}
      </div>
    </div>
  );
}

function findLast(arr, pred) {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i];
  return null;
}
