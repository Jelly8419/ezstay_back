/**
 * PayTag PG 결제 클라이언트
 *
 * PayTag API 연동을 위한 유틸리티 모듈
 * - 결제 승인 (API Direct 방식, resType="1")
 * - 결제 취소/환불
 * - AES256 암호화
 */

const axios = require('axios');
const crypto = require('crypto');

// PayTag 환경 설정
const PAYTAG_API_URL = process.env.PAYTAG_API_URL || 'https://apit.paytag.kr';
const PAYTAG_SHOPCODE = process.env.PAYTAG_SHOPCODE;
const PAYTAG_SERVICECODE = process.env.PAYTAG_SERVICECODE || 'PAYTAG';
const PAYTAG_API_KEY = process.env.PAYTAG_API_KEY; // 32 bytes
const PAYTAG_IV = '0000000000000000'; // 16 bytes, PayTag 고정값

/**
 * AES256-CBC 암호화
 * PayTag certval 생성에 사용
 */
function aes256Encrypt(plainText, key, iv) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

/**
 * certval 생성
 * format: "SERVICECODE|CMDTYPE|SHOPCODE|추가값..."
 */
function generateCertval(cmdType, ...additionalFields) {
  const certStr = [PAYTAG_SERVICECODE, cmdType, PAYTAG_SHOPCODE, ...additionalFields].join('|');
  return aes256Encrypt(certStr, PAYTAG_API_KEY, PAYTAG_IV);
}

/**
 * PayTag API 공통 헤더
 */
function getHeaders() {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    'CharSet': 'UTF-8',
    'Accept-Language': 'ko'
  };
}

/**
 * PayTag API 공통 파라미터
 */
function getBaseParams() {
  return {
    servicecode: PAYTAG_SERVICECODE,
    reqtype: 'L',
    restype: 'J',
    shopcode: PAYTAG_SHOPCODE,
    apiver: '1'
  };
}

/**
 * 결제 승인 (API Direct 방식)
 * 프론트 SDK에서 받은 recv_payparam을 전달하여 최종 승인
 *
 * @param {Object} params
 * @param {string} params.recvPayparam - SDK 콜백에서 받은 암호화 데이터
 * @param {string} params.payType - 결제 수단 (CARD, KAKAO, NAVER 등)
 * @returns {Object} PayTag 결제 응답
 */
async function confirmPayment({ recvPayparam, payType }) {
  // payType에 따라 엔드포인트 분기
  const isVbankOrLink = ['VBANK', 'TAGLINK'].includes(payType);
  const endpoint = isVbankOrLink ? '/order/reqorder' : '/pay/cardkeyin';

  // recv_payparam은 SDK에서 생성한 완전한 POST body (URL-encoded form data)
  // 그대로 전달해야 함 (추가 파라미터 감싸지 않음)
  const response = await axios.post(
    `${PAYTAG_API_URL}${endpoint}`,
    recvPayparam,
    { headers: getHeaders() }
  );

  const data = response.data;

  if (data.resultcode !== '0000') {
    const err = new Error(data.errmsg || 'PayTag 결제 승인 실패');
    err.paytagErrorCode = data.resultcode;
    err.paytagErrorMessage = data.errmsg;
    err.paytagResponse = data;
    throw err;
  }

  return data;
}

/**
 * 결제 취소/환불
 * TODO: PayTag 환불 API 문서 수령 후 구현 필요
 * 현재는 스텁 함수 (호출 시 에러 발생)
 *
 * @param {Object} params
 * @param {string} params.orderno - 주문번호
 * @param {string} params.paymentKey - 거래키
 * @param {number} params.cancelAmount - 취소 금액
 * @param {string} params.cancelReason - 취소 사유
 * @param {number} [params.totalAmount] - 원 결제 금액
 */
async function cancelPayment(params) {
  throw new Error('PayTag 환불 API 미구현: 환불 API 문서 수령 후 구현 필요');
}

/**
 * PayTag 결제 수단 → 내부 결제 수단 매핑
 */
