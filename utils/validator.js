const validator = require('validator');

/**
 * 이메일 유효성 검증
 */
const validateEmail = (email) => {
  if (!email) {
    return { valid: false, message: '이메일을 입력해주세요.' };
  }

  if (!validator.isEmail(email)) {
    return { valid: false, message: '유효하지 않은 이메일 형식입니다.' };
  }

  return { valid: true };
};

/**
 * 비밀번호 유효성 검증
 * - 8~16자 이내
 * - 영문자, 숫자 각 1개 이상 포함 필수
 */
const validatePassword = (password) => {
  if (!password) {
    return { valid: false, message: '비밀번호를 입력해주세요.' };
  }

  if (password.length < 8 || password.length > 16) {
    return { valid: false, message: '비밀번호는 8~16자 이내로 입력해주세요.' };
  }

  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  if (!(hasLetter && hasNumber)) {
    return {
      valid: false,
      message: '비밀번호는 영문자, 숫자를 각각 1개 이상 포함해야 합니다.'
    };
  }

  return { valid: true };
};

/**
 * 전화번호 유효성 검증
 * 한국 전화번호 형식: 010-XXXX-XXXX 또는 01012345678
 */
const validatePhoneNumber = (phone) => {
  if (!phone) {
    return { valid: false, message: '전화번호를 입력해주세요.' };
  }

  // 하이픈 제거
  const cleanedPhone = phone.replace(/-/g, '');

  // 한국 휴대폰 번호 형식 검증 (010, 011, 016, 017, 018, 019)
  const phoneRegex = /^01[0-9]{8,9}$/;

  if (!phoneRegex.test(cleanedPhone)) {
    return { valid: false, message: '유효하지 않은 전화번호입니다.' };
  }

  return { valid: true };
};

/**
 * 이름 유효성 검증
 * - 2~20자
 * - 한글, 영문만 허용
 */
const validateName = (name) => {
  if (!name) {
    return { valid: false, message: '이름을 입력해주세요.' };
  }

  if (name.length < 2 || name.length > 20) {
    return { valid: false, message: '이름은 2~20자 사이여야 합니다.' };
  }

  // 한글, 영문만 허용 (공백 허용)
  const nameRegex = /^[가-힣a-zA-Z\s]+$/;

  if (!nameRegex.test(name)) {
    return { valid: false, message: '이름은 한글 또는 영문만 입력 가능합니다.' };
  }

  return { valid: true };
};

/**
 * URL 유효성 검증
 */
const validateURL = (url) => {
  if (!url) {
    return { valid: true }; // URL은 선택사항일 수 있음
  }

  if (!validator.isURL(url, { require_protocol: true })) {
    return { valid: false, message: '유효하지 않은 URL 형식입니다.' };
  }

  return { valid: true };
};

/**
 * 숫자 범위 검증
 */
const validateNumberRange = (value, min, max, fieldName = '값') => {
  if (value === undefined || value === null) {
    return { valid: false, message: `${fieldName}을(를) 입력해주세요.` };
  }

  const num = Number(value);

  if (isNaN(num)) {
    return { valid: false, message: `${fieldName}은(는) 숫자여야 합니다.` };
  }

  if (min !== undefined && num < min) {
    return { valid: false, message: `${fieldName}은(는) ${min} 이상이어야 합니다.` };
  }

  if (max !== undefined && num > max) {
    return { valid: false, message: `${fieldName}은(는) ${max} 이하여야 합니다.` };
  }

  return { valid: true };
};

/**
 * 문자열 길이 검증
 */
const validateStringLength = (value, min, max, fieldName = '값') => {
  if (!value) {
    return { valid: false, message: `${fieldName}을(를) 입력해주세요.` };
  }

  const length = value.length;

  if (min !== undefined && length < min) {
    return { valid: false, message: `${fieldName}은(는) 최소 ${min}자 이상이어야 합니다.` };
  }

  if (max !== undefined && length > max) {
    return { valid: false, message: `${fieldName}은(는) 최대 ${max}자까지 입력 가능합니다.` };
  }

  return { valid: true };
};

/**
 * 영수증 번호 유효성 검증
 * type별로 다른 검증 규칙 적용
 * - personal: 휴대폰 번호(10-11자리) 또는 현금영수증 카드번호(최대 16자리)
 * - business: 휴대폰 번호(10-11자리) 또는 사업자등록번호(10자리)
 * - tax_invoice: 사업자등록번호(10자리)
 */
const validateReceiptNumber = (number, type) => {
  if (!number || !number.trim()) {
    return { valid: false, message: '영수증 번호를 입력해주세요.' };
  }

  // 숫자만 추출
  const digitsOnly = number.replace(/[^0-9]/g, '');

  if (digitsOnly.length === 0) {
    return { valid: false, message: '영수증 번호는 숫자만 입력 가능합니다.' };
  }

  if (type === 'tax_invoice') {
    // 사업자등록번호만 허용 (10자리)
    if (digitsOnly.length !== 10) {
      return { valid: false, message: '사업자등록번호는 10자리 숫자여야 합니다.' };
    }
  } else if (type === 'personal') {
    // 휴대폰(10-11자리) 또는 현금영수증 카드번호(최대 16자리)
    if (digitsOnly.length < 10 || digitsOnly.length > 16) {
      return { valid: false, message: '휴대폰 번호(10-11자리) 또는 현금영수증 카드번호(최대 16자리)를 입력해주세요.' };
    }
  } else if (type === 'business') {
    // 휴대폰(10-11자리) 또는 사업자등록번호(10자리)
    if (digitsOnly.length < 10 || digitsOnly.length > 11) {
      return { valid: false, message: '휴대폰 번호(10-11자리) 또는 사업자등록번호(10자리)를 입력해주세요.' };
    }
  }

  return { valid: true };
};

module.exports = {
  validateEmail,
  validatePassword,
  validatePhoneNumber,
  validateName,
  validateURL,
  validateNumberRange,
  validateStringLength,
  validateReceiptNumber
};
