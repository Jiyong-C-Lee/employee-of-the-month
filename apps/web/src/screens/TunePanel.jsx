// 포즈 얼굴 위치 튜닝 화면 — URL에 ?tune=1 이 있을 때 App이 게임 진입 없이 단독으로 띄운다.
// 원을 드래그하거나 클릭 후 방향키(0.5%, Shift+방향키 0.1%)로 이동, [·] 또는 휠로 지름을 조절한다.
// 값은 즉시 localStorage(eotm.poseOverride·eotm.faceAlpha)에 저장돼 게임 화면에도 곧바로 반영된다.
// 튜닝이 끝나면 "POSES 코드 복사"로 나온 리터럴을 comic-assets.js의 POSES 기본값에 붙여넣고 커밋한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  POSES as DEFAULT_POSES, FACE_ALPHA as DEFAULT_ALPHA, poseUrl,
  getPoses, setPoseOverride, resetPoseOverride, getFaceAlpha, setFaceAlpha, resetFaceAlpha,
} from '../comic-assets.js';
import '../tune.css';

const STEP = 0.5;
const FINE_STEP = 0.1;
const D_STEP = 0.5;

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function round1(n) { return Math.round(n * 10) / 10; }

export default function TunePanel() {
  const [poses, setPoses] = useState(() => getPoses());
  const [alpha, setAlpha] = useState(() => getFaceAlpha());
  const [selected, setSelected] = useState(null); // 방향키·[·] 조작 대상 포즈 번호
  const [copied, setCopied] = useState(false);
  const dragRef = useRef(null); // { pose, boxEl } — pointer capture 중인 드래그 대상

  // patch는 { x?, y?, d? } 객체거나 (prevPose) => patch 형태의 함수(최신 상태 기반 갱신용).
  const updatePose = useCallback((n, patch) => {
    setPoses((prev) => {
      const p = prev[n];
      const nextPatch = typeof patch === 'function' ? patch(p) : patch;
      const next = { ...prev, [n]: { ...p, ...nextPatch } };
      setPoseOverride(next);
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (selected == null) return;
      const step = e.shiftKey ? FINE_STEP : STEP;
      if (e.key === 'ArrowUp') { e.preventDefault(); updatePose(selected, (p) => ({ y: round1(clamp(p.y - step, 0, 100)) })); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); updatePose(selected, (p) => ({ y: round1(clamp(p.y + step, 0, 100)) })); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); updatePose(selected, (p) => ({ x: round1(clamp(p.x - step, 0, 100)) })); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); updatePose(selected, (p) => ({ x: round1(clamp(p.x + step, 0, 100)) })); }
      else if (e.key === '[') { e.preventDefault(); updatePose(selected, (p) => ({ d: round1(clamp(p.d - D_STEP, 1, 100)) })); }
      else if (e.key === ']') { e.preventDefault(); updatePose(selected, (p) => ({ d: round1(clamp(p.d + D_STEP, 1, 100)) })); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, updatePose]);

  function startDrag(n, boxRef) {
    return (e) => {
      e.preventDefault();
      setSelected(n);
      dragRef.current = { pose: n, boxEl: boxRef.current };
      e.currentTarget.setPointerCapture(e.pointerId);
    };
  }

  function onDragMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const rect = d.boxEl.getBoundingClientRect();
    const x = round1(clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100));
    const y = round1(clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100));
    updatePose(d.pose, { x, y });
  }

  function endDrag() { dragRef.current = null; }

  function onWheelCircle(n) {
    return (e) => {
      setSelected(n);
      const dir = e.deltaY > 0 ? -1 : 1;
      updatePose(n, (p) => ({ d: round1(clamp(p.d + dir * D_STEP, 1, 100)) }));
    };
  }

  function copyCode() {
    const lines = Object.keys(DEFAULT_POSES).map((k) => {
      const p = poses[k];
      return `  ${k}: { x: ${p.x}, y: ${p.y}, d: ${p.d} },`;
    });
    const code = `export const POSES = {\n${lines.join('\n')}\n};`;
    if (!navigator.clipboard) { setCopied(false); return; }
    navigator.clipboard.writeText(code).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => setCopied(false),
    );
  }

  function resetAll() {
    resetPoseOverride();
    resetFaceAlpha();
    setPoses(DEFAULT_POSES);
    setAlpha(DEFAULT_ALPHA);
    setSelected(null);
  }

  function onAlphaChange(e) {
    const v = Number(e.target.value);
    setAlpha(v);
    setFaceAlpha(v);
  }

  return (
    <div className="tune-panel" onPointerMove={onDragMove} onPointerUp={endDrag}>
      <header className="tune-head">
        <h1>포즈 얼굴 위치 튜닝</h1>
        <p>원을 드래그하거나 클릭 후 방향키(0.5%, Shift+방향키 0.1%)로 이동 · [ ] 또는 휠로 지름 조절</p>
        <div className="tune-controls">
          <label className="tune-alpha">
            프로필 투명도 {alpha.toFixed(2)}
            <input type="range" min="0" max="1" step="0.01" value={alpha} onChange={onAlphaChange} />
          </label>
          <button className="btn" onClick={copyCode}>{copied ? '복사됨!' : 'POSES 코드 복사'}</button>
          <button className="btn" onClick={resetAll}>기본값으로 리셋</button>
        </div>
      </header>

      <div className="tune-grid">
        {Object.keys(DEFAULT_POSES).map((k) => (
          <PosePanel
            key={k}
            n={Number(k)}
            pose={poses[k]}
            selected={selected === Number(k)}
            onSelect={() => setSelected(Number(k))}
            onDragStart={startDrag}
            onWheelCircle={onWheelCircle}
          />
        ))}
      </div>
    </div>
  );
}

function PosePanel({ n, pose, selected, onSelect, onDragStart, onWheelCircle }) {
  const boxRef = useRef(null);
  return (
    <div className="tune-pose">
      <div className="tune-box" ref={boxRef}>
        <img src={poseUrl(n)} alt="" draggable={false} />
        <div
          className={`tune-circle ${selected ? 'sel' : ''}`}
          style={{ left: `${pose.x}%`, top: `${pose.y}%`, width: `${pose.d}%` }}
          onPointerDown={onDragStart(n, boxRef)}
          onClick={onSelect}
          onWheel={onWheelCircle(n)}
        >
          <span className="tune-cross-v" /><span className="tune-cross-h" />
        </div>
      </div>
      <div className="tune-readout">#{n} x:{pose.x} y:{pose.y} d:{pose.d}</div>
    </div>
  );
}
