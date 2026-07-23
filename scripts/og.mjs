// OG 이미지·아이콘 생성기. 실행: node scripts/og.mjs  (산출물은 apps/web/public/)
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const BG = '#1d2733', ACCENT = '#f5c542', FG = '#ffffff';
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="60" y="60" width="1080" height="510" rx="24" fill="none" stroke="${ACCENT}" stroke-width="6"/>
  <text x="600" y="290" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="110" font-weight="800" fill="${FG}">이달의 사원</text>
  <text x="600" y="390" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="44" fill="${ACCENT}">보스의 마음을 움직여 사원에서 사장까지</text>
  <text x="600" y="500" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="34" fill="#9fb0c3">AI 참모들과 겨루는 아부 서바이벌 파티게임</text>
</svg>`;
const iconSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${BG}"/>
  <text x="50%" y="36%" dominant-baseline="middle" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="${size * 0.26}" font-weight="800" fill="${FG}">이달의</text>
  <text x="50%" y="66%" dominant-baseline="middle" text-anchor="middle" font-family="Malgun Gothic, sans-serif" font-size="${size * 0.23}" font-weight="800" fill="${ACCENT}">우수사원</text>
</svg>`;

await sharp(Buffer.from(ogSvg)).png().toFile('apps/web/public/og.png');
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(Buffer.from(iconSvg(size))).png().toFile(`apps/web/public/${file}`);
}
writeFileSync('apps/web/public/favicon.svg', iconSvg(64));
console.log('OK: og.png + icons');
