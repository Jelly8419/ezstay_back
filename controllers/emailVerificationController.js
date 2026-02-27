const { EmailVerificationCode, User, SocialUser } = require('../models');
const { success, error, ErrorCodes } = require('../utils/responseHelper');
const { validateEmail } = require('../utils/validator');
const { sendVerificationEmail } = require('../utils/email');
const {
  generateVerificationCode,
  getExpirationTime,
  isCodeExpired
} = require('../utils/verificationCode');
const { Op } = require('sequelize');

/**
 * 인증코드 발송
 * @route POST /api/auth/send-verification-code
 * @body {string} email - 이메일 주소
 * @body {string} [type] - 'signup' | 'password_reset' (기본: 'signup')
 */
const sendVerificationCode = async (req, res) => {
  try {
    const { email, type = 'signup' } = req.body;

    // 이메일 검증
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return error(res, ErrorCodes.INVALID_EMAIL, 400);
    }

    // 회원가입 타입인 경우 중복 확인
    if (type === 'signup') {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        if (existingUser.userType === 'social') {
          const socialAccount = await SocialUser.findOne({
            where: { userId: existingUser.id }
          });
          const platform = socialAccount?.provider || '소셜';
          return error(res, {
            ...ErrorCodes.EMAIL_EXISTS_AS_SOCIAL,
            message: `이미 가입된 이메일입니다. ${platform} 로그인을 시도해 주세요`
          }, 400);
        }
        return error(res, ErrorCodes.DUPLICATE_EMAIL, 400);
      }
    }

    // 비밀번호 재설정 타입인 경우 로컬 회원 확인
    if (type === 'password_reset') {
      const existingUser = await User.findOne({ where: { email } });
      if (!existingUser) {
        return error(res, ErrorCodes.USER_NOT_FOUND, 404);
      }
      if (existingUser.userType === 'social') {
        const socialAccount = await SocialUser.findOne({
          where: { userId: existingUser.id }
        });
        const platform = socialAccount?.provider || '소셜';
        return error(res, {
          code: 4016,
          message: `소셜 로그인 회원입니다. ${platform} 로그인을 이용해주세요.`
        }, 400);
      }
    }

    // 재발송 제한 확인 (1분)
    const recentCode = await EmailVerificationCode.findOne({
      where: {
        email,
        createdAt: {
          [Op.gte]: new Date(Date.now() - 60 * 1000) // 최근 1분
        }
      },
      order: [['createdAt', 'DESC']]
    });

    if (recentCode) {
      return error(res, {
        code: 4290,
        message: '인증코드는 1분에 한 번만 발송할 수 있습니다.'
      }, 429);
    }

    // 일일 발송 횟수 확인 (10회)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCount = await EmailVerificationCode.count({
      where: {
        email,
        createdAt: {
          [Op.gte]: today
        }
      }
    });

    if (todayCount >= 10) {
      return error(res, {
        code: 4291,
        message: '일일 인증코드 발송 횟수를 초과했습니다. 내일 다시 시도해주세요.'
      }, 429);
    }

    // 인증코드 생성
    const code = generateVerificationCode();
    const expiresAt = getExpirationTime();

    // IP 주소 추출
    const ipAddress = req.ip || req.connection.remoteAddress;

    // DB 저장
    await EmailVerificationCode.create({
      email,
      code,
      expiresAt,
      ipAddress
    });

    // 이메일 발송
    const emailSent = await sendVerificationEmail(email, code, type);

    if (!emailSent) {
      return error(res, ErrorCodes.EMAIL_SEND_FAILED, 500);
    }

    return success(res, {
      email,
      expiresIn: 300 // 5분 (초 단위)
    }, '인증코드가 이메일로 전송되었습니다.');

  } catch (err) {
    console.error('인증코드 발송 에러:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 인증코드 검증
 * @route POST /api/auth/verify-email
 * @body {string} email - 이메일 주소
 * @body {string} code - 6자리 인증코드
 */
const verifyEmail = async (req, res) => {
  try {
    const { email, code } = req.body;

    // 필수 필드 검증
    if (!email || !code) {
      return error(res, ErrorCodes.MISSING_REQUIRED_FIELDS, 400);
    }

    // 이메일 검증
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return error(res, ErrorCodes.INVALID_EMAIL, 400);
    }

    // 인증코드 조회 (최신 순)
    const verificationRecord = await EmailVerificationCode.findOne({
      where: {
        email,
        verified: false
      },
      order: [['createdAt', 'DESC']]
    });

    if (!verificationRecord) {
      return error(res, ErrorCodes.CODE_NOT_FOUND, 400);
    }

    // 만료 확인
    if (isCodeExpired(verificationRecord.expiresAt)) {
      return error(res, ErrorCodes.CODE_EXPIRED, 400);
    }

    // 시도 횟수 확인 (5회 제한)
    if (verificationRecord.attempts >= 5) {
      return error(res, ErrorCodes.MAX_ATTEMPTS_EXCEEDED, 400);
    }

    // 코드 일치 확인
    if (verificationRecord.code !== code) {
      // 시도 횟수 증가
      await verificationRecord.update({
        attempts: verificationRecord.attempts + 1
      });

      return error(res, ErrorCodes.INVALID_CODE, 400, {
        remainingAttempts: 5 - (verificationRecord.attempts + 1)
      });
    }

    // 인증 완료 처리
    await verificationRecord.update({
      verified: true,
      verifiedAt: new Date()
    });

    return success(res, {
      email,
      verifiedAt: verificationRecord.verifiedAt
    }, '이메일 인증이 완료되었습니다.');

  } catch (err) {
    console.error('이메일 인증 에러:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

/**
 * 인증코드 재발송
 * @route POST /api/auth/resend-verification-code
 * @body {string} email - 이메일 주소
 */
const resendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;

    // 이메일 검증
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      return error(res, ErrorCodes.INVALID_EMAIL, 400);
    }

    // 기존 코드 무효화 (verified: false인 것만)
    await EmailVerificationCode.update(
      { verified: true }, // 사용됨으로 표시 (재사용 방지)
      {
        where: {
          email,
          verified: false
        }
      }
    );

    // 새 코드 발송 (sendVerificationCode 로직 재사용)
    return sendVerificationCode(req, res);

  } catch (err) {
    console.error('인증코드 재발송 에러:', err);
    return error(res, ErrorCodes.INTERNAL_ERROR, 500, err.message);
  }
};

module.exports = {
  sendVerificationCode,
  verifyEmail,
  resendVerificationCode
};
