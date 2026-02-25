/**
 * KMC 본인인증 컨트롤러
 *
 * 플로우:
 * 1. requestVerification: 프론트에서 인증 요청 → 암호화된 tr_cert 반환
 * 2. (프론트) KMC 인증창 팝업 → 사용자 인증 수행
 * 3. (프론트) KMC로부터 apiToken + certNum 수신
 * 4. verifyResult: apiToken으로 KMC API 호출 → 복호화 → 검증 → 결과 반환
 */
const axios = require('axios');
const kmcExec = require('../utils/kmcCrypto');
const { User, sequelize } = require('../models');
const { ErrorCodes, success, error } = require('../utils/responseHelper');

const KMC_API_URL = 'https://www.kmcert.com/kmcis/api/kmcisToken_api.jsp';
const EXTEND_VAR = '0000000000000000';

/**
 * 시간 정보 생성 (YYYYMMDDHHMMSS) - KST 기준
 */
const getCurrentTime = () => {
  const now = new Date();
  // KST = UTC + 9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);
};

/**
 * POST /api/auth/kmc/request
 * KMC 본인인증 요청 데이터 생성
 *
 * 프론트에서 이 응답으로 KMC 인증창을 팝업합니다.
 */
const requestVerification = async (req, res) => {
  try {
    const cpId = process.env.KMC_CP_ID;
    const urlCode = process.env.KMC_URL_CODE;
    const trUrl = process.env.KMC_RESULT_URL;

    if (!cpId || !urlCode || !trUrl) {
      console.error('[KMC] 환경변수 미설정: KMC_CP_ID, KMC_URL_CODE, KMC_RESULT_URL');
      return error(res, ErrorCodes.KMC_ENCRYPTION_FAILED, 500);
    }

    // 요청번호 생성 (날짜 + 6자리 랜덤)
    const reqDate = getCurrentTime();
    const random = Math.floor(100000 + Math.random() * 900000);
    const certNum = reqDate + random;

    // 인증방법: T(휴대폰)
    const certMet = 'T';
    // 추가 데이터: 사용자 ID (인증 결과에서 매칭용)
    const plusInfo = req.user ? String(req.user.id) : '';

    // 암호화 대상 문자열 조합
    let trCert = `${cpId}/${urlCode}/${certNum}/${reqDate}/${certMet}///////${plusInfo}/${EXTEND_VAR}`;

    // 1차 암호화
    const tmpEnc = await kmcExec('enc', trCert);
    // 위변조 검증값 생성
    const tmpMsg = await kmcExec('msg', tmpEnc);
    // 2차 암호화
    trCert = await kmcExec('enc', `${tmpEnc}/${tmpMsg}/${EXTEND_VAR}`);

    return success(res, {
      trCert,
      cpId,
      trUrl,
      certNum,
      reqDate,
      certMet,
      plusInfo
    }, '본인인증 요청 데이터가 생성되었습니다.');

  } catch (err) {
    console.error('[KMC] 인증 요청 생성 실패:', err.message);
    return error(res, ErrorCodes.KMC_ENCRYPTION_FAILED, 500,
      process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

/**
 * POST /api/auth/kmc/verify
 * KMC 본인인증 결과 검증 및 사용자 정보 업데이트
 *
 * 프론트에서 KMC 인증 완료 후 받은 apiToken, certNum을 전달합니다.
 */
const verifyResult = async (req, res) => {
  try {
    let { apiToken, certNum } = req.body;

    if (!apiToken || !certNum) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // apiToken이 "null"/"undefined" 문자열인 경우 처리
    if (apiToken === 'null' || apiToken === 'undefined') {
      return error(res, ErrorCodes.KMC_TOKEN_NOT_FOUND, 400);
    }
    if (certNum === 'null' || certNum === 'undefined') {
      return error(res, ErrorCodes.KMC_VERIFY_FAILED, 400);
    }

    // 1. apiToken, certNum 복호화
    const tmpApiToken = await kmcExec('dec', apiToken);
    const tmpCertNum = await kmcExec('dec', certNum);
    const tmpApiDate = getCurrentTime();

    if (!tmpApiToken) {
      console.error('[KMC] apiToken 복호화 실패');
      return error(res, ErrorCodes.KMC_DECRYPTION_FAILED, 500);
    }
    if (!tmpCertNum) {
      console.error('[KMC] certNum 복호화 실패');
      return error(res, ErrorCodes.KMC_DECRYPTION_FAILED, 500);
    }

    // 2. KMC API 호출 (토큰 검증 및 결과 수신)
    const response = await axios.post(KMC_API_URL, {
      apiToken: tmpApiToken,
      apiDate: tmpApiDate
    }, {
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': 'application/json'
      },
      timeout: 20000
    });

    if (response.status !== 200) {
      console.error('[KMC] API 응답 실패:', response.status);
      return error(res, ErrorCodes.KMC_API_ERROR, 500);
    }

    const jsonObj = response.data;

    if (!jsonObj.result_cd) {
      console.error('[KMC] 응답에 result_cd 없음');
      return error(res, ErrorCodes.KMC_API_ERROR, 500);
    }

    // 결과 코드 처리
    switch (jsonObj.result_cd) {
      case 'APR01':
        // 성공 - 아래에서 계속 처리
        break;
      case 'APR02':
        return error(res, ErrorCodes.KMC_TOKEN_EXPIRED, 400);
      case 'APR03':
        return error(res, ErrorCodes.KMC_TOKEN_NOT_FOUND, 400);
      case 'APR04':
      case 'APR05':
        return error(res, ErrorCodes.KMC_VERIFY_FAILED, 400);
      case 'APR06':
        return error(res, { code: 4409, message: '결과 전송 재요청 횟수를 초과했습니다.' }, 400);
      default:
        console.error('[KMC] 알 수 없는 결과 코드:', jsonObj.result_cd);
        return error(res, ErrorCodes.KMC_VERIFY_FAILED, 400);
    }

    // 3. 암호화된 결과 복호화
    const apiRecCert = jsonObj.apiRecCert;

    const tmpDec1 = await kmcExec('dec', apiRecCert);

    const inf1 = tmpDec1.indexOf('/', 0);
    const inf2 = tmpDec1.indexOf('/', inf1 + 1);

    const tmpDec2 = tmpDec1.substring(0, inf1);          // 암호화된 통합 파라미터
    const tmpMsg1 = tmpDec1.substring(inf1 + 1, inf2);   // 암호화된 통합 파라미터의 Hash값

    // 4. 위변조 검증
    const tmpMsg2 = await kmcExec('msg', tmpDec2);

    if (tmpMsg1 !== tmpMsg2) {
      console.error('[KMC] 위변조 검증 실패');
      return error(res, ErrorCodes.KMC_TAMPERING_DETECTED, 400);
    }

    // 5. 최종 복호화 및 결과 파싱
    const recCert = await kmcExec('dec', tmpDec2);
    const recArr = recCert.split('/');

    const CI = await kmcExec('dec', recArr[2]);
    const DI = await kmcExec('dec', recArr[17]);

    const verificationData = {
      certNum: recArr[0],       // 요청번호
      date: recArr[1],          // 요청일시
      ci: CI,                   // 연계정보 (CI)
      phoneNo: recArr[3],       // 휴대폰번호
      phoneCorp: recArr[4],     // 이동통신사
      birth: recArr[5],         // 생년월일
      gender: recArr[6],        // 성별
      nation: recArr[7],        // 내/외국인
      name: recArr[8],          // 성명
      result: recArr[9],        // 결과값
      certMet: recArr[10],      // 인증방법
      plusInfo: recArr[16],     // 추가 데이터 (사용자 ID)
      di: DI                    // 중복가입확인정보 (DI)
    };

    // 6. 사용자 정보 업데이트 (로그인 상태인 경우)
    if (req.user) {
      const userId = req.user.id;

      // DI로 중복 인증 체크 (다른 사용자가 이미 이 DI로 인증한 경우)
      if (verificationData.di) {
        const existingUser = await User.findOne({
          where: {
            di: verificationData.di,
            isActive: true
          }
        });

        if (existingUser && existingUser.id !== userId) {
          return error(res, { code: 4410, message: '이미 다른 계정에서 본인인증이 완료된 정보입니다.' }, 409);
        }
      }

      await User.update({
        name: verificationData.name,
        nickname: verificationData.name,
        phoneNumber: verificationData.phoneNo,
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        ci: verificationData.ci,
        di: verificationData.di,
        birth: verificationData.birth,
        gender: verificationData.gender
      }, {
        where: { id: userId }
      });
    }

    // 7. 프론트에 인증 결과 반환
    return success(res, {
      verified: true,
      name: verificationData.name,
      phoneNumber: verificationData.phoneNo,
      birth: verificationData.birth,
      gender: verificationData.gender
    }, '본인인증이 완료되었습니다.');

  } catch (err) {
    if (err.response) {
      console.error('[KMC] API 응답 에러:', err.response.status, err.response.data);
    } else {
      console.error('[KMC] 인증 결과 검증 실패:', err.message);
    }

    return error(res, ErrorCodes.KMC_API_ERROR, 500,
      process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};

module.exports = {
  requestVerification,
  verifyResult
};
