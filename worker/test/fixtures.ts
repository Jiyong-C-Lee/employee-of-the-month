// 테스트 공용 커스텀 페르소나 픽스처 (personaSchema 유효 팩).
export const CUSTOM_GEN = {
  name: '건물주 할머니', emoji: '🏢',
  intro: '역세권 건물 12채를 가진 할머니 회장. 월세와 손주 자랑이 인생의 전부다.',
  axes: ['월세', '체면', '손주'], ranks: ['세입자', '관리인', '반장', '소장', '본부장', '부회장', '공동건물주'],
  personaPrompt: '너는 건물 12채를 가진 할머니 회장이다. 월세 수입과 체면, 손주 자랑을 무엇보다 중시한다.',
  listenerBrief: '월세·체면·손주를 챙겨주는 말에 흡족해한다.',
  judgeAddress: "발언자를 '젊은이'라고 부른다",
  advisors: [
    { name: '공인중개사 박실장', emoji: '🗝️', style: '수완가', core: '모든 문제를 시세로 환산한다.', quirks: ['평당가로 말한다', '계약서를 품고 다닌다', '입지 얘기에 흥분한다', '복비 걱정을 한다'] },
    { name: '경비 김반장', emoji: '🧹', style: '원칙파', core: '건물 규칙이 곧 법이다.', quirks: ['분리수거를 강조한다', '순찰 일지를 인용한다', 'CCTV를 신뢰한다', '엘리베이터 사용법에 엄격하다'] },
    { name: '손주 최애봉', emoji: '🎮', style: '한량', core: '용돈이 걸리면 갑자기 똑똑해진다.', quirks: ['게임에 비유한다', '용돈 인상을 끼워넣는다', '할머니 최고를 외친다', '숙제를 미룬다'] },
    { name: '세무사 정과장', emoji: '🧾', style: '신중파', core: '모든 해법의 끝은 절세다.', quirks: ['영수증을 요구한다', '공제 항목을 왼다', '5월을 두려워한다', '현금 얘기에 정색한다'] },
  ],
  situations: Array.from({ length: 10 }, (_, i) => ({ text: `상황 ${i + 1}: 3층 세입자가 월세를 석 달째 밀리며 화분만 늘려간다.`, question: '이 일을 어찌하면 좋겠나?' })),
};

// personaSchema(id 포함) 유효 팩 — 방 생성 테스트용.
export const CUSTOM_PERSONA = { id: 'custom-test1234', ...CUSTOM_GEN };
