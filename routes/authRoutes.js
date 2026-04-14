const express = require('express');
const router = express.Router();
const { register, login, refreshToken, logout, getProfile, switchUserMode, devBypassLogin, resetPassword } = require('../controllers/authController');
const { kakaoLogin } = require('../controllers/oauthController');
const { sendVerificationCode, verifyEmail, resendVerificationCode } = require('../controllers/emailVerificationController');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter, loginLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');

const isTest = process.env.NODE_ENV === 'test';

// === 이메일 인증 관련 라우트 (Rate Limiting 적용) ===
router.post('/send-verification-code', ...(isTest ? [] : [authLimiter]), sendVerificationCode);
router.post('/verify-email', ...(isTest ? [] : [authLimiter]), verifyEmail);
router.post('/resend-verification-code', ...(isTest ? [] : [authLimiter]), resendVerificationCode);

// === 일반 회원가입/로그인 (Rate Limiting 적용) ===
router.post('/register', ...(isTest ? [] : [authLimiter]), register);
router.post('/login', ...(isTest ? [] : [loginLimiter]), login);

// === 비밀번호 재설정 (비로그인, 이메일 인증 후) ===
router.post('/reset-password', ...(isTest ? [] : [passwordResetLimiter]), resetPassword);
router.post('/refresh', refreshToken);
router.post('/logout', authenticateToken, logout);

// 소셜 로그인
router.post('/kakao', kakaoLogin);
router.get('/kakao', async (req, res) => {
  const { code, state } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  console.log('🔍 [Kakao Callback] FRONTEND_URL:', process.env.FRONTEND_URL);
  console.log('🔍 [Kakao Callback] frontendUrl:', frontendUrl);

  const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';

  if (code) {
    try {
      // code를 body로 변환해서 kakaoLogin 호출
      req.body = { code };

      // 응답을 가로채서 프론트엔드로 리디렉트
      const originalJson = res.json;
      res.json = function(data) {
        if (data.success) {
          // 성공 시 JWT 토큰만 전달 (사용자 데이터는 토큰에 포함됨)
          const { accessToken, refreshToken } = data.data;
          const redirectUrl = `${frontendUrl}/auth/callback?token=${accessToken}&refresh=${refreshToken}${stateParam}`;
          console.log('🔍 [Kakao Callback] redirect URL state:', state, '| stateParam:', stateParam);
          res.redirect(redirectUrl);
        } else {
          // 실패 시 에러 메시지와 함께 리디렉트
          res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(data.message)}${stateParam}`);
        }
      };

      kakaoLogin(req, res);
    } catch (error) {
      res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent('로그인 중 오류가 발생했습니다.')}${stateParam}`);
    }
  } else {
    res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent('카카오 인증 코드가 필요합니다.')}${stateParam}`);
  }
});

// 사용자 프로필
router.get('/profile', authenticateToken, getProfile);

// 유저 모드 전환
router.patch('/mode', authenticateToken, switchUserMode);

// 개발 환경 전용 로그인 우회 (프로덕션에서 자동 차단됨)
router.get('/dev-bypass/:userid', devBypassLogin);

// 개발 환경 전용 이메일 발송 테스트 (프로덕션에서 자동 차단됨)
router.post('/test-email', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: '개발 환경에서만 사용 가능합니다.' });
  }

  try {
    const { sendVerificationEmail, isConfigured } = require('../utils/email');
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'email 필드가 필요합니다.' });
    }

    // AWS SES 설정 확인
    const configured = isConfigured();
    console.log('📧 AWS SES 설정 여부:', configured);
    console.log('📧 EMAIL_FROM:', process.env.EMAIL_FROM);
    console.log('📧 수신자 이메일:', email);

    if (!configured) {
      return res.status(500).json({
        success: false,
        message: 'AWS SES 인증 정보가 설정되지 않았습니다.',
        debug: {
          AWS_SES_CONFIGURED: configured,
          EMAIL_FROM: process.env.EMAIL_FROM
        }
      });
    }

    // 테스트 이메일 발송
    const testCode = '123456';
    const result = await sendVerificationEmail(email, testCode, 'signup');

    if (result) {
      return res.json({
        success: true,
        message: '테스트 이메일이 발송되었습니다. AWS SES 콘솔에서 확인하세요.',
        debug: {
          from: process.env.EMAIL_FROM,
          to: email,
          code: testCode,
          sesConfigured: configured
        }
      });
    } else {
      return res.status(500).json({
        success: false,
        message: '이메일 발송에 실패했습니다. 서버 로그를 확인하세요.'
      });
    }
  } catch (error) {
    console.error('❌ 테스트 이메일 발송 에러:', error);
    return res.status(500).json({
      success: false,
      message: '서버 오류',
      error: error.message
    });
  }
});

module.exports = router;