/**
 * 카카오 알림톡 템플릿 레지스트리
 *
 * - tplCode: Aligo 등록 템플릿 코드 (null이면 미등록 → 발송 skip)
 * - varMap: JS 변수명 → 카카오 템플릿 #{변수명} 매핑
 * - fallbackContent: Aligo API 조회 실패 시 사용할 백업 템플릿 (#{변수명} 포함)
 * - buildFallbackSMS: SMS 대체문자 빌드 함수 (Aligo failover 용)
 *
 * 발송 시 메시지 빌드 흐름:
 *   1. alimtalkTemplateCache에서 캐시된 templtContent 가져옴
 *   2. varMap 기반으로 #{변수명} → 실제값 치환
 *   3. 캐시 없으면 fallbackContent 사용
 */

const templates = {
  // =====================================================
  // 4-1. 채팅 메시지 알림
  // =====================================================
  chat_message_host: {
    tplCode: 'UF_8708',
    eventLabel: '채팅 확인 알림_호스트',
    varMap: { roomName: '방이름' },
    fallbackContent:
      `[채팅 확인 알림]\n\n` +
      `회원님께서 등록하신 방 '#{방이름}'에 게스트님의 문의 메시지가 도착했습니다.\n\n` +
      `메시지를 확인하고 답변해주세요.`,
    buildFallbackSMS: (data) =>
      `[EZstay] ${data.roomName} 게스트 메시지 도착. 앱에서 확인해주세요.`
  },

  chat_message_guest: {
    tplCode: 'UF_8887',
    eventLabel: '채팅 확인 알림_게스트',
    varMap: { roomName: '방이름' },
    fallbackContent:
      `[채팅 확인 알림]\n\n` +
      `게스트님이 문의하신 방 '#{방이름}'의 호스트님으로부터 메시지가 도착했어요.\n\n` +
      `메시지를 확인해주세요.`,
    buildFallbackSMS: (data) =>
      `[EZstay] ${data.roomName} 호스트 메시지 도착. 앱에서 확인해주세요.`
  },

  // =====================================================
  // 4-2. 계약 승인
  // =====================================================
  contract_approved_guest: {
    tplCode: 'UF_8886',
    eventLabel: '계약 요청 승인_게스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일' },
    fallbackContent:
      `[계약 승인 안내]\n\n` +
      `회원님이 요청하신 계약이 승인되었습니다.\n\n` +
      `방 이름: #{방이름}\n` +
      `계약 기간: #{입주일} ~ #{퇴실일}\n\n` +
      `계약 내용 확인 후 계약을 진행해주세요.\n` +
      `(게스트 로그인 - 상단 메뉴 [계약 관리])`,
    buildFallbackSMS: (data) =>
      `[EZstay] ${data.roomName} 계약 승인. 계약을 진행해주세요.`
  },

  // 계약 승인 요청 → 호스트 (신규)
  contract_request_host: {
    tplCode: 'UF_8883',
    eventLabel: '계약 승인 요청_호스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일' },
    fallbackContent:
      `[계약 승인 요청 안내]\n\n` +
      `호스트님의 방에 계약 승인요청이 접수되었습니다.\n\n` +
      `방 이름: #{방이름}\n` +
      `계약 기간: #{입주일} ~ #{퇴실일}\n\n` +
      `(호스트 로그인 - 상단 메뉴 [계약 관리] - 해당 계약 내 승인 또는 거절)`,
    buildFallbackSMS: (data) =>
      `[EZstay] ${data.roomName} 계약 승인 요청. 앱에서 확인해주세요.`
  },

  // 계약 요청 거절 → 게스트
  contract_rejected_guest: {
    tplCode: 'UF_9454',
    eventLabel: '계약 요청 거절_게스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일' },
    fallbackContent:
      `[계약 거절 안내]\n\n` +
      `방 이름: #{방이름}\n` +
      `계약 기간: #{입주일} ~ #{퇴실일}\n\n` +
      `아쉽게도 회원님이 요청하신 계약을 호스트가 승인하지 않았어요. 다른 방을 찾아주세요.`,
    buildFallbackSMS: (data) =>
      `[EZstay] ${data.roomName} 계약 요청이 거절되었습니다. 다른 방을 찾아주세요.`
  },

  // =====================================================
  // 4-3. 결제 완료
  // =====================================================
  payment_completed_guest: {
    tplCode: 'UF_9063',
    eventLabel: '게스트 계약 결제 완료_게스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일', amount: '결제총액', optionItems: '상품명, 상품개수' },
    fallbackContent:
      `[계약 확정 안내]\n\n` +
      `방 이름: #{방이름}\n` +
      `계약 기간: #{입주일} ~ #{퇴실일}\n` +
      `결제 금액: #{결제총액}원\n` +
      `옵션 상품: #{상품명, 상품개수}\n\n` +
      `결제가 완료되어 계약이 확정되었습니다.\n` +
      `입주 문의는 호스트님에게 채팅으로 할 수 있어요.`,
    buildFallbackSMS: (data) =>
      `[EZstay] ${data.roomName} 계약 확정. 결제 금액: ${data.amount}원`
  },

  payment_completed_host: {
    tplCode: 'UF_8372',
    eventLabel: '게스트 계약 결제 완료_호스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일', amount: '계약금액' },
    fallbackContent:
      `[계약 확정 안내]\n\n` +
      `방 이름: #{방이름}\n` +
      `계약 기간: #{입주일} ~ #{퇴실일}\n` +
      `계약 금액: #{계약금액}원\n\n` +
      `게스트님이 결제를 완료하여 계약이 확정되었습니다.\n` +
      `입주를 위해 미리 필요한 안내를 해주세요.`,
    buildFallbackSMS: (data) =>
      `[EZstay] ${data.roomName} 게스트 결제 완료. 계약 금액: ${data.amount}원`
  },

  // 환급 계좌 미등록 게스트 안내
  bank_account_required: {
    tplCode: 'UF_8730',
    eventLabel: '게스트 계좌 등록 요청_게스트',
    varMap: {},
    fallbackContent:
      `[환급 계좌 등록 안내]\n\n` +
      `환불 및 위약금 발생 시, 지급받을 계좌를 등록해주세요.\n\n` +
      `(게스트 로그인 - 상단 메뉴 [내 정보 관리] - 환급 계좌 등록)`,
    buildFallbackSMS: () =>
      `[EZstay] 환급 계좌를 등록해주세요. 앱 > 내 정보 관리 > 환급 계좌 등록`
  },

  // 옵션 추가 결제
  option_payment_guest: {
    tplCode: 'UF_8732',
    eventLabel: '게스트 옵션 추가 결제_게스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일', optionItems: '상품명, 상품개수', amount: '추가결제금액' },
    fallbackContent:
      `[옵션 추가 결제 안내]\n\n` +
      `방 이름: #{방이름}\n` +
      `입주 기간: #{입주일} ~ #{퇴실일}\n` +
      `추가 옵션 상품: #{상품명, 상품개수}\n` +
      `금액: #{추가결제금액}원\n\n` +
      `추가 옵션 상품 결제가 완료되었습니다.`,
    buildFallbackSMS: (data) =>
      `[EZstay] ${data.roomName} 옵션 추가 결제 완료. 금액: ${data.amount}원`
  },

  // =====================================================
  // 4-4. 입주 당일 안내
  // =====================================================
  checkin_today_guest: {
    tplCode: 'UF_8712',
    eventLabel: '입주 당일 안내_게스트',
    varMap: { roomName: '방이름', address: '상세주소' },
    fallbackContent:
      `[입주 당 안내]\n\n` +
      `오늘은 입주날입니다.\n\n` +
      `방 이름: #{방이름}\n` +
      `주소: #{상세주소}\n\n` +
      `입주 전 공동현관/도어락 비밀번호 등 입주에 필요한 사항은 호스트님에게 안내받을 수 있습니다.`,
    buildFallbackSMS: (data) =>
      `[EZstay] 오늘 입주일. ${data.roomName} (${data.address})`
  },

  checkin_today_host: {
    tplCode: 'UF_8713',
    eventLabel: '입주 당일 안내_호스트',
    varMap: { roomName: '방이름', address: '상세주소' },
    fallbackContent:
      `[입주 당일 안내]\n\n` +
      `오늘은 게스트님의 입주날입니다.\n\n` +
      `방 이름: #{방이름}\n` +
      `주소: #{상세주소}\n\n` +
      `입주 전 공동현관/도어락 비밀번호 등 입주 안내가 필요할 경우 게스트님에게 안내해주세요.`,
    buildFallbackSMS: (data) =>
      `[EZstay] 오늘 입주일. ${data.roomName} 게스트 안내 필요 시 채팅해주세요.`
  },

  // =====================================================
  // 4-5. 계약 취소 및 환불 안내
  // =====================================================

  // 게스트 취소 → 게스트
  contract_canceled_guest_to_guest: {
    tplCode: 'UF_8374',
    eventLabel: '게스트 계약 취소 안내_게스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일', penaltyAmount: '게스트부담금', refundAmount: '환불예정금액' },
    fallbackContent:
      `[계약 취소 안내]\n\n` +
      `게스트님의 요청으로 계약이 취소되었습니다.\n\n` +
      `방 이름: #{방이름}\n` +
      `계약 기간: #{입주일} ~ #{퇴실일}\n` +
      `위약금: #{게스트부담금}원\n\n` +
      `환불 규정에 따라 위약금이 발생한 경우 계약 금액에서 차감 후 환불됩니다.\n\n` +
      `환불 예정 금액: #{환불예정금액}원\n` +
      `(위약금 #{게스트부담금}원 차감 적용)`,
    buildFallbackSMS: (data) =>
      `[EZstay] 계약 취소. ${data.roomName} 환불 예정: ${data.refundAmount}원`
  },

  // 게스트 취소 → 호스트
  contract_canceled_guest_to_host: {
    tplCode: 'UF_8375',
    eventLabel: '게스트 계약 취소 안내_호스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일', penaltyAmount: '위약금', settlementAmount: '정산예정금액' },
    fallbackContent:
      `[계약 취소 안내]\n\n` +
      `게스트님의 요청으로 계약이 취소되었습니다.\n\n` +
      `방 이름: #{방이름}\n` +
      `계약 기간: #{입주일} ~ #{퇴실일}\n` +
      `위약금: #{위약금}원\n\n` +
      `환불 규정에 따라 위약금은 수수료 차감 후 호스트님의 정산 계좌로 입금될 예정입니다.(영업일 기준 7일 이내)\n\n` +
      `정산 예정 금액: #{정산예정금액}`,
    buildFallbackSMS: (data) =>
      `[EZstay] 게스트 계약 취소. ${data.roomName} 정산 예정: ${data.settlementAmount}`
  },

  // 호스트 취소 → 게스트
  contract_canceled_host_to_guest: {
    tplCode: 'UF_8716',
    eventLabel: '호스트 계약 취소 안내_게스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일', penaltyAmount: '위약금' },
    fallbackContent:
      `[계약 취소 안내]\n\n` +
      `호스트님의 요청으로 계약이 취소되었습니다.\n\n` +
      `방 이름: #{방이름}\n` +
      `계약 기간: #{입주일} ~ #{퇴실일}\n` +
      `위약금: #{위약금}원\n\n` +
      `환불 규정에 따라 위약금은 게스트님이 등록한 계좌로 입금될 예정입니다.(영업일 기준 7일 이내)`,
    buildFallbackSMS: (data) =>
      `[EZstay] 호스트 요청 계약 취소. ${data.roomName} 위약금: ${data.penaltyAmount}원`
  },

  // 호스트 취소 → 호스트
  contract_canceled_host_to_host: {
    tplCode: 'UF_8718',
    eventLabel: '호스트 계약 취소 안내_호스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일', penaltyAmount: '호스트부담금' },
    fallbackContent:
      `[계약 취소 안내]\n\n` +
      `호스트님의 요청으로 계약이 취소되었습니다.\n\n` +
      `방 이름: #{방이름}\n` +
      `입주 기간: #{입주일} ~ #{퇴실일}\n` +
      `위약금: #{호스트부담금}원\n\n` +
      `결제가 완료되어 정상 취소 처리되었습니다.`,
    buildFallbackSMS: (data) =>
      `[EZstay] 계약 취소 완료. ${data.roomName}`
  },

  // =====================================================
  // 4-6. 퇴실 전일 안내
  // =====================================================
  checkout_eve_guest: {
    tplCode: 'UF_8362',
    eventLabel: '퇴실 전일 안내_게스트',
    varMap: { checkOutTime: '퇴실시간' },
    fallbackContent:
      `[퇴실 사전 안내]\n\n` +
      `내일은 퇴실일입니다.\n` +
      `퇴실 전 다음 사항을 미리 확인해 주세요.\n\n` +
      `- 퇴실 시간 : #{퇴실시간}\n` +
      `- 쓰레기 지정 장소 배출\n` +
      `- 에어컨 / 보일러 전원 OFF\n` +
      `- 개인 물품 및 분실물 확인\n` +
      `- 심각한 오염이나 파손이 있을 경우 보증금에서 차감될 수 있습니다.`,
    buildFallbackSMS: (data) =>
      `[EZstay] 내일 퇴실일입니다. 퇴실시간: ${data.checkOutTime}. 퇴실 전 체크사항을 확인해주세요.`
  },

  // =====================================================
  // 4-7. 퇴실 당일 알림
  // =====================================================
  checkout_today_guest: {
    tplCode: 'UF_8722',
    eventLabel: '게스트 퇴실 당일 안내_게스트',
    varMap: {},
    fallbackContent:
      `[퇴실 완료 요청]\n\n` +
      `게스트님의 퇴실 시간이 경과했습니다.\n` +
      `퇴실을 완료하셨다면 퇴실 완료 처리를 해주세요.\n` +
      `이후 호스트님이 퇴실 확인을 하면 보증금 반환 절차가 시작됩니다.\n\n` +
      `(게스트 로그인 - 상단 메뉴 [계약 관리] - 해당 계약 내 '퇴실 완료' 버튼)`,
    buildFallbackSMS: () =>
      `[EZstay] 퇴실 시간 경과. 앱에서 퇴실 완료 처리를 해주세요.`
  },

  // =====================================================
  // 4-8. 호스트 퇴실 확인 요청
  // =====================================================
  checkout_host_request: {
    tplCode: 'UF_8726',
    eventLabel: '호스트 퇴실 확인 요청_호스트',
    varMap: { confirmDeadline: '퇴실확인마감시한' },
    fallbackContent:
      `[퇴실 확인 요청]\n\n` +
      `게스트님이 퇴실을 완료했습니다.\n\n` +
      `보증금 반환을 위해 '퇴실 확인' 또는 '보류' 여부를 #{퇴실확인마감시한}내에 처리해주세요.\n\n` +
      `(호스트 로그인 - 상단 메뉴 [계약 관리] - 해당 계약 내 '퇴실 확인' 또는 '퇴실 보류')`,
    buildFallbackSMS: (data) =>
      `[EZstay] 게스트 퇴실 완료. ${data.confirmDeadline}내 퇴실 확인 처리 필요.`
  },

  // =====================================================
  // 4-9. 보증금 보류 안내
  // =====================================================
  deposit_hold_host: {
    tplCode: 'UF_8727',
    eventLabel: '보증금 보류 안내_호스트',
    varMap: { agreementDeadline: '합의마감기한' },
    fallbackContent:
      `[보증금 보류 안내]\n\n` +
      `보증금이 보류되었습니다. 게스트님과 보증금 처리 합의 후 내용을 제출해주세요.\n\n` +
      `합의 마감 기한은 #{합의마감기한} 입니다. 합의 및 게스트님 동의 완료가 되지않으면, 자동으로 게스트님에게 보증금이 환급됩니다.\n\n` +
      `(합의 내용 제출 : 호스트 로그인 - 상단 메뉴 [계약 관리] - 해당 계약 내 '합의 내용 제출' 버튼)`,
    buildFallbackSMS: (data) =>
      `[EZstay] 보증금 보류. 합의 기한: ${data.agreementDeadline}. 앱에서 확인.`
  },

  deposit_hold_guest: {
    tplCode: 'UF_8728',
    eventLabel: '보증금 보류 안내_게스트',
    varMap: {},
    fallbackContent:
      `[보증금 보류 안내]\n\n` +
      `호스트님의 요청으로 보증금 반환이 보류되었습니다. \n` +
      `보증금 처리 합의를 위해 호스트님에게 문의해주세요.`,
    buildFallbackSMS: () =>
      `[EZstay] 보증금 반환 보류. 호스트에게 문의해주세요.`
  },

  // =====================================================
  // 4-10. 보증금 정산 합의 요청
  // =====================================================
  deposit_settlement_submitted: {
    tplCode: 'UF_8729',
    eventLabel: '보증금 정산 합의 요청_게스트',
    varMap: { deductAmount: '차감할금액', reason: '호스트사유' },
    fallbackContent:
      `[보증금 정산 합의 요청]\n\n` +
      `호스트님이 요청한 보증금 정산 합의 내용 전달드립니다.\n\n` +
      `차감할 금액: #{차감할금액}원\n` +
      `사유: #{호스트사유}\n\n` +
      `내용 확인 후 동의 처리를 하면 보증금 차감 및 반환이 진행됩니다.\n\n` +
      `(합의 내용 확인 : 게스트 로그인 - 상단 메뉴 [계약 관리] - 해당 계약 내 '합의 내용 확인' 버튼)`,
    buildFallbackSMS: (data) =>
      `[EZstay] 보증금 정산 합의 요청. 차감: ${data.deductAmount}원. 앱에서 확인.`
  },

  // =====================================================
  // 4-11. 보증금 정산 합의 동의 완료
  // =====================================================
  deposit_settlement_agreed: {
    tplCode: 'UF_8368',
    eventLabel: '보증금 정산 합의 동의 완료_공통',
    varMap: { guestAmount: '게스트지급액', hostAmount: '호스트지급액' },
    fallbackContent:
      `[보증금 정산 안내]\n\n` +
      `보증금 정산 합의가 완료되었습니다.\n\n` +
      `게스트 지급: #{게스트지급액}원\n` +
      `호스트 지급: #{호스트지급액}원\n\n` +
      `위 금액으로 보증금을 정산하여 지급처리 합니다.(영업일 기준 3일 이내 지급 예정)`,
    buildFallbackSMS: (data) =>
      `[EZstay] 보증금 정산 합의 완료. 게스트: ${data.guestAmount}원, 호스트: ${data.hostAmount}원`
  },

  // =====================================================
  // 4-12. 보증금 정산 합의 기한 만료
  // =====================================================
  deposit_agreement_expired: {
    tplCode: 'UF_8369',
    eventLabel: '보증금 정산 합의 기한 만료_공통',
    varMap: {},
    fallbackContent:
      `[보증금 반환 안내]\n\n` +
      `보증금 정산 합의 기한이 만료되어 보증금이 게스트님에게 반환됩니다.(영업일 기준 3일 이내 지급 예정)\n\n` +
      `추가 합의가 필요할 경우 당사자 간 별도 합의를 우선 진행해 주세요.`,
    buildFallbackSMS: () =>
      `[EZstay] 보증금 합의 기한 만료. 게스트에게 보증금이 반환됩니다.`
  },

  // =====================================================
  // 4-13. 호스트 퇴실 확인 완료 및 보증금 반환
  // =====================================================
  deposit_returned_normal: {
    tplCode: 'UF_8370',
    eventLabel: '호스트 퇴실 확인 완료_게스트',
    varMap: {},
    fallbackContent:
      `[보증금 반환 안내]\n\n` +
      `호스트님이 퇴실 확인을 완료하여 보증금 반환이 진행됩니다. (영업일 기준 3일 이내 지급 예정)`,
    buildFallbackSMS: () =>
      `[EZstay] 퇴실 확인 완료. 보증금 반환이 진행됩니다. (영업일 기준 3일 이내)`
  },

  // =====================================================
  // 4-15. 퇴실 확인 기한 만료
  // =====================================================
  checkout_confirm_expired_guest: {
    tplCode: 'UF_8370',
    eventLabel: '퇴실 확인 기한 만료_게스트',
    varMap: {},
    // 게스트에게는 4-13(UF_8370)과 동일한 메시지 사용
    fallbackContent:
      `[보증금 반환 안내]\n\n` +
      `호스트님이 퇴실 확인을 완료하여 보증금 반환이 진행됩니다. (영업일 기준 3일 이내 지급 예정)`,
    buildFallbackSMS: () =>
      `[EZstay] 퇴실 확인 완료. 보증금 반환이 진행됩니다. (영업일 기준 3일 이내)`
  },

  checkout_confirm_expired_host: {
    tplCode: 'UF_8376',
    eventLabel: '퇴실 확인 기한 만료_호스트',
    varMap: { roomName: '방이름', startDate: '입주일', endDate: '퇴실일' },
    fallbackContent:
      `[퇴실 확인 기한 만료 안내]\n\n` +
      `호스트님의 퇴실 확인 기한이 만료되어 보증금 반환이 진행됩니다.\n\n` +
      `방 이름: #{방이름}\n` +
      `계약 기간: #{입주일} ~ #{퇴실일}`,
    buildFallbackSMS: (data) =>
      `[EZstay] 퇴실확인 기한 만료. ${data.roomName} 보증금 반환 진행.`
  }
};

/**
 * 템플릿 조회
 * @param {string} eventName - 이벤트명
 * @returns {Object|null} 템플릿 정보 (null이면 미정의)
 */
const getTemplate = (eventName) => {
  return templates[eventName] || null;
};

/**
 * 템플릿 활성 여부 확인
 * @param {string} eventName
 * @returns {boolean}
 */
const isTemplateActive = (eventName) => {
  const template = templates[eventName];
  return template && template.tplCode !== null;
};

module.exports = { templates, getTemplate, isTemplateActive };
