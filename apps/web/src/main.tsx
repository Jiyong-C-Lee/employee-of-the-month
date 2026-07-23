import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// 폰트는 로컬 번들 — CDN 의존 제거 + 라운드 캡처(html-to-image)에서 폰트 보장.
import '@fontsource/nanum-gothic/400.css';
import '@fontsource/nanum-gothic/700.css';
import '@fontsource/nanum-gothic/800.css';
import './fonts.css';
import './styles.css';

// Cloudflare Web Analytics — 토큰이 설정된 빌드에서만 로드 (쿠키 없음, 동의 배너 불필요).
const cfToken = import.meta.env.VITE_CF_BEACON_TOKEN as string | undefined;
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
