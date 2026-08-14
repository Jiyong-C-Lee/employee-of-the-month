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

// situations.yaml이 있으면 그것이 저작 원본(다문단 한국어·링크 저작에 유리) — 없으면 situations.json.
// 런타임에 YAML 파서를 들이지 않으려고 여기서 파싱해 생성 파일에 JSON으로 인라인한다.
function situationsOf(id) {
  const yamlPath = join(root, 'packs', id, 'situations.yaml');
  if (existsSync(yamlPath)) return { inline: JSON.stringify(loadYaml(readFileSync(yamlPath, 'utf8'))) };
  return { importPath: `./packs/${id}/situations.json` };
}
const lines = ['// 자동 생성 파일 — 직접 수정 금지. `npm run gen`으로 재생성.'];
const situationExprs = [];
ids.forEach((id, i) => {
  lines.push(`import p${i} from './packs/${id}/persona.json';`);
  const s = situationsOf(id);
  if (s.importPath) lines.push(`import s${i} from '${s.importPath}';`);
  situationExprs[i] = s.importPath ? `s${i}` : s.inline;
});
lines.push('export const RAW_PACKS = [');
ids.forEach((id, i) => lines.push(`  { persona: p${i}, situations: ${situationExprs[i]} },`));
lines.push('];');
writeFileSync(join(root, 'packs.gen.ts'), lines.join('\n') + '\n');
console.log(`packs.gen.ts: ${ids.length}개 팩 (${ids.join(', ')})`);
