// 라운드/세션 공유 링크 생성 + OG 카드 업로드 + 공유 시트/클립보드.
// 서버가 KV에 30일 보관하고 /s/:id 읽기 전용 뷰 URL을 돌려준다.

// OG 카드(1200×630 PNG)를 canvas로 그린다 — 페이지에 로드된 나눔 폰트를 그대로 쓴다.
// 실패해도 공유는 계속돼야 하므로 null 반환 (서버가 기본 og.png로 폴백).
async function renderOgCard(payload) {
  try {
    await document.fonts.ready;
    const W = 1200;
    const H = 630;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;

    // 정적 og.png와 같은 톤: 남색 배경 + 골드 테두리
    ctx.fillStyle = '#1d2733';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#f5c542';
    ctx.lineWidth = 6;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(40, 40, W - 80, H - 80, 24);
      ctx.stroke();
    } else {
      ctx.strokeRect(40, 40, W - 80, H - 80);
    }

    const clip = (text, maxWidth) => {
      let t = String(text || '');
      if (ctx.measureText(t).width <= maxWidth) return t;
      while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
      return `${t}…`;
    };
    const session = payload.kind === 'session';
    const top = payload.standings?.[0];
    ctx.textAlign = 'center';

    ctx.font = '96px sans-serif';
    ctx.fillText(payload.persona.emoji || '🏆', W / 2, 185);

    ctx.fillStyle = '#ffffff';
    ctx.font = "800 62px 'NanumSquare', 'Nanum Gothic', sans-serif";
    const title = session
      ? `${payload.persona.name}의 회사에서 살아남기`
      : `${payload.persona.name}의 회의실 · Round ${payload.roundNo}`;
    ctx.fillText(clip(title, W - 200), W / 2, 300);

    ctx.fillStyle = '#f5c542';
    ctx.font = "800 46px 'NanumSquare', 'Nanum Gothic', sans-serif";
    const sub = session
      ? (top?.nick ? `🏆 올해의 사원: ${top.nick} · ${top.rank}` : '🏁 세션 종료')
      : (payload.adopted?.name ? `🏆 이달의 사원: ${payload.adopted.name}` : '이번 라운드, 채택 없음');
    ctx.fillText(clip(sub, W - 220), W / 2, 392);

    ctx.fillStyle = '#9fb0c3';
    ctx.font = "34px 'Nanum Gothic', sans-serif";
    const line = session ? payload.reason : payload.situation?.question;
    ctx.fillText(clip(`❝ ${line} ❞`, W - 220), W / 2, 470);

    ctx.fillStyle = '#66788c';
    ctx.font = "700 28px 'NanumSquare', 'Nanum Gothic', sans-serif";
    ctx.fillText('이달의 우수사원 — AI 보스 아부 서바이벌', W / 2, 548);

    return await new Promise((res) => cv.toBlob(res, 'image/png'));
  } catch {
    return null;
  }
}

export async function createShareLink(payload, title) {
  let url;
  let id;
  try {
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    if (res.error || !res.url) return 'error';
    url = res.url;
    id = res.id;
  } catch {
    return 'error';
  }

  // OG 카드 업로드 — 실패해도 링크 공유는 계속 (서버가 기본 이미지로 폴백)
  try {
    const og = await renderOgCard(payload);
    if (og) await fetch(`/api/share/${id}/og`, { method: 'PUT', body: og });
  } catch { /* 무시 */ }

  if (navigator.share) {
    try {
      await navigator.share({ title, text: title, url });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancel';
      // 공유 시트 실패 → 클립보드 폴백
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'error';
  }
}
