// packs/ 디렉토리를 스캔해 src/packs.gen.ts를 생성한다. 페르소나 추가 = 폴더 추가 + npm run gen.
import { readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ids = readdirSync(join(root, 'packs'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const lines = ['// 자동 생성 파일 — 직접 수정 금지. `npm run gen`으로 재생성.'];
ids.forEach((id, i) => {
  lines.push(`import p${i} from '../packs/${id}/persona.json';`);
  lines.push(`import s${i} from '../packs/${id}/situations.json';`);
});
lines.push('export const RAW_PACKS = [');
ids.forEach((_, i) => lines.push(`  { persona: p${i}, situations: s${i} },`));
lines.push('];');
writeFileSync(join(root, 'src', 'packs.gen.ts'), lines.join('\n') + '\n');
console.log(`packs.gen.ts: ${ids.length}개 팩 (${ids.join(', ')})`);
