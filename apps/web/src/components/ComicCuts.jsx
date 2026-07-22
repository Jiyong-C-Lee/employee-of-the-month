// 회의실 코믹 컷 모음 — 디자인 프로젝트 '코믹 UI 목업.dc.html' 확정안 + 1차 플레이테스트 피드백 반영.
// 모든 컷은 상태(room.round.queue/speeches, phase, verdict)로만 그린다. 피드는 자막·에필로그에만 쓴다.
import { useEffect, useState } from 'react';
import { POSES, BOSS_FRONT, USER_POSE, SEAT_POSES, poseUrl, hashColor } from '../comic-assets.js';

// 타이핑 연출: 마운트/텍스트 변경 시 한 글자씩 출력.
function TypeText({ text, speed = 28 }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return undefined;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(t);
    }, speed);
    return () => clearInterval(t);
  }, [text, speed]);
  return <>{text.slice(0, n)}</>;
}

export const PHASE_LABEL = {
  SITUATION: '상황 공개',
  PLAYER_TURNS: '발언 진행',
  JUDGING: '검토 중',
  RESULT: '판정',
  END: '세션 종료',
};

export function fmtSec(sec) {
  if (sec == null) return '--:--';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// 받침 유무 조사 선택 (은/는, 이/가 …)
export function josa(word, withFinal, noFinal) {
  const ch = word?.charCodeAt(word.length - 1) ?? 0;
  if (ch < 0xac00 || ch > 0xd7a3) return noFinal;
  return (ch - 0xac00) % 28 > 0 ? withFinal : noFinal;
}

// 포즈 배정: 큐 순서가 아니라 캐릭터 고정 — 참모는 명단 순, 유저는 입장순. 라운드가 바뀌어도 몸이 안 바뀐다.
// 내 컷만 지정석(턱받침).
export function buildPoseMap({ persona, players, playerId }) {
  const map = {};
  persona.advisors.forEach((a, i) => {
    map[`ai:${a.name}`] = SEAT_POSES[i % SEAT_POSES.length];
  });
  let seat = persona.advisors.length;
  for (const p of [...(players || [])].sort((a, b) => a.joinOrder - b.joinOrder)) {
    map[p.id] = p.id === playerId ? USER_POSE : SEAT_POSES[seat++ % SEAT_POSES.length];
  }
  return map;
}

function FaceSlot({ pose, entry, mine }) {
  const p = POSES[pose];
  const style = { left: `${p.x}%`, top: `${p.y}%`, width: `${p.d}%` };
  if (entry.kind === 'ai') {
    return <div className="face-slot ai" style={style}><span>{entry.emoji || '🤖'}</span></div>;
  }
  return (
    <div className="face-slot user" style={{ ...style, background: mine ? '#5cb87a' : hashColor(entry.name) }}>
      <span>{entry.name.slice(0, 1)}</span>
    </div>
  );
}

// ── 보스 프로필 카드: 원형 썸네일 + 이름 + 한 줄 소개 + 성향 태그 ──
export function BossCard({ persona, roundNo, phase }) {
  return (
    <div className="cut boss-card">
      <div className="bc-thumb emoji-circle">
        <span>{persona.emoji}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="bc-name">{persona.name}</div>
        <div className="bc-intro">{persona.intro}</div>
        <div className="bc-tags">
          {persona.axes.map((ax) => <span key={ax} className="bc-tag">{ax}</span>)}
        </div>
      </div>
      <span className="bc-state">R.{roundNo} {PHASE_LABEL[phase] || '진행 중'}</span>
    </div>
  );
}

// ── ① 문제 상황 ──
export function SituationCut({ persona, situation }) {
  const p = POSES[BOSS_FRONT];
  return (
    <div className="cut situation-cut">
      <div className="sc-boss">
        <img src={poseUrl(BOSS_FRONT)} alt="" />
        <div className="face-slot ai" style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.d}%` }}>
          <span>{persona.emoji}</span>
        </div>
      </div>
      <div className="sc-bubble-wrap">
        <div className="bubble-left">
          {situation.text}
          <b className="q">“{situation.question}”</b>
        </div>
        <div className="tail-l-ink" />
        <div className="tail-l-fill" />
      </div>
    </div>
  );
}

// ── ② 발언 컷 그리드 ──
export function SpeakGrid({ queue, speeches, speakTurn, playerId, timer, players, poseMap }) {
  const speechByKey = Object.fromEntries(speeches.map((s) => [s.key, s]));
  const rankByKey = Object.fromEntries((players || []).map((p) => [p.id, p.rank]));
  const showTimer = timer && timer.phase === 'PLAYER_TURNS' && timer.total > 0;

  return (
    <div className="speak-grid">
      {queue.map((entry, i) => {
        const spoken = speechByKey[entry.key];
        const speaking = speakTurn?.current === entry.key && !spoken;
        const waiting = !spoken && !speaking;
        const mine = entry.kind === 'user' && entry.key === playerId;
        const span2 = queue.length % 2 === 1 && i === queue.length - 1;
        const cls = ['cut', 'speak-panel', speaking ? 'speaking' : '', waiting ? 'waiting' : '', span2 ? 'span2' : ''].join(' ');
        const label = `${i + 1}  ${entry.name}${entry.kind === 'user' ? ` ${rankByKey[entry.key] || ''}` : ''}${mine ? ' ★' : ''}`;
        return (
          <div key={entry.key} className={cls}>
            {speaking && (
              <span className="speak-badge">
                ▶ 발언 중{speaking && showTimer ? ` ${fmtSec(timer.remaining)}` : ''}
              </span>
            )}
            <div className={`sp-bubble-wrap ${waiting ? 'faint' : ''}`}>
              <div className="sp-bubble">{spoken ? <TypeText text={spoken.text} /> : speaking ? '…(발언 중)' : '…'}</div>
              <div className="tail-b-ink" />
              <div className="tail-b-fill" />
            </div>
            <div className="sp-figure">
              <img src={poseUrl(poseMap[entry.key])} alt="" />
              <FaceSlot pose={poseMap[entry.key]} entry={entry} mine={mine} />
            </div>
            <span className="sp-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── ③ 심판: 분노 게이지 스트립 (가로 1줄, 1회 채움) ──
export function GaugeStrip({ persona, done }) {
  return (
    <div className={`cut gauge-strip ${done ? 'done' : ''}`}>
      <div className="gs-fill" />
      <div className="gs-boss emoji-circle sm"><span>{persona.emoji}</span></div>
      <span className="gs-title">분노 게이지</span>
      <span className="gs-rage">💢</span>
      <span className="gs-rage r2">💢</span>
      <div className="gs-status">{done ? '판정 완료' : '검토 중…'}</div>
    </div>
  );
}

// ── ④-a 수상 컷 (이달의 사원 액자) ──
export function AwardCut({ adopted, poseMap, playerId }) {
  const awardPose = adopted ? (poseMap[adopted.key] ?? USER_POSE) : USER_POSE;
  return (
    <div className="cut award-cut">
      {adopted ? (
        <div className="award">
          <div className="aw-ribbon">🏆 이달의 사원</div>
          <div className="aw-frame">
            <div className="aw-frame-in">
              <div className="aw-mat">
                <div className="aw-photo">
                  {/* 얼굴 원이 잘 보이게 아래쪽을 크롭 — 슬롯 %좌표 기준(이미지 박스)은 inner가 유지 */}
                  <div className="aw-photo-inner">
                    <img src={poseUrl(awardPose)} alt="" />
                    <FaceSlot
                      pose={awardPose}
                      entry={adopted.kind === 'ai' ? { kind: 'ai', emoji: adopted.emoji } : { kind: 'user', name: adopted.name }}
                      mine={adopted.kind === 'user' && adopted.key === playerId}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="aw-plate">
              <span>{adopted.name} · {adopted.kind === 'ai' ? 'AI 참모' : `${adopted.rank} 승진`}</span>
            </div>
            <span className="aw-screw tl" /><span className="aw-screw tr" />
            <span className="aw-screw bl" /><span className="aw-screw br" />
          </div>
        </div>
      ) : (
        <div className="no-adopt-stamp">전원 반려</div>
      )}
    </div>
  );
}

// ── ④-b 창밖 투척 컷 (최하위) ──
export function WindowCut({ last, pose }) {
  return (
    <div className="cut window-cut">
      <div className="wh-speed" />
      <div className="wh-window">
        <div className="w-glass" /><div className="w-mull-v" /><div className="w-mull-h" />
        <div className="w-sash-l" /><div className="w-sash-r" />
      </div>
      <div className="wh-flyer">
        <img src={poseUrl(pose ?? SEAT_POSES[0])} alt="" />
      </div>
      <div className="wh-caption">최하위 {last.name}{josa(last.name, '은', '는')} 창밖으로.</div>
    </div>
  );
}

// ── 채점 결과 표 ──
export function ScoreCut({ verdict, rows, axes }) {
  const cols = `.5fr 1.5fr ${axes.map(() => '.55fr').join(' ')} .6fr .4fr`;
  return (
    <div className="cut score-cut">
      <div className="sc-title">채점 결과 · 순위</div>
      <div className="score-grid-head" style={{ gridTemplateColumns: cols }}>
        <span>#</span><span>발언자</span>
        {axes.map((ax) => <span key={ax} className="num">{ax}</span>)}
        <span className="num">합계</span><span />
      </div>
      {rows.map((r, i) => {
        const win = r.key === verdict.adoptedKey;
        const lose = rows.length >= 2 && i === rows.length - 1 && !win;
        return (
          <div key={r.key} className={`score-grid-row ${win ? 'win' : ''} ${lose ? 'lose' : ''}`} style={{ gridTemplateColumns: cols }}>
            <span className="g-rank">{i + 1}</span>
            <span className="g-name">{r.name}</span>
            {axes.map((ax) => <span key={ax} className="num">{r.axisScores[ax]}</span>)}
            <span className="num g-total">{r.total}</span>
            <span className="g-mark">{win ? '🏆' : lose ? '🪟' : ''}</span>
          </div>
        );
      })}
      {rows.some((r) => r.comment) && (
        <div className="score-comments">
          {rows.map((r) => r.comment && (
            <div key={r.key} className="cm"><b>{r.name}</b> — {r.comment}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 보스 총평 ──
export function BossCommentCut({ persona, reason }) {
  return (
    <div className="cut verdict-cut">
      <div className="vc-title">보스 총평</div>
      <div className="vc-quote">
        “{reason}”
        <span className="vc-by">— {persona.name} · 채택 사유</span>
      </div>
    </div>
  );
}
