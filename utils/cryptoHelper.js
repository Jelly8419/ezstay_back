/**
 * cryptoHelper.js
 * AES-256-GCM 기반 대칭키 암/복호화 유틸
 *
 * - 용도: 입주 준비 서비스의 도어락/공동현관 비밀번호 등 민감 정보 저장
 * - 키 출처: 환경변수 MOVE_IN_PASSWORD_KEY (base64 인코딩된 32바이트)
 * - 출력 포맷: base64( iv(12) || authTag(16) || ciphertext )
 *
 * Why GCM: 인증된 암호화(AEAD) 제공 → 위변조 탐지 가능
 * Why 단일 base64 문자열: VARCHAR 컬럼 1개에 저장하여 스키마 단순화
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;       // GCM 권장 IV 길이
const TAG_BYTES = 16;      // GCM auth tag 고정 길이
const KEY_BYTES = 32;      // AES-256

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;

  const raw = process.env.MOVE_IN_PASSWORD_KEY;
  if (!raw) {
    throw new Error('MOVE_IN_PASSWORD_KEY 환경변수가 설정되지 않았습니다.');
  }

  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`MOVE_IN_PASSWORD_KEY는 base64 인코딩된 ${KEY_BYTES}바이트여야 합니다. (현재: ${buf.length}바이트)`);
  }

  cachedKey = buf;
  return cachedKey;
}

/**
 * 평문을 AES-256-GCM으로 암호화하여 base64 문자열로 반환.
 * @param {string|null|undefined} plain
 * @returns {string|null} base64 문자열 또는 null (입력이 빈 값이면 null)
 */
function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;

  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(String(plain), 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * encrypt()로 생성된 base64 문자열을 평문으로 복호화.
 * @param {string|null|undefined} encoded
 * @returns {string|null} 평문 또는 null
 */
function decrypt(encoded) {
  if (encoded === null || encoded === undefined || encoded === '') return null;

  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');

  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('암호문 형식이 올바르지 않습니다.');
  }

  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plain = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return plain.toString('utf8');
}

module.exports = {
  encrypt,
  decrypt
};