function mapPaymentMethod(paytagPayType) {
  const methodMap = {
    // 신용카드
    'BC': 'CARD', 'KB': 'CARD', 'SH': 'CARD', 'JB': 'CARD', 'KJ': 'CARD',
    'WR': 'CARD', 'KA': 'CARD', 'HN': 'CARD', 'SK': 'CARD', 'SS': 'CARD',
    'HD': 'CARD', 'LT': 'CARD', 'SIN': 'CARD', 'CT': 'CARD', 'NH': 'CARD',
    'CARD': 'CARD',
    // 간편결제
    'KAKAO': 'EASY_PAY', 'NAVER': 'EASY_PAY', 'PAYCO': 'EASY_PAY',
    // 카드 키인
    'TAGKEYIN': 'CARD',
    // 가상계좌
    'VBANK': 'VIRTUAL_ACCOUNT',
    // 링크결제
    'TAGLINK': 'TRANSFER'
  };
  return methodMap[paytagPayType] || 'CARD';
}

/**
 * PayTag 결제 수단 → Contract paymentMethod 매핑
 */
function mapContractPaymentMethod(paytagPayType) {
  const methodMap = {
    'CARD': 'CREDIT_CARD', 'BC': 'CREDIT_CARD', 'KB': 'CREDIT_CARD',
    'SH': 'CREDIT_CARD', 'JB': 'CREDIT_CARD', 'KJ': 'CREDIT_CARD',
    'WR': 'CREDIT_CARD', 'KA': 'CREDIT_CARD', 'HN': 'CREDIT_CARD',
    'SK': 'CREDIT_CARD', 'SS': 'CREDIT_CARD', 'HD': 'CREDIT_CARD',
    'LT': 'CREDIT_CARD', 'SIN': 'CREDIT_CARD', 'CT': 'CREDIT_CARD',
    'NH': 'CREDIT_CARD', 'TAGKEYIN': 'CREDIT_CARD',
    'KAKAO': 'SIMPLE_PAY', 'NAVER': 'SIMPLE_PAY', 'PAYCO': 'SIMPLE_PAY',
    'VBANK': 'BANK_TRANSFER',
    'TAGLINK': 'BANK_TRANSFER'
  };
  return methodMap[paytagPayType] || 'CREDIT_CARD';
}

/**
 * 테스트 환경 결제 금액 오버라이드
 * PAYMENT_TEST_AMOUNT 설정 시 PG 결제금액을 해당 값으로 대체
 * DB에는 원래 금액이 저장됨
 * 가상계좌(VBANK), 링크결제(TAGLINK)는 최소금액 제한이 있어 테스트 금액 적용 제외
 *
 * @param {string} [payType] - 결제 수단 (VBANK, TAGLINK 등)
 * @returns {number|null} 테스트 금액 (미설정 또는 제외 대상 시 null)
 */
function getTestAmount(payType) {
  const testAmount = process.env.PAYMENT_TEST_AMOUNT;
  if (!testAmount) return null;
  if (process.env.NODE_ENV === 'production') return null;
  // 가상계좌/링크결제는 최소금액 제한이 있어 실제 금액으로 결제
  if (['VBANK', 'TAGLINK'].includes(payType)) return null;
  return parseInt(testAmount, 10);
}

/**
 * 테스트 모드 여부
 */
function isTestAmountMode() {
  return getTestAmount() !== null;
}

/**
 * PayTag 설정 검증
 */
function validateConfig() {
  const missing = [];
  if (!PAYTAG_SHOPCODE) missing.push('PAYTAG_SHOPCODE');
  if (!PAYTAG_API_KEY) missing.push('PAYTAG_API_KEY');
  if (missing.length > 0) {
    throw new Error(`PayTag 설정 누락: ${missing.join(', ')}`);
  }
}

module.exports = {
  confirmPayment,
  cancelPayment,
  mapPaymentMethod,
  mapContractPaymentMethod,
  validateConfig,
  getTestAmount,
  isTestAmountMode,
  // 내부 유틸 (테스트용)
  aes256Encrypt,
  generateCertval
};
