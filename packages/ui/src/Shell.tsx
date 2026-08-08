// 공통 셸 — 접힘 헤더. 게임 화면 좌상단에 narre 로고 칩만 상시 떠 있고, 탭하면
// [홈으로] + [내 정보 자리]가 펼쳐진다. 기획은 스펙 §6에서 디렉터가 확정했다.
//
// 게임 화면을 감싸지 않고 그 위에 떠 있는다. 게임마다 레이아웃이 달라서, 셸이 자리를
// 차지하면 게임이 그만큼을 비켜 그려야 한다. 칩만 띄우면 게임은 셸을 몰라도 된다.
//
// 트리거는 탭으로 통일한다. 호버는 모바일에 없다.
// 허브 장애가 게임을 막지 않도록 링크는 평범한 <a>다(로드맵의 강등 설계 원칙).
import { useState, type ReactNode } from 'react';

export interface ShellProps {
  children: ReactNode;
  /** 허브 주소. 기본값은 narre.io. */
  hubUrl?: string;
}

export function Shell({ children, hubUrl = 'https://narre.io' }: ShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="narre-shell">
      <nav className="narre-shell__chip" data-open={open || undefined}>
        <button
          type="button"
          className="narre-shell__logo"
          aria-expanded={open}
          aria-label="narre 메뉴"
          onClick={() => setOpen((v) => !v)}
        >
          narre
        </button>
        {open && (
          <div className="narre-shell__menu">
            <a className="narre-shell__link" href={hubUrl}>
              홈으로
            </a>
            {/* 내 정보 자리 — 계정 도입 전까지 비운다(스펙 §6). */}
          </div>
        )}
      </nav>
      {children}
    </div>
  );
}
