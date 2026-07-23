// 이달의 사원 — 회의실 만화 페이지 UI.
// 한 라운드 = 스크롤되는 만화 한 페이지: 상황 → 발언 컷 → 심판(분노 게이지) → 결과(액자·창밖) → 채점표 → 총평.
import { useEffect, useRef, useState } from 'react';
import ActionBar from '../components/ActionBar.jsx';
import MenuPanel from '../components/MenuPanel.jsx';
import ShareCard from '../components/ShareCard.jsx';
import { shareRoundImage } from '../share.js';
import { HallOfFame } from '../components/EmployeeFrame.jsx';
import {
  BossCard, SituationCut, SpeakGrid, GaugeStrip, AwardCut, AwardFrame, WindowCut, ScoreCut, BossCommentCut,
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
  // 캐릭터별 고정 포즈 (순번·뷰어가 바뀌어도 몸이 안 바뀐다). 큐를 넘겨 이번 라운드 출전 참모끼리만 충돌을 푼다.
  const poseMap = buildPoseMap({ persona, players: room.players, queue: room.round?.queue });

  // 라운드 공유 — 캡처 전용 숨김 레이아웃(ShareCard)을 PNG로 찍는다.
  const shareRef = useRef(null);
  const [sharing, setSharing] = useState(false);
  async function onShare() {
    if (!shareRef.current || sharing) return;
    setSharing(true);
    try {
      await shareRoundImage(shareRef.current, { title: `이달의 사원 R.${room.roundNo}`, url: location.origin });
    } catch {
      actions.toast('이미지 생성에 실패했습니다.');
    } finally {
      setSharing(false);
    }
  }

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
          <AwardCut adopted={verdictItem.adopted} poseMap={poseMap} players={room.players} />
          {showWindow && <WindowCut last={last} pose={poseMap[last.key]} persona={persona} players={room.players} />}
        </div>
        {rows.length > 0 && <ScoreCut verdict={verdict} rows={rows} axes={axes} />}
        {verdict.adoptReason && <BossCommentCut persona={persona} reason={verdict.adoptReason} />}
        <button className="btn small share-btn" disabled={sharing} onClick={onShare}>
          {sharing ? '캡처 중…' : '📤 이 라운드 공유'}
        </button>
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
              persona={persona}
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

        {ended && <ComicEnded ended={ended} poseMap={poseMap} players={room.players} />}

        {caption && <div className="comic-caption">{caption.text}</div>}
      </div>

      {resulted && (
        <div className="share-card-holder" aria-hidden="true">
          <ShareCard cardRef={shareRef} persona={persona} situation={verdictItem.situation}
            speeches={speeches} verdict={verdictItem.verdict} epilogue={epilogueItem?.story} roundNo={verdictItem.roundNo} />
        </div>
      )}

      {!ended && <ActionBar state={state} actions={actions} />}

      {debugMode && !ended && <DebugPanel actions={actions} />}
    </div>
  );
}

// ?debug=1 로 여는 플레이테스트 패널: 승진 루프·엔딩을 빠르게 확인한다.
// (서버는 .dev.vars의 DEBUG_ACTIONS='true'일 때만 허용 — 프로덕션 비활성)
function DebugPanel({ actions }) {
  const [running, setRunning] = useState(false);
  const run = (action) => actions.debugAction(action).then((r) => r?.error && actions.toast(r.error));

  // 엔딩까지 자동 진행: adopt=true면 매 라운드 나 채택(6채택 사장 엔딩),
  // false면 무채택으로 10라운드 소진('올해의 사원' 상한 엔딩). 세션이 끝나 에러가 오면 멈춘다.
  async function skipToEnd(adopt) {
    setRunning(true);
    try {
      for (let i = 0; i < 12; i++) {
        const a = await actions.debugAction(adopt ? 'adoptMe' : 'noAdopt');
        if (a?.error) break;
        const n = await actions.debugAction('next');
        if (n?.error) break;
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="debug-panel">
      <b>DEBUG</b>
      <button disabled={running} onClick={() => run('adoptMe')}>이번 R 나 채택</button>
      <button disabled={running} onClick={() => run('noAdopt')}>채택 없음 처리</button>
      <button disabled={running} onClick={() => run('next')}>다음 라운드 ▶</button>
      <button disabled={running} onClick={() => skipToEnd(true)}>⏭ 사장 엔딩까지</button>
      <button disabled={running} onClick={() => skipToEnd(false)}>⏭ 10R 상한 엔딩까지</button>
    </div>
  );
}

function ComicEnded({ ended, poseMap, players }) {
  // 올해의 사원(MVP) = 총애 1위. standings는 서버에서 총애순 정렬이라 첫 항목이 MVP다.
  // 라운드 수상 컷(이달의 사원)과 같은 AwardFrame으로 그려 비주얼을 통일한다.
  const mvp = ended.standings?.[0];
  const showMvp = mvp && mvp.favor > 0;
  return (
    <div className="cut comic-ended">
      <div className="ce-title">🏁 세션 종료</div>
      {showMvp && (
        <div className="mvp-award">
          <AwardFrame
            title="올해의 사원"
            pose={poseMap?.[mvp.id]}
            entry={{ kind: 'user', name: mvp.nick }}
            avatar={(players || []).find((p) => p.id === mvp.id)?.avatar}
            plate={`${mvp.nick} · ${mvp.rank} · 채택 ${mvp.favor}회`}
          />
        </div>
      )}
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
