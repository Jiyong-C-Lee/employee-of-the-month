// 이달의 사원 — 회의실 만화 페이지 UI.
// 한 라운드 = 스크롤되는 만화 한 페이지: 상황 → 발언 컷 → 심판(분노 게이지) → 결과(액자·창밖) → 채점표 → 총평.
import { useEffect, useRef, useState } from 'react';
import { UI, fmt } from '@content/ui';
import ActionBar from '../components/ActionBar.jsx';
import MenuPanel from '../components/MenuPanel.jsx';
import { createShareLink } from '../share.js';
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

  // 라운드 공유 — 라운드 스냅샷을 서버(KV)에 올려 공유 링크를 만든다.
  // 링크를 연 손님은 이 화면과 동일한 읽기 전용 라운드 뷰(/s/:id)를 본다.
  const [sharing, setSharing] = useState(false);
  async function onShare() {
    if (sharing || !verdictItem) return;
    setSharing(true);
    try {
      const payload = {
        roundNo: verdictItem.roundNo,
        persona,
        situation: verdictItem.situation,
        queue,
        speeches,
        verdict: verdictItem.verdict,
        adopted: verdictItem.adopted,
        standings: verdictItem.standings || [],
        epilogue: epilogueItem?.story,
        players: room.players,
      };
      const r = await createShareLink(payload, fmt(UI.game.shareRoundTitle, { name: persona.name, roundNo: verdictItem.roundNo }));
      if (r === 'copied') actions.toast(UI.game.shareCopied);
      else if (r === 'error') actions.toast(UI.game.shareFail);
    } finally {
      setSharing(false);
    }
  }

  // 세션 최종 결과 공유 — 올해의 사원·명예의 전당 스냅샷 링크.
  const [sharingEnd, setSharingEnd] = useState(false);
  // 한 판 더 (방장 전용) — 같은 멤버로 방을 로비로 리셋.
  const [rematching, setRematching] = useState(false);
  async function onShareEnded() {
    if (sharingEnd || !ended) return;
    setSharingEnd(true);
    try {
      const payload = {
        kind: 'session',
        roundNo: room.roundNo,
        persona,
        players: room.players,
        standings: ended.standings,
        hall: ended.hall,
        reason: ended.reason,
      };
      const r = await createShareLink(payload, fmt(UI.game.shareEndTitle, { name: persona.name }));
      if (r === 'copied') actions.toast(UI.game.shareCopied);
      else if (r === 'error') actions.toast(UI.game.shareFail);
    } finally {
      setSharingEnd(false);
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
        <div className="comic-sec"><b>{UI.game.sec.result}</b><i /></div>
        <GaugeStrip persona={persona} done />
        <div className={`judge-row ${showWindow ? '' : 'solo'}`}>
          <AwardCut adopted={verdictItem.adopted} poseMap={poseMap} players={room.players} />
          {showWindow && <WindowCut last={last} pose={poseMap[last.key]} persona={persona} players={room.players} />}
        </div>
        {rows.length > 0 && <ScoreCut verdict={verdict} rows={rows} axes={axes} />}
        {verdict.adoptReason && <BossCommentCut persona={persona} reason={verdict.adoptReason} />}
        {verdictItem.standings?.length > 1 && (
          <div className="standing-strip">
            {verdictItem.standings.map((s, i) => (
              <span key={s.id} className="ss-item">
                {fmt(UI.game.standing, { no: i + 1, nick: s.nick })}
                {' '}<em>{fmt(UI.game.standingSub, { rank: s.rank, favor: s.favor })}</em>
              </span>
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
        <div className="ca-title">{UI.game.title}</div>
        {room.roundNo > 0 && <span className="ca-round">R.{room.roundNo}</span>}
        <span className="ca-phase">{ended ? PHASE_LABEL.END : PHASE_LABEL[phase] || PHASE_LABEL.idle}</span>
        {showTimer && <span className={`ca-timer ${timer.remaining <= 10 ? 'low' : ''}`}>⏱ {fmtSec(timer.remaining)}</span>}
        <MenuPanel code={room.code} onLeave={actions.leave} />
      </header>

      <div className="comic-page" ref={pageRef}>
        <BossCard persona={persona} roundNo={room.roundNo} phase={ended ? 'END' : phase} />

        {situation && (
          <>
            <div className="comic-sec"><b>{UI.game.sec.situation}</b><i /></div>
            <SituationCut persona={persona} situation={situation} />
          </>
        )}

        {queue.length > 0 && (
          <>
            <div className="comic-sec"><b>{phase === 'PLAYER_TURNS' ? UI.game.sec.speakLive : UI.game.sec.speakDone}</b><i /></div>
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
            <div className="comic-sec"><b>{UI.game.sec.judge}</b><i /></div>
            <GaugeStrip persona={persona} />
          </>
        )}

        {resultBlock}

        {epilogueItem && (
          <div className="comic-caption ep">
            <div className="cap-head">{UI.game.epilogueTitle}</div>
            <div>{epilogueItem.story}</div>
            <div className="cap-note">{UI.game.epilogueNote}</div>
          </div>
        )}

        {ended && <ComicEnded ended={ended} poseMap={poseMap} players={room.players} />}

        {caption && <div className="comic-caption">{caption.text}</div>}
      </div>

      {!ended && <ActionBar state={state} actions={actions} share={resulted ? { sharing, onShare } : null} />}

      {ended && (
        <div className="actionbar result">
          <button className="btn share-btn" disabled={sharingEnd} onClick={onShareEnded}>
            {sharingEnd ? UI.game.sharing : UI.game.shareEnd}
          </button>
          {room.hostId === playerId ? (
            <>
              <button
                className="btn primary big next-btn" disabled={rematching}
                onClick={async () => {
                  setRematching(true);
                  const r = await actions.rematch();
                  setRematching(false);
                  if (r?.error) actions.toast(r.error);
                }}
              >
                {rematching ? UI.game.rematching : UI.game.rematch}
              </button>
              <a className="btn big" href="/">{UI.game.toMain}</a>
            </>
          ) : (
            <a className="btn primary big next-btn" href="/">{UI.game.toMain}</a>
          )}
        </div>
      )}

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
      <button disabled={running} onClick={() => run('adoptMe')}>{UI.debug.adoptMe}</button>
      <button disabled={running} onClick={() => run('noAdopt')}>{UI.debug.noAdopt}</button>
      <button disabled={running} onClick={() => run('next')}>{UI.debug.next}</button>
      <button disabled={running} onClick={() => skipToEnd(true)}>{UI.debug.toBossEnd}</button>
      <button disabled={running} onClick={() => skipToEnd(false)}>{UI.debug.toCapEnd}</button>
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
      <div className="comic-caption" style={{ alignSelf: 'stretch' }}>{ended.reason}</div>
      <HallOfFame hall={ended.hall} />
      <div className="standing-strip" style={{ justifyContent: 'center' }}>
        {ended.standings.map((s, i) => (
          <span key={s.id} className="ss-item">
            {fmt(UI.game.standing, { no: i + 1, nick: s.nick })}
            {' '}<em>{fmt(UI.game.standingSub, { rank: s.rank, favor: s.favor })}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

function findLast(arr, pred) {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i];
  return null;
}
