/**
 * 표준화된 API 응답 헬퍼
 * 일관된 에러 코드와 응답 형식을 제공합니다.
 */

// 에러 코드 정의
const ErrorCodes = {
  // 인증 관련 (1xxx)
  UNAUTHORIZED: { code: 1001, message: '인증이 필요합니다.' },
  INVALID_TOKEN: { code: 1002, message: '유효하지 않은 토큰입니다.' },
  TOKEN_EXPIRED: { code: 1003, message: '토큰이 만료되었습니다.' },
  ACCOUNT_LOCKED: { code: 1004, message: '로그인 시도가 여러 번 실패하여 10분간 로그인할 수 없습니다.' },
  LOGIN_FAILED: { code: 1005, message: '이메일 또는 비밀번호가 올바르지 않습니다.' },
  ACCOUNT_SUSPENDED: { code: 1006, message: '회원님의 계정이 정지되었습니다. 고객센터로 문의 부탁드립니다.' },
  ACCOUNT_WITHDRAWN: { code: 1007, message: '탈퇴한 계정입니다. 재가입 하시겠습니까?' },

  // 권한 관련 (2xxx)
  FORBIDDEN: { code: 2001, message: '권한이 없습니다.' },
  NOT_OWNER: { code: 2002, message: '소유자만 접근 가능합니다.' },
  NOT_HOST: { code: 2003, message: '호스트만 접근 가능합니다.' },

  // 리소스 관련 (3xxx)
  NOT_FOUND: { code: 3001, message: '리소스를 찾을 수 없습니다.' },
  ROOM_NOT_FOUND: { code: 3002, message: '방을 찾을 수 없습니다.' },
  USER_NOT_FOUND: { code: 3003, message: '사용자를 찾을 수 없습니다.' },
  PHOTO_NOT_FOUND: { code: 3004, message: '사진을 찾을 수 없습니다.' },

  // 검증 관련 (4xxx)
  VALIDATION_ERROR: { code: 4001, message: '입력값이 유효하지 않습니다.' },
  MISSING_REQUIRED_FIELDS: { code: 4002, message: '필수 정보를 모두 입력해주세요.' },
  INVALID_EMAIL: { code: 4003, message: '유효하지 않은 이메일 형식입니다.' },
  INVALID_PASSWORD: { code: 4004, message: '비밀번호 형식이 올바르지 않습니다.' },
  PASSWORD_MISMATCH: { code: 4005, message: '비밀번호가 일치하지 않습니다.' },
  DUPLICATE_EMAIL: { code: 4006, message: '이미 사용 중인 이메일입니다.' },
  INVALID_PHONE: { code: 4007, message: '유효하지 않은 전화번호입니다.' },

  // 이메일 인증 관련 (40xx)
  INVALID_CODE: { code: 4008, message: '인증코드가 일치하지 않습니다.' },
  CODE_EXPIRED: { code: 4009, message: '인증코드가 만료되었습니다.' },
  MAX_ATTEMPTS_EXCEEDED: { code: 4010, message: '인증 시도 횟수를 초과했습니다.' },
  CODE_NOT_FOUND: { code: 4011, message: '인증코드를 찾을 수 없습니다.' },
  EMAIL_NOT_VERIFIED: { code: 4012, message: '이메일 인증이 필요합니다.' },
  EMAIL_SEND_FAILED: { code: 4013, message: '이메일 발송에 실패했습니다.' },
  ALREADY_VERIFIED: { code: 4015, message: '이미 본인인증이 완료된 계정입니다.' },
  EMAIL_EXISTS_AS_LOCAL: { code: 4016, message: '이미 이메일로 가입된 계정입니다. 이메일로 로그인해주세요.' },
  EMAIL_EXISTS_AS_SOCIAL: { code: 4017, message: '이미 소셜 계정으로 가입된 이메일입니다.' },

  // 파일 업로드 관련 (4xxx)
  NO_FILE_UPLOADED: { code: 4101, message: '파일을 업로드해주세요.' },
  INVALID_FILE_TYPE: { code: 4102, message: '지원하지 않는 파일 형식입니다.' },
  FILE_TOO_LARGE: { code: 4103, message: '파일 크기가 너무 큽니다.' },
  MIN_PHOTOS_REQUIRED: { code: 4104, message: '최소 6장의 사진을 업로드해주세요.' },
  MAX_PHOTOS_EXCEEDED: { code: 4105, message: '사진은 최대 20장까지 업로드 가능합니다.' },

  // 방 등록 관련 (4xxx)
  ROOM_INFO_INCOMPLETE: { code: 4201, message: '방 정보가 완전하지 않습니다.' },
  PRICING_INFO_REQUIRED: { code: 4202, message: '요금 정보를 입력해주세요.' },
  DESCRIPTION_REQUIRED: { code: 4203, message: '방 소개를 입력해주세요.' },
  AMENITIES_REQUIRED: { code: 4204, message: '편의시설 정보를 입력해주세요.' },
  PHOTO_IDS_REQUIRED: { code: 4205, message: '사진 ID 배열이 필요합니다.' },

  // 방 관리 관련 (42xx)
  ROOM_HAS_CONTRACTS: { code: 4230, message: '계약이 존재하여 삭제할 수 없습니다.' },
  ROOM_STATUS_NOT_APPROVED: { code: 4231, message: '게시 상태 변경은 승인된 방만 가능합니다.' },
  ROOM_ALREADY_DELETED: { code: 4232, message: '이미 삭제된 방입니다.' },
  DUPLICATE_ROOM_FAILED: { code: 4233, message: '방 복제에 실패했습니다.' },
  REGION_NOT_SUPPORTED: { code: 4234, message: '현재 서비스 지역이 아닙니다. 서울 지역만 등록 가능합니다.' },
  ROOM_ALREADY_PENDING: { code: 4235, message: '이미 심사 중인 방입니다.' },

  // 고객센터 관련 (4xxx)
  NOTICE_NOT_FOUND: { code: 4301, message: '공지사항을 찾을 수 없습니다.' },
  FAQ_CATEGORY_NOT_FOUND: { code: 4302, message: 'FAQ 카테고리를 찾을 수 없습니다.' },
  FAQ_NOT_FOUND: { code: 4303, message: 'FAQ를 찾을 수 없습니다.' },
  INQUIRY_NOT_FOUND: { code: 4304, message: '문의를 찾을 수 없습니다.' },
  CATEGORY_IN_USE: { code: 4305, message: '해당 카테고리에 FAQ가 존재하여 삭제할 수 없습니다.' },
  ANSWER_ALREADY_EXISTS: { code: 4306, message: '이미 답변된 문의입니다.' },
  INVALID_STATUS: { code: 4307, message: '유효하지 않은 상태 값입니다.' },
  DUPLICATE_CATEGORY_NAME: { code: 4308, message: '이미 존재하는 카테고리 이름입니다.' },

  // 일정 관리 관련 (43xx)
  CONFLICT_WITH_CONTRACT: { code: 4300, message: '해당 기간에 이미 확정된 계약이 있습니다.' },
  CONFLICT_WITH_BLOCKED_PERIOD: { code: 4301, message: '이미 계약 불가로 설정된 기간입니다.' },
  INVALID_DATE_RANGE: { code: 4302, message: '종료일은 시작일보다 이후여야 합니다.' },
  PAST_DATE_NOT_ALLOWED: { code: 4303, message: '과거 날짜는 선택할 수 없습니다.' },
  BLOCKED_PERIOD_NOT_FOUND: { code: 4304, message: '계약 불가 기간을 찾을 수 없습니다.' },

  // 환급 계좌 관련 (45xx)
  REFUND_ACCOUNT_NOT_FOUND: { code: 4501, message: '등록된 환급 계좌가 없습니다.' },
  REFUND_ACCOUNT_VERIFY_FAILED: { code: 4502, message: '예금주 확인에 실패했습니다.' },
  REFUND_ACCOUNT_HOLDER_MISMATCH: { code: 4503, message: '예금주 정보가 일치하지 않습니다.' },
  UNSUPPORTED_BANK: { code: 4504, message: '지원하지 않는 은행입니다.' },

  // 결제 관련 (46xx)
  CONTRACT_NOT_FOUND: { code: 3005, message: '계약을 찾을 수 없습니다.' },
  CONTRACT_NOT_APPROVED: { code: 4601, message: '승인된 계약이 아닙니다.' },
  PAYMENT_NOT_AVAILABLE: { code: 4602, message: '결제 가능한 상태가 아닙니다.' },
  ORDER_ID_MISMATCH: { code: 4603, message: '주문번호가 일치하지 않습니다.' },
  AMOUNT_MISMATCH: { code: 4604, message: '결제 금액이 일치하지 않습니다.' },
  PAYMENT_CONFIRMATION_FAILED: { code: 4605, message: '결제 승인에 실패했습니다.' },
  ALREADY_PAID: { code: 4606, message: '이미 결제된 계약입니다.' },
  PAYMENT_EXPIRED: { code: 4607, message: '결제 가능 시간이 만료되었습니다.' },
  PAYMENT_NOT_FOUND: { code: 4608, message: '결제 정보를 찾을 수 없습니다.' },
  PAYMENT_NOT_REFUNDABLE: { code: 4609, message: '환불 가능한 상태가 아닙니다.' },
  REFUND_EXCEEDS_BALANCE: { code: 4610, message: '환불 금액이 잔액을 초과합니다.' },

  // 보증금 보류 관련 (467x)
  DEPOSIT_HOLD_NOT_FOUND: { code: 4670, message: '보류 신청 대기 상태가 아닙니다.' },
  DEPOSIT_HOLD_ALREADY_PROCESSED: { code: 4671, message: '이미 처리된 보류 신청입니다.' },
  DEPOSIT_AGREEMENT_EXPIRED: { code: 4672, message: '합의 기한이 만료되었습니다.' },
  FORCE_HOLD_REASON_REQUIRED: { code: 4675, message: '강제 반환보류 사유를 입력해주세요.' },

  // 렌탈 주문 관련 (47xx)
  RENTAL_NOT_AVAILABLE_WITHIN_6_DAYS: { code: 4700, message: '입주일 6일 이내에는 렌탈 아이템을 신청할 수 없습니다.' },
  RENTAL_MODIFICATION_EXPIRED: { code: 4701, message: '입주 5일 전까지만 렌탈 변경이 가능합니다.' },
  RENTAL_ORDER_NOT_FOUND: { code: 4702, message: '렌탈 주문을 찾을 수 없습니다.' },
  RENTAL_ORDER_NOT_PAYABLE: { code: 4703, message: '결제 대기 상태의 주문만 결제할 수 있습니다.' },
  RENTAL_ITEM_ALREADY_CANCELLED: { code: 4704, message: '이미 취소된 아이템입니다.' },
  RENTAL_STATUS_NOT_ALLOWED: { code: 4705, message: '현재 계약 상태에서는 렌탈 변경이 불가합니다.' },
  RENTAL_STOCK_INSUFFICIENT: { code: 4706, message: '렌탈 아이템 재고가 부족합니다.' },
  RENTAL_ORDER_NOT_REFUNDABLE: { code: 4707, message: '결제된 주문만 환불할 수 있습니다.' },
  RENTAL_ITEM_NOT_FOUND: { code: 4708, message: '렌탈 아이템을 찾을 수 없습니다.' },
  RENTAL_AMOUNT_MISMATCH: { code: 4709, message: '렌탈 결제 금액이 일치하지 않습니다.' },
  RENTAL_ORDER_NOT_CANCELLABLE: { code: 4710, message: '미결제 주문만 취소할 수 있습니다.' },
  RENTAL_ORDER_ITEM_NOT_FOUND: { code: 4711, message: '렌탈 주문 아이템을 찾을 수 없습니다.' },
  RENTAL_NOT_GUEST: { code: 4712, message: '계약의 게스트만 렌탈 주문을 관리할 수 있습니다.' },
  RENTAL_ORDER_ALREADY_CANCELLED: { code: 4713, message: '이미 취소된 주문입니다.' },
  RENTAL_MINIMUM_AMOUNT_REQUIRED: { code: 4714, message: '별도 배송이 필요한 경우 최소 주문금액은 10,000원입니다.' },

  // 입주 준비 서비스 - 임차인 (478x)
  MOVE_IN_GUEST_TOKEN_INVALID:           { code: 4780, message: '입주 준비 서비스 링크가 유효하지 않습니다.' },
  MOVE_IN_GUEST_TOKEN_EXPIRED:           { code: 4781, message: '해당 입주 준비 서비스 링크가 만료되었거나 사용할 수 없습니다.' },
  MOVE_IN_GUEST_PHONE_MISMATCH:          { code: 4782, message: '임대인이 등록한 임차인 연락처와 현재 계정의 연락처가 일치하지 않습니다.' },
  MOVE_IN_GUEST_CASE_NOT_FOUND:          { code: 4783, message: '입주 준비 요청을 찾을 수 없습니다.' },
  MOVE_IN_GUEST_PAYMENT_DEADLINE_PASSED: { code: 4784, message: '입주일 5일 전까지만 결제할 수 있습니다.' },
  MOVE_IN_GUEST_OPTION_REQUIRED:         { code: 4785, message: '결제할 입주 준비 옵션을 선택해주세요.' },
  MOVE_IN_GUEST_OPTION_UNAVAILABLE:      { code: 4786, message: '선택한 옵션을 현재 사용할 수 없습니다.' },
  MOVE_IN_GUEST_OPTION_NOT_FOUND:        { code: 4787, message: '옵션을 찾을 수 없습니다.' },
  MOVE_IN_GUEST_STOCK_INSUFFICIENT:      { code: 4788, message: '선택한 옵션의 재고가 부족합니다.' },
  MOVE_IN_GUEST_AMOUNT_MISMATCH:         { code: 4789, message: '결제 금액이 변경되었습니다. 다시 시도해주세요.' },
  MOVE_IN_GUEST_ORDER_NOT_FOUND:         { code: 4790, message: '주문을 찾을 수 없습니다.' },
  MOVE_IN_GUEST_ORDER_NOT_PAYABLE:       { code: 4791, message: '결제 가능한 상태의 주문이 아닙니다.' },
  MOVE_IN_GUEST_ORDER_NOT_CANCELLABLE:   { code: 4792, message: '미결제 주문만 취소할 수 있습니다.' },
  MOVE_IN_GUEST_PENDING_ORDER_EXISTS:    { code: 4793, message: '결제 대기 중인 주문이 있습니다. 기존 주문을 결제하거나 취소해주세요.' },
  MOVE_IN_GUEST_PAYMENT_NOT_FOUND:       { code: 4794, message: '결제 정보를 찾을 수 없습니다.' },

  // 입주 준비 - 방 심사 (4795~)
  MOVE_IN_ROOM_NOT_APPROVED:             { code: 4795, message: '심사 승인된 방만 사용할 수 있습니다.' },

  // 입주 준비 - 케이스 (4796~)
  MOVE_IN_CASE_NOT_FOUND:                { code: 4796, message: '입주 준비 케이스를 찾을 수 없습니다.' },
  MOVE_IN_CLEANING_PAYMENT_DEADLINE_PASSED: { code: 4797, message: '입주일 2일 전까지만 청소 결제가 가능합니다.' },
  MOVE_IN_CLEANING_SCHEDULE_INVALID:     { code: 4798, message: '청소 희망 시간은 30분 단위로 09:00~18:00 사이여야 합니다.' },

  // 입주 준비 - 환불/반품 (4799~)
  MOVE_IN_GUEST_REFUND_NOT_ALLOWED:      { code: 4799, message: '현재 환불/취소가 불가한 상태입니다.' },
  MOVE_IN_GUEST_RETURN_ALREADY_REQUESTED:{ code: 4810, message: '이미 처리 중인 반품 요청이 있습니다.' },
  MOVE_IN_REFUND_REQUEST_NOT_FOUND:      { code: 4811, message: '반품 요청을 찾을 수 없습니다.' },
  MOVE_IN_REFUND_REQUEST_NOT_PENDING:    { code: 4812, message: '이미 처리된 반품 요청입니다.' },
  MOVE_IN_CLEANING_REFUND_NOT_ALLOWED:   { code: 4813, message: '현재 청소 환불이 불가한 상태입니다.' },
  MOVE_IN_GUEST_CANCEL_QTY_INVALID:      { code: 4814, message: '취소/반품 수량이 올바르지 않습니다.' },
  MOVE_IN_GUEST_CANCEL_REMAINING_INVALID:{ code: 4815, message: '취소 후 남은 옵션 금액이 10,000원 미만입니다. 전체 취소하거나 10,000원 이상 남도록 선택해주세요.' },
  MOVE_IN_GUEST_OPTION_QTY_EXCEEDED:     { code: 4816, message: '품목당 5개를 초과할 수 없습니다.' },

  // 알림 관련 (48xx)
  NOTIFICATION_NOT_FOUND: { code: 4801, message: '알림을 찾을 수 없습니다.' },

  // 정산 관련 (49xx)
  SETTLEMENT_NOT_FOUND: { code: 4901, message: '정산 정보를 찾을 수 없습니다.' },
  INVALID_USER_MODE: { code: 4802, message: 'userMode는 guest 또는 host여야 합니다.' },

  // 중개인 인센티브 관련 (491x)
  BROKER_NOT_FOUND:                 { code: 4910, message: '중개인을 찾을 수 없습니다.' },
  BROKER_TAX_ID_REQUIRED:           { code: 4911, message: '사업자 중개인은 사업자등록번호가 필요합니다.' },
  BROKER_INVALID_DATE_RANGE:        { code: 4912, message: '종료일은 시작일 이후여야 합니다.' },
  BROKER_RATE_INVALID:              { code: 4913, message: '적용률은 0 초과 1 이하 값이어야 합니다.' },
  BROKER_HOST_ALREADY_MAPPED:       { code: 4914, message: '해당 임대인은 이미 활성 매핑이 존재합니다.' },
  BROKER_HOST_MAPPING_NOT_FOUND:    { code: 4915, message: '중개인-임대인 매핑을 찾을 수 없습니다.' },
  BROKER_INCENTIVE_PAYOUT_NOT_FOUND:{ code: 4916, message: '중개인 월별 지급 정보를 찾을 수 없습니다.' },
  BROKER_INCENTIVE_ALREADY_PAID:    { code: 4917, message: '이미 지급 완료된 건입니다.' },
  BROKER_MONTH_INVALID:             { code: 4918, message: '월 형식은 YYYY-MM 이어야 합니다.' },
  BROKER_HOST_NOT_FOUND:            { code: 4919, message: '임대인(호스트)을 찾을 수 없습니다.' },

  // 아이디/비밀번호 찾기 관련 (442x)
  FIND_ID_NOT_FOUND: { code: 4420, message: '본인인증 정보와 일치하는 계정이 없습니다.' },
  FIND_PW_MISMATCH: { code: 4421, message: '이메일과 본인인증 정보가 일치하지 않습니다.' },
  SOCIAL_ACCOUNT_NO_PASSWORD: { code: 4422, message: '소셜 계정은 비밀번호 찾기를 사용할 수 없습니다.' },

  // KMC 본인인증 관련 (44xx)
  KMC_ENCRYPTION_FAILED: { code: 4401, message: '인증 요청 생성에 실패했습니다.' },
  KMC_DECRYPTION_FAILED: { code: 4402, message: '인증 결과 처리에 실패했습니다.' },
  KMC_TOKEN_EXPIRED: { code: 4403, message: '인증 토큰이 만료되었습니다.' },
  KMC_TOKEN_NOT_FOUND: { code: 4404, message: '인증 토큰을 찾을 수 없습니다.' },
  KMC_VERIFY_FAILED: { code: 4405, message: '본인인증에 실패했습니다.' },
  KMC_TAMPERING_DETECTED: { code: 4406, message: '인증 데이터 위변조가 감지되었습니다.' },
  KMC_API_ERROR: { code: 4407, message: 'KMC 서버 연동 중 오류가 발생했습니다.' },
  KMC_WORKER_NOT_READY: { code: 4408, message: '인증 모듈이 준비되지 않았습니다.' },

  // 영수증 관련 (441x)
  RECEIPT_NOT_FOUND: { code: 4410, message: '영수증을 찾을 수 없습니다.' },
  INVALID_RECEIPT_TYPE: { code: 4412, message: '영수증 종류가 올바르지 않습니다.' },
  INVALID_RECEIPT_NUMBER: { code: 4413, message: '영수증 번호가 올바르지 않습니다.' },
  RECEIPT_BUSINESS_NAME_REQUIRED: { code: 4414, message: '세금계산서 발급 시 사업자명은 필수입니다.' },
  RECEIPT_REP_NAME_REQUIRED: { code: 4415, message: '세금계산서 발급 시 대표자명은 필수입니다.' },
  RECEIPT_ALREADY_ISSUED: { code: 4416, message: '이미 발급 완료된 영수증입니다.' },
  BUSINESS_CLOSED: { code: 4417, message: '폐업된 사업자입니다. 저장할 수 없습니다.' },
  BUSINESS_NOT_FOUND: { code: 4418, message: '국세청에 등록되지 않은 사업자등록번호입니다.' },
  BUSINESS_STATUS_CHECK_FAILED: { code: 4419, message: '사업자 상태 확인에 실패했습니다. 잠시 후 다시 시도해주세요.' },

  // 서버 관련 (5xxx)
  INTERNAL_ERROR: { code: 5001, message: '서버 오류가 발생했습니다.' },
  DATABASE_ERROR: { code: 5002, message: '데이터베이스 오류가 발생했습니다.' },
  TRANSACTION_ERROR: { code: 5003, message: '트랜잭션 처리 중 오류가 발생했습니다.' }
};

