const axios = require('axios');
const { UserBankAccount, GuestRefundAccount } = require('../models');
const { ErrorCodes, success, error, created, deleted } = require('../utils/responseHelper');
const { BANK_NAME_TO_CODE: BANK_CODES } = require('../utils/bankCodes');

// 아임포트 액세스 토큰 캐시
let accessTokenCache = {
  token: null,
  expiresAt: 0
};

// 아임포트 액세스 토큰 발급
const getIamportAccessToken = async () => {
  try {
    // 캐시된 토큰이 있고 아직 유효한지 확인 (5분 여유두고)
    const now = Math.floor(Date.now() / 1000);
    if (accessTokenCache.token && accessTokenCache.expiresAt > now + 300) {
      return accessTokenCache.token;
    }

    console.log('아임포트 액세스 토큰 발급 중...');

    const response = await axios.post('https://api.iamport.kr/users/getToken', {
      imp_key: process.env.PORTONE_API_KEY,
      imp_secret: process.env.PORTONE_API_SECRET
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const data = response.data;

    if (data.code === 0 && data.response.access_token) {
      // 토큰 캐시에 저장
      accessTokenCache.token = data.response.access_token;
      accessTokenCache.expiresAt = data.response.expired_at;

      console.log('아임포트 액세스 토큰 발급 완료');
      return data.response.access_token;
    } else {
      throw new Error(data.message || '토큰 발급 실패');
    }
  } catch (error) {
    console.error('아임포트 토큰 발급 오류:', error.message);
    throw error;
  }
};

// 아임포트 API로 계좌 실명 확인
const verifyAccountWithIamport = async (bankCode, accountNum) => {
  try {
    // 액세스 토큰 획득
    const accessToken = await getIamportAccessToken();

    const requestUrl = 'https://api.iamport.kr/vbanks/holder';
    console.log(`요청 URL: ${requestUrl}`);
    console.log(`은행코드: ${bankCode}, 계좌번호: ${accountNum}`);
    console.log(`액세스토큰: ${accessToken.substring(0, 20)}...`);

    const response = await axios.get(requestUrl, {
      params: {
        bank_code: bankCode,
        bank_num: accountNum
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 10000
    });

    const data = response.data;

    if (data.code === 0 && data.response.bank_holder) {
      return {
        success: true,
        accountHolderName: data.response.bank_holder
      };
    } else {
      return {
        success: false,
        error: data.message || '계좌 확인 실패'
      };
    }
  } catch (error) {
    console.error('아임포트 계좌 확인 오류:', error.message);

    if (error.response) {
      console.error('응답 상태코드:', error.response.status);
      console.error('응답 데이터:', error.response.data);
      console.error('요청 URL:', error.config?.url);
    } else if (error.request) {
      console.error('요청이 전송되지 않음:', error.request);
    }


    throw error;
  }
};

// 은행 코드로 은행명 조회
const getBankNameByCode = (bankCode) => {
  const bankEntry = Object.entries(BANK_CODES).find(([name, code]) => code === bankCode);
  return bankEntry ? bankEntry[0] : '알 수 없는 은행';
};

// 계좌 실명 확인 엔드포인트
const verifyAccount = async (req, res) => {
  try {
    const { bank_code, account_num } = req.body;

    // 입력값 검증
    if (!bank_code || !account_num) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 계좌번호 형식 정리 (하이픈 제거)
    const cleanAccountNum = account_num.replace(/-/g, '');

    // 은행 코드 확인
    const bankCode = BANK_CODES[bank_code] || bank_code;
    if (!bankCode) {
      return error(res, { code: 4301, message: '지원하지 않는 은행입니다.' }, 400);
    }

    // 아임포트 API로 계좌 실명 확인
    const verificationResult = await verifyAccountWithIamport(bankCode, cleanAccountNum);

    if (!verificationResult.success) {
      return error(res, { code: 4302, message: verificationResult.error || '계좌 확인에 실패했습니다.' }, 400);
    }

    // API에서 받은 예금주명을 그대로 반환
    return success(res, {
      verified: true,
      accountHolderName: verificationResult.accountHolderName,
      bankName: getBankNameByCode(bankCode)
    }, '계좌 확인이 완료되었습니다.');

  } catch (err) {
    console.error('계좌 확인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 사용자 계좌 정보 조회
const getUserAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    const account = await UserBankAccount.findOne({
      where: { userId },
      attributes: ['id', 'bankName', 'accountNumber', 'accountHolder', 'isVerified', 'verifiedAt', 'isPrimary']
    });

    if (!account) {
      return error(res, { code: 3005, message: '등록된 계좌가 없습니다.' }, 404);
    }

    return success(res, {
      account: {
        ...account.toJSON(),
        // 계좌번호 마스킹 (보안)
        accountNumber: account.accountNumber.replace(/(\d{4})\d{4,}(\d{4})/, '$1****$2')
      }
    });

  } catch (err) {
    console.error('계좌 정보 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// 계좌 정보 추가/수정 (게스트 → 호스트 전환용)
const saveAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bank_code, account_num, account_holder_name } = req.body;

    // 필수 필드 검증
    if (!bank_code || !account_num || !account_holder_name) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 계좌번호 형식 정리 (하이픈 제거)
    const cleanAccountNum = account_num.replace(/-/g, '');

    // 은행 코드 확인
    const bankCode = BANK_CODES[bank_code] || bank_code;
    if (!bankCode) {
      return error(res, { code: 4301, message: '지원하지 않는 은행입니다.' }, 400);
    }

    // 기존 계좌 확인
    const existingAccount = await UserBankAccount.findOne({
      where: { userId }
    });

    const accountData = {
      userId,
      bankName: bank_code,
      accountNumber: cleanAccountNum,
      accountHolder: account_holder_name,
      isVerified: true,
      verifiedAt: new Date(),
      isPrimary: true
    };

    let account;
    let message;

    if (existingAccount) {
      // 기존 계좌 수정
      await existingAccount.update(accountData);
      account = existingAccount;
      message = '계좌 정보가 수정되었습니다.';
    } else {
      // 신규 계좌 추가
      account = await UserBankAccount.create(accountData);
      message = '계좌 정보가 등록되었습니다.';
    }

    return success(res, {
      account: {
        id: account.id,
        bankName: account.bankName,
        accountHolder: account.accountHolder,
        isVerified: account.isVerified,
        verifiedAt: account.verifiedAt,
        isPrimary: account.isPrimary
      }
    }, message);

  } catch (err) {
    console.error('계좌 저장 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 계좌 정보 삭제
const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    const deleted = await UserBankAccount.destroy({
      where: { userId }
    });

    if (deleted === 0) {
      return error(res, { code: 3005, message: '삭제할 계좌가 없습니다.' }, 404);
    }

    return success(res, null, '계좌 정보가 삭제되었습니다.');

  } catch (err) {
    console.error('계좌 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

// =====================================================
// 게스트 환급 계좌 관련 (호스트 정산계좌와 별도)
// =====================================================

// 환급 계좌 예금주 확인 (아임포트)
const verifyRefundAccount = async (req, res) => {
  try {
    const { bank_code, account_num, account_holder_name } = req.body;

    if (!bank_code || !account_num || !account_holder_name) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const cleanAccountNum = account_num.replace(/-/g, '');

    // 은행 코드 변환 (은행명 → 코드, 이미 코드면 그대로)
    const bankCode = BANK_CODES[bank_code] || bank_code;
    if (!bankCode || bankCode.length !== 3) {
      return error(res, ErrorCodes.UNSUPPORTED_BANK, 400);
    }

    const verificationResult = await verifyAccountWithIamport(bankCode, cleanAccountNum);

    if (!verificationResult.success) {
      return error(res, ErrorCodes.REFUND_ACCOUNT_VERIFY_FAILED, 400);
    }

    const verified = verificationResult.accountHolderName === account_holder_name;

    return success(res, {
      verified,
      accountHolderName: verificationResult.accountHolderName,
      bankName: getBankNameByCode(bankCode),
      inputName: account_holder_name
    }, verified ? '예금주 확인이 완료되었습니다.' : '예금주 정보가 일치하지 않습니다.');

  } catch (err) {
    console.error('환급 계좌 예금주 확인 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 환급 계좌 조회
const getRefundAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    const account = await GuestRefundAccount.findOne({
      where: { userId },
      attributes: ['id', 'bankCode', 'bankName', 'accountNumber', 'accountHolder', 'isVerified', 'verifiedAt', 'createdAt', 'updatedAt']
    });

    if (!account) {
      return success(res, { account: null }, '등록된 환급 계좌가 없습니다.');
    }

    return success(res, {
      account: {
        ...account.toJSON(),
        // 계좌번호 마스킹 (보안)
        accountNumber: account.accountNumber.replace(/(\d{3})\d+(\d{4})/, '$1****$2')
      }
    });

  } catch (err) {
    console.error('환급 계좌 조회 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 환급 계좌 저장/수정
const saveRefundAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bank_code, account_num, account_holder_name } = req.body;

    if (!bank_code || !account_num || !account_holder_name) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    const cleanAccountNum = account_num.replace(/-/g, '');

    // 은행 코드 변환
    const bankCode = BANK_CODES[bank_code] || bank_code;
    if (!bankCode || bankCode.length !== 3) {
      return error(res, ErrorCodes.UNSUPPORTED_BANK, 400);
    }

    const bankName = getBankNameByCode(bankCode);

    const existingAccount = await GuestRefundAccount.findOne({
      where: { userId }
    });

    const accountData = {
      userId,
      bankCode,
      bankName,
      accountNumber: cleanAccountNum,
      accountHolder: account_holder_name,
      isVerified: false,
      verifiedAt: null
    };

    let account;
    let message;
    let statusCode;

    if (existingAccount) {
      await existingAccount.update(accountData);
      account = existingAccount;
      message = '환급 계좌가 수정되었습니다.';
      statusCode = 200;
    } else {
      account = await GuestRefundAccount.create(accountData);
      message = '환급 계좌가 등록되었습니다.';
      statusCode = 201;
    }

    return success(res, {
      account: {
        id: account.id,
        bankCode: account.bankCode,
        bankName: account.bankName,
        accountNumber: account.accountNumber.replace(/(\d{3})\d+(\d{4})/, '$1****$2'),
        accountHolder: account.accountHolder,
        isVerified: account.isVerified
      }
    }, message, statusCode);

  } catch (err) {
    console.error('환급 계좌 저장 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

// 환급 계좌 삭제
const deleteRefundAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    const deletedCount = await GuestRefundAccount.destroy({
      where: { userId }
    });

    if (deletedCount === 0) {
      return error(res, ErrorCodes.REFUND_ACCOUNT_NOT_FOUND, 404);
    }

    return deleted(res, '환급 계좌가 삭제되었습니다.');

  } catch (err) {
    console.error('환급 계좌 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

module.exports = {
  verifyAccount,
  getUserAccount,
  saveAccount,
  deleteAccount,
  // 게스트 환급 계좌
  verifyRefundAccount,
  getRefundAccount,
  saveRefundAccount,
  deleteRefundAccount
};