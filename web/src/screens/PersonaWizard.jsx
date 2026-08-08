import { useState } from 'react';

const STORE_KEY = 'eotm.customPersonas';
const MAX_SAVED = 8;

export function loadCustomPersonas() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
export function saveCustomPersona(p) {
  const list = [p, ...loadCustomPersonas().filter((x) => x.id !== p.id)].slice(0, MAX_SAVED);
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
  return list;
}
export function deleteCustomPersona(id) {
  const list = loadCustomPersonas().filter((x) => x.id !== id);
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
  return list;
}

// 커스텀 페르소나 생성 위저드: 입력 → AI 생성 → 미리보기·수정 → 저장.
export default function PersonaWizard({ onSaved, onCancel, toast }) {
  const [step, setStep] = useState('input');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', concept: '', voiceHint: '', taboo: '', axes: '' });
  const [persona, setPersona] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function generate() {
    if (!form.name.trim()) return toast('보스 이름을 입력하세요.');
    if (form.concept.trim().length < 2) return toast('컨셉을 입력하세요.');
    setBusy(true);
    const axes = form.axes.split(',').map((s) => s.trim()).filter(Boolean);
    const body = {
      name: form.name.trim(), concept: form.concept.trim(),
      ...(form.voiceHint.trim() && { voiceHint: form.voiceHint.trim() }),
      ...(form.taboo.trim() && { taboo: form.taboo.trim() }),
      ...(axes.length > 0 && { axes }),
    };
    const res = await fetch('/api/personas/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => ({ error: '서버에 연결할 수 없습니다.' }));
    setBusy(false);
    if (res.error) return toast(res.error);
    setPersona(res.persona);
    setStep('preview');
  }

  function save() {
    saveCustomPersona(persona);
    onSaved(persona);
  }

  if (step === 'input') {
    return (
      <div className="stack wizard">
        <h2>🛠 나만의 보스 만들기</h2>
        <label className="field"><span>보스 이름 *</span>
          <input value={form.name} onChange={set('name')} maxLength={20} placeholder="예: 용왕" /></label>
        <label className="field"><span>컨셉 *</span>
          <textarea value={form.concept} onChange={set('concept')} maxLength={300} rows={3}
            placeholder="예: 바닷속 용궁물산 그룹의 회장. 용궁의 위엄이 최우선이지만 육지 문물에 호기심이 많고, 사실 헤엄이 서툴다는 것을 숨기고 있다." /></label>
        <label className="field"><span>말투 힌트 (비우면 AI가 정함)</span>
          <input value={form.voiceHint} onChange={set('voiceHint')} maxLength={200} placeholder="예: 근엄한 하오체, 흥분하면 말끝에 물거품 소리" /></label>
        <label className="field"><span>역린 (비우면 AI가 정함)</span>
          <input value={form.taboo} onChange={set('taboo')} maxLength={200} placeholder="예: 이무기 시절 이야기" /></label>
        <label className="field"><span>채점축 (쉼표 구분, 비우면 AI가 정함)</span>
          <input value={form.axes} onChange={set('axes')} placeholder="예: 위엄, 실리, 용궁부심" /></label>
        <div className="row">
          <button className="btn" onClick={onCancel}>뒤로</button>
          <button className="btn primary" disabled={busy} onClick={generate}>{busy ? 'AI 생성 중… (최대 1분)' : '✨ AI로 생성'}</button>
        </div>
      </div>
    );
  }

  const setP = (k) => (e) => setPersona({ ...persona, [k]: e.target.value });
  return (
    <div className="stack wizard">
      <h2>{persona.emoji} 생성 결과 확인</h2>
      <label className="field"><span>이름</span><input value={persona.name} onChange={setP('name')} maxLength={20} /></label>
      <label className="field"><span>이모지</span><input value={persona.emoji} onChange={setP('emoji')} maxLength={4} /></label>
      <label className="field"><span>소개</span><textarea value={persona.intro} onChange={setP('intro')} rows={2} /></label>
      <label className="field"><span>채점축 (쉼표 구분 3개)</span>
        <input value={persona.axes.join(', ')} onChange={(e) => setPersona({ ...persona, axes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
      <div className="wizard-detail">
        <div className="wd-sec"><b>승진 사다리</b><p>{persona.ranks.join(' → ')}</p></div>
        <div className="wd-sec"><b>참모진</b>
          {persona.advisors.map((a) => <p key={a.name}>{a.emoji} {a.name} ({a.style}) — {a.core}</p>)}</div>
        <div className="wd-sec"><b>상황 샘플</b><p>{persona.situations[0]?.text}</p></div>
      </div>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => setStep('input')}>← 다시 입력</button>
        <button className="btn" disabled={busy} onClick={generate}>{busy ? '생성 중…' : '🔄 다시 생성'}</button>
        <button className="btn primary" onClick={save}>저장하고 사용</button>
      </div>
    </div>
  );
}
