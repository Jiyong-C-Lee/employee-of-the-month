import { useState } from 'react';
import { UI } from '@content/ui';

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
  const T = UI.wizard;

  async function generate() {
    if (!form.name.trim()) return toast(T.needName);
    if (form.concept.trim().length < 2) return toast(T.needConcept);
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
    }).then((r) => r.json()).catch(() => ({ error: UI.errors.connectFail }));
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
        <h2>{T.title}</h2>
        <label className="field"><span>{T.nameLabel}</span>
          <input value={form.name} onChange={set('name')} maxLength={20} placeholder={T.namePlaceholder} /></label>
        <label className="field"><span>{T.conceptLabel}</span>
          <textarea value={form.concept} onChange={set('concept')} maxLength={300} rows={3}
            placeholder={T.conceptPlaceholder} /></label>
        <label className="field"><span>{T.voiceLabel}</span>
          <input value={form.voiceHint} onChange={set('voiceHint')} maxLength={200} placeholder={T.voicePlaceholder} /></label>
        <label className="field"><span>{T.tabooLabel}</span>
          <input value={form.taboo} onChange={set('taboo')} maxLength={200} placeholder={T.tabooPlaceholder} /></label>
        <label className="field"><span>{T.axesLabel}</span>
          <input value={form.axes} onChange={set('axes')} placeholder={T.axesPlaceholder} /></label>
        <div className="row">
          <button className="btn" onClick={onCancel}>{T.back}</button>
          <button className="btn primary" disabled={busy} onClick={generate}>{busy ? T.generating : T.generate}</button>
        </div>
      </div>
    );
  }

  const setP = (k) => (e) => setPersona({ ...persona, [k]: e.target.value });
  return (
    <div className="stack wizard">
      <h2>{persona.emoji} {T.previewTitle}</h2>
      <label className="field"><span>{T.fieldName}</span><input value={persona.name} onChange={setP('name')} maxLength={20} /></label>
      <label className="field"><span>{T.fieldEmoji}</span><input value={persona.emoji} onChange={setP('emoji')} maxLength={4} /></label>
      <label className="field"><span>{T.fieldIntro}</span><textarea value={persona.intro} onChange={setP('intro')} rows={2} /></label>
      <label className="field"><span>{T.fieldAxes}</span>
        <input value={persona.axes.join(', ')} onChange={(e) => setPersona({ ...persona, axes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
      <div className="wizard-detail">
        <div className="wd-sec"><b>{T.ladder}</b><p>{persona.ranks.join(' → ')}</p></div>
        <div className="wd-sec"><b>{T.advisors}</b>
          {persona.advisors.map((a) => <p key={a.name}>{a.emoji} {a.name} ({a.style}) — {a.core}</p>)}</div>
        <div className="wd-sec"><b>{T.sample}</b><p>{persona.situations[0]?.text}</p></div>
      </div>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => setStep('input')}>{T.reinput}</button>
        <button className="btn" disabled={busy} onClick={generate}>{busy ? T.regenerating : T.regenerate}</button>
        <button className="btn primary" onClick={save}>{T.save}</button>
      </div>
    </div>
  );
}
