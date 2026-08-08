import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// 폰트는 로컬 번들 — CDN 의존 제거 + 라운드 캡처(html-to-image)에서 폰트 보장.
import '@fontsource/nanum-gothic/400.css';
import '@fontsource/nanum-gothic/700.css';
import '@fontsource/nanum-gothic/800.css';
import './fonts.css';
// 디자인 토큰·공통 셸 스타일. 게임 CSS보다 먼저 와야 --narre-* 변수를 덮어쓸 수 있다.
import '@narre/ui/tokens.css';
import './styles.css';

// Cloudflare Web Analytics (쿠키 없음, 동의 배너 불필요). 토큰은 HTML에 공개되는 값이라 코드에 둬도 안전.
// 로컬 개발(localhost)에서는 로드하지 않는다 — 대시보드 오염 방지. VITE_CF_BEACON_TOKEN으로 교체 가능.
const CF_BEACON_TOKEN = '54e91246baa84280b127fc73526ed737';
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const cfToken = (import.meta.env.VITE_CF_BEACON_TOKEN as string | undefined) || (isLocal ? undefined : CF_BEACON_TOKEN);
if (cfToken) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: cfToken }));
  document.head.appendChild(s);
}

const el = document.getElementById('root');
if (!el) throw new Error('root element를 찾을 수 없습니다.');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
