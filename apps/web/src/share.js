// 라운드 공유 링크 생성 + 공유 시트/클립보드.
// 서버가 KV에 30일 보관하고 /s/:id 읽기 전용 뷰 URL을 돌려준다.
export async function createShareLink(payload, title) {
  let url;
  try {
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
    if (res.error || !res.url) return 'error';
    url = res.url;
  } catch {
    return 'error';
  }
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
