// 게임/로비 상단 우측 메뉴 — 방 코드 복사 + 메인으로 나가기. Game.jsx·Lobby.jsx 공용.
import { useEffect, useRef, useState } from 'react';

export default function MenuPanel({ code, onLeave }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // 패널 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function copyCode() {
    // 복사 실패(권한 없음 등)는 조용히 무시 — 초대용 편의 기능일 뿐이라 에러 UI가 필요 없다.
    navigator.clipboard?.writeText(code).catch(() => {});
  }

  function leave() {
    if (!window.confirm('메인 화면으로 나가시겠습니까? 진행 중인 게임에서 나갑니다.')) return;
    setOpen(false);
    onLeave();
  }

  return (
    <div className="menu-fab" ref={boxRef}>
      <button type="button" className="menu-btn" aria-label="메뉴" onClick={() => setOpen((v) => !v)}>☰</button>
      {open && (
        <div className="menu-panel">
          <div className="menu-code-row">
            <span className="menu-code-label">방 코드</span>
            <span className="menu-code-value">{code}</span>
            <button type="button" className="btn small" onClick={copyCode}>복사</button>
          </div>
          <button type="button" className="btn small menu-leave" onClick={leave}>메인으로 나가기</button>
        </div>
      )}
    </div>
  );
}
