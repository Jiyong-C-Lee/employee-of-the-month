// npm run dev 앞에서 한 번 도는 키 설정. .dev.vars가 없을 때만 묻는다.
//
// npm install의 postinstall이 아니라 dev 앞에 두는 이유: 설치는 CI나 스크립트에서도 돈다.
// 거기서 입력을 기다리면 그대로 멈춘다. dev는 사람이 직접 치는 명령이라 물어봐도 안전하다.
import { createInterface } from 'node:readline/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEV_VARS = fileURLToPath(new URL('../.dev.vars', import.meta.url));

// 체인 순서와 같다(wrangler.jsonc의 LLM_CHAIN). 위에 있을수록 먼저 시도한다.
const PROVIDERS = [
  { key: 'GOOGLE_AI_STUDIO_FREE_API_KEY', label: 'Google AI Studio — 무료 등급', url: 'https://aistudio.google.com/apikey' },
  { key: 'GOOGLE_AI_STUDIO_API_KEY', label: 'Google AI Studio — 유료 등급', url: 'https://aistudio.google.com/apikey' },
  { key: 'NVIDIA_API_KEY', label: 'NVIDIA NIM', url: 'https://build.nvidia.com' },
];

if (existsSync(DEV_VARS)) process.exit(0);

// 파이프·CI처럼 입력받을 수 없는 자리에서는 조용히 넘어간다. 키가 없어도 게임은 mock으로 돈다.
if (!process.stdin.isTTY) {
  console.log('[setup] .dev.vars가 없습니다. LLM 없이 mock 대사로 실행합니다.');
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
let body = '';

// 파일 쓰기는 종료 훅에 맡긴다. stdin이 도중에 닫히면 대기 중인 질문을 남긴 채
// 이벤트 루프가 비어 node가 예외 없이 그냥 끝나는데, 그때도 파일은 남아야 한다.
// (안 남으면 다음 실행에서 또 묻는다.)
process.on('exit', () => {
  if (!existsSync(DEV_VARS)) {
    writeFileSync(DEV_VARS, body || '# 키를 넣으려면 .dev.vars.example을 참고하세요.\n');
  }
});

// 이 설정은 게임 실행을 막을 자격이 없다. 입력이 중간에 끊기든 뭐가 터지든,
// 키 없는 상태로 넘어가고 dev는 계속 뜬다(predev가 && 로 이어져 있다).
try {
  console.log('\n  이달의 우수사원 — 첫 실행 설정\n');
  console.log('  API 키를 넣으면 참모 대사와 판정을 실제 LLM이 만듭니다.');
  console.log('  넣지 않아도 게임은 끝까지 돌아갑니다(내장 mock).\n');
  PROVIDERS.forEach((p, i) => console.log(`    ${i + 1}. ${p.label}  (${p.url})`));
  console.log('    0. 키 없이 시작\n');

  const pick = (await rl.question('  번호를 고르세요 [0]: ')).trim() || '0';
  const provider = PROVIDERS[Number(pick) - 1];

  if (provider) {
    const value = (await rl.question(`\n  ${provider.key} = `)).trim();
    if (value) {
      body = `${provider.key}=${value}\n`;
      console.log('\n  .dev.vars에 저장했습니다. 나머지 키는 파일을 직접 열어 추가하면 됩니다.\n');
    } else {
      console.log('\n  입력이 없어 키 없이 시작합니다.\n');
    }
  } else {
    console.log('\n  키 없이 시작합니다. 나중에 넣으려면 .dev.vars.example을 .dev.vars로 복사하세요.\n');
  }
} catch {
  console.log('\n  설정을 건너뜁니다. 키 없이 시작합니다.\n');
} finally {
  rl.close();
}
