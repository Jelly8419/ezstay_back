const axios = require('axios');
const { UserBankAccount } = require('../models');
const { ErrorCodes, success, error, deleted } = require('../utils/responseHelper');

// 아임포트 API 은행 코드 매핑
const BANK_CODES = {
  '국민은행': '004',
  '신한은행': '088',
  '우리은행': '020',
  '하나은행': '081',
  'KB국민은행': '004',
  '기업은행': '003',
  '농협은행': '011',
  '카카오뱅크': '090',
  '토스뱅크': '092',
  '새마을금고': '045',
  '신협': '048',
  '우체국예금보험': '071',
  '경남은행': '039',
  '광주은행': '034',
  '대구은행': '031',
  '부산은행': '032',
  '수협은행': '007',
  '전북은행': '037',
  '제주은행': '035',
  '산업은행': '002',
  '수출입은행': '008',
  'SC제일은행': '023',
  '씨티은행': '027'
};

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
    const { bank_code, account_num, account_holder_name } = req.body;

    // 입력값 검증
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

    // 아임포트 API로 계좌 실명 확인
    const verificationResult = await verifyAccountWithIamport(bankCode, cleanAccountNum);

    if (!verificationResult.success) {
      return error(res, { code: 4302, message: verificationResult.error || '계좌 확인에 실패했습니다.' }, 400);
    }

    // 예금주명 비교
    const verified = verificationResult.accountHolderName === account_holder_name;

    // 실명 확인만 하고 저장은 하지 않음
    return success(res, {
      verified: verified,
      accountHolderName: verificationResult.accountHolderName,
      bankName: getBankNameByCode(bankCode),
      inputName: account_holder_name
    }, verified ? '계좌 확인이 완료되었습니다.' : '계좌 정보가 일치하지 않습니다.');

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

    return deleted(res, '계좌 정보가 삭제되었습니다.');

  } catch (err) {
    console.error('계좌 삭제 오류:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  verifyAccount,
  getUserAccount,
  deleteAccount
};