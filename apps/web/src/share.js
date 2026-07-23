// 라운드 캡처·공유. 모바일=Web Share(파일), 미지원=PNG 다운로드.
import { toBlob } from 'html-to-image';

export async function shareRoundImage(node, { title, url, background = '#f6f1e9' }) {
  // 스크롤 컨테이너를 펼쳐서 라운드 페이지 전체를 찍는다 (보이는 영역만이 아니라).
  const blob = await toBlob(node, {
    pixelRatio: 2,
    backgroundColor: background,
    width: node.scrollWidth,
    height: node.scrollHeight,
    style: { height: 'auto', maxHeight: 'none', overflow: 'visible' },
  });
  if (!blob) throw new Error('capture-fail');
  const file = new File([blob], 'eotm-round.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `${title}\n${url}` });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancel';
      // 공유 시트 실패 → 다운로드 폴백으로 계속
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'eotm-round.png';
  a.click();
  URL.revokeObjectURL(a.href);
  return 'downloaded';
}
