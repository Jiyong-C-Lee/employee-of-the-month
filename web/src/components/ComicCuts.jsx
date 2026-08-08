// 회의실 코믹 컷 모음 — 디자인 프로젝트 '코믹 UI 목업.dc.html' 확정안 + 1차 플레이테스트 피드백 반영.
// 모든 컷은 상태(room.round.queue/speeches, phase, verdict)로만 그린다. 피드는 자막·에필로그에만 쓴다.
import { useEffect, useState } from 'react';
import { UI, fmt } from '@content/ui';
import {
  BOSS_FRONT, BOSS_GAZE, USER_POSE, SEAT_POSES, poseUrl, hashColor,
  getPoses, getFaceAlpha, hexToRgba, isImageAvatar, isEmojiAvatar, avatarEmoji,
} from '../comic-assets.js';

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

export const PHASE_LABEL = UI.game.phase;

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

// 포즈 배정: 큐 순서가 아니라 캐릭터 고정 — 참모는 명단 순, 유저는 입장순으로 결정적 배정.
// 뷰어와 무관하게 배정한다 → 같은 유저는 모든 클라이언트에서·라운드가 바뀌어도 같은 몸. (뷰어 본인 강조는
// FaceSlot의 mine으로만 처리한다.) 이전엔 뷰어 본인만 USER_POSE로 빼면서 seat 인덱스가 어긋나
// 같은 유저가 클라이언트마다 다른 포즈로 보였다.
// queue(선택): 이번 라운드 발언 큐. 참모 풀(최대 8명)이 포즈 수(5)보다 커서, 라운드 출전 참모끼리
// 선호 포즈(명단 인덱스 기준)가 겹칠 수 있다 → 출전 참모 안에서만 빈 포즈로 밀어내 충돌을 푼다.
// 큐는 서버 상태라 모든 클라이언트가 동일 → 배정도 뷰어와 무관하게 동일하다.
export function buildPoseMap({ persona, players, queue }) {
  const map = {};
  const inRound = new Set((queue || []).filter((e) => e.kind === 'ai').map((e) => e.name));
  const active = inRound.size > 0 ? persona.advisors.filter((a) => inRound.has(a.name)) : persona.advisors;
  const taken = new Set();
  active.forEach((a) => {
    const idx = persona.advisors.findIndex((x) => x.name === a.name);
    const prefer = idx % SEAT_POSES.length;
    let k = prefer;
    while (taken.has(SEAT_POSES[k % SEAT_POSES.length]) && k < prefer + SEAT_POSES.length) k += 1;
    const pose = SEAT_POSES[k % SEAT_POSES.length];
    taken.add(pose);
    map[`ai:${a.name}`] = pose;
  });
  const seats = [USER_POSE, ...SEAT_POSES]; // 사람 자리 풀 (지정석 포함)
  [...(players || [])]
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .forEach((p, i) => { map[p.id] = seats[i % seats.length]; });
  return map;
}

// 얼굴 슬롯 — 포즈 이미지 위에 아바타/이니셜/이모지를 반투명(FACE_ALPHA)으로 합성한다.
// avatar가 있으면 원형 이미지, 없으면 기존 색원+이니셜(유저) / 이모지(AI)로 폴백한다.
function FaceSlot({ pose, entry, avatar }) {
  const p = getPoses()[pose];
  const alpha = getFaceAlpha();
  const style = { left: `${p.x}%`, top: `${p.y}%`, width: `${p.d}%` };
  if (entry.kind === 'ai') {
    return (
      <div className="face-slot ai" style={{ ...style, background: `rgba(255, 255, 255, ${alpha})` }}>
        <span>{entry.emoji || '🤖'}</span>
      </div>
    );
  }
  if (isImageAvatar(avatar)) {
    return (
      <div className="face-slot user avatar" style={style}>
        <img src={avatar} alt="" style={{ opacity: alpha }} />
      </div>
    );
  }
  if (isEmojiAvatar(avatar)) {
    return (
      <div className="face-slot user emoji" style={{ ...style, background: `rgba(255, 255, 255, ${alpha})` }}>
        <span>{avatarEmoji(avatar)}</span>
      </div>
    );
  }
  // 색은 이름 해시로만 정한다 — 뷰어별 강조색을 섞으면 같은 유저가 클라이언트마다 다른 색으로 보인다.
  // (본인 표시는 이름표의 ★가 담당)
  return (
    <div className="face-slot user" style={{ ...style, background: hexToRgba(hashColor(entry.name), alpha) }}>
      <span>{entry.name.slice(0, 1)}</span>
    </div>
  );
}

