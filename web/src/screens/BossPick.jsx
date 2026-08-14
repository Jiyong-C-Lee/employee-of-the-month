// 보스 선택 — 디자인 프로젝트 '스타일 탐색' 3c 확정안.
// 일러스트 없이 색·문장(紋章)·채점축으로 보스를 구분하는 가로 카드. 회의 설정은 접지 않고
// 카드 아래칸에 그대로 편다 — 시작 전에 뭘 고르는지 한 화면에서 다 보이게 한다.
import { useEffect, useRef, useState } from 'react';
import { UI, fmt } from '@content/ui';
import { hashColor } from '../comic-assets.js';
import PersonaWizard, { loadCustomPersonas, deleteCustomPersona } from './PersonaWizard.jsx';
import { AvatarCircle } from './Home.jsx';
import '../paper.css';

const DIFFICULTIES = ['easy', 'normal', 'hard'];
const ROUND_CHOICES = [5, 10, 15];
const SPEAK_TIMES = [60, 120, 180];
const PLAYER_COUNTS = [2, 3, 4, 5, 6];

export default function BossPick({ mode, nick, avatar, actions, onBack }) {
  const isMulti = mode === 'multi';
  const [personas, setPersonas] = useState([]);
  const [customs, setCustoms] = useState(loadCustomPersonas);
  const [personaId, setPersonaId] = useState(null);
  const [wizard, setWizard] = useState(false);
  const [busy, setBusy] = useState(false);
  const railRef = useRef(null);

  const [difficulty, setDifficulty] = useState('normal');
  const [maxRounds, setMaxRounds] = useState(5);
  const [scenarioId, setScenarioId] = useState(''); // '' = 자유 모드
  const [speakTime, setSpeakTime] = useState(60);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [aiCompete, setAiCompete] = useState(false);

  useEffect(() => {
    fetch('/api/personas')
      .then((r) => r.json())
      .then((list) => {
        setPersonas(list);
        setPersonaId((cur) => cur ?? loadCustomPersonas()[0]?.id ?? list[0]?.id ?? null);
      })
      .catch(() => actions.toast(UI.errors.personaListFail));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 커스텀이 앞, 기본 팩이 뒤. 캐러셀 순서와 점 인디케이터가 같은 배열을 본다.
  const all = [...customs, ...personas];
  const selectedIndex = all.findIndex((p) => p.id === personaId);
  const selected = all[selectedIndex] ?? null;

  // 카드를 고르면 캐러셀이 그 카드로 스크롤한다 — 반쯤 걸친 카드를 눌렀을 때 중앙으로 온다.
  function pick(p, i) {
    setPersonaId(p.id);
    setScenarioId(''); // 아크는 보스별 — 보스를 바꾸면 자유 모드로 리셋
    const el = railRef.current?.children?.[i];
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  // 스와이프로 넘긴 카드가 곧 선택이다 — 모바일에서 넘긴 뒤 다시 눌러야 했던 걸 없앤다.
  // 스크롤이 멎은 뒤 레일 중앙에 가장 가까운 카드를 고른다. scrollend는 지원이 갈려서 디바운스로 잡는다.
  const settleRef = useRef(null);
  function onRailScroll() {
    const rail = railRef.current;
    if (!rail) return;
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      const mid = rail.scrollLeft + rail.clientWidth / 2;
      let best = null;
      let bestGap = Infinity;
      [...rail.children].forEach((el, i) => {
        const gap = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
        if (gap < bestGap) { bestGap = gap; best = i; }
      });
      const p = all[best];
      // setPersonaId만 부른다 — pick을 쓰면 scrollIntoView가 다시 스크롤을 일으켜 서로 문다.
      if (p && p.id !== personaId) { setPersonaId(p.id); setScenarioId(''); }
    }, 120);
  }

  useEffect(() => () => clearTimeout(settleRef.current), []);

  async function start() {
    if (!nick.trim()) return actions.toast(UI.errors.needNick);
    if (!personaId) return actions.toast(UI.errors.needPersona);
    setBusy(true);
    const config = isMulti
      ? { mode: 'multi', personaId, speakTime, maxPlayers, aiCompete, difficulty, maxRounds }
      : { mode: 'single', personaId, difficulty, maxRounds }; // 싱글은 제한시간 없음
    if (scenarioId) config.scenarioId = scenarioId; // 시나리오 방은 라운드 수를 아크 길이가 정한다
    // 커스텀 페르소나 선택 시 팩 전체를 동봉 — 서버가 재검증 후 방에 영속한다.
    const custom = customs.find((p) => p.id === personaId);
    if (custom) config.customPersona = custom;
    const res = await actions.createRoom(nick, config, avatar || undefined);
    setBusy(false);
    if (res.error) actions.toast(res.error);
  }

  if (wizard) {
    return (
      <div className="paper">
        <div className="paper-card">
          <div className="ph-body">
            <PersonaWizard
              toast={actions.toast}
              onCancel={() => setWizard(false)}
              onSaved={(p) => {
                setCustoms(loadCustomPersonas());
                setPersonaId(p.id);
                setWizard(false);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  const T = UI.bossPick;

  return (
    <div className="paper">
      <div className="paper-card pb-card">
        <div className="pb-head">
          <button type="button" className="pb-back" onClick={onBack} aria-label={UI.home.back}>◀</button>
          <span className="pb-title">{T.title}</span>
          <span className="pb-me">
            <AvatarCircle avatar={avatar} nick={nick} className="pb-me-face" />
            <b>{nick.trim() || UI.home.nickEmpty}</b>
          </span>
        </div>

        {all.length === 0 ? (
          <div className="pb-loading">{T.loading}</div>
        ) : (
          <>
            <div className="pb-rail" ref={railRef} onScroll={onRailScroll} role="radiogroup" aria-label={T.title}>
              {all.map((p, i) => {
                const isCustom = i < customs.length;
                const sel = p.id === personaId;
                // 카드 안에 삭제 버튼이 들어가야 해서 <button>을 못 쓴다(중첩 금지).
                // div + role=button으로 키보드 조작까지 직접 맡는다.
                return (
                  <div
                    key={p.id}
                    className={`pb-boss ${sel ? 'sel' : ''}`}
                    role="radio"
                    aria-checked={sel}
                    aria-label={p.name}
                    tabIndex={0}
                    onClick={() => pick(p, i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p, i); }
                    }}
                  >
                    <div className="pb-crest" style={{ background: hashColor(p.id) }}>
                      <i className="stripes" />
                      <span>{p.emoji}</span>
                      {isCustom && (
                        <button
                          type="button"
                          className="pb-del"
                          aria-label={fmt(T.customDelete, { name: p.name })}
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = deleteCustomPersona(p.id);
                            setCustoms(next);
                            if (personaId === p.id) setPersonaId(next[0]?.id ?? personas[0]?.id ?? null);
                          }}
                        >✕</button>
                      )}
                    </div>
                    <div className="pb-boss-body">
                      <div className="pb-name">
                        {p.name}
                        {isCustom && <em className="pb-custom-badge">{T.customBadge}</em>}
                      </div>
                      <p className="pb-intro">{p.intro}</p>
                      <div className="pb-axes-label">{T.axesLabel}</div>
                      <div className="pb-axes">
                        {p.axes.map((ax) => <span key={ax}>{ax}</span>)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pb-dots">
              {all.map((p, i) => <i key={p.id} className={i === selectedIndex ? 'on' : ''} />)}
            </div>

            <div className="pb-custom-link">
              <button type="button" onClick={() => setWizard(true)}>{T.customCreate}</button>
            </div>

            <div className="pb-settings">
              <div className="pb-settings-title">{T.settingsTitle}</div>

              {/* 넓은 화면에서 이 묶음만 2단으로 접힌다(paper.css). 시작 버튼은 밖에 둬서 항상 한 줄. */}
              <div className="pb-settings-fields">
              <label className="pb-field">
                <span>{T.difficulty.label}</span>
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{T.difficulty[d]}</option>)}
                </select>
              </label>

              {(selected?.scenarios?.length ?? 0) > 0 && (
                <label className="pb-field">
                  <span>{T.scenario.label} <em>{T.scenario.note}</em></span>
                  <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                    <option value="">{T.scenario.free}</option>
                    {selected.scenarios.map((sc) => (
                      <option key={sc.id} value={sc.id}>{fmt(T.scenario.arc, { name: sc.name, n: sc.beatCount })}</option>
                    ))}
                  </select>
                </label>
              )}

              {/* 시나리오 방은 라운드 수를 아크 길이가 정한다 — 선택지를 감춘다 */}
              {!scenarioId && (
                <label className="pb-field">
                  <span>{T.rounds.label} <em>{T.rounds.note}</em></span>
                  <select value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))}>
                    {ROUND_CHOICES.map((r) => <option key={r} value={r}>{T.rounds[`r${r}`]}</option>)}
                  </select>
                </label>
              )}

              {isMulti && (
                <>
                  <label className="pb-field">
                    <span>{T.speakTime.label}</span>
                    <select value={speakTime} onChange={(e) => setSpeakTime(Number(e.target.value))}>
                      {SPEAK_TIMES.map((t) => <option key={t} value={t}>{T.speakTime[`t${t}`]}</option>)}
                    </select>
                  </label>

                  <label className="pb-field">
                    <span>{T.maxPlayers.label} <em>{T.maxPlayers.note}</em></span>
                    <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
                      {PLAYER_COUNTS.map((n) => <option key={n} value={n}>{fmt(T.maxPlayers.unit, { n })}</option>)}
                    </select>
                  </label>

                  <label className="pb-check">
                    <span>{T.aiCompete.label}</span>
                    <input type="checkbox" checked={aiCompete} onChange={(e) => setAiCompete(e.target.checked)} />
                  </label>
                </>
              )}
              </div>

              <button type="button" className="pb-start" disabled={busy || !selected} onClick={start}>
                {fmt(isMulti ? T.startMulti : T.startSingle, { name: selected?.name ?? '' })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
