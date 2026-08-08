// 웹 UI 문자열의 유일한 진입점. 화면(web/src)은 여기서만 문구를 읽는다.
//
// loader.ts를 타지 않는다 — loader는 packs.gen을 물고, 그러면 상황·프롬프트가 통째로
// 브라우저 번들에 실려 스포일러가 샌다. 여기서 import하는 건 ui.json 하나뿐이다.
//
// zod 스키마를 안 두는 이유: JSON을 그대로 import하면 TS가 리터럴 타입을 뽑아준다.
// 없는 키를 읽으면 컴파일이 깨지므로 런타임 검증보다 이르고 정확하다.
import UI from './global/ui.json';

export { UI };
export { fmt } from './fmt';