/**
 * 성공 응답
 * @param {Object} res - Express response 객체
 * @param {*} data - 응답 데이터
 * @param {String} message - 성공 메시지
 * @param {Number} statusCode - HTTP 상태 코드 (기본: 200)
 */
const success = (res, data = null, message = '성공', statusCode = 200) => {
  const response = {
    success: true,
    message
  };

  if (data !== null) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};

/**
 * 에러 응답
 * @param {Object} res - Express response 객체
 * @param {Object} errorCode - ErrorCodes 객체의 에러 코드
 * @param {Number} statusCode - HTTP 상태 코드
 * @param {*} details - 추가 에러 상세 정보 (선택)
 */
const error = (res, errorCode, statusCode = 400, details = null) => {
  const response = {
    success: false,
    code: errorCode.code,
    message: errorCode.message
  };

  if (details !== null) {
    response.details = details;
  }

  return res.status(statusCode).json(response);
};

/**
 * 생성 성공 응답 (201)
 */
const created = (res, data = null, message = '생성되었습니다.') => {
  return success(res, data, message, 201);
};

/**
 * 삭제 성공 응답 (200)
 */
const deleted = (res, message = '삭제되었습니다.') => {
  return success(res, null, message, 200);
};

/**
 * 업데이트 성공 응답 (200)
 */
const updated = (res, data = null, message = '업데이트되었습니다.') => {
  return success(res, data, message, 200);
};

module.exports = {
  ErrorCodes,
  success,
  error,
  created,
  deleted,
  updated
};