// 유저 id → avatar dataURL. players에 avatar가 없으면 키가 아예 없다(FaceSlot은 undefined면 기본 색원 폴백).
function avatarByKeyFromPlayers(players) {
  const map = {};
  (players || []).forEach((p) => { if (p.avatar) map[p.id] = p.avatar; });
  return map;
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
      <span className="bc-state">R.{roundNo} {PHASE_LABEL[phase] || PHASE_LABEL.fallback}</span>
    </div>
  );
}

// ── ① 문제 상황 ──
export function SituationCut({ persona, situation }) {
  return (
    <div className="cut situation-cut">
      <div className="sc-boss">
        <img src={poseUrl(BOSS_FRONT)} alt="" />
        <FaceSlot pose={BOSS_FRONT} entry={{ kind: 'ai', emoji: persona.emoji }} />
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

// 도장 등장 순서 — 반려가 큐 순서대로 하나씩 찍히고, 채택이 마지막에 내려온다(5a).
// 초 단위 상수는 comic.css의 stampIn 길이와 짝이다.
// 처음엔 절반 속도였는데 반려가 후두둑 지나가서 누가 왜 잘렸는지 읽을 틈이 없었다.
// 도장 하나하나를 읽을 수 있는 간격으로 늘린다.
const STAMP_STEP = 0.7;
const STAMP_LEAD = 0.4;

// 채택 도장은 반려가 다 찍힌 뒤에 내려온다. 그만큼 뒤로 미는 간격.
const STAMP_ADOPT_GAP = 0.6;
const STAMP_DURATION = 0.9; // comic.css stampIn과 같은 값
// stampIn이 60% 지점에서 축소를 멈추고 도장이 종이에 닿는다. 화면은 그때 흔들려야 한다.
const STAMP_IMPACT = STAMP_DURATION * 0.6;

function stampDelays(queue, adoptedKey) {
  const delays = {};
  let n = 0;
  queue.forEach((e) => {
    if (e.key === adoptedKey) return;
    delays[e.key] = STAMP_LEAD + n * STAMP_STEP;
    n += 1;
  });
  if (adoptedKey) delays[adoptedKey] = STAMP_LEAD + n * STAMP_STEP + STAMP_ADOPT_GAP;
  return delays;
}

// 마지막 도장이 다 찍히는 시각(ms). 결과 컷을 언제 풀지 Game이 이 값으로 정한다.
export function stampSequenceMs(queue, adoptedKey) {
  const delays = stampDelays(queue, adoptedKey);
  const last = Math.max(0, ...Object.values(delays));
  return Math.round((last + STAMP_DURATION) * 1000);
}

// ── ② 발언 컷 그리드 ──
// verdict가 오면 컷 위에 반려·채택 도장을 얹는다(5a). 판정 전에는 undefined로 들어와 도장이 없다.
export function SpeakGrid({ queue, speeches, speakTurn, playerId, timer, players, poseMap, persona, verdict }) {
  const speechByKey = Object.fromEntries(speeches.map((s) => [s.key, s]));
  const rankByKey = Object.fromEntries((players || []).map((p) => [p.id, p.rank]));
  const avatarByKey = avatarByKeyFromPlayers(players);
  // 참모 얼굴 이모지 — 큐 엔트리에는 emoji가 없어서 persona.advisors에서 이름으로 찾는다(없으면 FaceSlot이 🤖 폴백).
  const emojiByName = Object.fromEntries((persona?.advisors || []).map((a) => [a.name, a.emoji]));
  const showTimer = timer && timer.phase === 'PLAYER_TURNS' && timer.total > 0;
  const adoptedKey = verdict?.adoptedKey ?? null;
  const delays = verdict ? stampDelays(queue, adoptedKey) : null;
  // 흔들림은 채택 도장이 닿는 순간에 맞춘다. CSS에 초를 박아두면 발언자 수가 바뀌는 순간
  // 어긋난다 — 실제로 흔들린 뒤에 도장이 내려오고 있었다. 계산값을 그대로 넘긴다.
  const shakeDelay = delays && adoptedKey ? (delays[adoptedKey] + STAMP_IMPACT).toFixed(2) : null;

  return (
    <div
      className={`speak-grid ${shakeDelay != null ? 'judged' : ''}`}
      style={shakeDelay != null ? { '--shake-delay': `${shakeDelay}s` } : undefined}
    >
      {queue.map((entry, i) => {
        const spoken = speechByKey[entry.key];
        const speaking = speakTurn?.current === entry.key && !spoken;
        const waiting = !spoken && !speaking;
        const mine = entry.kind === 'user' && entry.key === playerId;
        const span2 = queue.length % 2 === 1 && i === queue.length - 1;
        const adopted = verdict && entry.key === adoptedKey;
        const rejected = verdict && !adopted;
        const cls = [
          'cut', 'speak-panel',
          speaking ? 'speaking' : '', waiting ? 'waiting' : '', span2 ? 'span2' : '',
          adopted ? 'adopted' : '', rejected ? 'rejected' : '',
        ].join(' ');
        // 직급은 큐에 박힌 그 라운드 값을 먼저 본다. players의 현재 직급을 읽으면 승진하는
        // 순간 지난 컷 이름표까지 새 직급으로 바뀐다. rank가 없는 옛 방·공유 스냅샷만 폴백.
        const rank = entry.rank ?? rankByKey[entry.key];
        const label = `${i + 1}  ${entry.name}${entry.kind === 'user' ? ` ${rank || ''}` : ''}${mine ? ' ★' : ''}`;
        const stampDelay = delays ? `${delays[entry.key] ?? 0}s` : undefined;
        return (
          <div key={entry.key} className={cls} style={verdict ? { '--stamp-delay': stampDelay } : undefined}>
            {speaking && (
              <span className="speak-badge">
                {UI.game.speaking}{showTimer ? ` ${fmtSec(timer.remaining)}` : ''}
              </span>
            )}
            <div className={`sp-bubble-wrap ${waiting ? 'faint' : ''}`}>
              <div className="sp-bubble">{spoken ? <TypeText text={spoken.text} /> : speaking ? UI.game.speakingPlaceholder : UI.game.speakPending}</div>
              <div className="tail-b-ink" />
              <div className="tail-b-fill" />
            </div>
            <div className="sp-figure">
              <img src={poseUrl(poseMap[entry.key])} alt="" />
              <FaceSlot
                pose={poseMap[entry.key]}
                entry={entry.kind === 'ai' ? { ...entry, emoji: entry.emoji ?? emojiByName[entry.name] } : entry}
                avatar={avatarByKey[entry.key]}
              />
            </div>
            {verdict && (
              <span className={`sp-stamp ${adopted ? 'adopt' : 'reject'}`}>
                {adopted ? UI.game.stamp.adopt : UI.game.stamp.reject}
              </span>
            )}
            {/* 이름표는 컷(패널) 기준 우하단 고정 — span2에서 캐릭터가 가운데 정렬돼도 모든 컷과 같은 구석 위치를 유지한다. */}
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
      <div className="gs-figure">
        <img src={poseUrl(BOSS_GAZE)} alt="" />
        <FaceSlot pose={BOSS_GAZE} entry={{ kind: 'ai', emoji: persona.emoji }} />
      </div>
      <span className="gs-rage">💢</span>
      <span className="gs-rage r2">💢</span>
      <div className="gs-status">{done ? UI.game.gauge.done : UI.game.gauge.judging}</div>
    </div>
  );
}

// 금테 액자 프레임 — 라운드 수상(이달의 우수사원)과 세션 MVP(올해의 사원)가 같은 비주얼을 공유한다.
export function AwardFrame({ title, entry, pose = USER_POSE, avatar, plate }) {
  return (
    <div className="award">
      <div className="aw-ribbon">{title}</div>
      <div className="aw-frame">
        <div className="aw-frame-in">
          <div className="aw-mat">
            <div className="aw-photo">
              {/* 얼굴 원이 잘 보이게 아래쪽을 크롭 — 슬롯 %좌표 기준(이미지 박스)은 inner가 유지 */}
              <div className="aw-photo-inner">
                <img src={poseUrl(pose)} alt="" />
                <FaceSlot pose={pose} entry={entry} avatar={avatar} />
              </div>
            </div>
          </div>
        </div>
        <div className="aw-plate">
          <span>{plate}</span>
        </div>
        <span className="aw-screw tl" /><span className="aw-screw tr" />
        <span className="aw-screw bl" /><span className="aw-screw br" />
      </div>
    </div>
  );
}

// ── ④-a 수상 컷 (이달의 우수사원 액자) ──
export function AwardCut({ adopted, poseMap, players }) {
  const avatarByKey = avatarByKeyFromPlayers(players);
  return (
    <div className="cut award-cut">
      {adopted ? (
        <AwardFrame
          title={UI.game.awardTitle}
          pose={poseMap[adopted.key] ?? USER_POSE}
          entry={adopted.kind === 'ai' ? { kind: 'ai', emoji: adopted.emoji } : { kind: 'user', name: adopted.name }}
          avatar={adopted.kind === 'user' ? avatarByKey[adopted.key] : undefined}
          plate={adopted.kind === 'ai' ? adopted.name : fmt(UI.game.adoptedPlate, { name: adopted.name, rank: adopted.rank })}
        />
      ) : (
        <div className="no-adopt-stamp">{UI.game.noAdopt}</div>
      )}
    </div>
  );
}

// ── ④-b 창밖 투척 컷 (최하위) ──
export function WindowCut({ last, pose, persona, players }) {
  // 날아가는 몸체에도 발언 컷과 같은 얼굴 합성 — 누가 던져졌는지 보이게 한다.
  const kind = String(last.key || '').startsWith('ai:') ? 'ai' : 'user';
  const emoji = kind === 'ai' ? persona?.advisors?.find((a) => a.name === last.name)?.emoji : undefined;
  const avatar = kind === 'user' ? avatarByKeyFromPlayers(players)[last.key] : undefined;
  const flyPose = pose ?? SEAT_POSES[0];
  return (
    <div className="cut window-cut">
      <div className="wh-speed" />
      <div className="wh-window">
        <div className="w-glass" /><div className="w-mull-v" /><div className="w-mull-h" />
        <div className="w-sash-l" /><div className="w-sash-r" />
      </div>
      <div className="wh-flyer">
        <img src={poseUrl(flyPose)} alt="" />
        <FaceSlot pose={flyPose} entry={{ kind, name: last.name, emoji }} avatar={avatar} />
      </div>
      <div className="wh-caption">{fmt(UI.game.windowCaption, { name: last.name, josa: josa(last.name, '은', '는') })}</div>
    </div>
  );
}

// ── 채점 결과 표 ──
export function ScoreCut({ verdict, rows, axes }) {
  const cols = `.5fr 1.5fr ${axes.map(() => '.55fr').join(' ')} .6fr .4fr`;
  return (
    <div className="cut score-cut">
      <div className="sc-title">{UI.game.scoreTitle}</div>
      <div className="score-grid-head" style={{ gridTemplateColumns: cols }}>
        <span>{UI.game.scoreHead.rank}</span><span>{UI.game.scoreHead.name}</span>
        {axes.map((ax) => <span key={ax} className="num">{ax}</span>)}
        <span className="num">{UI.game.scoreHead.total}</span><span />
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
            <span className="g-mark">{win ? UI.game.scoreAdopted : lose ? UI.game.scoreOut : ''}</span>
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
      <div className="vc-title">{UI.game.verdictTitle}</div>
      <div className="vc-quote">
        “{reason}”
        <span className="vc-by">{fmt(UI.game.verdictBy, { name: persona.name })}</span>
      </div>
    </div>
  );
}
