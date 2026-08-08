// 상대 import에 .js를 붙이지 않는 유일한 패키지다. llm·cf·prompt-kit은 tsc로 dist를
// 내보내서 확장자가 필요하지만, ui는 빌드 없이 소스를 그대로 export하고 게임의 Vite가
// 컴파일한다. Vite는 './Shell.js'를 Shell.tsx로 되돌려주지 않는다.
export { Shell } from './Shell';
export type { ShellProps } from './Shell';
