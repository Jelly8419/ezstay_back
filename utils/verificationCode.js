const crypto = require('crypto');

/**
 * 6자리 랜덤 숫자 인증코드 생성
 * @returns {string} 6자리 숫자 문자열
 */
const generateVerificationCode = () => {
  // crypto 사용 (더 안전한 랜덤)
  const randomNumber = crypto.randomInt(100000, 1000000);
  return randomNumber.toString();
};

/**
 * 인증코드 만료 시간 계산
 * @param {number} expiresInSeconds - 만료 시간 (초, 기본 5분)
 * @returns {Date} 만료 시간
 */
const getExpirationTime = (expiresInSeconds = 300) => {
  const seconds = parseInt(process.env.EMAIL_VERIFICATION_CODE_EXPIRES_IN || expiresInSeconds);
  return new Date(Date.now() + seconds * 1000);
};

/**
 * 인증코드 만료 여부 확인
 * @param {Date} expiresAt - 만료 시간
 * @returns {boolean} 만료 여부
 */
const isCodeExpired = (expiresAt) => {
  return new Date() > new Date(expiresAt);
};

/**
 * 마지막 발송 이후 경과 시간 확인 (재발송 제한)
 * @param {Date} lastSentAt - 마지막 발송 시간
 * @param {number} minIntervalSeconds - 최소 간격 (초, 기본 60초)
 * @returns {boolean} 재발송 가능 여부
 */
const canResend = (lastSentAt, minIntervalSeconds = 60) => {
  if (!lastSentAt) return true;

  const elapsedSeconds = (Date.now() - new Date(lastSentAt).getTime()) / 1000;
  return elapsedSeconds >= minIntervalSeconds;
};

/**
 * 일일 발송 횟수 확인
 * @param {number} count - 오늘 발송한 횟수
 * @param {number} maxDaily - 일일 최대 횟수 (기본 10회)
 * @returns {boolean} 발송 가능 여부
 */
const canSendToday = (count, maxDaily = 10) => {
  return count < maxDaily;
};

module.exports = {
  generateVerificationCode,
  getExpirationTime,
  isCodeExpired,
  canResend,
  canSendToday
};
