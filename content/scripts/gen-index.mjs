// packs/ 디렉토리를 스캔해 packs.gen.ts를 생성한다. 페르소나 추가 = 폴더 추가 + npm run gen.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// 노출 순서 — 삼국지 세계관(조조→유비→손권)을 앞에, 나머지는 알파벳순.
const PREFERRED = ['caocao', 'liubei', 'sonkwon'];
const rank = (id) => { const i = PREFERRED.indexOf(id); return i === -1 ? PREFERRED.length : i; };
const ids = readdirSync(join(root, 'packs'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

// scenarios.yaml은 선택 파일(저작용 원본) — 아크가 있는 팩만 갖는다.
// 런타임에 YAML 파서를 들이지 않으려고 여기서 파싱해 생성 파일에 JSON으로 인라인한다.
function scenariosOf(id) {
  const path = join(root, 'packs', id, 'scenarios.yaml');
  if (!existsSync(path)) return null;
  return loadYaml(readFileSync(path, 'utf8'));
}
const lines = ['// 자동 생성 파일 — 직접 수정 금지. `npm run gen`으로 재생성.'];
ids.forEach((id, i) => {
  lines.push(`import p${i} from './packs/${id}/persona.json';`);
  lines.push(`import s${i} from './packs/${id}/situations.json';`);
});
lines.push('export const RAW_PACKS = [');
ids.forEach((id, i) => {
  const sc = scenariosOf(id);
  lines.push(`  { persona: p${i}, situations: s${i}, scenarios: ${sc ? JSON.stringify(sc) : '[]'} },`);
});
lines.push('];');
writeFileSync(join(root, 'packs.gen.ts'), lines.join('\n') + '\n');
console.log(`packs.gen.ts: ${ids.length}개 팩 (${ids.join(', ')})`);
